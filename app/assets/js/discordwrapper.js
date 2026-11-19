/**
 * Statut Discord ("Joue a Nerysia") pendant la partie (Rich Presence).
 *
 * Le launcher parle au Discord installe sur le PC (en local) : Discord affiche alors sur le
 * profil du joueur "Joue a Nerysia", l'etape (menu, sur le serveur…), le temps de jeu et deux
 * boutons (Discord, site). Discord pas ouvert = rien ne se passe.
 *
 * Application Discord "Nerysia" (https://discord.com/developers/applications) :
 *   - DISCORD_APP_ID = son "Application ID" (public, ce n'est PAS un secret). Vide = statut eteint.
 *     Le nom affiche ("Joue a …") est le nom de l'application.
 *   - Rich Presence > Art Assets : le logo, nomme comme LARGE_IMAGE.
 * Reglage joueur : Parametres > Minecraft > "Afficher ma partie sur Discord" (actif par defaut).
 * Jamais le nom de l'instance (l'instance ADMIN est secrete) : toujours "Nerysia".
 * Appele par landing.js (dlAsyncInner) au lancement du jeu, arrete quand le jeu se ferme.
 */
const { LoggerUtil } = require('helios-core')
const { Client }     = require('discord-rpc-patch')

const Lang           = require('./langloader')

const logger = LoggerUtil.getLogger('DiscordWrapper')

const DISCORD_APP_ID = ''
const LARGE_IMAGE    = 'nerysia'

let client = null
let ready = false
let activity = null

/** Le statut Discord est-il prevu dans cette version du launcher ? */
exports.isConfigured = function(){
    return DISCORD_APP_ID !== ''
}

function buttons(){
    // Memes liens que les boutons du launcher (_custom.toml)
    const list = [
        { label: Lang.queryJS('discord.buttonDiscord'), url: Lang.queryEJS('landing.mediaDiscordURL') },
        { label: Lang.queryJS('discord.buttonSite'), url: Lang.queryEJS('landing.mediaGitHubURL') }
    ]
    return list.filter(b => /^https:\/\//.test(b.url))
}

function push(){
    if(client == null || !ready || activity == null) return
    // Requete brute : la bibliotheque ne transmet pas les boutons dans toutes ses versions
    client.request('SET_ACTIVITY', { pid: process.pid, activity }).catch(err => {
        logger.warn('Statut Discord non mis a jour : ' + err.message)
    })
}

/**
 * Affiche le statut (le jeu vient d'etre lance).
 *
 * @param {string} details Premiere ligne (ex : "Chargement du jeu…").
 * @returns {boolean} Vrai si le statut est demarre.
 */
exports.initRPC = function(details = Lang.queryJS('discord.waiting')){
    if(!exports.isConfigured()) return false
    exports.shutdownRPC()

    activity = {
        details,
        state: Lang.queryJS('discord.state'),
        timestamps: { start: Date.now() },
        assets: {
            large_image: LARGE_IMAGE,
            large_text: Lang.queryJS('discord.largeText')
        },
        buttons: buttons(),
        instance: false
    }

    const c = new Client({ transport: 'ipc' })
    client = c
    ready = false
    c.on('ready', () => {
        if(client !== c) return
        logger.info('Discord RPC Connected')
        ready = true
        push()
    })
    c.login({ clientId: DISCORD_APP_ID }).catch(error => {
        if(client === c){
            client = null
            ready = false
        }
        if(String(error?.message).includes('ENOENT') || String(error?.message).includes('Could not connect')) {
            logger.info('Discord n\'est pas ouvert sur ce PC : pas de statut Discord.')
        } else {
            logger.info('Unable to initialize Discord Rich Presence: ' + error?.message)
        }
    })
    return true
}

/** Change la premiere ligne du statut (menu, sur le serveur…). */
exports.updateDetails = function(details){
    if(activity == null || activity.details === details) return
    activity.details = details
    push()
}

/** Retire le statut (le jeu s'est ferme). */
exports.shutdownRPC = function(){
    activity = null
    if(client == null) return
    const c = client
    const wasReady = ready
    client = null
    ready = false
    const close = () => c.destroy().catch(() => {})
    if(wasReady){
        c.clearActivity().catch(() => {}).finally(close)
    } else {
        close()
    }
}
