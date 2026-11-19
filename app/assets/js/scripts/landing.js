/**
 * Script for landing.ejs
 */
// Requirements
const { URL }                 = require('url')
const {
    MojangRestAPI,
    getServerStatus
}                             = require('helios-core/mojang')
const {
    RestResponseStatus,
    isDisplayableError,
    validateLocalFile
}                             = require('helios-core/common')
const {
    FullRepair,
    DistributionIndexProcessor,
    MojangIndexProcessor,
    downloadFile
}                             = require('helios-core/dl')
const {
    validateSelectedJvm,
    ensureJavaDirIsRoot,
    javaExecFromRoot,
    discoverBestJvmInstallation,
    latestOpenJDK,
    extractJdk
}                             = require('helios-core/java')

// Internal Requirements
const DiscordWrapper          = require('./assets/js/discordwrapper')
const ProcessBuilder          = require('./assets/js/processbuilder')
const ModpackUpdater          = require('./assets/js/modpackupdater')
const GameInstances           = require('./assets/js/gameinstances')
const SkinChanger             = require('./assets/js/skinchanger')
const SkinViewer              = require('./assets/js/skinviewer')
const SkinHistory             = require('./assets/js/skinhistory')
const Screenshots             = require('./assets/js/screenshots')
const GameLanguage            = require('./assets/js/gamelanguage')
const { REMOTE_DISTRO_URL }   = require('./assets/js/distromanager')

// Launch Elements
const launch_content          = document.getElementById('launch_content')
const launch_details          = document.getElementById('launch_details')
const launch_progress         = document.getElementById('launch_progress')
const launch_progress_label   = document.getElementById('launch_progress_label')
const launch_details_text     = document.getElementById('launch_details_text')
const server_selection_button = document.getElementById('server_selection_button')
const user_text               = document.getElementById('user_text')

const loggerLanding = LoggerUtil.getLogger('Landing')

/* Launch Progress Wrapper Functions */

/**
 * Show/hide the loading area.
 * 
 * @param {boolean} loading True if the loading area should be shown, otherwise false.
 */
function toggleLaunchArea(loading){
    if(loading){
        launch_details.style.display = 'flex'
        launch_content.style.display = 'none'
    } else {
        launch_details.style.display = 'none'
        launch_content.style.display = 'inline-flex'
    }
}

/**
 * Set the details text of the loading area.
 * 
 * @param {string} details The new text for the loading details.
 */
function setLaunchDetails(details){
    launch_details_text.innerHTML = details
}

/**
 * Set the value of the loading progress bar and display that value.
 * 
 * @param {number} percent Percentage (0-100)
 */
function setLaunchPercentage(percent){
    launch_progress.setAttribute('max', 100)
    launch_progress.setAttribute('value', percent)
    launch_progress_label.innerHTML = percent + '%'
}

/**
 * Set the value of the OS progress bar and display that on the UI.
 * 
 * @param {number} percent Percentage (0-100)
 */
function setDownloadPercentage(percent){
    remote.getCurrentWindow().setProgressBar(percent/100)
    setLaunchPercentage(percent)
}

/**
 * Enable or disable the launch button.
 * 
 * @param {boolean} val True to enable, false to disable.
 */
function setLaunchEnabled(val){
    document.getElementById('launch_button').disabled = !val
}

/**
 * Un Minecraft lance par le launcher est-il deja en train de demarrer / ouvert ?
 * Si oui, on demande au joueur s'il veut vraiment en lancer un deuxieme.
 *
 * @returns {Promise<boolean>} Vrai si on peut lancer.
 */
function confirmIfGameRunning(){
    const running = GameInstances.list()
    if(running.length === 0){
        return Promise.resolve(true)
    }
    const game = running[0]
    const launching = game.state !== 'running'
    const minutes = Math.max(1, Math.round((Date.now() - game.startedAt) / 60000))
    const key = launching ? 'landing.alreadyRunning.launching' : 'landing.alreadyRunning.running'
    return new Promise(resolve => {
        setOverlayContent(
            Lang.queryJS(key + 'Title'),
            Lang.queryJS(key + 'Text', { name: game.name, minutes }),
            Lang.queryJS('landing.alreadyRunning.confirm'),
            Lang.queryJS('landing.alreadyRunning.cancel')
        )
        setOverlayHandler(() => {
            toggleOverlay(false)
            resolve(true)
        })
        setDismissHandler(() => {
            toggleOverlay(false)
            resolve(false)
        })
        toggleOverlay(true, true)
    })
}

// Bind launch button
document.getElementById('launch_button').addEventListener('click', async e => {
    if(!(await confirmIfGameRunning())){
        loggerLanding.info('Launch cancelled: a game is already running.')
        return
    }
    loggerLanding.info('Launching game..')
    try {
        const server = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())
        const jExe = ConfigManager.getJavaExecutable(ConfigManager.getSelectedServer())
        if(jExe == null){
            await asyncSystemScan(server.effectiveJavaOptions)
        } else {

            setLaunchDetails(Lang.queryJS('landing.launch.pleaseWait'))
            toggleLaunchArea(true)
            setLaunchPercentage(0, 100)

            const details = await validateSelectedJvm(ensureJavaDirIsRoot(jExe), server.effectiveJavaOptions.supported)
            if(details != null){
                loggerLanding.info('Jvm Details', details)
                await dlAsync()

            } else {
                await asyncSystemScan(server.effectiveJavaOptions)
            }
        }
    } catch(err) {
        loggerLanding.error('Unhandled error in during launch process.', err)
        showLaunchFailure(Lang.queryJS('landing.launch.failureTitle'), Lang.queryJS('landing.launch.failureText'))
    }
})

// Bind settings button
document.getElementById('settingsMediaButton').onclick = async e => {
    await prepareSettings()
    switchView(getCurrentView(), VIEWS.settings)
}

/* ---------- Changement de skin (bouton a droite + clic sur l'avatar) ---------- */

// La fenetre (overlay.ejs) est ajoutee a la page APRES ce script : on la prepare au premier clic.
let skinChange = null

function initSkinChanger(){
    if(skinChange != null){
        return
    }
    skinChange = {
        content:    document.getElementById('skinChangeContent'),
        viewer:     new SkinViewer(document.getElementById('skinChangePreview')),
        label:      document.getElementById('skinChangePreviewLabel'),
        fileInput:  document.getElementById('skinChangeFile'),
        fileName:   document.getElementById('skinChangeFileName'),
        status:     document.getElementById('skinChangeStatus'),
        confirm:    document.getElementById('skinChangeConfirm'),
        models:     Array.from(document.getElementsByClassName('skinChangeModel')),
        image: null,          // image affichee dans l'apercu
        newPng: null,         // fichier choisi par le joueur (Buffer) ou null
        currentUrl: null,     // skin actuel chez Minecraft
        currentVariant: 'classic',
        variant: 'classic',
        capesBox:   document.getElementById('skinChangeCapes'),
        capes: [],            // capes que possede le compte
        capeImages: new Map(),// id de cape -> image
        currentCapeId: null,  // cape portee chez Minecraft (null = aucune)
        capeId: null,         // cape choisie dans la fenetre
        historyBox: document.getElementById('skinChangeHistory'),
        currentPng: null,     // image du skin porte (Buffer)
        currentHash: null,    // son empreinte dans "Mes skins"
        historyId: null,      // skin de "Mes skins" affiche dans l'apercu
        session: 0,           // ouverture en cours (ignore les reponses d'une ouverture precedente)
        poseIndex: 0          // pose de l'apercu (SkinViewer.POSES)
    }

    // Pose de l'apercu : fleches sous le personnage (marche, course, debout, salut, assis)
    const showPose = (step) => {
        const poses = SkinViewer.POSES
        skinChange.poseIndex = (skinChange.poseIndex + step + poses.length) % poses.length
        const pose = poses[skinChange.poseIndex]
        skinChange.viewer.setPose(pose)
        document.getElementById('skinChangePoseName').textContent = Lang.queryJS('skin.poses.' + pose)
    }
    const posePrev = document.getElementById('skinChangePosePrev')
    const poseNext = document.getElementById('skinChangePoseNext')
    posePrev.title = Lang.queryJS('skin.posePrev')
    poseNext.title = Lang.queryJS('skin.poseNext')
    posePrev.onclick = () => showPose(-1)
    poseNext.onclick = () => showPose(1)
    showPose(0)

    document.getElementById('skinChangeChoose').onclick = () => {
        skinChange.fileInput.value = '' // pour pouvoir rechoisir le meme fichier
        skinChange.fileInput.click()
    }

    skinChange.fileInput.onchange = async () => {
        const file = skinChange.fileInput.files[0]
        if(file == null) return
        try {
            const png = Buffer.from(await file.arrayBuffer())
            SkinChanger.checkSkinFile(png)
            skinChange.image = await loadSkinImage('data:image/png;base64,' + png.toString('base64'))
            skinChange.newPng = png
            skinChange.historyId = null
            skinChange.fileName.textContent = file.name
            skinChange.label.innerHTML = Lang.queryJS('skin.previewLabel')
            skinStatus('')
        } catch(err) {
            skinStatus(skinErrorText(err.code ? err : { code: 'notPng' }), 'error')
        }
        refreshSkinChangeForm()
    }

    for(const btn of skinChange.models){
        btn.onclick = () => {
            skinChange.variant = btn.getAttribute('variant')
            refreshSkinChangeForm()
        }
    }

    skinChange.confirm.onclick = () => {
        if(!skinChange.confirm.disabled) applySkinChange('upload')
    }
    document.getElementById('skinChangeReset').onclick = () => applySkinChange('reset')
    document.getElementById('skinChangeCancel').onclick = closeSkinChanger
}

