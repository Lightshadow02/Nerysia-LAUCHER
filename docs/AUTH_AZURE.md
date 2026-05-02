# 🔐 Authentification Microsoft — Configuration Azure Nerysia

> Ce document conserve la **config Azure officielle de Nerysia** pour pouvoir la rebrancher quand le whitelist Microsoft sera validé.
>
> **Statut au 2026-05-02** : Azure App créée + configurée correctement, mais **whitelist Microsoft non encore demandé/validé**. C'est pour ça que le login échoue avec `403 Invalid app registration` à l'étape "Get MC Access Token".

---

## 📋 IDs de l'App Azure (Nerysia)

| Info | Valeur |
|---|---|
| **Application (Client) ID** | `4979ff0d-390e-4a51-878c-efcbf4626cab` |
| **Directory (Tenant) ID** | `d0c96773-b433-49ef-a272-e34f724ce0fe` |
| **Tenant name** | `Default Directory` |
| **Compte Microsoft propriétaire** | loureirohugo70@gmail.com |
| **Date création** | 2026-05-02 |

⚠️ Le **Client ID n'est PAS un secret** — il peut être commit en clair sur Git. Source : [stackoverflow](https://stackoverflow.com/questions/57306964/are-azure-active-directorys-tenantid-and-clientid-considered-secrets).

⚠️ Le **Client Secret** est sensible et ne doit PAS être partagé. Il existe dans Azure (factice, non utilisé par le code), à régénérer si compromis.

---

## 🔧 Configuration Azure (déjà faite)

Sur https://entra.microsoft.com → App registrations → `Nerysia Launcher` :

### Authentication

- ✅ **Supported account types** : *"Tous les utilisateurs de compte Microsoft"* (multitenant + comptes personnels Xbox/Skype)
- ✅ **Plateforme** : `Mobile and desktop applications`
- ✅ **3 URIs de redirection cochés** :
  - `https://login.microsoftonline.com/common/oauth2/nativeclient` ← celle utilisée par le code
  - `msal4979ff0d-390e-4a51-878c-efcbf4626cab://auth`
  - `https://login.live.com/oauth20_desktop.srf`
- ✅ **Allow public client flows** : `Oui`

### Certificats & secrets

- ✅ Un client secret factice existe (Microsoft l'exige, le code ne l'utilise pas)

---

## 💻 Référence dans le code

Le Client ID est utilisé à un seul endroit :

**[app/assets/js/ipcconstants.js:4](../app/assets/js/ipcconstants.js)**

```js
exports.AZURE_CLIENT_ID = '4979ff0d-390e-4a51-878c-efcbf4626cab'
```

Pour revenir à l'ancien Client ID (Helios par défaut), remplacer par :
```js
exports.AZURE_CLIENT_ID = '1ce6e35a-126f-48fd-97fb-54d143ac6d45'
```

---

## 🐛 Bug fixé en parallèle (à ne PAS perdre)

Lors du débug d'auth, on a corrigé un bug de **parsing du code OAuth** qui causait `AADSTS70000 invalid_grant` aléatoirement.

**[index.js:151-156](../index.js)** — l'ancien code utilisait `decodeURI` au lieu de `decodeURIComponent`, ce qui ne décode pas correctement les `%2B`, `%2F`, `%3D` dans le code OAuth retourné par Microsoft.

```js
// Ancien (cassé) :
const [name, value] = query.split('=')
queryMap[name] = decodeURI(value)

// Nouveau (corrigé) :
const idx = query.indexOf('=')
const name = idx === -1 ? query : query.substring(0, idx)
const value = idx === -1 ? '' : query.substring(idx + 1)
queryMap[name] = decodeURIComponent(value)
```

⚠️ **Ce fix est nécessaire quel que soit le Client ID utilisé**. À garder.

---

## 🚀 Whitelist Microsoft — étape obligatoire

Tant que l'app n'est pas whitelistée par Microsoft Minecraft Engineering, l'API `https://api.minecraftservices.com/authentication/login_with_xbox` renvoie :

```json
{
  "errorMessage": "Invalid app registration, see https://aka.ms/AppRegInfo for more information"
}
```

### Procédure

1. **Formulaire de demande** : https://aka.ms/mce-reviewappid
2. À remplir avec :
   - **Client ID** : `4979ff0d-390e-4a51-878c-efcbf4626cab`
   - **Tenant ID** : `d0c96773-b433-49ef-a272-e34f724ce0fe`
   - **App name** : `Nerysia Launcher`
   - **Description** : *"Custom Minecraft launcher for the French Cobblemon server Nerysia, fork of dscalzi/HeliosLauncher"*
   - **GitHub** : https://github.com/Lightshadow02/Nerysia-LAUCHER
   - **Email** : loureirohugo70@gmail.com
3. **Délai** : généralement 24h-72h pour la review, puis jusqu'à 24h pour propagation
4. Status check : Microsoft envoie un mail de validation/refus

### Pendant le délai d'attente

❌ Aucun joueur ne peut se connecter avec son compte Microsoft.

Options de contournement (à discuter, voir section ci-dessous).

---

## 🔄 Procédure de re-bascule quand whitelist OK

Si le code a été temporairement modifié (autre Client ID), pour revenir au Client Nerysia officiel :

1. Ouvrir [app/assets/js/ipcconstants.js](../app/assets/js/ipcconstants.js)
2. Remplacer `AZURE_CLIENT_ID` par `'4979ff0d-390e-4a51-878c-efcbf4626cab'`
3. Tester avec `npm start`
4. Build et release

Aucune autre modification nécessaire — toute la config est dans Azure.
