/**
 * Journal du launcher enregistre dans un fichier (avant : seulement dans la console, perdu a la fermeture).
 *
 * <donnees du launcher>/logs/launcher.log = session actuelle, launcher-previous.log = session d'avant.
 * Tout ce que la fenetre ecrit dans la console (loggers helios-core compris) + les erreurs non
 * interceptees. Lu par l'onglet Depannage (supportlogs.js), qui masque les infos sensibles.
 * Branche tout au debut (uicore.js), sans module interne pour ne rien rater.
 */
/* global window */
const fs   = require('fs')
const path = require('path')

const MAX_BYTES = 5 * 1024 * 1024 // au-dela, on arrete d'ecrire (une session normale fait quelques centaines de Ko)
const LEVELS = ['log', 'info', 'warn', 'error', 'debug']

let file = null
let previous = null
let queue = []
let written = 0
let timer = null

const stripAnsi = s => s.replace(/\u001b\[[0-9;]*m/g, '')

function toText(arg){
    if(typeof arg === 'string') return arg
    if(arg instanceof Error) return arg.stack || arg.message
    try {
        return JSON.stringify(arg)
    } catch(err) {
        return String(arg)
    }
}

function stamp(){
    const d = new Date()
    const z = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`
}

function push(level, args){
    let text = stripAnsi(args.map(toText).join(' '))
    // Les loggers helios-core ecrivent deja "[date] [niveau] [Nom]: ..." ; le reste recoit date + niveau
    if(!/^\[\d{4}-\d\d-\d\d /.test(text)){
        text = `[${stamp()}] [${level === 'log' ? 'info' : level}] ${text}`
    }
    queue.push(text + '\n')
    if(timer == null) timer = setTimeout(flush, 500)
}

function flush(sync = false){
    clearTimeout(timer)
    timer = null
    if(file == null || queue.length === 0) return
    const text = queue.join('')
    queue = []
    if(written > MAX_BYTES) return
    written += Buffer.byteLength(text)
    if(sync){
        try { fs.appendFileSync(file, text) } catch(err) { /* tant pis */ }
    } else {
        fs.appendFile(file, text, () => {})
    }
}

/** A appeler une fois, au demarrage de la fenetre. */
exports.init = function(launcherDir){
    if(file != null) return
    try {
        const dir = path.join(launcherDir, 'logs')
        fs.mkdirSync(dir, { recursive: true })
        file = path.join(dir, 'launcher.log')
        previous = path.join(dir, 'launcher-previous.log')
        if(fs.existsSync(file)) fs.renameSync(file, previous)
    } catch(err) {
        file = null
        return
    }
    for(const level of LEVELS){
        const original = console[level].bind(console)
        console[level] = (...args) => {
            original(...args)
            try { push(level, args) } catch(err) { /* ne jamais casser la console */ }
        }
    }
    window.addEventListener('error', e => push('error', [`Erreur non interceptee : ${e.error?.stack || e.message}`]))
    window.addEventListener('unhandledrejection', e => push('error', [`Promesse rejetee non interceptee : ${toText(e.reason)}`]))
    window.addEventListener('beforeunload', () => flush(true))
}

/** Fichier de la session actuelle (null si le journal n'a pas pu etre cree). */
exports.file = function(){
    flush(true) // pour lire un fichier a jour
    return file
}

/** Fichier de la session precedente. */
exports.previousFile = function(){
    return previous
}