function skinStatus(text, type){
    skinChange.status.innerHTML = text || ''
    if(type) skinChange.status.setAttribute('type', type)
    else skinChange.status.removeAttribute('type')
}

function skinErrorText(err){
    return Lang.queryJS('skin.errors.' + (err?.code || 'network'))
}

function pngDataUrl(png){
    return 'data:image/png;base64,' + png.toString('base64')
}

async function downloadPng(url){
    return (await require('got').get(url, { responseType: 'buffer', timeout: { request: 10000 } })).body
}

function skinAccountUuid(){
    return ConfigManager.getSelectedAccount()?.uuid
}

/** Miniature d'un skin : la tete vue de face (avec la 2e couche). */
function skinHeadThumb(img){
    const c = document.createElement('canvas')
    c.width = 32
    c.height = 32
    c.className = 'skinChangeHistoryThumb'
    const ctx = c.getContext('2d')
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(img, 8, 8, 8, 8, 0, 0, 32, 32)
    // ancien skin (64x32) au chapeau entierement opaque : Minecraft ne l'affiche pas
    if(img.naturalHeight !== 32 || SkinViewer.hatHasTransparency(img)){
        ctx.drawImage(img, 40, 8, 8, 8, 0, 0, 32, 32)
    }
    return c
}

/** "Mes skins" : un bouton par skin sauvegarde (clic = apercu, croix = retirer). */
async function renderSkinHistory(){
    const session = skinChange.session
    const uuid = skinAccountUuid()
    const box = skinChange.historyBox
    const entries = uuid != null ? SkinHistory.list(uuid) : []
    const items = []
    for(const entry of entries){
        try {
            const png = SkinHistory.read(uuid, entry.id)
            items.push({ entry, png, img: await loadSkinImage(pngDataUrl(png)) })
        } catch(err) {
            // image abimee : on l'ignore
        }
    }
    if(session !== skinChange.session) return
    box.innerHTML = ''
    if(items.length === 0){
        const none = document.createElement('span')
        none.id = 'skinChangeNoHistory'
        none.innerHTML = Lang.queryJS('skin.historyEmpty')
        box.appendChild(none)
        return
    }
    for(const { entry, png, img } of items){
        const btn = document.createElement('button')
        btn.className = 'skinChangeHistoryItem'
        btn.setAttribute('skinid', entry.id)
        btn.title = Lang.queryJS(entry.variant === 'slim' ? 'skin.modelSlim' : 'skin.modelClassic')
        btn.appendChild(skinHeadThumb(img))
        btn.onclick = () => pickSkinFromHistory(entry, png, img)
        if(entry.id !== skinChange.currentHash){
            const del = document.createElement('span')
            del.className = 'skinChangeHistoryDelete'
            del.innerHTML = '&#10005;'
            del.title = Lang.queryJS('skin.historyDelete')
            del.onclick = (e) => {
                e.stopPropagation()
                SkinHistory.remove(uuid, entry.id)
                if(skinChange.historyId === entry.id) skinChange.historyId = null
                btn.remove()
            }
            btn.appendChild(del)
        }
        box.appendChild(btn)
    }
    refreshSkinChangeForm()
}

function pickSkinFromHistory(entry, png, img){
    const isCurrent = entry.id === skinChange.currentHash
    skinChange.image = img
    skinChange.variant = entry.variant
    skinChange.newPng = isCurrent ? null : png
    skinChange.historyId = entry.id
    skinChange.fileName.textContent = Lang.queryJS(isCurrent ? 'skin.historyCurrent' : 'skin.historyPicked')
    skinChange.label.innerHTML = Lang.queryJS(isCurrent ? 'skin.currentLabel' : 'skin.previewLabel')
    skinStatus('')
    refreshSkinChangeForm()
}

function loadSkinImage(src){
    return new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error('Image illisible'))
        img.src = src
    })
}

/** Affiche l'image du skin sur le personnage 3D qui tourne (assets/js/skinviewer.js). */
function drawSkinPreview(){
    const cape = skinChange.capeId != null ? skinChange.capeImages.get(skinChange.capeId) : null
    skinChange.viewer.setSkin(skinChange.image, skinChange.variant === 'slim', cape)
}

function skinChanged(){
    return skinChange.newPng != null || (skinChange.variant !== skinChange.currentVariant && skinChange.currentUrl != null)
}

function capeChanged(){
    return skinChange.capeId !== skinChange.currentCapeId
}

/** Boutons des capes du compte (+ "Aucune"). Miniature = le devant de la cape. */
function renderSkinCapes(){
    const box = skinChange.capesBox
    box.innerHTML = ''
    if(skinChange.capes.length === 0){
        const none = document.createElement('span')
        none.id = 'skinChangeNoCape'
        none.innerHTML = Lang.queryJS('skin.noCape')
        box.appendChild(none)
        return
    }
    const options = [{ id: null, alias: Lang.queryJS('skin.capeNone') }].concat(skinChange.capes)
    for(const cape of options){
        const btn = document.createElement('button')
        btn.className = 'skinChangeCape'
        btn.title = cape.alias
        const img = cape.id != null ? skinChange.capeImages.get(cape.id) : null
        if(img != null){
            const thumb = document.createElement('div')
            thumb.className = 'skinChangeCapeThumb'
            const k = 64 / img.naturalWidth // capes plus grandes que 64x32 : meme decoupage
            thumb.style.backgroundImage = `url("${img.src}")`
            thumb.style.backgroundSize = `${64 * 3}px ${img.naturalHeight * k * 3}px`
            thumb.style.backgroundPosition = '-3px -3px'
            btn.appendChild(thumb)
        } else {
            btn.textContent = cape.id == null ? Lang.queryJS('skin.capeNone') : cape.alias
        }
        btn.onclick = () => {
            skinChange.capeId = cape.id
            refreshSkinChangeForm()
        }
        btn.setAttribute('capeid', cape.id ?? '')
        box.appendChild(btn)
    }
}

function refreshSkinChangeForm(){
    for(const btn of skinChange.models){
        if(btn.getAttribute('variant') === skinChange.variant) btn.setAttribute('selected', '')
        else btn.removeAttribute('selected')
    }
    for(const btn of skinChange.historyBox.getElementsByClassName('skinChangeHistoryItem')){
        const id = btn.getAttribute('skinid')
        if(id === skinChange.historyId) btn.setAttribute('selected', '')
        else btn.removeAttribute('selected')
        if(id === skinChange.currentHash) btn.setAttribute('current', '')
        else btn.removeAttribute('current')
    }
    for(const btn of skinChange.capesBox.getElementsByClassName('skinChangeCape')){
        if(btn.getAttribute('capeid') === (skinChange.capeId ?? '')) btn.setAttribute('selected', '')
        else btn.removeAttribute('selected')
    }
    // Rien a envoyer tant que rien n'a change (fichier, modele ou cape)
    skinChange.confirm.disabled = !skinChanged() && !capeChanged()
    drawSkinPreview()
}

function setSkinBusy(busy){
    if(busy) skinChange.content.setAttribute('busy', '')
    else skinChange.content.removeAttribute('busy')
}

async function openSkinChanger(){
    initSkinChanger()
    const session = ++skinChange.session
    Object.assign(skinChange, { image: null, newPng: null, currentUrl: null, currentVariant: 'classic', variant: 'classic',
        capes: [], capeImages: new Map(), currentCapeId: null, capeId: null,
        currentPng: null, currentHash: null, historyId: null })
    document.getElementById('skinChangeHeader').innerHTML = Lang.queryJS('skin.title')
    document.getElementById('skinChangeChoose').innerHTML = Lang.queryJS('skin.choose')
    document.getElementById('skinChangeModelTitle').innerHTML = Lang.queryJS('skin.modelTitle')
    document.getElementById('skinChangeCapeTitle').innerHTML = Lang.queryJS('skin.capeTitle')
    document.getElementById('skinChangeHistoryTitle').innerHTML = Lang.queryJS('skin.historyTitle')
    skinChange.capesBox.innerHTML = ''
    skinChange.historyBox.innerHTML = ''
    skinChange.models[0].innerHTML = Lang.queryJS('skin.modelClassic')
    skinChange.models[1].innerHTML = Lang.queryJS('skin.modelSlim')
    document.getElementById('skinChangeFind').innerHTML = Lang.queryJS('skin.find')
    document.getElementById('skinChangeReset').innerHTML = Lang.queryJS('skin.reset')
    skinChange.confirm.innerHTML = Lang.queryJS('skin.confirm')
    document.getElementById('skinChangeCancel').innerHTML = Lang.queryJS('skin.cancel')
    skinChange.label.innerHTML = ''
    skinChange.fileName.textContent = Lang.queryJS('skin.fileHint')
    setSkinBusy(true)
    skinStatus(Lang.queryJS('skin.loading'))
    refreshSkinChangeForm()
    toggleOverlay(true, true, 'skinChangeContent')
    skinChange.viewer.start()

    try {
        const current = await SkinChanger.getCurrentSkin()
        if(session !== skinChange.session) return
        skinChange.currentUrl = current.url
        skinChange.currentVariant = skinChange.variant = current.variant
        skinChange.capes = current.capes
        skinChange.currentCapeId = skinChange.capeId = current.capeId
        // Images du skin et des capes en parallele (une cape illisible est juste montree par son nom)
        const [currentPng] = await Promise.all([
            current.url != null ? downloadPng(current.url) : null,
            ...current.capes.map(cape => loadSkinImage(cape.url)
                .then(img => skinChange.capeImages.set(cape.id, img))
                .catch(() => {}))
        ])
        if(session !== skinChange.session) return
        if(currentPng != null){
            skinChange.currentPng = currentPng
            skinChange.image = await loadSkinImage(pngDataUrl(currentPng))
            if(session !== skinChange.session) return
            // Le skin porte rejoint "Mes skins" (meme s'il a ete change ailleurs, ex. minecraft.net)
            skinChange.currentHash = SkinHistory.add(skinAccountUuid(), currentPng, current.variant)
            skinChange.historyId = skinChange.currentHash
        }
        renderSkinCapes()
        renderSkinHistory()
        skinChange.label.innerHTML = Lang.queryJS('skin.currentLabel')
        skinStatus('')
    } catch(err) {
        if(session !== skinChange.session) return
        skinStatus(skinErrorText(err), 'error')
    }
    setSkinBusy(false)
    refreshSkinChangeForm()
}

