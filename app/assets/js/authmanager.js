/**
 * AuthManager
 * 
 * This module aims to abstract login procedures (Microsoft accounts only: Mojang accounts
 * no longer exist since their migration to Microsoft). Results are processed and stored
 * in the config using the ConfigManager. All login procedures should be made through this module.
 * 
 * @module authmanager
 */
// Requirements
const ConfigManager          = require('./configmanager')
const { LoggerUtil }         = require('helios-core')
const { RestResponseStatus } = require('helios-core/common')
const { MicrosoftAuth, MicrosoftErrorCode } = require('helios-core/microsoft')
const { AZURE_CLIENT_ID }    = require('./ipcconstants')
const got                    = require('got')
const Lang = require('./langloader')

const log = LoggerUtil.getLogger('AuthManager')

// Error messages

function microsoftErrorDisplayable(errorCode) {
    switch (errorCode) {
        case MicrosoftErrorCode.NO_PROFILE:
            return {
                title: Lang.queryJS('auth.microsoft.error.noProfileTitle'),
                desc: Lang.queryJS('auth.microsoft.error.noProfileDesc')
            }
        case MicrosoftErrorCode.NO_XBOX_ACCOUNT:
            return {
                title: Lang.queryJS('auth.microsoft.error.noXboxAccountTitle'),
                desc: Lang.queryJS('auth.microsoft.error.noXboxAccountDesc')
            }
        case MicrosoftErrorCode.XBL_BANNED:
            return {
                title: Lang.queryJS('auth.microsoft.error.xblBannedTitle'),
                desc: Lang.queryJS('auth.microsoft.error.xblBannedDesc')
            }
        case MicrosoftErrorCode.UNDER_18:
            return {
                title: Lang.queryJS('auth.microsoft.error.under18Title'),
                desc: Lang.queryJS('auth.microsoft.error.under18Desc')
            }
        case MicrosoftErrorCode.UNKNOWN:
            return {
                title: Lang.queryJS('auth.microsoft.error.unknownTitle'),
                desc: Lang.queryJS('auth.microsoft.error.unknownDesc')
            }
    }
}

// Functions

const AUTH_MODE = { FULL: 0, MS_REFRESH: 1, MC_REFRESH: 2 }

/*
 * Jeton Microsoft : code de connexion -> jetons, ou renouvellement avec le refresh_token.
 * Fait ici plutot qu'avec MicrosoftAuth.getAccessToken (helios-core) pour demander
 * explicitement "offline_access" : sans lui, Microsoft ne renvoyait pas de refresh_token avec
 * le Client ID Nerysia (constate le 2026-11-19), et la connexion expirait au bout de 24 h
 * ("Ta connexion a expire, reconnecte-toi").
 * Requete faite par Node (got) et non fetch : Microsoft refuse une demande de jeton qui vient
 * d'une page web (en-tete Origin) pour une application de bureau.
 */
const MS_TOKEN_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token'
const MS_REDIRECT_URI = 'https://login.microsoftonline.com/common/oauth2/nativeclient'

async function getMicrosoftAccessToken(code, refresh){
    const form = {
        client_id: AZURE_CLIENT_ID,
        scope: 'XboxLive.signin offline_access',
        redirect_uri: MS_REDIRECT_URI
    }
    if(refresh){
        form.grant_type = 'refresh_token'
        form.refresh_token = code
    } else {
        form.grant_type = 'authorization_code'
        form.code = code
    }
    try {
        const res = await got.post(MS_TOKEN_URL, { form, responseType: 'json', throwHttpErrors: false, timeout: 15000 })
        const data = res.body || {}
        if(res.statusCode !== 200 || data.access_token == null){
            // Jamais de jeton dans les logs : seulement le code d'erreur de Microsoft
            log.warn(`Jeton Microsoft refuse (${res.statusCode}) : ${data.error || '?'}`)
            return { responseStatus: RestResponseStatus.ERROR, microsoftErrorCode: MicrosoftErrorCode.UNKNOWN }
        }
        if(data.refresh_token == null){
            log.warn('Microsoft n\'a pas renvoye de jeton de renouvellement (refresh_token).')
        }
        return { responseStatus: RestResponseStatus.SUCCESS, data }
    } catch(err) {
        log.error('Jeton Microsoft impossible a obtenir :', err.message)
        return { responseStatus: RestResponseStatus.ERROR, microsoftErrorCode: MicrosoftErrorCode.UNKNOWN }
    }
}

