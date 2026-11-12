/**
 * "Mes skins" : historique des skins d'un compte, garde sur le PC.
 *
 * Minecraft ne garde que le skin porte : pour pouvoir remettre un ancien skin, le launcher
 * sauvegarde chaque skin vu (skin porte a l'ouverture de la fenetre + chaque skin envoye).
 *
 * Rangement : <donnees du launcher>/skins/<uuid>/
 *   - <empreinte>.png   l'image du skin (empreinte = sha1 de l'image : pas de doublon)
 *   - index.json        [{ id, variant, savedAt }] du plus recent au plus ancien
 */
const crypto            = require('crypto')
const fs                = require('fs-extra')
const path              = require('path')
const { LoggerUtil }    = require('helios-core')

const ConfigManager     = require('./configmanager')

const log = LoggerUtil.getLogger('SkinHistory')

const MAX_SKINS = 40 // au-dela, les plus anciens sont oublies

function dir(uuid){
    return path.join(ConfigManager.getLauncherDirectory(), 'skins', uuid.replace(/-/g, ''))
}

function readIndex(uuid){
    try {
        const data = fs.readJsonSync(path.join(dir(uuid), 'index.json'))
        return Array.isArray(data) ? data : []
    } catch(err) {
        return []
    }
}

function writeIndex(uuid, index){
    fs.writeJsonSync(path.join(dir(uuid), 'index.json'), index)
}

/**
 * @param {Buffer} png Image du skin.
 * @returns {string} Empreinte de l'image (identifiant dans l'historique).
 */
exports.hashOf = function(png){
    return crypto.createHash('sha1').update(png).digest('hex')
}

/**
 * Skins sauvegardes du compte, du plus recent au plus ancien.
 *
 * @param {string} uuid
 * @returns {Array<{id: string, variant: 'classic'|'slim', savedAt: number}>}
 */
exports.list = function(uuid){
    return readIndex(uuid).filter(e => fs.existsSync(path.join(dir(uuid), `${e.id}.png`)))
}

/**
 * Sauvegarde un skin (ou le remonte en tete s'il y est deja).
 *
 * @param {string} uuid
 * @param {Buffer} png
 * @param {'classic'|'slim'} variant
 * @returns {string} Empreinte du skin.
 */
exports.add = function(uuid, png, variant){
    const id = exports.hashOf(png)
    try {
        fs.ensureDirSync(dir(uuid))
        const file = path.join(dir(uuid), `${id}.png`)
        if(!fs.existsSync(file)){
            fs.writeFileSync(file, png)
        }
        const index = readIndex(uuid).filter(e => e.id !== id)
        index.unshift({ id, variant: variant === 'slim' ? 'slim' : 'classic', savedAt: Date.now() })
        for(const old of index.splice(MAX_SKINS)){
            fs.removeSync(path.join(dir(uuid), `${old.id}.png`))
        }
        writeIndex(uuid, index)
    } catch(err) {
        log.warn('Impossible de sauvegarder le skin dans l\'historique.', err)
    }
    return id
}

/**
 * @param {string} uuid
 * @param {string} id Empreinte du skin.
 * @returns {Buffer} Image du skin.
 */
exports.read = function(uuid, id){
    return fs.readFileSync(path.join(dir(uuid), `${id}.png`))
}

/**
 * Retire un skin de l'historique.
 *
 * @param {string} uuid
 * @param {string} id Empreinte du skin.
 */
exports.remove = function(uuid, id){
    try {
        writeIndex(uuid, readIndex(uuid).filter(e => e.id !== id))
        fs.removeSync(path.join(dir(uuid), `${id}.png`))
    } catch(err) {
        log.warn('Impossible de retirer le skin de l\'historique.', err)
    }
}