function closeSkinChanger(){
    skinChange.session++
    skinChange.viewer.stop()
    setSkinBusy(false)
    toggleOverlay(false)
}

async function applySkinChange(action){
    const session = skinChange.session
    setSkinBusy(true)
    skinStatus(Lang.queryJS('skin.sending'))
    try {
        if(action === 'reset'){
            await SkinChanger.resetSkin()
        } else {
            if(skinChanged()){
                let png = skinChange.newPng
                if(png == null){
                    // Seul le modele change : on renvoie l'image actuelle avec le nouveau modele
                    png = skinChange.currentPng ?? await downloadPng(skinChange.currentUrl)
                }
                await SkinChanger.uploadSkin(png, skinChange.variant)
                // Le nouveau skin rejoint "Mes skins"
                skinChange.currentPng = png
                skinChange.currentHash = SkinHistory.add(skinAccountUuid(), png, skinChange.variant)
                skinChange.currentVariant = skinChange.variant
                skinChange.newPng = null
            }
            if(capeChanged()){
                await SkinChanger.setCape(skinChange.capeId)
                skinChange.currentCapeId = skinChange.capeId
            }
        }
        const account = ConfigManager.getSelectedAccount()
        SkinUtil.applySkin(document.getElementById('avatarContainer'), account.uuid, 'body', 'right')
        if(session !== skinChange.session) return
        skinStatus(Lang.queryJS('skin.success'), 'success')
        setTimeout(() => {
            if(session === skinChange.session) closeSkinChanger()
        }, 2500)
    } catch(err) {
        if(session !== skinChange.session) return
        loggerLanding.warn('Skin change failed', err.code || err.message)
        skinStatus(skinErrorText(err), 'error')
        setSkinBusy(false)
    }
}

// Bouton "Skin" a droite + clic sur l'avatar : ouvrent la fenetre de changement de skin
document.getElementById('skinMediaButton').onclick = () => openSkinChanger()
document.getElementById('avatarOverlay').onclick = () => openSkinChanger()

/* ===== Mes captures d'ecran (bouton a droite, cf assets/js/screenshots.js) ===== */

// Fenetre preparee au 1er clic : overlay.ejs est charge apres landing.js
let shots = null

function initScreenshots(){
    if(shots != null){
        return
    }
    shots = {
        header:    document.getElementById('screenshotsHeader'),
        grid:      document.getElementById('screenshotsGrid'),
        viewer:    document.getElementById('screenshotsViewer'),
        viewerImg: document.getElementById('screenshotsViewerImg'),
        bar:       document.getElementById('screenshotsViewerBar'),
        name:      document.getElementById('screenshotsViewerName'),
        status:    document.getElementById('screenshotsStatus'),
        close:     document.getElementById('screenshotsClose'),
        folder:    document.getElementById('screenshotsOpenFolder'),
        list: [],          // captures, la plus recente en premier
        names: {},         // id du serveur -> nom affiche
        index: -1,         // capture affichee en grand (-1 = grille)
        observer: null,    // charge les vignettes quand elles apparaissent
        session: 0         // ouverture en cours (ignore les reponses d'une ouverture precedente)
    }

    document.getElementById('screenshotsPrev').onclick = () => showScreenshot(shots.index - 1)
    document.getElementById('screenshotsNext').onclick = () => showScreenshot(shots.index + 1)

    // Fermer (ou revenir a la grille si une capture est affichee en grand). Aussi : Echap / Entree.
    shots.close.onclick = () => {
        if(shots.index >= 0){
            showScreenshotGrid()
        } else {
            closeScreenshots()
        }
    }

    shots.folder.onclick = async () => {
        if(shots.index >= 0){
            Screenshots.showInFolder(shots.list[shots.index].path)
            return
        }
        // Dossier du serveur selectionne (sinon celui de la capture la plus recente)
        const server = ConfigManager.getSelectedServer() || shots.list[0]?.server
        if(server == null){
            return
        }
        const error = await Screenshots.openFolder(Screenshots.folderOf(ConfigManager.getInstanceDirectory(), server))
        if(error){
            loggerLanding.warn('Dossier des captures non ouvert :', error)
            setScreenshotsStatus(Lang.queryJS('screenshots.openFailed'), 'error')
        }
    }

    document.getElementById('screenshotsCopy').onclick = () => {
        const ok = Screenshots.copy(shots.list[shots.index].path)
        setScreenshotsStatus(Lang.queryJS(ok ? 'screenshots.copied' : 'screenshots.copyFailed'), ok ? 'success' : 'error')
    }

    document.getElementById('screenshotsDelete').onclick = async () => {
        const index = shots.index
        try {
            await Screenshots.trash(shots.list[index].path)
        } catch (err) {
            loggerLanding.warn('Capture non supprimee :', err)
            setScreenshotsStatus(Lang.queryJS('screenshots.deleteFailed'), 'error')
            return
        }
        shots.list.splice(index, 1)
        renderScreenshots()
        if(shots.list.length > 0){
            showScreenshot(Math.min(index, shots.list.length - 1))
        } else {
            showScreenshotGrid()
        }
        setScreenshotsStatus(Lang.queryJS('screenshots.deleted'), 'success')
    }
}

function setScreenshotsStatus(text, type = ''){
    shots.status.innerHTML = text
    shots.status.setAttribute('type', type)
}

