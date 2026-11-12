/**
 * Changement de skin depuis le launcher (comptes Microsoft).
 *
 * Utilise l'API officielle de Minecraft (la meme que le site minecraft.net) :
 *   - GET    /minecraft/profile                  -> skin actuel (image + modele classique / fin)
 *   - POST   /minecraft/profile/skins            -> envoi d'une nouvelle image PNG
 *   - DELETE /minecraft/profile/skins/active     -> retour au skin par defaut
 *
 * Le jeton du joueur ne part que chez Minecraft (api.minecraftservices.com), comme au lancement du jeu.
 */
const crypto            = require('crypto')
const got               = require('got')
const { LoggerUtil }    = require('helios-core')

const AuthManager       = require('./authmanager')
const ConfigManager     = require('./configmanager')
const SkinUtil          = require('./skinutil')

const log = LoggerUtil.getLogger('SkinChanger')

const API = 'https://api.minecraftservices.com/minecraft/profile'
const MAX_FILE_SIZE = 64 * 1024 // un skin 64x64 fait quelques Ko

class SkinError extends Error {
    /** @param {string} code Cle de traduction (js.skin.errors.<code>) */
    constructor(code, cause){
        super(code)
        this.code = code
        this.cause = cause
    }
}
exports.SkinError = SkinError

/**
 * Compte selectionne + jeton valide (rafraichi si besoin).
 */
async function selectedAccount(){
    const account = ConfigManager.getSelectedAccount()
    if(account == null){
        throw new SkinError('noAccount')
    }
    if(account.type !== 'microsoft'){
        throw new SkinError('notMicrosoft')
    }
    if(!(await AuthManager.validateSelected())){
        throw new SkinError('sessionExpired')
    }
    return ConfigManager.getSelectedAccount()
}

function toSkinError(err){
    if(err instanceof SkinError){
        return err
    }
    const status = err.response?.statusCode
    log.warn('Erreur API skin', status ?? err.code ?? err.message)
    if(status === 401 || status === 403) return new SkinError('sessionExpired', err)
    if(status === 400) return new SkinError('rejected', err)
    if(status === 429) return new SkinError('tooMany', err)
    return new SkinError('network', err)
}

function textureIdOf(profile){
    const active = (profile.skins || []).find(s => s.state === 'ACTIVE')
    return active?.url ? active.url.split('/').pop() : null
}

/**
 * Skin actuel du compte selectionne.
 *
 * @returns {Promise<{name: string, url: string|null, variant: 'classic'|'slim'}>}
 */
exports.getCurrentSkin = async function(){
    try {
        const account = await selectedAccount()
        const res = await got.get(API, {
            headers: { Authorization: `Bearer ${account.accessToken}` },
            responseType: 'json',
            timeout: { request: 10000 }
        })
        const active = (res.body.skins || []).find(s => s.state === 'ACTIVE')
        return {
            name: res.body.name,
            url: active?.url ?? null,
            variant: active?.variant?.toLowerCase() === 'slim' ? 'slim' : 'classic'
        }
    } catch(err) {
        throw toSkinError(err)
    }
}

/**
 * Verifie qu'une image peut servir de skin (PNG 64x64, ou ancien format 64x32).
 *
 * @param {Buffer} png
 */
exports.checkSkinFile = function(png){
    if(png.length > MAX_FILE_SIZE){
        throw new SkinError('tooBig')
    }
    // Signature PNG puis bloc IHDR : largeur / hauteur aux octets 16 et 20
    const isPng = png.length > 24 && png.readUInt32BE(0) === 0x89504E47 && png.toString('ascii', 12, 16) === 'IHDR'
    if(!isPng){
        throw new SkinError('notPng')
    }
    const width = png.readUInt32BE(16)
    const height = png.readUInt32BE(20)
    if(width !== 64 || (height !== 64 && height !== 32)){
        throw new SkinError('badSize')
    }
    return { width, height }
}

/**
 * Envoie un nouveau skin pour le compte selectionne.
 *
 * @param {Buffer} png Image PNG du skin.
 * @param {'classic'|'slim'} variant Modele : bras larges (Steve) ou fins (Alex).
 */
exports.uploadSkin = async function(png, variant){
    exports.checkSkinFile(png)
    try {
        const account = await selectedAccount()
        // Formulaire multipart fait a la main (got 11 n'a pas de FormData integre)
        const boundary = '----NerysiaSkin' + crypto.randomBytes(12).toString('hex')
        const body = Buffer.concat([
            Buffer.from(
                `--${boundary}\r\nContent-Disposition: form-data; name="variant"\r\n\r\n${variant === 'slim' ? 'slim' : 'classic'}\r\n` +
                `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="skin.png"\r\nContent-Type: image/png\r\n\r\n`
            ),
            png,
            Buffer.from(`\r\n--${boundary}--\r\n`)
        ])
        const res = await got.post(`${API}/skins`, {
            headers: {
                Authorization: `Bearer ${account.accessToken}`,
                'Content-Type': `multipart/form-data; boundary=${boundary}`
            },
            body,
            responseType: 'json',
            timeout: { request: 20000 }
        })
        SkinUtil.setTexture(account.uuid, textureIdOf(res.body))
        log.info('Skin mis a jour.')
    } catch(err) {
        throw toSkinError(err)
    }
}

/**
 * Remet le skin par defaut (Steve / Alex...) sur le compte selectionne.
 */
exports.resetSkin = async function(){
    try {
        const account = await selectedAccount()
        const res = await got.delete(`${API}/skins/active`, {
            headers: { Authorization: `Bearer ${account.accessToken}` },
            responseType: 'json',
            timeout: { request: 20000 }
        })
        SkinUtil.setTexture(account.uuid, textureIdOf(res.body))
        log.info('Skin remis par defaut.')
    } catch(err) {
        throw toSkinError(err)
    }
}
