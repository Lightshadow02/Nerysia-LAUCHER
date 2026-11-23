/**
 * Onglet Depannage des parametres : lecture des journaux et rapport pour le support.
 *
 * Journaux : launcher (launcherlog.js), jeu (instances/<serveur>/logs/latest.log), dernier
 * plantage (crash-reports/*.txt ou hs_err_pid*.log de Java, le plus recent).
 * "Copier pour le support" = infos du PC et du launcher + fin des journaux, pret a coller sur Discord.
 *
 * Tout ce qui est affiche ou copie passe par redact() : jetons de connexion, e-mails, nom de la
 * session du PC (chemins C:\Users\<nom>) et noms de l'instance ADMIN (secrete) sont masques.
 * Rien n'est envoye : le joueur colle lui-meme le texte ou il veut.
 */
const fs                = require('fs-extra')
const os                = require('os')
const path              = require('path')

const ConfigManager     = require('./configmanager')
const LauncherLog       = require('./launcherlog')
const HardwareProfile   = require('./hardwareprofile')
const PresetUtil        = require('./presetutil')
const AdminAccess       = require('./adminaccess')
const Lang              = require('./langloader')
const { DistroAPI }     = require('./distromanager')

const VIEW_LINES = 1500       // lignes affichees dans l'onglet
const REPORT_LINES = 150      // lignes de chaque journal dans le rapport
const REPORT_CRASH_LINES = 80 // debut du rapport de plantage (la cause est en haut)
const READ_BYTES = 768 * 1024 // on ne lit que la fin des gros fichiers

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Construit la fonction qui masque les infos sensibles. */
async function makeRedactor(){
    const rules = [
        // Jetons (JWT Minecraft, jetons Microsoft) et valeurs apres un nom de jeton
        [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '***'],
        [/\bEwA[A-Za-z0-9+/=_-]{40,}/g, '***'],
        [/\bM\.C\d+_[A-Za-z0-9!*._$-]{20,}/g, '***'],
        [/((?:access|refresh|client|id)_?token|authorization|bearer|password|secret)(["'\s:=]+)([^\s"',;}]{6,})/gi, '$1$2***'],
        // e-mail (extension en lettres : "java.base@21.0.3" des erreurs Java n'est pas touche)
        [/[\w.+-]+@[\w-]+(\.[\w-]+)*\.[A-Za-z]{2,}\b/g, '***@***']
    ]
    // Nom de la session du PC : dossier personnel -> ~
    const home = os.homedir()
    for(const variant of new Set([home, home.replace(/\\/g, '/'), home.replace(/\\/g, '\\\\')])){
        rules.push([new RegExp(escapeRe(variant), 'gi'), '~'])
    }
    rules.push([/([\\/](?:Users|home)[\\/]+)[^\\/\s"':]+/gi, '$1***'])
    // Instance admin : ni son identifiant, ni son nom, ni son adresse
    try {
        const distro = await DistroAPI.getDistribution()
        for(const serv of distro?.servers ?? []){
            if(AdminAccess.isAdminServer(serv.rawServer)){
                const r = serv.rawServer
                for(const v of [r.id, r.name, r.address?.split(':')[0]]){
                    if(v && v.length >= 3) rules.push([new RegExp(escapeRe(v), 'gi'), '[instance]'])
                }
            }
        }
    } catch(err) {
        // pas de distribution : rien a masquer de ce cote
    }
    return text => rules.reduce((t, [re, by]) => t.replace(re, by), text)
}

/** Lit au plus READ_BYTES a la fin (ou au debut) d'un fichier. */
async function readPart(file, fromStart = false){
    const { size } = await fs.stat(file)
    const length = Math.min(size, READ_BYTES)
    const fd = await fs.open(file, 'r')
    try {
        const buf = Buffer.alloc(length)
        await fs.read(fd, buf, 0, length, fromStart ? 0 : size - length)
        let text = buf.toString('utf8')
        if(!fromStart && length < size) text = text.slice(text.indexOf('\n') + 1) // ligne coupee
        return text
    } finally {
        await fs.close(fd)
    }
}

async function newest(files){
    let best = null
    for(const f of files){
        try {
            const st = await fs.stat(f)
            if(best == null || st.mtimeMs > best.mtime) best = { file: f, mtime: st.mtimeMs }
        } catch(err) { /* disparu entre-temps */ }
    }
    return best
}

/** Fichier d'un journal : 'launcher', 'game' ou 'crash'. */
async function locate(kind, serverId){
    if(kind === 'launcher'){
        const f = LauncherLog.file()
        return f && await fs.pathExists(f) ? { file: f, mtime: (await fs.stat(f)).mtimeMs } : null
    }
    if(serverId == null) return null
    const inst = path.join(ConfigManager.getInstanceDirectory(), serverId)
    if(kind === 'game'){
        const f = path.join(inst, 'logs', 'latest.log')
        return await fs.pathExists(f) ? { file: f, mtime: (await fs.stat(f)).mtimeMs } : null
    }
    const candidates = []
    const crashDir = path.join(inst, 'crash-reports')
    if(await fs.pathExists(crashDir)){
        for(const n of await fs.readdir(crashDir)) if(n.endsWith('.txt')) candidates.push(path.join(crashDir, n))
    }
    if(await fs.pathExists(inst)){
        for(const n of await fs.readdir(inst)) if(/^hs_err_pid\d+\.log$/.test(n)) candidates.push(path.join(inst, n))
    }
    return newest(candidates)
}

/**
 * Journal a afficher (deja masque).
 *
 * @returns {Promise<{found: boolean, name?: string, mtime?: number, text?: string, folder: string|null}>}
 */
exports.read = async function(kind, serverId){
    const redact = await makeRedactor()
    const loc = await locate(kind, serverId)
    const folder = kind === 'launcher'
        ? path.join(ConfigManager.getLauncherDirectory(), 'logs')
        : (serverId != null ? path.join(ConfigManager.getInstanceDirectory(), serverId, kind === 'game' ? 'logs' : 'crash-reports') : null)
    if(loc == null) return { found: false, folder }
    const crash = kind === 'crash'
    let lines = (await readPart(loc.file, crash)).split(/\r?\n/)
    lines = crash ? lines.slice(0, VIEW_LINES) : lines.slice(-VIEW_LINES)
    return { found: true, name: redact(path.basename(loc.file)), mtime: loc.mtime, text: redact(lines.join('\n')), folder: path.dirname(loc.file) }
}

function presetName(serv, serverId){
    const modConf = ConfigManager.getModConfiguration(serverId)
    if(modConf == null) return '?'
    const mods = PresetUtil.presetMods(serv)
    const isOn = id => PresetUtil.isOnInConfig(modConf, id)
    const level = PresetUtil.detect(mods, isOn) ?? 'custom'
    const builder = PresetUtil.builderMods(mods).some(m => isOn(m.id))
    return level + (builder ? ' + builder' : '')
}

/** Rapport complet pour le support (masque), pret a coller. */
exports.buildReport = async function(serverId){
    const redact = await makeRedactor()
    const out = []
    const add = (k, v) => out.push(`${k.padEnd(10)}: ${v}`)
    const remote = require('@electron/remote')

    out.push('=== Nerysia Launcher : rapport de depannage / support report ===')
    add('Date', new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC')
    add('Launcher', `${remote.app.getVersion()} (${Lang.getLanguage()})`)
    add('OS', `${os.type()} ${os.release()} (${process.arch})`)
    let hw = null
    try { hw = await HardwareProfile.detect() } catch(err) { /* inconnu */ }
    add('CPU', `${os.cpus()[0]?.model?.trim() ?? '?'} (${os.cpus().length} threads)`)
    add('RAM', `${Math.round(os.totalmem() / 1073741824)} GB (${Math.round(os.freemem() / 1073741824)} GB free)`)
    add('GPU', `${hw?.gpu ?? '?'} (recommended preset: ${hw?.level ?? '?'})`)
    try {
        const distro = await DistroAPI.getDistribution()
        const serv = serverId != null ? distro.getServerById(serverId) : null
        if(serv != null){
            add('Server', `${serv.rawServer.id} - modpack ${serv.rawServer.version} - Minecraft ${serv.rawServer.minecraftVersion}`)
            add('Preset', presetName(serv, serverId))
            add('Game RAM', `${ConfigManager.getMinRAM(serverId)} - ${ConfigManager.getMaxRAM(serverId)}`)
            add('Java', ConfigManager.getJavaExecutable(serverId) ?? 'auto')
        } else {
            add('Server', serverId ?? 'none')
        }
    } catch(err) {
        add('Server', `${serverId} (distribution unavailable)`)
    }

    const section = async (title, kind, count) => {
        const loc = await locate(kind, serverId)
        if(loc == null){
            out.push('', `=== ${title} : none ===`)
            return
        }
        const crash = kind === 'crash'
        let lines = (await readPart(loc.file, crash)).split(/\r?\n/)
        lines = crash ? lines.slice(0, count) : lines.slice(-count)
        const when = new Date(loc.mtime).toISOString().replace('T', ' ').slice(0, 16)
        out.push('', `=== ${title} : ${path.basename(loc.file)} (${when} UTC) ===`, ...lines)
    }
    await section('Last crash', 'crash', REPORT_CRASH_LINES)
    await section(`Game log (last ${REPORT_LINES} lines)`, 'game', REPORT_LINES)
    await section(`Launcher log (last ${REPORT_LINES} lines)`, 'launcher', REPORT_LINES)

    return '```\n' + redact(out.join('\n')).replace(/```/g, '\'\'\'') + '\n```'
}