/** Date d'une capture, dans la langue du launcher (ex : 19 nov. 2026, 14:32). */
function formatScreenshotDate(time){
    return new Date(time).toLocaleString(Lang.getLocaleTag(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** Fleches gauche / droite : capture precedente / suivante (quand une capture est en grand). */
function screenshotsKeys(e){
    if(shots == null || shots.index < 0 || shots.viewer.offsetParent === null){
        return
    }
    if(e.key === 'ArrowLeft'){
        showScreenshot(shots.index - 1)
    } else if(e.key === 'ArrowRight'){
        showScreenshot(shots.index + 1)
    }
}

/** Grille des vignettes. */
function renderScreenshots(){
    if(shots.observer != null){
        shots.observer.disconnect()
    }
    shots.grid.innerHTML = ''
    shots.header.textContent = Lang.queryJS('screenshots.title') + (shots.list.length > 0 ? ` (${shots.list.length})` : '')

    if(shots.list.length === 0){
        const empty = document.createElement('div')
        empty.id = 'screenshotsEmpty'
        empty.innerHTML = Lang.queryJS('screenshots.empty')
        shots.grid.appendChild(empty)
        return
    }

    // Plusieurs serveurs : on indique le serveur sous chaque capture
    const severalServers = new Set(shots.list.map(s => s.server)).size > 1

    // Les vignettes ne sont preparees que lorsqu'elles apparaissent (pas 200 images d'un coup)
    shots.observer = new IntersectionObserver(entries => {
        for(const entry of entries){
            if(!entry.isIntersecting) continue
            const tile = entry.target
            shots.observer.unobserve(tile)
            const shot = shots.list[Number(tile.getAttribute('index'))]
            if(shot == null) continue
            Screenshots.thumbnail(shot.path).then(url => {
                tile.firstChild.style.backgroundImage = `url("${url}")`
            })
        }
    }, { root: shots.grid, rootMargin: '150px' })

    shots.list.forEach((shot, i) => {
        const tile = document.createElement('button')
        tile.className = 'screenshotsTile'
        tile.setAttribute('index', i)
        const thumb = document.createElement('div')
        thumb.className = 'screenshotsThumb'
        const caption = document.createElement('span')
        caption.className = 'screenshotsCaption'
        caption.textContent = formatScreenshotDate(shot.time) + (severalServers ? ' · ' + (shots.names[shot.server] || shot.server) : '')
        tile.append(thumb, caption)
        tile.onclick = () => showScreenshot(i)
        shots.grid.appendChild(tile)
        shots.observer.observe(tile)
    })
}

/** Affiche une capture en grand (i peut deborder : on reboucle). */
function showScreenshot(i){
    if(shots.list.length === 0){
        showScreenshotGrid()
        return
    }
    shots.index = (i + shots.list.length) % shots.list.length
    const shot = shots.list[shots.index]
    shots.viewerImg.src = Screenshots.fileUrl(shot.path)
    shots.name.textContent = `${shots.index + 1} / ${shots.list.length} · ${formatScreenshotDate(shot.time)}`
    shots.grid.style.display = 'none'
    shots.viewer.style.display = ''
    shots.bar.style.display = ''
    shots.close.innerHTML = Lang.queryJS('screenshots.back')
    shots.folder.innerHTML = Lang.queryJS('screenshots.showInFolder')
    setScreenshotsStatus('')
}

function showScreenshotGrid(){
    shots.index = -1
    shots.viewer.style.display = 'none'
    shots.bar.style.display = 'none'
    shots.grid.style.display = ''
    shots.viewerImg.removeAttribute('src')
    shots.close.innerHTML = Lang.queryJS('screenshots.close')
    shots.folder.innerHTML = Lang.queryJS('screenshots.openFolder')
    setScreenshotsStatus('')
}

async function openScreenshots(){
    initScreenshots()
    const session = ++shots.session
    document.getElementById('screenshotsPrev').title = Lang.queryJS('screenshots.previous')
    document.getElementById('screenshotsNext').title = Lang.queryJS('screenshots.next')
    document.getElementById('screenshotsCopy').innerHTML = Lang.queryJS('screenshots.copy')
    document.getElementById('screenshotsDelete').innerHTML = Lang.queryJS('screenshots.delete')
    shots.header.textContent = Lang.queryJS('screenshots.title')
    shots.grid.innerHTML = ''
    showScreenshotGrid()
    setScreenshotsStatus(Lang.queryJS('screenshots.loading'))
    toggleOverlay(true, true, 'screenshotsContent')
    document.addEventListener('keydown', screenshotsKeys)

    try {
        const distro = await DistroAPI.getDistribution()
        shots.names = Object.fromEntries(distro.servers.map(s => [s.rawServer.id, s.rawServer.name]))
    } catch (err) {
        shots.names = {}
    }
    // Dossier actuel + ancien dossier .helioslauncher (captures d'avant la v1.0.13)
    const roots = [ConfigManager.getInstanceDirectory(), ConfigManager.getLegacyInstanceDirectory()].filter(Boolean)
    const list = await Screenshots.list(roots)
    if(session !== shots.session){
        return
    }
    shots.list = list
    renderScreenshots()
    setScreenshotsStatus('')
}

function closeScreenshots(){
    shots.session++
    document.removeEventListener('keydown', screenshotsKeys)
    if(shots.observer != null){
        shots.observer.disconnect()
    }
    showScreenshotGrid()
    toggleOverlay(false)
}

document.getElementById('screenshotsMediaButton').onclick = () => openScreenshots()

// Bind selected account
function updateSelectedAccount(authUser){
    let username = Lang.queryJS('landing.selectedAccount.noAccountSelected')
    if(authUser != null){
        if(authUser.displayName != null){
            username = authUser.displayName
        }
        if(authUser.uuid != null){
            SkinUtil.applySkin(document.getElementById('avatarContainer'), authUser.uuid, 'body', 'right')
        }
    }
    user_text.innerHTML = username
    onSelectedAccountChanged()
}
updateSelectedAccount(ConfigManager.getSelectedAccount())

// Bind selected server
function updateSelectedServer(serv){
    if(getCurrentView() === VIEWS.settings){
        fullSettingsSave()
    }
    ConfigManager.setSelectedServer(serv != null ? serv.rawServer.id : null)
    ConfigManager.save()
    server_selection_button.innerHTML = '&#8226; ' + (serv != null ? serv.rawServer.name : Lang.queryJS('landing.selectedServer.noSelection'))
    if(getCurrentView() === VIEWS.settings){
        animateSettingsTabRefresh()
    }
    setLaunchEnabled(serv != null)
    ModpackUpdater.checkSoon()
}
// Real text is set in uibinder.js on distributionIndexDone.
server_selection_button.innerHTML = '&#8226; ' + Lang.queryJS('landing.selectedServer.loading')
server_selection_button.onclick = async e => {
    e.target.blur()
    await toggleServerSelection(true)
}

/*
 * Statut (en bas a gauche, ex-"Statut Mojang") : seulement ce qui compte pour jouer sur Nerysia,
 * regroupe par usage (ex : Microsoft + Xbox Live + Minecraft = "Connexion au compte").
 * Les services Mojang viennent de MojangRestAPI.status(), Discord de discordstatus.com,
 * et "Telechargements Nerysia" verifie que le site du modpack repond.
 * Couleur du point = pire statut des services essentiels.
 */
const STATUS_TIMEOUT = 5000

/** Le site du modpack (apk.nerysia.fr) repond-il ? */
async function checkNerysiaFiles(){
    try {
        // no-cors : on veut juste savoir si le site repond (pas lire la reponse)
        await fetch(REMOTE_DISTRO_URL, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(STATUS_TIMEOUT) })
        return 'green'
    } catch (err) {
        return 'red'
    }
}

/** Etat de Discord (page de statut officielle). */
async function checkDiscordStatus(){
    try {
        const res = await fetch('https://discordstatus.com/api/v2/status.json', { cache: 'no-store', signal: AbortSignal.timeout(STATUS_TIMEOUT) })
        const indicator = (await res.json())?.status?.indicator
        return { none: 'green', minor: 'yellow', maintenance: 'yellow', major: 'red', critical: 'red' }[indicator] || 'grey'
    } catch (err) {
        return 'grey'
    }
}

const STATUS_GROUPS = [
    { key: 'account',     essential: true,  mojang: ['microsoft-o-auth-server', 'xbox-live-auth-server', 'xbox-live-gatekeeper', 'microsoft-minecraft-api'] },
    { key: 'multiplayer', essential: true,  mojang: ['mojang-multiplayer-session-service'] },
    { key: 'nerysia',     essential: true,  check: checkNerysiaFiles },
    { key: 'skins',       essential: false, mojang: ['minecraft-skins', 'microsoft-minecraft-profile'] },
    { key: 'discord',     essential: false, check: checkDiscordStatus }
]

/** Pire statut d'une liste (rouge > jaune > vert > gris = inconnu). */
function worstStatus(list){
    for(const s of ['red', 'yellow', 'green']){
        if(list.includes(s)) return s
    }
    return 'grey'
}

const refreshMojangStatuses = async function(){
    loggerLanding.info('Refreshing service statuses..')

    const [response, ...checks] = await Promise.all([
        MojangRestAPI.status(),
        ...STATUS_GROUPS.map(g => g.check ? g.check() : null)
    ])
    let mojangStatuses
    if(response.responseStatus === RestResponseStatus.SUCCESS) {
        mojangStatuses = response.data
    } else {
        loggerLanding.warn('Unable to refresh Mojang service status.')
        mojangStatuses = MojangRestAPI.getDefaultStatuses()
    }
    const mojangById = {}
    for(const service of mojangStatuses){
        mojangById[service.service || service.slug] = service.status
    }

    let essentialHTML = ''
    let otherHTML = ''
    const essentialStatuses = []
    STATUS_GROUPS.forEach((group, i) => {
        const status = group.check ? checks[i] : worstStatus(group.mojang.map(id => mojangById[id] || 'grey'))
        const html = `<div class="mojangStatusContainer">
            <span class="mojangStatusIcon" style="color: ${MojangRestAPI.statusToHex(status)};">&#8226;</span>
            <span class="mojangStatusName">${Lang.queryJS('landing.status.' + group.key)}</span>
        </div>`
        if(group.essential){
            essentialHTML += html
            essentialStatuses.push(status)
        } else {
            otherHTML += html
        }
    })

    document.getElementById('mojangStatusEssentialContainer').innerHTML = essentialHTML
    document.getElementById('mojangStatusNonEssentialContainer').innerHTML = otherHTML
    document.getElementById('mojang_status_icon').style.color = MojangRestAPI.statusToHex(worstStatus(essentialStatuses))
}

const refreshServerStatus = async (fade = false) => {
    loggerLanding.info('Refreshing Server Status')
    const serv = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())

    let pLabel = Lang.queryJS('landing.serverStatus.server')
    let pVal = Lang.queryJS('landing.serverStatus.offline')

    try {

        const servStat = await getServerStatus(47, serv.hostname, serv.port)
        console.log(servStat)
        pLabel = Lang.queryJS('landing.serverStatus.players')
        pVal = servStat.players.online + '/' + servStat.players.max

    } catch (err) {
        loggerLanding.warn('Unable to refresh server status, assuming offline.')
        loggerLanding.debug(err)
    }
    if(fade){
        $('#server_status_wrapper').fadeOut(250, () => {
            document.getElementById('landingPlayerLabel').innerHTML = pLabel
            document.getElementById('player_count').innerHTML = pVal
            $('#server_status_wrapper').fadeIn(500)
        })
    } else {
        document.getElementById('landingPlayerLabel').innerHTML = pLabel
        document.getElementById('player_count').innerHTML = pVal
    }
    
}

refreshMojangStatuses()
// Server Status is refreshed in uibinder.js on distributionIndexDone.

// Statut rafraichi toutes les 10 minutes
let mojangStatusListener = setInterval(() => refreshMojangStatuses(true), 10*60*1000)
// Set refresh rate to once every 5 minutes.
let serverStatusListener = setInterval(() => refreshServerStatus(true), 300000)

/**
 * Shows an error overlay, toggles off the launch area.
 * 
 * @param {string} title The overlay title.
 * @param {string} desc The overlay description.
 */
function showLaunchFailure(title, desc){
    setOverlayContent(
        title,
        desc,
        Lang.queryJS('landing.launch.okay')
    )
    setOverlayHandler(null)
    toggleOverlay(true)
    toggleLaunchArea(false)
}

/* System (Java) Scan */

/**
 * Asynchronously scan the system for valid Java installations.
 * 
 * @param {boolean} launchAfter Whether we should begin to launch after scanning. 
 */
async function asyncSystemScan(effectiveJavaOptions, launchAfter = true){

    setLaunchDetails(Lang.queryJS('landing.systemScan.checking'))
    toggleLaunchArea(true)
    setLaunchPercentage(0, 100)

    const jvmDetails = await discoverBestJvmInstallation(
        ConfigManager.getDataDirectory(),
        effectiveJavaOptions.supported
    )

    if(jvmDetails == null) {
        // If the result is null, no valid Java installation was found.
        // Show this information to the user.
        setOverlayContent(
            Lang.queryJS('landing.systemScan.noCompatibleJava'),
            Lang.queryJS('landing.systemScan.installJavaMessage', { 'major': effectiveJavaOptions.suggestedMajor }),
            Lang.queryJS('landing.systemScan.installJava'),
            Lang.queryJS('landing.systemScan.installJavaManually')
        )
        setOverlayHandler(() => {
            setLaunchDetails(Lang.queryJS('landing.systemScan.javaDownloadPrepare'))
            toggleOverlay(false)
            
            try {
                downloadJava(effectiveJavaOptions, launchAfter)
            } catch(err) {
                loggerLanding.error('Unhandled error in Java Download', err)
                showLaunchFailure(Lang.queryJS('landing.systemScan.javaDownloadFailureTitle'), Lang.queryJS('landing.systemScan.javaDownloadFailureText'))
            }
        })
        setDismissHandler(() => {
            $('#overlayContent').fadeOut(250, () => {
                //$('#overlayDismiss').toggle(false)
                setOverlayContent(
                    Lang.queryJS('landing.systemScan.javaRequired', { 'major': effectiveJavaOptions.suggestedMajor }),
                    Lang.queryJS('landing.systemScan.javaRequiredMessage', { 'major': effectiveJavaOptions.suggestedMajor }),
                    Lang.queryJS('landing.systemScan.javaRequiredDismiss'),
                    Lang.queryJS('landing.systemScan.javaRequiredCancel')
                )
                setOverlayHandler(() => {
                    toggleLaunchArea(false)
                    toggleOverlay(false)
                })
                setDismissHandler(() => {
                    toggleOverlay(false, true)

                    asyncSystemScan(effectiveJavaOptions, launchAfter)
                })
                $('#overlayContent').fadeIn(250)
            })
        })
        toggleOverlay(true, true)
    } else {
        // Java installation found, use this to launch the game.
        const javaExec = javaExecFromRoot(jvmDetails.path)
        ConfigManager.setJavaExecutable(ConfigManager.getSelectedServer(), javaExec)
        ConfigManager.save()

        // We need to make sure that the updated value is on the settings UI.
        // Just incase the settings UI is already open.
        settingsJavaExecVal.value = javaExec
        await populateJavaExecDetails(settingsJavaExecVal.value)

        // TODO Callback hell, refactor
        // TODO Move this out, separate concerns.
        if(launchAfter){
            await dlAsync()
        }
    }

}

async function downloadJava(effectiveJavaOptions, launchAfter = true) {

    // TODO Error handling.
    // asset can be null.
    const asset = await latestOpenJDK(
        effectiveJavaOptions.suggestedMajor,
        ConfigManager.getDataDirectory(),
        effectiveJavaOptions.distribution)

    if(asset == null) {
        throw new Error(Lang.queryJS('landing.downloadJava.findJdkFailure'))
    }

    let received = 0
    await downloadFile(asset.url, asset.path, ({ transferred }) => {
        received = transferred
        setDownloadPercentage(Math.trunc((transferred/asset.size)*100))
    })
    setDownloadPercentage(100)

    if(received != asset.size) {
        loggerLanding.warn(`Java Download: Expected ${asset.size} bytes but received ${received}`)
        if(!await validateLocalFile(asset.path, asset.algo, asset.hash)) {
            log.error(`Hashes do not match, ${asset.id} may be corrupted.`)
            // Don't know how this could happen, but report it.
            throw new Error(Lang.queryJS('landing.downloadJava.javaDownloadCorruptedError'))
        }
    }

    // Extract
    // Show installing progress bar.
    remote.getCurrentWindow().setProgressBar(2)

    // Wait for extration to complete.
    const eLStr = Lang.queryJS('landing.downloadJava.extractingJava')
    let dotStr = ''
    setLaunchDetails(eLStr)
    const extractListener = setInterval(() => {
        if(dotStr.length >= 3){
            dotStr = ''
        } else {
            dotStr += '.'
        }
        setLaunchDetails(eLStr + dotStr)
    }, 750)

    const newJavaExec = await extractJdk(asset.path)

    // Extraction complete, remove the loading from the OS progress bar.
    remote.getCurrentWindow().setProgressBar(-1)

    // Extraction completed successfully.
    ConfigManager.setJavaExecutable(ConfigManager.getSelectedServer(), newJavaExec)
    ConfigManager.save()

    clearInterval(extractListener)
    setLaunchDetails(Lang.queryJS('landing.downloadJava.javaInstalled'))

    // TODO Callback hell
    // Refactor the launch functions
    asyncSystemScan(effectiveJavaOptions, launchAfter)

}

// Keep reference to Minecraft Process
let proc
// Is DiscordRPC enabled
let hasRPC = false
// Joined server regex
// Change this if your server uses something different.
const GAME_JOINED_REGEX = /\[.+\]: Sound engine started/
const GAME_LAUNCH_REGEX = /^\[.+\]: (?:MinecraftForge .+ Initialized|ModLauncher .+ starting: .+|Loading Minecraft .+ with Fabric Loader .+)$/
// Etapes du demarrage de Minecraft (lues dans sa sortie) : la barre de chargement reste
// affichee jusqu'au menu du jeu (avant : cachee 5 s apres le lancement, alors que la
// fenetre met ~1 min a s'ouvrir avec les mods -> les joueurs recliquaient sur "Jouer").
// cap = jusqu'ou la barre avance doucement en attendant l'etape suivante
const GAME_START_STEPS = [
    { regex: GAME_LAUNCH_REGEX,                        percent: 5,  cap: 45, text: 'landing.gameStart.loadingMods' },
    { regex: /^\[.+\]: Setting user: /,                percent: 45, cap: 75, text: 'landing.gameStart.initMods' },
    { regex: /^\[.+\]: Backend library: LWJGL/,        percent: 75, cap: 98, text: 'landing.gameStart.openingWindow' }
]
// Si le menu n'est jamais detecte (sortie differente...), on rend la main quand meme
const GAME_START_TIMEOUT = 5 * 60 * 1000

/* Mise a jour automatique du modpack en arriere-plan (assets/js/modpackupdater.js). */
let launchInProgress = false
const modpackUpdateStatus = document.getElementById('modpackUpdateStatus')
let modpackStatusTimer = null

function showModpackStatus(status){
    clearTimeout(modpackStatusTimer)
    const name = status.server?.rawServer.name ?? ''
    if(status.state === 'downloading'){
        modpackUpdateStatus.innerHTML = Lang.queryJS('landing.modpackUpdate.downloading', { percent: status.percent ?? 0 })
        modpackUpdateStatus.title = name
        modpackUpdateStatus.style.display = ''
    } else if(status.state === 'done' && status.updated){
        modpackUpdateStatus.innerHTML = Lang.queryJS('landing.modpackUpdate.done', { version: status.server.rawServer.version })
        modpackUpdateStatus.title = name
        modpackUpdateStatus.style.display = ''
        modpackStatusTimer = setTimeout(() => { modpackUpdateStatus.style.display = 'none' }, 10000)
    } else {
        // verification sans rien a telecharger, ou echec (on reessaiera) : rien a montrer
        modpackUpdateStatus.style.display = 'none'
    }
}

ModpackUpdater.start({
    onStatus: showModpackStatus,
    // Jamais pendant un lancement ou une partie (Minecraft verrouille ses fichiers)
    isBusy: () => launchInProgress || GameInstances.isAnyRunning()
})

async function dlAsync(login = true) {
    launchInProgress = true
    try {
        if(ModpackUpdater.isRunning()){
            // Mise a jour en arriere-plan en cours : on la laisse finir (elle a deja avance)
            setLaunchDetails(Lang.queryJS('landing.modpackUpdate.finishing'))
            toggleLaunchArea(true)
            setLaunchPercentage(0, 100)
            await ModpackUpdater.waitIdle()
        }
        return await dlAsyncInner(login)
    } finally {
        launchInProgress = false
    }
}

async function dlAsyncInner(login = true) {

    // Login parameter is temporary for debug purposes. Allows testing the validation/downloads without
    // launching the game.

    const loggerLaunchSuite = LoggerUtil.getLogger('LaunchSuite')

    setLaunchDetails(Lang.queryJS('landing.dlAsync.loadingServerInfo'))

    if(login && ConfigManager.getSelectedAccount() == null){
        loggerLanding.error('You must be logged into an account.')
        return
    }

    // Reactivite : le processus de verification (~0,6 s a demarrer) et la verification du compte
    // Microsoft se font PENDANT le chargement des infos du serveur et la verification des fichiers,
    // au lieu de les attendre. Le processus ne lit le modpack qu'au moment de verifier (verifyFiles).
    // Compte : jeton renouvele si besoin (launcher ouvert depuis plus de 24 h), sinon on ne lance
    // pas le jeu avec une connexion expiree (validateSelectedAccount affiche alors "reconnecte-toi").
    const accountCheck = login ? validateSelectedAccount().catch(() => false) : Promise.resolve(true)

    const fullRepairModule = new FullRepair(
        ConfigManager.getCommonDirectory(),
        ConfigManager.getInstanceDirectory(),
        ConfigManager.getLauncherDirectory(),
        ConfigManager.getSelectedServer(),
        DistroAPI.isDevMode()
    )

    // Cache des empreintes (patches/helios-core+2.2.4.patch) : un fichier dont la taille et la
    // date n'ont pas change depuis sa derniere verification n'est pas relu (~680 Mo par lancement avant).
    fullRepairModule.spawnReceiver({
        NERYSIA_HASH_CACHE: path.join(ConfigManager.getLauncherDirectory(), 'hash-cache.json')
    })

    fullRepairModule.childProcess.on('error', (err) => {
        loggerLaunchSuite.error('Error during launch', err)
        showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), err.message || Lang.queryJS('landing.dlAsync.errorDuringLaunchText'))
    })
    fullRepairModule.childProcess.on('close', (code, _signal) => {
        if(code !== 0){
            loggerLaunchSuite.error(`Full Repair Module exited with code ${code}, assuming error.`)
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
        }
    })

    let distro

    try {
        distro = await DistroAPI.refreshDistributionOrFallback()
        onDistroRefresh(distro)
    } catch(err) {
        loggerLaunchSuite.error('Unable to refresh distribution index.', err)
        fullRepairModule.destroyReceiver()
        showLaunchFailure(Lang.queryJS('landing.dlAsync.fatalError'), Lang.queryJS('landing.dlAsync.unableToLoadDistributionIndex'))
        return
    }

    const serv = distro.getServerById(ConfigManager.getSelectedServer())

    setLaunchDetails(Lang.queryJS('landing.dlAsync.pleaseWait'))
    toggleLaunchArea(true)
    setLaunchPercentage(0, 100)

    loggerLaunchSuite.info('Validating files.')
    setLaunchDetails(Lang.queryJS('landing.dlAsync.validatingFileIntegrity'))
    let invalidFileCount = 0
    try {
        invalidFileCount = await fullRepairModule.verifyFiles(percent => {
            setLaunchPercentage(percent)
        })
        setLaunchPercentage(100)
    } catch (err) {
        loggerLaunchSuite.error('Error during file validation.')
        showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringFileVerificationTitle'), err.displayable || Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
        return
    }
    

    if(invalidFileCount > 0) {
        loggerLaunchSuite.info('Downloading files.')
        setLaunchDetails(Lang.queryJS('landing.dlAsync.downloadingFiles'))
        setLaunchPercentage(0)
        try {
            await fullRepairModule.download(percent => {
                setDownloadPercentage(percent)
            })
            setDownloadPercentage(100)
        } catch(err) {
            loggerLaunchSuite.error('Error during file download.')
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringFileDownloadTitle'), err.displayable || Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
            return
        }
    } else {
        loggerLaunchSuite.info('No invalid files, skipping download.')
    }
    // Tout est verifie et a jour : rien a refaire en arriere-plan pour ce modpack
    ModpackUpdater.markSynced(serv)

    // Remove download bar.
    remote.getCurrentWindow().setProgressBar(-1)

    fullRepairModule.destroyReceiver()

    if(!(await accountCheck)){
        // Connexion expiree et non renouvelable : la fenetre "reconnecte-toi" est deja affichee
        loggerLaunchSuite.warn('Compte non valide, lancement annule.')
        toggleLaunchArea(false)
        return
    }

    setLaunchDetails(Lang.queryJS('landing.dlAsync.preparingToLaunch'))

    const mojangIndexProcessor = new MojangIndexProcessor(
        ConfigManager.getCommonDirectory(),
        serv.rawServer.minecraftVersion)
    const distributionIndexProcessor = new DistributionIndexProcessor(
        ConfigManager.getCommonDirectory(),
        distro,
        serv.rawServer.id
    )

    const modLoaderData = await distributionIndexProcessor.loadModLoaderVersionJson(serv)
    const versionData = await mojangIndexProcessor.getVersionJson()

    if(login) {
        // Minecraft dans la langue du launcher (cf assets/js/gamelanguage.js)
        GameLanguage.apply(path.join(ConfigManager.getInstanceDirectory(), serv.rawServer.id), Lang.getMinecraftLanguage())

        const authUser = ConfigManager.getSelectedAccount()
        loggerLaunchSuite.info(`Sending selected account (${authUser.displayName}) to ProcessBuilder.`)
        let pb = new ProcessBuilder(serv, versionData, modLoaderData, authUser, remote.app.getVersion())
        setLaunchDetails(Lang.queryJS('landing.dlAsync.launchingGame'))

        // const SERVER_JOINED_REGEX = /\[.+\]: \[CHAT\] [a-zA-Z0-9_]{1,16} joined the game/
        const SERVER_JOINED_REGEX = new RegExp(`\\[.+\\]: \\[CHAT\\] ${authUser.displayName} joined the game`)

        // Demarrage du jeu : on suit sa sortie etape par etape (cf GAME_START_STEPS)
        let gameProc = null
        let stepIndex = -1
        let shownPercent = 0
        let startFinished = false
        let creepTimer = null
        let startTimeout = null

        const showPercent = (percent) => {
            shownPercent = percent
            setLaunchPercentage(Math.round(percent))
        }

        const finishStart = (ready) => {
            if(startFinished){
                return
            }
            startFinished = true
            clearInterval(creepTimer)
            clearTimeout(startTimeout)
            gameProc.stdout.removeListener('data', tempListener)
            gameProc.stderr.removeListener('data', gameErrorListener)
            if(ready){
                GameInstances.markRunning(gameProc.pid)
                showPercent(100)
                setLaunchDetails(Lang.queryJS('landing.dlAsync.doneEnjoyServer'))
                setTimeout(() => toggleLaunchArea(false), 2000)
            } else {
                toggleLaunchArea(false)
            }
        }

        const enterStep = (index) => {
            stepIndex = index
            const step = GAME_START_STEPS[index]
            showPercent(Math.max(shownPercent, step.percent))
            setLaunchDetails(Lang.queryJS(step.text))
            if(index === 0 && hasRPC){
                DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.loading'))
                gameProc.stdout.on('data', gameStateChange)
            }
        }

        // Attach a temporary listener to the client output.
        const tempListener = function(data){
            // La sortie arrive par paquets de plusieurs lignes : on teste chaque ligne
            for(const raw of data.split('\n')){
                const line = raw.trim()
                if(GAME_JOINED_REGEX.test(line)){
                    // "Sound engine started" : fin du chargement, le menu du jeu s'affiche
                    finishStart(true)
                    return
                }
                for(let i = stepIndex + 1; i < GAME_START_STEPS.length; i++){
                    if(GAME_START_STEPS[i].regex.test(line)){
                        enterStep(i)
                        break
                    }
                }
            }
        }

        // Listener for Discord RPC.
        const gameStateChange = function(data){
            data = data.trim()
            if(SERVER_JOINED_REGEX.test(data)){
                DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.joined'))
            } else if(GAME_JOINED_REGEX.test(data)){
                DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.joining'))
            }
        }

        const gameErrorListener = function(data){
            data = data.trim()
            if(data.indexOf('Could not find or load main class net.minecraft.launchwrapper.Launch') > -1){
                loggerLaunchSuite.error('Game launch failed, LaunchWrapper was not downloaded properly.')
                showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.launchWrapperNotDownloaded'))
            }
        }

        try {
            // Build Minecraft process.
            proc = pb.build()
            gameProc = proc
            GameInstances.register(gameProc, serv)

            // Bind listeners to stdout.
            gameProc.stdout.on('data', tempListener)
            gameProc.stderr.on('data', gameErrorListener)

            setLaunchDetails(Lang.queryJS('landing.gameStart.starting'))
            showPercent(0)

            // La barre avance doucement entre deux etapes : on voit que ca travaille
            creepTimer = setInterval(() => {
                const cap = stepIndex < 0 ? 5 : GAME_START_STEPS[stepIndex].cap
                if(shownPercent < cap - 0.5){
                    showPercent(shownPercent + (cap - shownPercent) * 0.04)
                }
            }, 1000)
            startTimeout = setTimeout(() => finishStart(false), GAME_START_TIMEOUT)

            gameProc.on('close', (code, _signal) => {
                if(proc === gameProc){
                    proc = null
                }
                if(!startFinished){
                    finishStart(false)
                    if(code !== 0){
                        loggerLaunchSuite.error(`Minecraft closed during startup (code ${code}).`)
                        showLaunchFailure(
                            Lang.queryJS('landing.gameStart.crashedTitle'),
                            Lang.queryJS('landing.gameStart.crashedText', { code })
                        )
                    }
                }
            })

            // Init Discord Hook
            if(distro.rawDistribution.discord != null && serv.rawServer.discord != null){
                DiscordWrapper.initRPC(distro.rawDistribution.discord, serv.rawServer.discord)
                hasRPC = true
                gameProc.on('close', (code, signal) => {
                    loggerLaunchSuite.info('Shutting down Discord Rich Presence..')
                    DiscordWrapper.shutdownRPC()
                    hasRPC = false
                })
            }

        } catch(err) {

            loggerLaunchSuite.error('Error during launch', err)
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.checkConsoleForDetails'))

        }
    }

}

