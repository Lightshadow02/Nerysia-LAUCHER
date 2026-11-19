/**
 * Prereglage conseille selon le PC (Faible / Moyen / Ultra).
 *
 * Seuils = "Configuration conseillee" de la page Rejoindre du site (nerysia.fr/rejoindre) :
 *                    Faible          Moyen                 Ultra
 *   Carte graphique  Intel HD 660    NVIDIA GTX 1050       NVIDIA RTX 2060
 *   Memoire (RAM)    4 Go            6 Go                  8 Go
 *   Processeur       i5-7300         i5-7300HQ (4 coeurs)  i5-9000 (6 coeurs)
 * Conseil = le plus bas des trois. Carte graphique inconnue -> au plus Moyen.
 * Si le site change, mettre a jour gpuLevel / ramLevel / cpuLevel.
 *
 * Sert :
 *   - au 1er lancement d'un serveur : son prereglage est celui conseille (avant : Moyen d'office),
 *     cf applyRecommendedPreset dans uibinder.js. Le choix d'un joueur n'est jamais modifie ;
 *   - pour l'etoile "Conseille pour ton PC" des boutons de prereglage (onglet Mods + choix du serveur).
 * Tout reste sur le PC : rien n'est envoye.
 */
const os                = require('os')
const { LoggerUtil }    = require('helios-core')

const { LEVELS }        = require('./presetutil')
const Lang              = require('./langloader')

const log = LoggerUtil.getLogger('HardwareProfile')

const rank = level => LEVELS.indexOf(level)
const lowest = levels => levels.reduce((a, b) => rank(b) < rank(a) ? b : a)

/**
 * Niveau d'une carte graphique d'apres son nom.
 *
 * @param {string} rawName Ex : "NVIDIA GeForce RTX 4060 Ti", "Intel(R) UHD Graphics 620", "Apple M2".
 * @returns {string|null} 'faible', 'moyen', 'ultra', ou null si la carte est inconnue.
 */
function gpuLevel(rawName){
    const name = String(rawName || '').toLowerCase().replace(/\((r|tm)\)/g, '')
    if(name.trim() === '') return null
    let m

    // Pas de vraie carte graphique (rendu par le processeur)
    if(/basic render|swiftshader|llvmpipe|softpipe|software/.test(name)) return 'faible'

    // NVIDIA RTX (RTX 2060 = Ultra sur le site)
    if((m = name.match(/rtx\s*(a)?\s*(\d{3,4})/))){
        const num = Number(m[2])
        if(m[1] || num % 1000 < 50) return num >= 4000 ? 'ultra' : 'moyen' // pro : RTX A2000, Quadro RTX 4000…
        const gen = Math.floor(num / 1000)
        return (num % 100 >= 60 || gen >= 4) ? 'ultra' : 'moyen' // RTX 2050 / 3050 ~ GTX 1650-1660
    }
    if(/titan/.test(name)) return 'ultra'
    // NVIDIA GTX (GTX 1050 = Moyen sur le site)
    if((m = name.match(/gtx\s*(\d{3,4})/))){
        const num = Number(m[1])
        if(num >= 1070 && num < 1100) return 'ultra'           // GTX 1070 / 1080
        if(num >= 1050 || (num >= 950 && num < 1000)) return 'moyen' // 1050, 1060, 1650, 1660, 950-980
        return 'faible'                                         // GTX 7xx et plus vieux
    }
    if(/\b(mx|gt)\s*\d/.test(name)) return 'faible'             // MX 150-550, GT 1030…

    // AMD Radeon
    if((m = name.match(/rx\s*(\d{3,4})/))){
        const num = Number(m[1])
        if(num >= 9000) return num % 1000 >= 60 ? 'ultra' : 'moyen' // RX 9060 / 9070
        if(num >= 1000){
            const tier = num % 1000                             // RX 6600 -> 600
            if(tier >= 600) return 'ultra'                      // RX 5600 XT, 6600, 7600 et plus
            if(tier >= 400) return 'moyen'                      // RX 5500, 6400, 6500
            return 'faible'
        }
        return (num >= 460 && num !== 550) ? 'moyen' : 'faible'  // RX 460-590
    }
    if(/vega\s*(56|64)|radeon\s*vii/.test(name)) return 'ultra'
    if((m = name.match(/radeon\s*(\d{3})m/))) return Number(m[1]) >= 680 ? 'moyen' : 'faible' // 680M, 780M, 880M…
    if(/r9\s*(29|39)\d|r9\s*fury/.test(name)) return 'moyen'
    if(/radeon|vega/.test(name)) return 'faible'                // Radeon Graphics (integree), R5, R7, HD…

    // Intel
    if(/\barc\b/.test(name)){
        if((m = name.match(/\b([ab])(\d{3})m?\b/))){
            return (m[1] === 'b' || Number(m[2]) >= 580) ? 'ultra' : 'moyen' // A580, A750, A770, B570, B580
        }
        return 'moyen'                                          // Arc integree (Core Ultra)
    }
    if(/intel|iris|uhd|hd graphics/.test(name)) return 'faible' // HD, UHD, Iris Xe

    // Apple (Mac M1, M2…)
    if((m = name.match(/apple\s*m\d/))) return /\b(pro|max|ultra)\b/.test(name) ? 'ultra' : 'moyen'

    return null
}

