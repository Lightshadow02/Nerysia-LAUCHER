/**
 * Protections anti-triche appliquees au lancement du jeu (instances joueurs).
 *
 * Limite assumee : rien cote client n'est infaillible (le joueur controle son PC et peut
 * lancer Minecraft sans ce launcher). Ces protections ferment les portes FACILES ; la vraie
 * barriere reste cote serveur (verification des mods a la connexion, anti-xray, anti-cheat).
 *
 * 1. Mods ajoutes a la main : Fabric charge tout .jar du dossier mods/ de l'instance. Les
 *    mods du modpack, eux, sont dans common/ et passes par liste explicite (--fabric.addMods).
 *    Tout .jar trouve dans <instance>/mods est donc mis de cote (mods_bloques/), pas supprime.
 * 2. Options JVM : liste blanche. -javaagent, -agentpath, -Dfabric.*, -cp... sont ignores.
 * 3. Variables d'environnement JAVA_TOOL_OPTIONS & co : retirees (injection sans le launcher).
 * 4. -XX:+DisableAttachMechanism : empeche un outil externe de s'attacher au jeu lance.
 */
const fs   = require('fs-extra')
const path = require('path')
const { LoggerUtil } = require('helios-core')

const log = LoggerUtil.getLogger('LaunchGuard')

// Toujours ajoutees aux arguments JVM des instances joueurs.
exports.HARDENING_ARGS = ['-XX:+DisableAttachMechanism']

// Variables lues directement par la JVM : permettent d'injecter -javaagent sans passer par le launcher.
const JVM_ENV_VARS = ['JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'JDK_JAVA_OPTIONS']

// -XX: autorises sauf ceux-ci (agents, fichiers d'options, execution de commandes).
const DENIED_XX = new Set([
    'EnableDynamicAgentLoading', 'DisableAttachMechanism', 'StartAttachListener',
    'Flags', 'VMOptionsFile', 'OnError', 'OnOutOfMemoryError', 'CompileCommandFile'
])

// -D autorises (proprietes sans effet sur le chargement de code).
const ALLOWED_PROPS = [
    /^file\.encoding$/, /^user\.(language|country)$/, /^java\.net\.preferIPv[46](Stack|Addresses)$/,
    /^sun\.java2d\./, /^org\.lwjgl\.opengl\.Display\.allowSoftwareOpenGL$/, /^log4j2\.formatMsgNoLookups$/
]

function isAllowedJvmOption(opt){
    if(typeof opt !== 'string') return false
    const xx = opt.match(/^-XX:([+-]?)([A-Za-z0-9_]+)(=.*)?$/)
    if(xx) return !DENIED_XX.has(xx[2])
    if(/^-X(ss|mn)\d+[kKmMgG]?$/.test(opt)) return true
    const prop = opt.match(/^-D([^=]+)(=.*)?$/)
    if(prop) return ALLOWED_PROPS.some(re => re.test(prop[1]))
    return false
}

/**
 * Filtre les options JVM saisies par le joueur (Parametres > Java).
 * @returns {string[]} les options conservees
 */
exports.sanitizeJvmOptions = function(options){
    const kept = []
    for(const opt of options || []){
        if(isAllowedJvmOption(opt)){
            kept.push(opt)
        } else {
            log.warn(`Option JVM ignoree (non autorisee) : ${opt}`)
        }
    }
    return kept
}

/**
 * Copie de l'environnement sans les variables d'injection JVM.
 */
exports.cleanEnv = function(env){
    const clean = { ...env }
    for(const name of Object.keys(clean)){
        if(JVM_ENV_VARS.includes(name.toUpperCase())){
            log.warn(`Variable d'environnement ignoree : ${name}`)
            delete clean[name]
        }
    }
    return clean
}

/**
 * Met de cote tout .jar ajoute a la main dans <instance>/mods (sous-dossiers compris).
 * @returns {string[]} noms des fichiers deplaces
 */
exports.quarantineInstanceMods = function(gameDir){
    const modsDir = path.join(gameDir, 'mods')
    if(!fs.existsSync(modsDir)) return []
    const moved = []
    const target = path.join(gameDir, 'mods_bloques')
    const walk = (dir) => {
        for(const entry of fs.readdirSync(dir, { withFileTypes: true })){
            const full = path.join(dir, entry.name)
            if(entry.isDirectory()){
                walk(full)
            } else if(/\.jar$/i.test(entry.name)){
                fs.ensureDirSync(target)
                let dest = path.join(target, entry.name)
                if(fs.existsSync(dest)) dest = path.join(target, `${Date.now()}-${entry.name}`)
                fs.moveSync(full, dest)
                moved.push(entry.name)
            }
        }
    }
    walk(modsDir)
    if(moved.length > 0){
        log.warn(`Mods ajoutes a la main mis de cote dans ${target} : ${moved.join(', ')}`)
    }
    return moved
}