/**
 * News Loading Functions
 */

// DOM Cache
const newsContent                   = document.getElementById('newsContent')
const newsArticleTitle              = document.getElementById('newsArticleTitle')
const newsArticleDate               = document.getElementById('newsArticleDate')
const newsArticleAuthor             = document.getElementById('newsArticleAuthor')
const newsArticleComments           = document.getElementById('newsArticleComments')
const newsNavigationStatus          = document.getElementById('newsNavigationStatus')
const newsArticleContentScrollable  = document.getElementById('newsArticleContentScrollable')
const nELoadSpan                    = document.getElementById('nELoadSpan')

// News slide caches.
let newsActive = false
let newsGlideCount = 0
// Duree du glissement des actualites : doit correspondre a --news-slide-time dans launcher.css
const NEWS_SLIDE_MS = 1400
let newsSlideEndTimer = null

/**
 * Show the news UI via a slide animation.
 * 
 * @param {boolean} up True to slide up, otherwise false. 
 */
function slide_(up){
    const lCUpper = document.querySelector('#landingContainer > #upper')
    const lCLLeft = document.querySelector('#landingContainer > #lower > #left')
    const lCLCenter = document.querySelector('#landingContainer > #lower > #center')
    const lCLRight = document.querySelector('#landingContainer > #lower > #right')
    const newsBtn = document.querySelector('#landingContainer > #lower > #center #content')
    const landingContainer = document.getElementById('landingContainer')
    const newsContainer = document.querySelector('#landingContainer > #newsContainer')

    newsGlideCount++

    // Fluidite : on deplace avec transform (calcule par la carte graphique) au lieu de "top"
    // (toute la page recalculee a chaque image), et le flou des panneaux des actualites est
    // coupe pendant le glissement (recalcule a chaque image = la grosse saccade).
    newsContainer.setAttribute('sliding', '')
    clearTimeout(newsSlideEndTimer)
    newsSlideEndTimer = setTimeout(() => newsContainer.removeAttribute('sliding'), NEWS_SLIDE_MS)

    if(up){
        lCUpper.style.transform = 'translateY(-200vh)'
        lCLLeft.style.transform = 'translateY(-200vh)'
        lCLCenter.style.transform = 'translateY(-200vh)'
        lCLRight.style.transform = 'translateY(-200vh)'
        newsBtn.style.transform = 'translateY(calc(130vh - 42px))'
        newsContainer.style.transform = 'translateY(0)'
        landingContainer.setAttribute('news', '') // assombrit le fond (cf launcher.css)
        setTimeout(() => {
            if(newsGlideCount === 1){
                lCLCenter.style.transition = 'none'
                newsBtn.style.transition = 'none'
            }
            newsGlideCount--
        }, NEWS_SLIDE_MS)
    } else {
        setTimeout(() => {
            newsGlideCount--
        }, NEWS_SLIDE_MS)
        landingContainer.removeAttribute('news')
        lCLCenter.style.transition = null
        newsBtn.style.transition = null
        newsContainer.style.transform = null
        lCUpper.style.transform = null
        lCLLeft.style.transform = null
        lCLCenter.style.transform = null
        lCLRight.style.transform = null
        newsBtn.style.transform = null
    }
}

