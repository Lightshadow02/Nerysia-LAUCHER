/**
 * Sauvegarde des reglages du joueur (Parametres > Minecraft > "Sauvegardes de tes reglages").
 *
 * Copie, pour un serveur, ce que le joueur a regle lui-meme : options du jeu (touches, son, video),
 * liste des serveurs, configs des mods, points de passage / carte Xaero, plans Litematica.
 * PAS les mods, packs de textures, shaders (retelecharges par le launcher), ni les captures
 * et les mondes solo (jamais touches par le launcher, trop lourds).
 *
 * Sauvegarde automatique (cf autoBackup) avant que le launcher remplace des fichiers :
 *   - toujours si la version du modpack a change depuis la derniere sauvegarde ;
 *   - sinon au plus une fois par jour (au clic sur Jouer, Helios remet souvent des configs a l'identique).
 * On garde les MAX_AUTO dernieres automatiques et les MAX_MANUAL dernieres faites a la main.
 *
 * Dossier : <dossier du jeu>/backups/<id du serveur>/<date>/ (+ backup.json : date, raison, version).
 * Tout reste sur le PC.
 */
const fs                = require('fs-extra')
const path              = require('path')
const { LoggerUtil }    = require('helios-core')

const ConfigManager     = require('./configmanager')

const log = LoggerUtil.getLogger('PlayerBackup')

// Fichiers / dossiers de l'instance sauvegardes (ceux qui manquent sont ignores)
const ITEMS = ['options.txt', 'optionsshaders.txt', 'servers.dat', 'config', 'xaero', 'XaeroWaypoints', 'schematics']
const META = 'backup.json'
const MAX_AUTO = 5
const MAX_MANUAL = 5
const DAY_MS = 24 * 60 * 60 * 1000

let busy = null // sauvegarde / restauration en cours (une seule a la fois)

function backupRoot(serverId){
    return path.join(ConfigManager.getDataDirectory(), 'backups', serverId)
}
function instanceDir(serverId){
    return path.join(ConfigManager.getInstanceDirectory(), serverId)
}

async function folderSize(p){
    const st = await fs.stat(p)
    if(!st.isDirectory()) return st.size
    let total = 0
    for(const name of await fs.readdir(p)){
        total += await folderSize(path.join(p, name))
    }
    return total
}

function stamp(d){
    const z = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}-${z(d.getMinutes())}-${z(d.getSeconds())}`
}

/** Une seule operation a la fois (sinon deux copies pourraient se marcher dessus). */
function exclusive(fn){
    const run = (busy ?? Promise.resolve()).catch(() => {}).then(fn)
    busy = run.finally(() => { if(busy === run) busy = null })
    return run
}

/**
 * Liste des sauvegardes d'un serveur, la plus recente d'abord.
 *
 * @returns {Promise<Array<{id: string, date: number, reason: string, auto: boolean, version: string|null, size: number}>>}
 */
exports.list = async function(serverId){
    const root = backupRoot(serverId)
    if(!await fs.pathExists(root)) return []
    const out = []
    for(const id of await fs.readdir(root)){
        try {
            const meta = await fs.readJson(path.join(root, id, META))
            out.push({ id, ...meta })
        } catch(err) {
            // dossier incomplet (copie interrompue) : ignore
        }
    }
    return out.sort((a, b) => b.date - a.date)
}

async function prune(serverId){
    const all = await exports.list(serverId)
    const drop = [
        ...all.filter(b => b.auto).slice(MAX_AUTO),
        ...all.filter(b => !b.auto).slice(MAX_MANUAL)
    ]
    for(const b of drop){
        await fs.remove(path.join(backupRoot(serverId), b.id))
    }
}

async function doCreate(serverId, { reason, auto, version }, pruneAfter = true){
    const src = instanceDir(serverId)
    const present = []
    for(const item of ITEMS){
        if(await fs.pathExists(path.join(src, item))) present.push(item)
    }
    if(present.length === 0){
        return null // jeu jamais lance pour ce serveur : rien a sauvegarder
    }
    const now = new Date()
    let id = stamp(now)
    while(await fs.pathExists(path.join(backupRoot(serverId), id))) id += '_'
    const dest = path.join(backupRoot(serverId), id)
    const tmp = dest + '.tmp'
    await fs.remove(tmp)
    for(const item of present){
        await fs.copy(path.join(src, item), path.join(tmp, item))
    }
    const meta = { date: now.getTime(), reason, auto, version: version ?? null, size: await folderSize(tmp) }
    await fs.writeJson(path.join(tmp, META), meta)
    await fs.move(tmp, dest) // la sauvegarde n'apparait qu'une fois complete
    if(pruneAfter) await prune(serverId)
    log.info(`Sauvegarde des reglages (${reason}) : ${present.join(', ')} (${Math.round(meta.size / 1024)} Ko).`)
    return { id, ...meta }
}

/**
 * Sauvegarde maintenant.
 *
 * @param {string} serverId
 * @param {{reason?: string, auto?: boolean, version?: string}} opts reason : 'manual', 'update', 'beforeRestore'
 */
exports.create = function(serverId, { reason = 'manual', auto = false, version = null } = {}){
    return exclusive(() => doCreate(serverId, { reason, auto, version }))
}

/**
 * Sauvegarde automatique avant que le launcher remplace des fichiers du modpack.
 * Ne bloque jamais la suite : une erreur est seulement notee.
 *
 * @param {Object} server Serveur helios-core (server.rawServer.id / version).
 */
exports.autoBackup = async function(server){
    const serverId = server.rawServer.id
    const version = server.rawServer.version ?? null
    try {
        const last = (await exports.list(serverId)).find(b => b.auto)
        if(last != null && last.version === version && Date.now() - last.date < DAY_MS){
            return null // deja une sauvegarde recente de cette version
        }
        return await exports.create(serverId, { reason: 'update', auto: true, version })
    } catch(err) {
        log.warn('Sauvegarde automatique des reglages impossible :', err?.message ?? err)
        return null
    }
}

/**
 * Remet une sauvegarde en place. L'etat actuel est d'abord sauvegarde ("avant restauration"),
 * pour pouvoir revenir en arriere. A n'appeler que quand le jeu est ferme.
 */
exports.restore = function(serverId, id){
    return exclusive(async () => {
        const src = path.join(backupRoot(serverId), id)
        if(!await fs.pathExists(path.join(src, META))){
            throw new Error('sauvegarde introuvable')
        }
        // sans tri tout de suite : il pourrait effacer la sauvegarde qu'on restaure
        await doCreate(serverId, { reason: 'beforeRestore', auto: false, version: null }, false)
        const dest = instanceDir(serverId)
        for(const item of ITEMS){
            if(await fs.pathExists(path.join(src, item))){
                await fs.remove(path.join(dest, item))
                await fs.copy(path.join(src, item), path.join(dest, item))
            }
        }
        await prune(serverId)
        log.info(`Reglages restaures depuis la sauvegarde ${id}.`)
    })
}

/** Supprime une sauvegarde. */
exports.remove = function(serverId, id){
    return exclusive(() => fs.remove(path.join(backupRoot(serverId), id)))
}

/** Dossier des sauvegardes d'un serveur (cree s'il n'existe pas, pour "Ouvrir le dossier"). */
exports.folder = async function(serverId){
    const root = backupRoot(serverId)
    await fs.ensureDir(root)
    return root
}
