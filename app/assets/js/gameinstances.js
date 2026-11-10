/**
 * Suivi des Minecraft lances par le launcher.
 *
 * Sert a prevenir le joueur s'il clique sur "Jouer" alors qu'un Minecraft est deja
 * en train de demarrer (avec tous les mods, la fenetre peut mettre ~1 min a s'ouvrir)
 * ou deja ouvert : deux jeux en meme temps = deux fois la RAM, et souvent un plantage.
 *
 * La liste est gardee dans <donnees du launcher>/running-games.json : elle survit a un
 * redemarrage du launcher (le jeu, lui, continue de tourner). Un jeu dont le processus
 * n'existe plus est retire automatiquement.
 */
const fs                = require('fs-extra')
const path              = require('path')
const { LoggerUtil }    = require('helios-core')

const ConfigManager     = require('./configmanager')

const log = LoggerUtil.getLogger('GameInstances')

// Au-dela, on considere l'entree comme perimee (le numero de processus a pu etre reutilise)
const MAX_AGE_MS = 24 * 60 * 60 * 1000

let games = null // [{ pid, serverId, name, startedAt, state: 'launching' | 'running' }]

function file(){
    return path.join(ConfigManager.getLauncherDirectory(), 'running-games.json')
}

function load(){
    if(games == null){
        try {
            const data = fs.readJsonSync(file())
            games = Array.isArray(data) ? data : []
        } catch(err) {
            games = []
        }
    }
    return games
}

function save(){
    try {
        fs.writeJsonSync(file(), games)
    } catch(err) {
        log.warn('Impossible d\'enregistrer la liste des jeux lances.', err)
    }
}

function isAlive(pid){
    try {
        process.kill(pid, 0) // signal 0 : teste seulement si le processus existe
        return true
    } catch(err) {
        return err.code === 'EPERM' // existe, mais appartient a un autre utilisateur
    }
}

/**
 * Enregistre un Minecraft qui vient d'etre lance. Il est retire tout seul quand il se ferme.
 *
 * @param {import('child_process').ChildProcess} child Le processus du jeu.
 * @param {Object} server Le serveur (helios-core) lance.
 */
exports.register = function(child, server){
    if(child == null || child.pid == null){
        return
    }
    const pid = child.pid
    load().push({
        pid,
        serverId: server.rawServer.id,
        name: server.rawServer.name,
        startedAt: Date.now(),
        state: 'launching'
    })
    save()
    child.once('exit', () => {
        games = load().filter(g => g.pid !== pid)
        save()
    })
}

/**
 * Le jeu a fini de demarrer (menu principal atteint).
 *
 * @param {number} pid Numero du processus du jeu.
 */
exports.markRunning = function(pid){
    const game = load().find(g => g.pid === pid)
    if(game != null && game.state !== 'running'){
        game.state = 'running'
        save()
    }
}

/**
 * Les Minecraft encore ouverts (ou en train de demarrer), du plus recent au plus ancien.
 *
 * @returns {Array<{pid: number, serverId: string, name: string, startedAt: number, state: string}>}
 */
exports.list = function(){
    const now = Date.now()
    const before = load().length
    games = games.filter(g => now - g.startedAt < MAX_AGE_MS && isAlive(g.pid))
    if(games.length !== before){
        save()
    }
    return games.slice().sort((a, b) => b.startedAt - a.startedAt)
}

/**
 * @returns {boolean} Vrai si au moins un Minecraft lance par le launcher tourne encore.
 */
exports.isAnyRunning = function(){
    return exports.list().length > 0
}
