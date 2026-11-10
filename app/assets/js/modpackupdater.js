/**
 * Mise a jour AUTOMATIQUE du modpack, en arriere-plan.
 *
 * Toutes les 10 minutes (et au demarrage, et quand le joueur change de serveur), le launcher
 * regarde le distribution.json en ligne. Si le contenu du modpack du serveur selectionne a change
 * depuis la derniere fois, il telecharge tout seul les fichiers nouveaux / modifies.
 * -> au clic sur "Jouer", tout est deja la : le jeu se lance presque tout de suite.
 *
 * Meme moteur que le clic sur "Jouer" (FullRepair de helios-core, dans un processus separe :
 * l'interface ne rame pas). La verification complete au clic sur "Jouer" est conservee (anti-triche).
 *
 * "Contenu du modpack" = empreinte de la liste des fichiers + leurs MD5 : fonctionne meme si
 * la version n'a pas ete augmentee lors de la publication.
 */
/* global localStorage */
const crypto            = require('crypto')
const path              = require('path')
const { FullRepair }    = require('helios-core/dl')
const { LoggerUtil }    = require('helios-core')

const ConfigManager     = require('./configmanager')
const { DistroAPI }     = require('./distromanager')

const log = LoggerUtil.getLogger('ModpackUpdater')

const STORE_KEY = 'nerysia.modpack.synced' // { serverId: empreinte du dernier modpack complet }
const FIRST_CHECK_MS = 15000
const INTERVAL_MS = 10 * 60 * 1000

let current = null              // mise a jour en cours (Promise) ou null
let listener = () => {}         // affichage de l'etat (landing.js)
let isBusy = () => false        // jeu lance / lancement en cours (landing.js)
let timer = null

function getSynced(){
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {} } catch(err) { return {} }
}
function setSynced(serverId, fp){
    try {
        const synced = getSynced()
        synced[serverId] = fp
        localStorage.setItem(STORE_KEY, JSON.stringify(synced))
    } catch(err) { /* pas grave : on reverifiera */ }
}

/** Empreinte du contenu du modpack d'un serveur (fichiers + MD5 + version de Minecraft). */
function fingerprint(server){
    const parts = [`mc:${server.rawServer.minecraftVersion}`]
    const walk = (modules) => {
        for(const mdl of modules){
            parts.push(`${mdl.rawModule.id}|${mdl.rawModule.artifact?.MD5 ?? ''}`)
            walk(mdl.subModules)
        }
    }
    walk(server.modules)
    return crypto.createHash('sha1').update(parts.sort().join('\n')).digest('hex')
}

/** Lance FullRepair dans un processus separe et attend la fin (ou l'echec) de l'etape. */
function step(repair, run){
    return new Promise((resolve, reject) => {
        const onClose = (code) => reject(new Error(`processus de verification arrete (code ${code})`))
        repair.childProcess.once('close', onClose)
        repair.childProcess.once('error', reject)
        run().then(resolve, reject).finally(() => {
            repair.childProcess?.removeListener('close', onClose)
            repair.childProcess?.removeListener('error', reject)
        })
    })
}

async function run(){
    const serverId = ConfigManager.getSelectedServer()
    if(serverId == null || ConfigManager.getSelectedAccount() == null || isBusy()){
        return
    }

    let distro
    try {
        distro = await DistroAPI.refreshDistributionOrFallback()
    } catch(err) {
        return // hors ligne : on reessaiera
    }
    const server = distro.getServerById(serverId)
    if(server == null){
        return
    }
    const fp = fingerprint(server)
    if(getSynced()[serverId] === fp || isBusy()){
        return // deja a jour (ou le joueur vient de cliquer sur Jouer)
    }

    log.info(`Modpack ${server.rawServer.name} (${server.rawServer.version}) : verification en arriere-plan.`)
    listener({ state: 'checking', server })

    const repair = new FullRepair(
        ConfigManager.getCommonDirectory(),
        ConfigManager.getInstanceDirectory(),
        ConfigManager.getLauncherDirectory(),
        serverId,
        DistroAPI.isDevMode()
    )
    try {
        repair.spawnReceiver({
            NERYSIA_HASH_CACHE: path.join(ConfigManager.getLauncherDirectory(), 'hash-cache.json')
        })
        const invalid = await step(repair, () => repair.verifyFiles(() => {}))
        if(invalid > 0){
            log.info(`${invalid} fichier(s) a telecharger.`)
            listener({ state: 'downloading', server, percent: 0 })
            await step(repair, () => repair.download(percent => listener({ state: 'downloading', server, percent })))
        }
        setSynced(serverId, fp)
        log.info('Modpack a jour.')
        listener({ state: 'done', server, updated: invalid > 0 })
    } catch(err) {
        log.warn('Mise a jour en arriere-plan impossible (on reessaiera) :', err?.message ?? err)
        listener({ state: 'error', server })
    } finally {
        try { repair.destroyReceiver() } catch(err) { /* deja arrete */ }
    }
}

/** Lance une verification maintenant (ou renvoie celle deja en cours). */
exports.checkNow = function(){
    if(current == null){
        current = run().catch(() => {}).finally(() => { current = null })
    }
    return current
}

/** Attend la fin de la mise a jour en cours (appele au clic sur "Jouer"). */
exports.waitIdle = function(){
    return current ?? Promise.resolve()
}

exports.isRunning = function(){
    return current != null
}

/** Le lancement du jeu a tout verifie : rien a refaire en arriere-plan pour ce modpack. */
exports.markSynced = function(server){
    setSynced(server.rawServer.id, fingerprint(server))
}

/**
 * Demarre les verifications automatiques.
 * @param {Object} opts { onStatus(status), isBusy() }
 */
exports.start = function({ onStatus, isBusy: busy }){
    if(onStatus) listener = onStatus
    if(busy) isBusy = busy
    if(timer != null) return
    setTimeout(exports.checkNow, FIRST_CHECK_MS)
    timer = setInterval(exports.checkNow, INTERVAL_MS)
}

/** Le joueur a change de serveur : verifier bientot le modpack de ce serveur. */
let soonTimer = null
exports.checkSoon = function(){
    if(timer == null) return // pas encore demarre (demarrage du launcher)
    clearTimeout(soonTimer)
    soonTimer = setTimeout(exports.checkNow, 5000)
}
