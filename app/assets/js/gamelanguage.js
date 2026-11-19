/**
 * Langue de Minecraft = langue du launcher (ligne "lang:" de options.txt, ex : lang:fr_fr).
 * Appele juste avant chaque lancement du jeu (landing.js -> dlAsync).
 *
 * Regles :
 *  - options.txt existe : on change la langue seulement si la langue du launcher a change
 *    depuis la derniere fois (fichier nerysia-lang.json dans le dossier de l'instance).
 *    Un joueur qui choisit une autre langue DANS le jeu la garde donc ensuite.
 *  - options.txt n'existe pas (1er lancement) :
 *      - le mod DefaultOptions a un modele (config/defaultoptions/options.txt) : on met la
 *        langue dans le modele, que le mod copie au 1er lancement (le modele est remis a
 *        l'identique par la verification des fichiers au lancement suivant, sans importance).
 *      - sinon : on cree options.txt avec juste la langue, Minecraft complete le reste.
 */
const fs = require('fs-extra')
const path = require('path')
const { LoggerUtil } = require('helios-core')

const log = LoggerUtil.getLogger('GameLanguage')

const MARKER_FILE = 'nerysia-lang.json'

/** Remplace (ou ajoute) la ligne "lang:" en gardant le reste du fichier tel quel. */
function setLangLine(text, mcLang){
    const line = /^lang:.*$/m
    if(line.test(text)){
        return text.replace(line, `lang:${mcLang}`)
    }
    const eol = text.includes('\r\n') ? '\r\n' : '\n'
    const base = text.length > 0 && !text.endsWith('\n') ? text + eol : text
    return `${base}lang:${mcLang}${eol}`
}

function readMarker(gameDir){
    try {
        return JSON.parse(fs.readFileSync(path.join(gameDir, MARKER_FILE), 'utf-8')).applied ?? null
    } catch (err) {
        return null
    }
}

function writeMarker(gameDir, mcLang){
    fs.writeFileSync(path.join(gameDir, MARKER_FILE), JSON.stringify({ applied: mcLang }), 'utf-8')
}

/**
 * @param {string} gameDir Dossier de l'instance (ex : <donnees>/instances/Nerysia-1.21.1).
 * @param {string} mcLang Code de langue Minecraft (ex : 'fr_fr', 'en_us').
 */
exports.apply = function(gameDir, mcLang){
    try {
        const optionsFile = path.join(gameDir, 'options.txt')

        if(fs.existsSync(optionsFile)){
            if(readMarker(gameDir) === mcLang){
                // Deja applique : on ne touche plus a un choix fait dans le jeu
                return
            }
            const text = fs.readFileSync(optionsFile, 'utf-8')
            const updated = setLangLine(text, mcLang)
            if(updated !== text){
                fs.writeFileSync(optionsFile, updated, 'utf-8')
            }
            writeMarker(gameDir, mcLang)
            log.info(`Langue du jeu : ${mcLang}`)
            return
        }

        const template = path.join(gameDir, 'config', 'defaultoptions', 'options.txt')
        if(fs.existsSync(template)){
            const text = fs.readFileSync(template, 'utf-8')
            const updated = setLangLine(text, mcLang)
            if(updated !== text){
                fs.writeFileSync(template, updated, 'utf-8')
            }
            // Pas de marqueur ici : au prochain lancement, options.txt existera et sera verifie
            // (au cas ou DefaultOptions n'aurait pas copie le modele).
            log.info(`Langue du jeu (modele DefaultOptions) : ${mcLang}`)
            return
        }

        fs.ensureDirSync(gameDir)
        fs.writeFileSync(optionsFile, `lang:${mcLang}\n`, 'utf-8')
        writeMarker(gameDir, mcLang)
        log.info(`Langue du jeu (1er lancement) : ${mcLang}`)
    } catch (err) {
        // Jamais bloquant : au pire le jeu reste dans sa langue actuelle
        log.warn('Impossible de regler la langue du jeu.', err)
    }
}

// Pour les tests
exports._setLangLine = setLangLine