// Bind news button.
document.getElementById('newsButton').onclick = () => {
    // Toggle tabbing.
    if(newsActive){
        $('#landingContainer *').removeAttr('tabindex')
        $('#newsContainer *').attr('tabindex', '-1')
    } else {
        $('#landingContainer *').attr('tabindex', '-1')
        $('#newsContainer, #newsContainer *, #lower, #lower #center *').removeAttr('tabindex')
        if(newsAlertShown){
            $('#newsButtonAlert').fadeOut(2000)
            newsAlertShown = false
            ConfigManager.setNewsCacheDismissed(true)
            ConfigManager.save()
        }
    }
    slide_(!newsActive)
    newsActive = !newsActive
    updateNewsBackButton()
}

/**
 * Actualites en plein ecran : la fleche de retour est cachee une fois le panneau en place,
 * et reapparait quand la souris s'approche du haut de la fenetre.
 */
const NEWS_BACK_ZONE_PX = 90 // hauteur de la zone du haut qui fait reapparaitre la fleche
let newsMouseNearTop = false
let newsBackTimer = null

function updateNewsBackButton(){
    const landing = document.getElementById('landingContainer')
    clearTimeout(newsBackTimer)
    if(!newsActive){
        landing.removeAttribute('newsbtnhidden')
        return
    }
    // pendant le glissement, la fleche reste visible (elle monte avec le panneau)
    newsBackTimer = setTimeout(() => {
        landing.toggleAttribute('newsbtnhidden', newsActive && !newsMouseNearTop)
    }, newsGlideCount > 0 ? NEWS_SLIDE_MS : 0)
}

