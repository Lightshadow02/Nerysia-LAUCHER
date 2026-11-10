/**
 * Prereglages de performance (Faible / Moyen / Ultra + Builder).
 *
 * Regles communes a l'onglet Mods des parametres et a la fenetre de choix du serveur :
 *   Faible = mods obligatoires seuls, Moyen = + dossier moyen/, Ultra = + moyen/ + ultra/.
 *   Builder est independant et s'ajoute a n'importe quel prereglage.
 * Le dossier d'un mod donne son champ "preset" dans distribution.json
 * (tools/generate-distribution.ps1).
 */
const { Type } = require('helios-distribution-types')

const LEVELS = ['faible', 'moyen', 'ultra']
exports.LEVELS = LEVELS

/**
 * Mods optionnels rattaches a un prereglage.
 * @returns {{id: string, preset: string}[]}
 */
exports.presetMods = function(server){
    return server.modules
        .filter(mdl => mdl.rawModule.type === Type.FabricMod && !mdl.getRequired().value && mdl.rawModule.preset != null)
        .map(mdl => ({ id: mdl.getVersionlessMavenIdentifier(), preset: mdl.rawModule.preset }))
}

/** Le mod doit-il etre actif pour ce niveau ? (null pour builder, qui ne depend pas du niveau) */
exports.enabledFor = function(mod, level){
    const modRank = LEVELS.indexOf(mod.preset)
    return modRank === -1 ? null : modRank <= LEVELS.indexOf(level)
}

/**
 * Niveau actif d'apres l'etat des mods, ou null si le joueur a modifie des mods a la main.
 * @param {Function} isOn (id) => boolean
 */
exports.detect = function(mods, isOn){
    const leveled = mods.filter(mod => LEVELS.includes(mod.preset))
    return LEVELS.find(level => leveled.every(mod => isOn(mod.id) === exports.enabledFor(mod, level))) ?? null
}

exports.builderMods = function(mods){
    return mods.filter(mod => mod.preset === 'builder')
}

/* Lecture / ecriture dans la configuration des mods enregistree (ConfigManager). */

function confValue(conf){
    return typeof conf === 'object' && conf != null ? conf.value : conf
}

exports.isOnInConfig = function(modConf, id){
    return confValue(modConf.mods[id]) === true
}

exports.setInConfig = function(modConf, id, enabled){
    const conf = modConf.mods[id]
    if(typeof conf === 'object' && conf != null){
        conf.value = enabled
    } else {
        modConf.mods[id] = enabled
    }
}
