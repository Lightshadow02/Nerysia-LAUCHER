/**
 * "Mes captures" : captures d'ecran Minecraft (touche F2 en jeu) de toutes les instances
 * du launcher (<dossier du jeu>/instances/<serveur>/screenshots/).
 * Fenetre : overlay.ejs -> screenshotsContent, logique d'affichage : landing.js -> openScreenshots.
 *
 * Rien ne part sur Internet : tout se passe sur le PC du joueur.
 */
const fs = require('fs-extra')
const path = require('path')
const { pathToFileURL } = require('url')
const { clipboard, nativeImage, shell, ipcRenderer } = require('electron')
const { SHELL_OPCODE } = require('./ipcconstants')

const SCREENSHOT_DIR = 'screenshots'
const IMAGE_FILE = /\.(png|jpe?g)$/i

/** Dossier des captures d'une instance. */
exports.folderOf = function(instanceRoot, serverId){
    return path.join(instanceRoot, serverId, SCREENSHOT_DIR)
}

/**
 * Toutes les captures, la plus recente en premier.
 *
 * @param {string[]} instanceRoots Dossiers des instances (actuel + ancien .helioslauncher).
 * @returns {Promise<{path: string, name: string, server: string, time: number}[]>}
 */
exports.list = async function(instanceRoots){
    const shots = []
    for(const instanceRoot of instanceRoots){
        await listInstances(instanceRoot, shots)
    }
    return shots.sort((a, b) => b.time - a.time)
}

async function listInstances(instanceRoot, shots){
    let servers = []
    try {
        servers = await fs.readdir(instanceRoot)
    } catch (err) {
        return // pas encore d'instance
    }
    for(const server of servers){
        const dir = exports.folderOf(instanceRoot, server)
        let files
        try {
            files = await fs.readdir(dir)
        } catch (err) {
            continue // pas de capture pour ce serveur
        }
        for(const name of files){
            if(!IMAGE_FILE.test(name)) continue
            const file = path.join(dir, name)
            try {
                const stat = await fs.stat(file)
                if(stat.isFile()){
                    shots.push({ path: file, name, server, time: stat.mtimeMs })
                }
            } catch (err) {
                // fichier supprime entre-temps
            }
        }
    }
}

/** Adresse a mettre dans une balise <img> pour afficher l'image en grand. */
exports.fileUrl = function(file){
    return pathToFileURL(file).href
}

/**
 * Petite image pour la grille (bien plus leger que l'image entiere en 1920 x 1080).
 * Windows / macOS : vignette du systeme. Linux : l'image entiere (affichee en petit).
 */
exports.thumbnail = async function(file, width = 240, height = 135){
    try {
        if(typeof nativeImage.createThumbnailFromPath === 'function' && process.platform !== 'linux'){
            const thumb = await nativeImage.createThumbnailFromPath(file, { width, height })
            if(!thumb.isEmpty()){
                return thumb.toDataURL()
            }
        }
    } catch (err) {
        // vignette impossible : on affiche l'image elle-meme
    }
    return exports.fileUrl(file)
}

/** Copie l'image (a coller dans Discord, par exemple). */
exports.copy = function(file){
    const image = nativeImage.createFromPath(file)
    if(image.isEmpty()){
        return false
    }
    clipboard.writeImage(image)
    return true
}

/**
 * Met la capture a la corbeille (recuperable). Fait par le processus principal (index.js) :
 * sous Windows, shell.trashItem echoue depuis la fenetre ("Failed to create FileOperation instance").
 */
exports.trash = async function(file){
    const res = await ipcRenderer.invoke(SHELL_OPCODE.TRASH_ITEM, file)
    if(!res?.result){
        throw new Error(res?.error || 'trashItem')
    }
}

/** Ouvre l'explorateur sur la capture. */
exports.showInFolder = function(file){
    shell.showItemInFolder(file)
}

/** Ouvre le dossier des captures d'une instance (le cree s'il n'existe pas encore). */
exports.openFolder = async function(dir){
    await fs.ensureDir(dir)
    return shell.openPath(dir)
}
