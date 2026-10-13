const { DistributionAPI } = require('helios-core/common')

const ConfigManager = require('./configmanager')

// Old WesterosCraft url.
// exports.REMOTE_DISTRO_URL = 'http://mc.westeroscraft.com/WesterosCraftLauncher/distribution.json'
exports.REMOTE_DISTRO_URL = 'https://apk.nerysia.fr/nerysia-laucher/distribution.json'

const api = new DistributionAPI(
    ConfigManager.getLauncherDirectory(),
    null, // Injected forcefully by the preloader.
    null, // Injected forcefully by the preloader.
    exports.REMOTE_DISTRO_URL,
    false
)

// Instance ADMIN secrete : ajoutee au distribution.json public au moment ou il est
// telecharge (puis enregistre sur le disque, ou le processus de telechargement le relit).
const AdminAccess = require('./adminaccess')

const pullRemote = api.pullRemote.bind(api)
api.pullRemote = async function(){
    const res = await pullRemote()
    if(res.data != null){
        await AdminAccess.injectInto(res.data)
    }
    return res
}

// Hors ligne : copie locale, en ne gardant l'instance admin que pour le compte qui l'a recue.
const pullLocal = api.pullLocal.bind(api)
api.pullLocal = async function(){
    const data = await pullLocal()
    if(data != null){
        AdminAccess.stripFrom(data, true)
    }
    return data
}

exports.DistroAPI = api