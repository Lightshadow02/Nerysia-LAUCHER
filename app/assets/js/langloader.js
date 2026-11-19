const fs = require('fs-extra')
const path = require('path')
const toml = require('toml')
const merge = require('lodash.merge')

/*
 * Langue du launcher (et du jeu, cf applyGameLanguage dans landing.js).
 *
 * Fichiers dans app/assets/lang/ :
 *  - en_US.toml : anglais, TOUTES les cles (sert aussi de secours si une cle manque en francais)
 *  - fr_FR.toml : francais, toutes les cles
 *  - _custom.toml : ce qui ne depend pas de la langue (titre, liens), charge en dernier
 *
 * Choix de la langue : reglage "Langue" (Parametres > Launcher), "auto" par defaut =
 * langue du PC (francais si elle commence par "fr", anglais sinon).
 * Le processus principal (index.js) choisit la langue au demarrage et la transmet a la
 * fenetre (argument --nerysia-lang) : les deux affichent toujours la meme langue.
 */

const SUPPORTED = ['fr_FR', 'en_US']
const DEFAULT_LANGUAGE = 'en_US'
// Code de langue de Minecraft (ligne "lang:" de options.txt)
const MINECRAFT_LANG = { fr_FR: 'fr_fr', en_US: 'en_us' }

let lang
let currentLanguage = DEFAULT_LANGUAGE

/**
 * Langue a utiliser.
 *
 * @param {string} preference Reglage du joueur : 'auto', 'fr_FR' ou 'en_US'.
 * @param {string[]} systemLanguages Langues du PC par ordre de preference (ex : ['fr-FR', 'en-US']).
 * @returns {string} 'fr_FR' ou 'en_US'.
 */
exports.resolveLanguage = function(preference, systemLanguages){
    if(SUPPORTED.includes(preference)){
        return preference
    }
    const first = (systemLanguages || []).find(l => typeof l === 'string' && l.length > 0)
    if(first && first.toLowerCase().startsWith('fr')){
        return 'fr_FR'
    }
    return DEFAULT_LANGUAGE
}

/**
 * Langues du PC, la preferee en premier (langue d'affichage de Windows / macOS / Linux).
 *
 * @param {Electron.App} app L'objet app d'Electron (processus principal, ou @electron/remote).
 */
exports.getSystemLanguages = function(app){
    const list = []
    try { list.push(...(app.getPreferredSystemLanguages() || [])) } catch (err) { /* indisponible */ }
    try { list.push(app.getSystemLocale()) } catch (err) { /* indisponible */ }
    try { list.push(app.getLocale()) } catch (err) { /* indisponible */ }
    return list.filter(l => typeof l === 'string' && l.length > 0)
}

exports.SUPPORTED = SUPPORTED

exports.getLanguage = function(){
    return currentLanguage
}

/** Code de langue a mettre dans options.txt de Minecraft (ex : 'fr_fr'). */
exports.getMinecraftLanguage = function(){
    return MINECRAFT_LANG[currentLanguage] || MINECRAFT_LANG[DEFAULT_LANGUAGE]
}

/** Code BCP 47 pour les dates (ex : 'fr-FR'). */
exports.getLocaleTag = function(){
    return currentLanguage.replace('_', '-')
}

exports.loadLanguage = function(id){
    lang = merge(lang || {}, toml.parse(fs.readFileSync(path.join(__dirname, '..', 'lang', `${id}.toml`))) || {})
}

/**
 * Texte d'une cle (ex : 'js.landing.launch.okay'). Une cle introuvable renvoie ''
 * (avant : "undefined" affiche, ou plantage si une partie du chemin manquait).
 * Une cle qui designe un groupe (ex : 'js.login.error.unknown') renvoie l'objet.
 */
exports.query = function(id, placeHolders){
    let res = lang
    for(let q of id.split('.')){
        if(res == null || typeof res !== 'object'){
            res = undefined
            break
        }
        res = res[q]
    }
    if(res == null || res === lang){
        return ''
    }
    let text = res
    if (placeHolders && typeof text === 'string') {
        Object.entries(placeHolders).forEach(([key, value]) => {
            text = text.split(`{${key}}`).join(value)
        })
    }
    return text
}

exports.queryJS = function(id, placeHolders){
    return exports.query(`js.${id}`, placeHolders)
}

exports.queryEJS = function(id, placeHolders){
    return exports.query(`ejs.${id}`, placeHolders)
}

/**
 * Langue transmise par le processus principal a la fenetre (cf index.js, additionalArguments).
 */
function languageFromArgs(){
    const arg = (process.argv || []).find(a => typeof a === 'string' && a.startsWith('--nerysia-lang='))
    return arg ? arg.substring('--nerysia-lang='.length) : null
}

/**
 * Charge les textes.
 *
 * @param {string} [language] 'fr_FR' ou 'en_US'. Sans parametre : langue transmise par
 * le processus principal (fenetre du launcher), sinon anglais.
 */
exports.setupLanguage = function(language){
    language = language || languageFromArgs()
    currentLanguage = SUPPORTED.includes(language) ? language : DEFAULT_LANGUAGE

    lang = undefined
    // Anglais d'abord : complet, il sert de secours si une cle manque dans l'autre langue
    exports.loadLanguage(DEFAULT_LANGUAGE)
    if(currentLanguage !== DEFAULT_LANGUAGE){
        exports.loadLanguage(currentLanguage)
    }

    // Load Custom Language File for Launcher Customizer
    exports.loadLanguage('_custom')
}