document.addEventListener('mousemove', e => {
    if(!newsActive) return
    const near = e.clientY < NEWS_BACK_ZONE_PX
    if(near !== newsMouseNearTop){
        newsMouseNearTop = near
        if(newsGlideCount === 0){
            document.getElementById('landingContainer').toggleAttribute('newsbtnhidden', !near)
        }
    }
})
// La souris quitte la fenetre : on recache la fleche
document.addEventListener('mouseleave', () => {
    newsMouseNearTop = false
    if(newsActive && newsGlideCount === 0){
        document.getElementById('landingContainer').setAttribute('newsbtnhidden', '')
    }
})

// Array to store article meta.
let newsArr = null

// News load animation listener.
let newsLoadingListener = null

/**
 * Set the news loading animation.
 * 
 * @param {boolean} val True to set loading animation, otherwise false.
 */
function setNewsLoading(val){
    if(val){
        const nLStr = Lang.queryJS('landing.news.checking')
        let dotStr = '..'
        nELoadSpan.innerHTML = nLStr + dotStr
        newsLoadingListener = setInterval(() => {
            if(dotStr.length >= 3){
                dotStr = ''
            } else {
                dotStr += '.'
            }
            nELoadSpan.innerHTML = nLStr + dotStr
        }, 750)
    } else {
        if(newsLoadingListener != null){
            clearInterval(newsLoadingListener)
            newsLoadingListener = null
        }
    }
}

// Bind retry button.
newsErrorRetry.onclick = () => {
    $('#newsErrorFailed').fadeOut(250, () => {
        initNews()
        $('#newsErrorLoading').fadeIn(250)
    })
}

newsArticleContentScrollable.onscroll = (e) => {
    if(e.target.scrollTop > Number.parseFloat($('.newsArticleSpacerTop').css('height'))){
        newsContent.setAttribute('scrolled', '')
    } else {
        newsContent.removeAttribute('scrolled')
    }
}

/**
 * Reload the news without restarting.
 * 
 * @returns {Promise.<void>} A promise which resolves when the news
 * content has finished loading and transitioning.
 */
function reloadNews(){
    return new Promise((resolve, reject) => {
        $('#newsContent').fadeOut(250, () => {
            $('#newsErrorLoading').fadeIn(250)
            initNews().then(() => {
                resolve()
            })
        })
    })
}

let newsAlertShown = false

/**
 * Show the news alert indicating there is new news.
 */
function showNewsAlert(){
    newsAlertShown = true
    $(newsButtonAlert).fadeIn(250)
}

async function digestMessage(str) {
    const msgUint8 = new TextEncoder().encode(str)
    const hashBuffer = await crypto.subtle.digest('SHA-1', msgUint8)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const hashHex = hashArray
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    return hashHex
}

/**
 * Initialize News UI. This will load the news and prepare
 * the UI accordingly.
 * 
 * @returns {Promise.<void>} A promise which resolves when the news
 * content has finished loading and transitioning.
 */