/** Memoire totale du PC (en octets). */
function ramLevel(bytes){
    const gb = bytes / 1073741824
    if(gb >= 7.5) return 'ultra'   // 8 Go (Windows en annonce un peu moins)
    if(gb >= 5.5) return 'moyen'   // 6 Go
    return 'faible'
}

/** Nombre de coeurs (logiques) du processeur. */
function cpuLevel(threads){
    if(threads >= 6) return 'ultra' // i5-9000 : 6 coeurs
    if(threads >= 4) return 'moyen' // i5-7300HQ : 4 coeurs
    return 'faible'
}

/** Nom lisible : "ANGLE (NVIDIA, NVIDIA GeForce GTX 1050 (0x…) Direct3D11 …)" -> "NVIDIA GeForce GTX 1050". */
function cleanName(name){
    let n = String(name || '')
    const angle = n.match(/^ANGLE \((?:[^,]*), (.+?)(?:, [^,]*)?\)$/)
    if(angle) n = angle[1]
    return n
        .replace(/ANGLE Metal Renderer: /, '')
        .replace(/\(0x[0-9a-f]+\)/ig, '')
        .replace(/Direct3D.*$|\/PCIe.*$|OpenGL.*$/i, '')
        .replace(/\((R|TM)\)/g, '')
        .replace(/\s+/g, ' ')
        .trim()
}

/** Noms des cartes graphiques du PC (toutes : sur un portable, la carte integree ET la carte dediee). */
async function gpuNames(){
    const names = []
    try {
        const { app } = require('@electron/remote')
        const basic = await app.getGPUInfo('basic')
        for(const dev of basic.gpuDevice ?? []){
            if(dev.deviceString) names.push(dev.deviceString)
        }
        // macOS / Linux : pas toujours de nom dans "basic", il est dans le moteur de rendu
        if(!names.some(n => gpuLevel(n) != null && gpuLevel(n) !== 'faible')){
            const complete = await Promise.race([
                app.getGPUInfo('complete'),
                new Promise(resolve => setTimeout(() => resolve(null), 3000))
            ])
            if(complete?.auxAttributes?.glRenderer) names.push(complete.auxAttributes.glRenderer)
        }
    } catch(err) {
        log.warn('Infos de la carte graphique indisponibles.', err)
    }
    try {
        const gl = globalThis.document?.createElement('canvas').getContext('webgl')
        const ext = gl?.getExtension('WEBGL_debug_renderer_info')
        if(ext) names.push(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))
    } catch(err) {
        // pas de WebGL (carte graphique desactivee) : tant pis
    }
    return names
}

let cached = null
let pending = null

/**
 * Analyse le PC (une seule fois par demarrage du launcher, ~50 ms).
 *
 * @returns {Promise<{level: string, gpu: string|null, ramGo: number, threads: number}>}
 */
exports.detect = function(){
    if(cached != null) return Promise.resolve(cached)
    if(pending != null) return pending
    pending = (async () => {
        const ramBytes = os.totalmem()
        const threads = os.cpus().length
        let best = null
        try {
            for(const raw of await gpuNames()){
                const level = gpuLevel(raw)
                if(level != null && (best == null || rank(level) > rank(best.level))){
                    best = { name: cleanName(raw), level }
                }
            }
        } catch(err) {
            log.warn('Analyse de la carte graphique impossible.', err)
        }
        cached = {
            level: lowest([best?.level ?? 'moyen', ramLevel(ramBytes), cpuLevel(threads)]),
            gpu: best?.name ?? null,
            ramGo: Math.round(ramBytes / 1073741824),
            threads
        }
        log.info(`Prereglage conseille : ${cached.level} (carte : ${cached.gpu ?? 'inconnue'}, ${cached.ramGo} Go, ${threads} coeurs)`)
        return cached
    })()
    return pending
}

/** Le resultat de detect() s'il est deja connu, sinon null. */
exports.getCached = function(){
    return cached
}

/** Texte "★ Conseille pour ton PC : Ultra (NVIDIA GeForce RTX 4060 Ti · 32 Go de memoire)". */
exports.adviceText = function(profile){
    const names = { faible: 'settings.presetLow', moyen: 'settings.presetMedium', ultra: 'settings.presetUltra' }
    const details = [profile.gpu, Lang.queryJS('settings.presetAdvice.memory', { go: profile.ramGo })].filter(Boolean).join(' · ')
    return Lang.queryJS('settings.presetAdvice.line', { level: Lang.queryEJS(names[profile.level]), details })
}

exports.gpuLevel = gpuLevel
exports.cleanName = cleanName
