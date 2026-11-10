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
// Court au 1er essai : ces requetes retardent l'affichage du launcher pour TOUT le monde.
// Plus long ensuite (nouveaux essais en arriere-plan, clic sur Jouer).
const TIMEOUT_FIRST = { request: 5000 }
const TIMEOUT_RETRY = { request: 12000 }
let attempts = 0
// Resultat reutilise pendant 1 h : evite de redemander a chaque clic sur Jouer
// (les liens de telechargement admin restent valables 24 h)
const CACHE_MS = 3600000
const cache = new Map() // uuid -> { at, server (null = pas admin) }

// Marque l'instance injectee : uuid du compte admin pour qui elle a ete recuperee.
const ADMIN_FLAG = 'nerysiaAdminFor'

// Uuid du compte pour lequel l'acces admin a ete verifie en dernier (cf needsRefresh).
let lastCheckedUuid
// Vrai si la derniere verification a echoue pour une raison passagere (reseau lent, Mojang
// ou api.php qui ne repond pas a temps...). Faux si elle a reussi ou si le compte n'est pas admin.
let lastFailed = false

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
    lastFailed = false
    if(account == null || account.type !== 'microsoft'){
        return null
    }
    const uuid = normalizeUuid(account.uuid)

    const cached = cache.get(uuid)
    if(cached != null && Date.now() - cached.at < CACHE_MS){
        return cached.server == null ? null : JSON.parse(JSON.stringify(cached.server))
    }
    const remember = (server) => {
        cache.set(uuid, { at: Date.now(), server })
        return server == null ? null : JSON.parse(JSON.stringify(server))
    }
    // Echec passager : rien n'est mis en cache, le launcher reessaiera (cf retryPending)
    const failed = () => {
        lastFailed = true
        return null
    }
    const TIMEOUT = attempts++ === 0 ? TIMEOUT_FIRST : TIMEOUT_RETRY

    try {
        // 1. Ce compte est-il admin ? (404 pour tous les joueurs normaux : une seule petite requete)
        const challenge = await got.get(ADMIN_API, {
            searchParams: { action: 'challenge', uuid },
            timeout: TIMEOUT,
            throwHttpErrors: false,
            responseType: 'json'
        })
        if(challenge.statusCode === 404){
            return remember(null) // joueur normal : on ne redemande pas avant 1 h
        }
        if(challenge.statusCode !== 200){
            log.warn(`Verification admin : api.php a repondu HTTP ${challenge.statusCode}.`)
            return failed()
        }
        const nonce = challenge.body.nonce

        // Jeton Minecraft expire (> 24h) : on le rafraichit avant de l'utiliser.
        if(!await AuthManager.validateSelected()){
            log.warn('Compte admin : jeton Minecraft invalide, instance admin ignoree.')
            return failed()
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
            return failed()
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
            return failed()
        }
        const server = res.body.server
        server[ADMIN_FLAG] = uuid
        log.info(`Instance admin chargee : ${server.name}`)
        return remember(server)
    } catch(err) {
        log.warn('Instance admin indisponible :', err.message)
        return failed()
    }
}

/**
 * Instance admin recue lors d'un lancement precedent par CE compte (copie sur le disque).
 * Utilisee seulement si la verification vient d'echouer pour une raison passagere :
 * l'instance reste visible au lieu de disparaitre jusqu'au prochain redemarrage.
 * (Un compte retire des admins recoit un 404 -> pas de copie locale pour lui.)
 */
async function previousAdminServer(loadLocal){
    const account = selectedAccountOrNull()
    if(account == null || loadLocal == null){
        return null
    }
    try {
        const local = await loadLocal()
        const server = local?.servers?.find(s => s[ADMIN_FLAG] === normalizeUuid(account.uuid))
        if(server != null){
            log.info('Verification admin impossible pour le moment : copie locale de l\'instance utilisee.')
        }
        return server ?? null
    } catch(err) {
        return null
    }
}

/**
 * Ajoute l'instance admin a un distribution.json brut (si le compte selectionne est admin).
 * Retire toujours une eventuelle ancienne instance admin avant.
 *
 * @param {Object} rawDistribution distribution.json qui vient d'etre telecharge
 * @param {Function} loadLocal     lit la copie du distribution.json sur le disque (secours)
 */
exports.injectInto = async function(rawDistribution, loadLocal){
    exports.stripFrom(rawDistribution)
    let server = await fetchAdminServer()
    if(server == null && lastFailed){
        server = await previousAdminServer(loadLocal)
    }
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

/**
 * Vrai si la derniere verification admin du compte selectionne a echoue pour une raison
 * passagere : le launcher doit reessayer en arriere-plan (cf uibinder.js scheduleAdminRetry).
 */
exports.retryPending = function(){
    return lastFailed && selectedAccountOrNull()?.uuid === lastCheckedUuid
}

exports.isAdminServer = function(rawServer){
    return rawServer != null && rawServer[ADMIN_FLAG] != null
}
