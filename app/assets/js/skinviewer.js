/**
 * Apercu 3D d'un skin : le personnage tourne sur lui-meme en marchant.
 * On peut aussi le faire tourner a la souris (cliquer-glisser).
 *
 * Fait en CSS 3D (chaque partie du corps = une boite de 6 faces qui affichent la bonne zone
 * de l'image du skin), sans bibliotheque 3D a embarquer.
 */
/* global document, requestAnimationFrame, cancelAnimationFrame */

const S = 6                 // taille d'un pixel de skin a l'ecran
const TURN_SPEED = 40       // degres par seconde
const TILT = -10            // vue legerement du dessus

/**
 * Faces d'une boite Minecraft de taille (w, h, d) dont la texture commence en (u, v).
 * Disposition standard : [droite][devant][gauche][dos] avec dessus / dessous au-dessus.
 */
function boxFaces(u, v, w, h, d){
    return [
        { name: 'front',  fw: w, fh: h, fx: u + d,         fy: v + d, tf: `translateZ(${d * S / 2}px)` },
        { name: 'back',   fw: w, fh: h, fx: u + 2 * d + w, fy: v + d, tf: `rotateY(180deg) translateZ(${d * S / 2}px)` },
        { name: 'right',  fw: d, fh: h, fx: u,             fy: v + d, tf: `rotateY(-90deg) translateZ(${w * S / 2}px)` },
        { name: 'left',   fw: d, fh: h, fx: u + d + w,     fy: v + d, tf: `rotateY(90deg) translateZ(${w * S / 2}px)` },
        { name: 'top',    fw: w, fh: d, fx: u + d,         fy: v,     tf: `rotateX(90deg) translateZ(${h * S / 2}px)` },
        { name: 'bottom', fw: w, fh: d, fx: u + d + w,     fy: v,     tf: `rotateX(-90deg) translateZ(${h * S / 2}px) scaleY(-1)` }
    ]
}

function el(cls, parent){
    const e = document.createElement('div')
    e.className = cls
    parent.appendChild(e)
    return e
}

/** Sur un ancien skin (64x32), Minecraft ignore un chapeau entierement opaque (souvent noir). */
function hatHasTransparency(img){
    try {
        const c = document.createElement('canvas')
        c.width = 32
        c.height = 16
        const ctx = c.getContext('2d')
        ctx.drawImage(img, 32, 0, 32, 16, 0, 0, 32, 16)
        const data = ctx.getImageData(0, 0, 32, 16).data
        for(let i = 3; i < data.length; i += 4){
            if(data[i] < 128) return true
        }
        return false
    } catch(err) {
        return true // image d'un autre site non lisible : on affiche le chapeau
    }
}

class SkinViewer {

    /** @param {HTMLElement} container Zone ou afficher le personnage. */
    constructor(container){
        this.container = container
        this.container.classList.add('skin3d-stage')
        this.root = null
        this.limbs = []
        this.angle = 30
        this.frame = null
        this.dragging = false
        this.lastX = 0

        container.addEventListener('pointerdown', e => {
            this.dragging = true
            this.lastX = e.clientX
            container.setPointerCapture(e.pointerId)
        })
        container.addEventListener('pointermove', e => {
            if(!this.dragging) return
            this.angle += (e.clientX - this.lastX) * 0.8
            this.lastX = e.clientX
        })
        const stopDrag = () => { this.dragging = false }
        container.addEventListener('pointerup', stopDrag)
        container.addEventListener('pointercancel', stopDrag)
    }

