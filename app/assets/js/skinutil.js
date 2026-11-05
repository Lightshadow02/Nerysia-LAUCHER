/**
 * Affichage des skins (avatar de l'accueil, liste des comptes, parametres).
 *
 * Avant : https://mc-heads.net/<type>/<uuid>. Si mc-heads n'arrivait pas a obtenir le skin
 * aupres de Mojang, il renvoyait Steve... et ce Steve restait en cache des heures.
 * Maintenant : on demande l'identifiant de la texture directement a Mojang (officiel), puis
 * mc-heads dessine CETTE texture. Un changement de skin change l'identifiant -> pas de cache perime.
 */
const got = require('got')

const textureIds = new Map() // uuid -> Promise<identifiant texture | uuid>

function skinId(uuid){
    if(!textureIds.has(uuid)){
        textureIds.set(uuid, (async () => {
            try {
                const res = await got.get(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid.replace(/-/g, '')}`, {
                    responseType: 'json',
                    timeout: { request: 5000 }
                })
                const prop = (res.body.properties || []).find(p => p.name === 'textures')
                const url = JSON.parse(Buffer.from(prop.value, 'base64').toString('utf8')).textures?.SKIN?.url
                return url ? url.split('/').pop() : uuid // pas de skin perso : Steve/Alex par l'uuid
            } catch(err) {
                textureIds.delete(uuid) // on reessaiera plus tard
                return uuid
            }
        })())
    }
    return textureIds.get(uuid)
}

function renderUrl(id, kind, size){
    return `https://mc-heads.net/${kind}/${id}/${size}`
}

/**
 * Applique le skin d'un compte a un element.
 * @param {HTMLElement} el      <img> (src) ou autre (background-image)
 * @param {string} uuid         uuid du compte
 * @param {string} kind         'body' | 'head' | 'avatar'
 * @param {string|number} size  taille ou orientation acceptee par mc-heads ('right', 40...)
 */
exports.applySkin = function(el, uuid, kind, size){
    const set = (url) => {
        if(el.tagName === 'IMG') el.src = url
        else el.style.backgroundImage = `url('${url}')`
    }
    set(renderUrl(uuid, kind, size)) // affichage immediat
    el.setAttribute('data-skin-uuid', uuid)
    skinId(uuid).then(id => {
        // l'element affiche peut-etre deja un autre compte entre-temps
        if(id !== uuid && el.getAttribute('data-skin-uuid') === uuid) set(renderUrl(id, kind, size))
    })
}