/**
 * Perform the full MS Auth flow in a given mode.
 * 
 * AUTH_MODE.FULL = Full authorization for a new account.
 * AUTH_MODE.MS_REFRESH = Full refresh authorization.
 * AUTH_MODE.MC_REFRESH = Refresh of the MC token, reusing the MS token.
 * 
 * @param {string} entryCode FULL-AuthCode. MS_REFRESH=refreshToken, MC_REFRESH=accessToken
 * @param {*} authMode The auth mode.
 * @returns An object with all auth data. AccessToken object will be null when mode is MC_REFRESH.
 */
async function fullMicrosoftAuthFlow(entryCode, authMode) {
    try {

        let accessTokenRaw
        let accessToken
        if(authMode !== AUTH_MODE.MC_REFRESH) {
            const accessTokenResponse = await getMicrosoftAccessToken(entryCode, authMode === AUTH_MODE.MS_REFRESH)
            if(accessTokenResponse.responseStatus === RestResponseStatus.ERROR) {
                return Promise.reject(microsoftErrorDisplayable(accessTokenResponse.microsoftErrorCode))
            }
            accessToken = accessTokenResponse.data
            accessTokenRaw = accessToken.access_token
        } else {
            accessTokenRaw = entryCode
        }
        
        const xblResponse = await MicrosoftAuth.getXBLToken(accessTokenRaw)
        if(xblResponse.responseStatus === RestResponseStatus.ERROR) {
            return Promise.reject(microsoftErrorDisplayable(xblResponse.microsoftErrorCode))
        }
        const xstsResonse = await MicrosoftAuth.getXSTSToken(xblResponse.data)
        if(xstsResonse.responseStatus === RestResponseStatus.ERROR) {
            return Promise.reject(microsoftErrorDisplayable(xstsResonse.microsoftErrorCode))
        }
        const mcTokenResponse = await MicrosoftAuth.getMCAccessToken(xstsResonse.data)
        if(mcTokenResponse.responseStatus === RestResponseStatus.ERROR) {
            return Promise.reject(microsoftErrorDisplayable(mcTokenResponse.microsoftErrorCode))
        }
        const mcProfileResponse = await MicrosoftAuth.getMCProfile(mcTokenResponse.data.access_token)
        if(mcProfileResponse.responseStatus === RestResponseStatus.ERROR) {
            return Promise.reject(microsoftErrorDisplayable(mcProfileResponse.microsoftErrorCode))
        }
        return {
            accessToken,
            accessTokenRaw,
            xbl: xblResponse.data,
            xsts: xstsResonse.data,
            mcToken: mcTokenResponse.data,
            mcProfile: mcProfileResponse.data
        }
    } catch(err) {
        log.error(err)
        return Promise.reject(microsoftErrorDisplayable(MicrosoftErrorCode.UNKNOWN))
    }
}

/**
 * Calculate the expiry date. Advance the expiry time by 10 seconds
 * to reduce the liklihood of working with an expired token.
 * 
 * @param {number} nowMs Current time milliseconds.
 * @param {number} epiresInS Expires in (seconds)
 * @returns 
 */
function calculateExpiryDate(nowMs, epiresInS) {
    return nowMs + ((epiresInS-10)*1000)
}

/**
 * Add a Microsoft account. This will pass the provided auth code to Mojang's OAuth2.0 flow.
 * The resultant data will be stored as an auth account in the configuration database.
 * 
 * @param {string} authCode The authCode obtained from microsoft.
 * @returns {Promise.<Object>} Promise which resolves the resolved authenticated account object.
 */