async function initNews(){

    setNewsLoading(true)

    const news = await loadNews()

    newsArr = news?.articles || null

    if(newsArr == null){
        // News Loading Failed
        setNewsLoading(false)

        await $('#newsErrorLoading').fadeOut(250).promise()
        await $('#newsErrorFailed').fadeIn(250).promise()

    } else if(newsArr.length === 0) {
        // No News Articles
        setNewsLoading(false)

        ConfigManager.setNewsCache({
            date: null,
            content: null,
            dismissed: false
        })
        ConfigManager.save()

        await $('#newsErrorLoading').fadeOut(250).promise()
        await $('#newsErrorNone').fadeIn(250).promise()
    } else {
        // Success
        setNewsLoading(false)

        const lN = newsArr[0]
        const cached = ConfigManager.getNewsCache()
        let newHash = await digestMessage(lN.content)
        let newDate = new Date(lN.timestamp)
        let isNew = false

        if(cached.date != null && cached.content != null){

            if(new Date(cached.date) >= newDate){

                // Compare Content
                if(cached.content !== newHash){
                    isNew = true
                    showNewsAlert()
                } else {
                    if(!cached.dismissed){
                        isNew = true
                        showNewsAlert()
                    }
                }

            } else {
                isNew = true
                showNewsAlert()
            }

        } else {
            isNew = true
            showNewsAlert()
        }

        if(isNew){
            ConfigManager.setNewsCache({
                date: newDate.getTime(),
                content: newHash,
                dismissed: false
            })
            ConfigManager.save()
        }

        const switchHandler = (forward) => {
            let cArt = parseInt(newsContent.getAttribute('article'))
            let nxtArt = forward ? (cArt >= newsArr.length-1 ? 0 : cArt + 1) : (cArt <= 0 ? newsArr.length-1 : cArt - 1)
    
            displayArticle(newsArr[nxtArt], nxtArt+1)
        }

        document.getElementById('newsNavigateRight').onclick = () => { switchHandler(true) }
        document.getElementById('newsNavigateLeft').onclick = () => { switchHandler(false) }
        renderNewsList()
        await $('#newsErrorContainer').fadeOut(250).promise()
        displayArticle(newsArr[0], 1)
        await $('#newsContent').fadeIn(250).promise()
    }


}

/**
 * Add keyboard controls to the news UI. Left and right arrows toggle
 * between articles. If you are on the landing page, the up arrow will
 * open the news UI.
 */
document.addEventListener('keydown', (e) => {
    if(newsActive){
        // Echap : retour a la page principale (sauf si une fenetre par-dessus est ouverte)
        if(e.key === 'Escape' && !isOverlayVisible() && getCurrentView() === VIEWS.landing){
            document.getElementById('newsButton').click()
            return
        }
        if(e.key === 'ArrowRight' || e.key === 'ArrowLeft'){
            document.getElementById(e.key === 'ArrowRight' ? 'newsNavigateRight' : 'newsNavigateLeft').click()
        }
        // Interferes with scrolling an article using the down arrow.
        // Not sure of a straight forward solution at this point.
        // if(e.key === 'ArrowDown'){
        //     document.getElementById('newsButton').click()
        // }
    } else {
        if(getCurrentView() === VIEWS.landing){
            if(e.key === 'ArrowUp'){
                document.getElementById('newsButton').click()
            }
        }
    }
})

/**
 * Display a news article on the UI.
 * 
 * @param {Object} articleObject The article meta object.
 * @param {number} index The article index.
 */
/*
 * News prioritaires (mise en avant en jaune), meme regle que le site vitrine et l'admin :
 * une <category> qui vaut "prioritaire" (espaces retires, minuscules), et si elle existe,
 * <category domain="https://nerysia.fr/rss/prioritaire-jusqu-au"> = date de fin (format de pubDate) pas encore passee.
 * Date illisible = ignoree (reste prioritaire). Les autres <category> sont ignorees.
 * La date de fin est relue a chaque affichage : la news redevient normale toute seule.
 * L'ordre des news ne change pas (par date).
 */
const PRIORITY_UNTIL_DOMAIN = 'https://nerysia.fr/rss/prioritaire-jusqu-au'

function readPriority(el){
    const categories = el.find('category').toArray()
    const priority = categories.some(c => c.textContent.trim().toLowerCase() === 'prioritaire')
    const untilCategory = categories.find(c => c.getAttribute('domain') === PRIORITY_UNTIL_DOMAIN)
    return { priority, priorityUntil: untilCategory ? Date.parse(untilCategory.textContent.trim()) : NaN }
}

function isPriorityNow(article){
    return article.priority === true && (isNaN(article.priorityUntil) || Date.now() < article.priorityUntil)
}

function displayArticle(articleObject, index){
    newsArticleTitle.innerHTML = articleObject.title
    newsArticleTitle.href = articleObject.link
    newsArticleAuthor.innerHTML = articleObject.author ? Lang.queryJS('landing.news.by', { author: articleObject.author }) : ''
    newsArticleAuthor.style.display = articleObject.author ? '' : 'none'
    newsArticleDate.innerHTML = articleObject.date
    const priority = isPriorityNow(articleObject)
    const priorityChip = document.getElementById('newsArticlePriority')
    priorityChip.innerHTML = Lang.queryJS('landing.news.priority')
    priorityChip.style.display = priority ? '' : 'none'
    newsContent.toggleAttribute('prioritaire', priority)
    newsArticleComments.innerHTML = articleObject.comments
    newsArticleComments.href = articleObject.commentsLink
    newsArticleContentScrollable.scrollTop = 0
    newsContent.removeAttribute('scrolled')
    for(const item of document.querySelectorAll('.newsListItem')){
        if(Number(item.getAttribute('article')) === index - 1) item.setAttribute('selected', '')
        else item.removeAttribute('selected')
    }
    newsArticleContentScrollable.innerHTML = '<div id="newsArticleContentWrapper"><div class="newsArticleSpacerTop"></div>' + articleObject.content + '<div class="newsArticleSpacerBot"></div></div>'
    Array.from(newsArticleContentScrollable.getElementsByClassName('bbCodeSpoilerButton')).forEach(v => {
        v.onclick = () => {
            const text = v.parentElement.getElementsByClassName('bbCodeSpoilerText')[0]
            text.style.display = text.style.display === 'block' ? 'none' : 'block'
        }
    })
    newsNavigationStatus.innerHTML = Lang.query('ejs.landing.newsNavigationStatus', {currentPage: index, totalPages: newsArr.length})
    newsContent.setAttribute('article', index-1)
}

/**
 * Liste des articles (colonne de gauche des news) : titre + date, cliquable.
 */
function renderNewsList(){
    const list = document.getElementById('newsList')
    list.innerHTML = ''
    newsArr.forEach((article, i) => {
        const item = document.createElement('button')
        item.className = 'newsListItem'
        item.setAttribute('article', i)
        item.toggleAttribute('prioritaire', isPriorityNow(article))
        const title = document.createElement('span')
        title.className = 'newsListItemTitle'
        title.textContent = article.title
        const date = document.createElement('span')
        date.className = 'newsListItemDate'
        date.textContent = article.date
        item.append(title, date)
        item.onclick = () => displayArticle(newsArr[i], i + 1)
        list.appendChild(item)
    })
}

/**
 * Load news information from the RSS feed specified in the
 * distribution index.
 */
async function loadNews(){

    const distroData = await DistroAPI.getDistribution()
    if(!distroData.rawDistribution.rss) {
        loggerLanding.debug('No RSS feed provided.')
        return null
    }

    const promise = new Promise((resolve, reject) => {
        
        const newsFeed = distroData.rawDistribution.rss
        const newsHost = new URL(newsFeed).origin + '/'
        $.ajax({
            url: newsFeed,
            // Toujours retelecharger : sinon Chromium garde l'ancien feed.xml en cache pendant des jours
            // (le serveur n'envoie pas d'en-tete de cache) et les nouvelles news n'apparaissent pas.
            cache: false,
            success: (data) => {
                const items = $(data).find('item')
                const articles = []

                for(let i=0; i<items.length; i++){
                // JQuery Element
                    const el = $(items[i])

                    // Resolve date.
                    // date : affichee dans la langue du launcher ; timestamp : pour la detection "nouvel article" (initNews)
                    const timestamp = new Date(el.find('pubDate').text()).getTime()
                    const date = new Date(timestamp).toLocaleDateString(Lang.getLocaleTag(), {day: 'numeric', month: 'long', year: 'numeric'})

                    // Resolve comments.
                    const commentCount = el.find('slash\\:comments').text() || '0'
                    const comments = commentCount === '1'
                        ? Lang.queryJS('landing.news.commentsOne')
                        : Lang.queryJS('landing.news.commentsMany', { count: commentCount })

                    // Fix relative links in content.
                    let content = el.find('content\\:encoded').text()
                    let regex = /src="(?!http:\/\/|https:\/\/)(.+?)"/g
                    let matches
                    while((matches = regex.exec(content))){
                        content = content.replace(`"${matches[1]}"`, `"${newsHost + matches[1]}"`)
                    }

                    let link   = el.find('link').text()
                    let title  = el.find('title').text()
                    let author = el.find('dc\\:creator').text()
                    const { priority, priorityUntil } = readPriority(el)

                    // Generate article.
                    articles.push(
                        {
                            link,
                            title,
                            date,
                            timestamp,
                            author,
                            content,
                            comments,
                            commentsLink: link + '#comments',
                            priority,
                            priorityUntil
                        }
                    )
                }
                resolve({
                    articles
                })
            },
            timeout: 2500
        }).catch(err => {
            resolve({
                articles: null
            })
        })
    })

    return await promise
}
