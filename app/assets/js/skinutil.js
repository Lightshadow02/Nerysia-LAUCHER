/**
 * Affichage des skins (avatar de l'accueil, liste des comptes, parametres).
 *
 * 1. Affichage IMMEDIAT de la derniere image connue (gardee sur le PC), sinon du rendu mc-heads.
 * 2. En arriere-plan : on demande l'identifiant de la texture a Mojang (officiel), puis
 *    mc-heads dessine CETTE texture (un changement de skin change l'identifiant -> pas de cache
 *    perime, plus de Steve par erreur).
 * 3. L'image n'est remplacee QUE si la nouvelle a bien ete telechargee. Avant, si mc-heads etait
 *    lent ou en panne, l'avatar en haut a droite restait vide.
 * 4. Secours si mc-heads ne repond pas : crafatar.com.
 */
/* global localStorage */
const got = require('got')

const TEX_KEY = 'nerysia.skin.texture.' // + uuid -> identifiant de texture
const IMG_KEY = 'nerysia.skin.image.'   // + uuid|type|taille -> image (data URL)

function lsGet(key){
    try { return localStorage.getItem(key) } catch(err) { return null }
}
function lsSet(key, value){
    try { localStorage.setItem(key, value) } catch(err) { /* stockage plein : tant pis */ }
}

const textureIds = new Map() // uuid -> Promise<{ id, sure }>

/**
 * Identifiant de la texture du skin. sure = false si on n'a pas pu le savoir (Mojang injoignable
 * et rien en memoire) : on affiche alors par l'uuid, sans garder l'image (risque de Steve).
 */
function skinId(uuid){
    if(!textureIds.has(uuid)){
        textureIds.set(uuid, (async () => {
            try {
                const res = await got.get(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid.replace(/-/g, '')}`, {
                    responseType: 'json',
                    timeout: { request: 8000 }
                })
                const prop = (res.body.properties || []).find(p => p.name === 'textures')
                const url = JSON.parse(Buffer.from(prop.value, 'base64').toString('utf8')).textures?.SKIN?.url
                const id = url ? url.split('/').pop() : uuid // pas de skin perso : Steve/Alex par l'uuid
                lsSet(TEX_KEY + uuid, id)
                return { id, sure: true }
            } catch(err) {
                // Mojang limite les demandes (relances rapides du launcher) : derniere texture connue
                textureIds.delete(uuid) // on reessaiera plus tard
                const known = lsGet(TEX_KEY + uuid)
                return known ? { id: known, sure: true } : { id: uuid, sure: false }
            }
        })())
    }
    return textureIds.get(uuid)
}

function renderUrl(id, kind, size){
    return `https://mc-heads.net/${kind}/${id}/${size}`
}

function fallbackUrl(uuid, kind, size){
    const id = uuid.replace(/-/g, '')
    if(kind === 'body'){
        return `https://crafatar.com/renders/body/${id}?overlay`
    }
    return `https://crafatar.com/avatars/${id}?size=${parseInt(size) || 64}&overlay`
}

async function download(url){
    const res = await got.get(url, {
        responseType: 'buffer',
        timeout: { request: 10000 },
        retry: { limit: 1 }
    })
    const type = (res.headers['content-type'] || '').split(';')[0]
    if(!type.startsWith('image/') || res.body.length === 0){
        throw new Error(`Pas une image (${type})`)
    }
    return `data:${type};base64,${res.body.toString('base64')}`
}

const fresh = new Map() // uuid|type|taille -> Promise<data URL | null>

function loadFresh(uuid, kind, size, key){
    if(!fresh.has(key)){
        fresh.set(key, (async () => {
            const tex = await skinId(uuid)
            const candidates = [renderUrl(tex.id, kind, size)]
            if(tex.id !== uuid) candidates.push(renderUrl(uuid, kind, size))
            candidates.push(fallbackUrl(uuid, kind, size))

            for(let i = 0; i < candidates.length; i++){
                try {
                    const data = await download(candidates[i])
                    // On ne garde que le vrai skin (texture confirmee), jamais un Steve de secours
                    if(i === 0 && tex.sure) lsSet(IMG_KEY + key, data)
                    return data
                } catch(err) {
                    console.warn(`[Skin] ${candidates[i]} indisponible : ${err.message}`)
                }
            }
            fresh.delete(key) // tout a echoue : on reessaiera au prochain affichage
            return null
        })())
    }
    return fresh.get(key)
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
    const key = `${uuid}|${kind}|${size}`
    el.setAttribute('data-skin-uuid', uuid)

    // Affichage immediat : derniere image connue, sinon rendu direct par l'uuid
    set(lsGet(IMG_KEY + key) || renderUrl(uuid, kind, size))

    loadFresh(uuid, kind, size, key).then(data => {
        // l'element affiche peut-etre deja un autre compte entre-temps
        if(data != null && el.getAttribute('data-skin-uuid') === uuid) set(data)
    })
}