exports.addMicrosoftAccount = async function(authCode) {

    const fullAuth = await fullMicrosoftAuthFlow(authCode, AUTH_MODE.FULL)

    // Advance expiry by 10 seconds to avoid close calls.
    const now = new Date().getTime()

    const ret = ConfigManager.addMicrosoftAuthAccount(
        fullAuth.mcProfile.id,
        fullAuth.mcToken.access_token,
        fullAuth.mcProfile.name,
        calculateExpiryDate(now, fullAuth.mcToken.expires_in),
        fullAuth.accessToken.access_token,
        fullAuth.accessToken.refresh_token,
        calculateExpiryDate(now, fullAuth.accessToken.expires_in)
    )
    ConfigManager.save()

    return ret
}

/**
 * Remove a Microsoft account. It is expected that the caller will invoke the OAuth logout
 * through the ipc renderer.
 * 
 * @param {string} uuid The UUID of the account to be removed.
 * @returns {Promise.<void>} Promise which resolves to void when the action is complete.
 */
exports.removeMicrosoftAccount = async function(uuid){
    try {
        ConfigManager.removeAuthAccount(uuid)
        ConfigManager.save()
        return Promise.resolve()
    } catch (err){
        log.error('Error while removing account', err)
        return Promise.reject(err)
    }
}

/**
 * Validate the selected account with Microsoft's authserver. If the account is not valid,
 * we will attempt to refresh the access token and update that value. If that fails, a
 * new login will be required.
 * 
 * @returns {Promise.<boolean>} Promise which resolves to true if the access token is valid,
 * otherwise false.
 */
async function validateSelectedMicrosoftAccount(){
    const current = ConfigManager.getSelectedAccount()
    const now = new Date().getTime()
    const mcExpiresAt = current.expiresAt
    const mcExpired = now >= mcExpiresAt

    if(!mcExpired) {
        return true
    }

    // MC token expired. Check MS token.

    const msExpiresAt = current.microsoft.expires_at
    const msExpired = now >= msExpiresAt

    if(msExpired) {
        // MS expired, do full refresh.
        try {
            if(current.microsoft.refresh_token == null){
                // Compte connecte sans jeton de renouvellement (avant le correctif) : reconnexion
                log.warn('Pas de jeton de renouvellement pour ce compte : il faut se reconnecter.')
                return false
            }
            const res = await fullMicrosoftAuthFlow(current.microsoft.refresh_token, AUTH_MODE.MS_REFRESH)

            ConfigManager.updateMicrosoftAuthAccount(
                current.uuid,
                res.mcToken.access_token,
                res.accessToken.access_token,
                res.accessToken.refresh_token || current.microsoft.refresh_token,
                calculateExpiryDate(now, res.accessToken.expires_in),
                calculateExpiryDate(now, res.mcToken.expires_in)
            )
            ConfigManager.save()
            return true
        } catch(err) {
            return false
        }
    } else {
        // Only MC expired, use existing MS token.
        try {
            const res = await fullMicrosoftAuthFlow(current.microsoft.access_token, AUTH_MODE.MC_REFRESH)

            ConfigManager.updateMicrosoftAuthAccount(
                current.uuid,
                res.mcToken.access_token,
                current.microsoft.access_token,
                current.microsoft.refresh_token,
                current.microsoft.expires_at,
                calculateExpiryDate(now, res.mcToken.expires_in)
            )
            ConfigManager.save()
            return true
        }
        catch(err) {
            return false
        }
    }
}

/**
 * Validate the selected auth account.
 * 
 * @returns {Promise.<boolean>} Promise which resolves to true if the access token is valid,
 * otherwise false.
 */
// Verification en cours, par compte. Plusieurs parties du launcher verifient le compte en meme
// temps (demarrage, instance admin, clic sur Jouer) : sans ca, chacune rafraichissait le jeton
// Microsoft de son cote, et un rafraichissement concurrent pouvait echouer.
const validating = new Map()

exports.validateSelected = function(){
    const current = ConfigManager.getSelectedAccount()

    if(!validating.has(current.uuid)){
        // Ancien compte Mojang (retire au demarrage, cf configmanager) : plus utilisable
        const run = current.type === 'microsoft'
            ? validateSelectedMicrosoftAccount()
            : Promise.resolve(false)
        validating.set(current.uuid, run.finally(() => validating.delete(current.uuid)))
    }
    return validating.get(current.uuid)
}
