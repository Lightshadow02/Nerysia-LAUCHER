/**
 * Instance ADMIN secrete de Nerysia.
 *
 * Le modpack admin n'est PAS dans le distribution.json public : il est servi par
 * tools/admin-gate/api.php (deploye sur apk.nerysia.fr) uniquement aux comptes admins.
 *
 * Preuve d'identite = le mecanisme d'un serveur Minecraft :
 *   1. api.php?action=challenge : le serveur donne un code a usage unique (404 si le compte n'est pas admin)
 *   2. le launcher "rejoint" ce code chez Mojang avec le jeton du joueur
 *      -> le jeton part UNIQUEMENT chez Mojang, jamais chez Nerysia
 *   3. api.php?action=server : le serveur demande a Mojang qui a rejoint ce code,
 *      verifie que c'est un admin et renvoie l'instance (liens de telechargement valables 24h)
 *
 * L'instance est ajoutee au distribution.json au moment ou le launcher le telecharge
 * (cf distromanager.js), pour que le processus de telechargement la voie aussi.
 */
const got               = require('got')
const { LoggerUtil }    = require('helios-core')

const ConfigManager     = require('./configmanager')
const AuthManager       = require('./authmanager')

const log = LoggerUtil.getLogger('AdminAccess')

const ADMIN_API = 'https://apk.nerysia.fr/nerysia-laucher/admin/api.php'
const MOJANG_JOIN = 'https://sessionserver.mojang.com/session/minecraft/join'
const TIMEOUT = { request: 10000 }

// Marque l'instance injectee : uuid du compte admin pour qui elle a ete recuperee.
const ADMIN_FLAG = 'nerysiaAdminFor'

// Uuid du compte pour lequel l'acces admin a ete verifie en dernier (cf needsRefresh).
let lastCheckedUuid

function normalizeUuid(uuid){
    return uuid.replace(/-/g, '').toLowerCase()
}

function selectedAccountOrNull(){
    try {
        return ConfigManager.getSelectedAccount()
    } catch(err) {
        return null // config pas encore chargee
    }
}

/**
 * Recupere l'instance admin pour le compte selectionne.
 *
 * @returns {Promise.<Object|null>} Le serveur (format distribution.json) ou null si le compte
 * n'est pas admin ou si quelque chose echoue. Ne leve jamais d'erreur : un souci ici ne doit
 * jamais empecher les joueurs de lancer le jeu.
 */
async function fetchAdminServer(){
    const account = selectedAccountOrNull()
    lastCheckedUuid = account?.uuid
    if(account == null || account.type !== 'microsoft'){
        return null
    }
    const uuid = normalizeUuid(account.uuid)

    try {
        // 1. Ce compte est-il admin ? (404 pour tous les joueurs normaux : une seule petite requete)
        const challenge = await got.get(ADMIN_API, {
            searchParams: { action: 'challenge', uuid },
            timeout: TIMEOUT,
            throwHttpErrors: false,
            responseType: 'json'
        })
        if(challenge.statusCode !== 200){
            return null
        }
        const nonce = challenge.body.nonce

        // Jeton Minecraft expire (> 24h) : on le rafraichit avant de l'utiliser.
        if(!await AuthManager.validateSelected()){
            log.warn('Compte admin : jeton Minecraft invalide, instance admin ignoree.')
            return null
        }
        const fresh = ConfigManager.getSelectedAccount()

        // 2. Preuve de possession du compte, chez Mojang uniquement.
        const join = await got.post(MOJANG_JOIN, {
            json: { accessToken: fresh.accessToken, selectedProfile: uuid, serverId: nonce },
            timeout: TIMEOUT,
            throwHttpErrors: false
        })
        if(join.statusCode !== 204){
            log.warn(`Compte admin : Mojang a refuse la verification (HTTP ${join.statusCode}).`)
            return null
        }

        // 3. Le serveur Nerysia verifie aupres de Mojang et renvoie l'instance.
        const res = await got.get(ADMIN_API, {
            searchParams: { action: 'server', username: fresh.displayName, nonce },
            timeout: TIMEOUT,
            throwHttpErrors: false,
            responseType: 'json'
        })
        if(res.statusCode !== 200 || res.body?.server == null){
            log.warn(`Instance admin refusee par le serveur (HTTP ${res.statusCode}).`)
            return null
        }
        const server = res.body.server
        server[ADMIN_FLAG] = uuid
        log.info(`Instance admin chargee : ${server.name}`)
        return server
    } catch(err) {
        log.warn('Instance admin indisponible :', err.message)
        return null
    }
}

/**
 * Ajoute l'instance admin a un distribution.json brut (si le compte selectionne est admin).
 * Retire toujours une eventuelle ancienne instance admin avant.
 */
exports.injectInto = async function(rawDistribution){
    exports.stripFrom(rawDistribution)
    const server = await fetchAdminServer()
    if(server != null){
        rawDistribution.servers = rawDistribution.servers.filter(s => s.id !== server.id)
        rawDistribution.servers.push(server)
    }
}

/**
 * Retire l'instance admin d'un distribution.json brut. Avec keepForSelected, garde celle
 * du compte selectionne (copie locale, utilisee quand le launcher est hors ligne).
 */
exports.stripFrom = function(rawDistribution, keepForSelected = false){
    const account = selectedAccountOrNull()
    const keepUuid = keepForSelected && account != null ? normalizeUuid(account.uuid) : null
    rawDistribution.servers = rawDistribution.servers.filter(s => s[ADMIN_FLAG] == null || s[ADMIN_FLAG] === keepUuid)
}

/**
 * Vrai si le compte selectionne a change depuis la derniere verification
 * (il faut alors recharger la distribution pour afficher / cacher l'instance admin).
 */
exports.needsRefresh = function(){
    return selectedAccountOrNull()?.uuid !== lastCheckedUuid
}

exports.isAdminServer = function(rawServer){
    return rawServer != null && rawServer[ADMIN_FLAG] != null
}