    /**
     * Affiche un skin.
     * @param {HTMLImageElement|null} img Image du skin deja chargee (64x64 ou 64x32), null = vide.
     * @param {boolean} slim Modele a bras fins (Alex).
     * @param {HTMLImageElement|null} cape Image de la cape portee (64x32), null = pas de cape.
     */
    setSkin(img, slim, cape = null){
        this.container.innerHTML = ''
        this.limbs = []
        this.root = null
        if(img == null){
            return
        }
        const legacy = img.naturalHeight === 32
        const texH = legacy ? 32 : 64
        const aw = slim ? 3 : 4
        const skinTex = { bg: `url("${img.src}")`, w: 64, h: texH }

        const root = el('skin3d-root', this.container)
        this.root = root

        // Une partie du corps : articulation (pivot) + boite(s) de base et 2e couche
        const part = ({ x, y, z = 0, offY, offZ = 0, w, h, d, base, layer, mirror, turn, swing, tex = skinTex }) => {
            const pivot = el('skin3d-pivot', root)
            pivot.style.transform = `translate3d(${x * S}px, ${y * S}px, ${z * S}px)`
            const boxes = [{ uv: base, grow: 0 }]
            if(layer) boxes.push({ uv: layer, grow: 1 })
            for(const box of boxes){
                const cuboid = el('skin3d-box', pivot)
                let tf = `translate3d(0, ${offY * S}px, ${offZ * S}px)`
                if(turn) tf += ` rotateY(${turn}deg)`
                if(box.grow) tf += ` scale3d(${(w + box.grow) / w}, ${(h + box.grow) / h}, ${(d + box.grow) / d})`
                if(mirror) tf += ' scaleX(-1)'
                cuboid.style.transform = tf
                for(const f of boxFaces(box.uv[0], box.uv[1], w, h, d)){
                    const face = el('skin3d-face', cuboid)
                    face.style.width = `${f.fw * S}px`
                    face.style.height = `${f.fh * S}px`
                    face.style.left = `${-f.fw * S / 2}px`
                    face.style.top = `${-f.fh * S / 2}px`
                    face.style.backgroundImage = tex.bg
                    face.style.backgroundSize = `${tex.w * S}px ${tex.h * S}px`
                    face.style.backgroundPosition = `${-f.fx * S}px ${-f.fy * S}px`
                    face.style.transform = f.tf
                }
            }
            if(swing) this.limbs.push({ pivot, x, y, z, swing })
        }

        // Le personnage fait 32 pixels de haut, centre au milieu du corps. Sa droite = gauche de l'ecran.
        part({ x: 0, y: -6, offY: -4, w: 8, h: 8, d: 8, base: [0, 0], layer: (!legacy || hatHasTransparency(img)) ? [32, 0] : null })
        part({ x: 0, y: 0, offY: 0, w: 8, h: 12, d: 4, base: [16, 16], layer: legacy ? null : [16, 32] })
        // bras (articulation a l'epaule)
        part({ x: -(4 + aw / 2), y: -5, offY: 5, w: aw, h: 12, d: 4, base: [40, 16], layer: legacy ? null : [40, 32], swing: 1 })
        part({ x: 4 + aw / 2, y: -5, offY: 5, w: aw, h: 12, d: 4, base: legacy ? [40, 16] : [32, 48], layer: legacy ? null : [48, 48], mirror: legacy, swing: -1 })
        // jambes (articulation a la hanche)
        part({ x: -2, y: 6, offY: 6, w: 4, h: 12, d: 4, base: [0, 16], layer: legacy ? null : [0, 32], swing: -1.3 })
        part({ x: 2, y: 6, offY: 6, w: 4, h: 12, d: 4, base: legacy ? [0, 16] : [16, 48], layer: legacy ? null : [0, 48], mirror: legacy, swing: 1.3 })
        // cape (texture 64x32, ou plus grande en gardant les proportions) : accrochee en haut du dos,
        // retournee pour que l'exterieur de la cape soit vu de dos
        if(cape != null){
            const capeTex = { bg: `url("${cape.src}")`, w: 64, h: 64 * cape.naturalHeight / cape.naturalWidth }
            part({ x: 0, y: -6, z: -2, offY: 8, offZ: -0.5, w: 10, h: 16, d: 1, base: [0, 0], turn: 180, swing: 'cape', tex: capeTex })
        }

        this.render(performance.now())
    }

    render(now){
        if(this.root == null) return
        this.root.style.transform = `rotateX(${TILT}deg) rotateY(${this.angle}deg)`
        const walk = Math.sin(now / 1000 * 4) * 18 // degres
        for(const limb of this.limbs){
            // la cape s'ecarte du dos et flotte un peu en marchant
            const angle = limb.swing === 'cape' ? -(8 + Math.abs(walk) * 0.4) : walk * limb.swing
            limb.pivot.style.transform = `translate3d(${limb.x * S}px, ${limb.y * S}px, ${limb.z * S}px) rotateX(${angle}deg)`
        }
    }

    /** Lance l'animation (a appeler quand l'apercu devient visible). */
    start(){
        if(this.frame != null) return
        let last = performance.now()
        const loop = (now) => {
            if(!this.dragging) this.angle += TURN_SPEED * (now - last) / 1000
            last = now
            this.render(now)
            this.frame = requestAnimationFrame(loop)
        }
        this.frame = requestAnimationFrame(loop)
    }

    /** Arrete l'animation (fenetre fermee : pas de calcul inutile). */
    stop(){
        if(this.frame != null){
            cancelAnimationFrame(this.frame)
            this.frame = null
        }
    }
}

SkinViewer.hatHasTransparency = hatHasTransparency

module.exports = SkinViewer
