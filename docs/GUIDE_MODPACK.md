# 📦 Guide — Créer et gérer un Modpack pour le Nerysia Launcher

> Ce guide explique comment créer un modpack Fabric 1.21.1, le mettre à jour, et gérer les actualités affichées dans le launcher.  
> Le launcher utilise le système **Helios Launcher** avec un fichier `distribution.json` hébergé sur `www.nerysia.fr`.

---

## 📋 Table des matières

1. [Architecture du système](#1-architecture-du-système)
2. [Structure de la distribution.json](#2-structure-de-la-distributionjson)
3. [Ajouter / mettre à jour un mod](#3-ajouter--mettre-à-jour-un-mod)
4. [Mettre à jour Fabric Loader](#4-mettre-à-jour-fabric-loader)
5. [Mettre à jour la version de Minecraft](#5-mettre-à-jour-la-version-de-minecraft)
6. [Poster des news dans le launcher](#6-poster-des-news-dans-le-launcher)
7. [Mettre à jour le launcher lui-même](#7-mettre-à-jour-le-launcher-lui-même)
8. [Fichiers à héberger sur www.nerysia.fr](#8-fichiers-à-héberger-sur-wwwnerysiaFR)
9. [Générer les MD5 d'un fichier](#9-générer-les-md5-dun-fichier)
10. [Checklist de mise à jour complète](#10-checklist-de-mise-à-jour-complète)

---

## 1. Architecture du système

```
www.nerysia.fr/
└── launcher/
    ├── distribution.json          ← Fichier principal lu par le launcher
    └── repo/
        ├── lib/                   ← Libraries Fabric et ses dépendances
        │   └── net/fabricmc/
        │       └── fabric-loader/0.17.3/fabric-loader-0.17.3.jar
        ├── versions/              ← Manifests version Fabric
        │   └── 1.21.1-fabric-0.17.3/1.21.1-fabric-0.17.3.json
        └── servers/
            └── Nerysia-1.21.1/
                ├── fabricmods/
                │   ├── required/      ← Mods obligatoires (toujours téléchargés)
                │   └── optionaloff/   ← Mods optionnels (désactivés par défaut)
                └── files/
                    └── resourcepacks/ ← Resource packs
```

Le launcher télécharge `distribution.json` au démarrage, vérifie l'intégrité de chaque fichier (MD5 + taille), et télécharge ce qui manque ou est modifié.

---

## 2. Structure de la distribution.json

Voici le squelette complet du fichier :

```json
{
  "version": "1.0.0",
  "rss": "https://www.nerysia.fr/feed/",
  "discord": {
    "clientId": "VOTRE_CLIENT_ID_DISCORD",
    "smallImageText": "Nerysia",
    "smallImageKey": "nerysia_logo"
  },
  "servers": [
    {
      "id": "Nerysia-1.21.1",
      "name": "Nerysia (Minecraft 1.21.1)",
      "description": "Serveur Nerysia - Cobblemon Fabric 1.21.1",
      "icon": "https://www.nerysia.fr/Logo.png",
      "version": "1.0.0",
      "address": "play.nerysia.fr:25565",
      "minecraftVersion": "1.21.1",
      "mainServer": true,
      "autoconnect": false,
      "modules": [
        // ... voir sections suivantes
      ]
    }
  ]
}
```

### Champs importants

| Champ | Description |
|-------|-------------|
| `version` | Version du modpack (incrémente à chaque update) |
| `rss` | URL de ton flux RSS WordPress pour les news |
| `id` | Identifiant unique du serveur (utilisé dans les dossiers locaux) |
| `address` | Adresse IP:port du serveur Minecraft |
| `mainServer` | `true` = serveur sélectionné par défaut |
| `autoconnect` | `true` = connexion automatique au serveur au lancement |

---

## 3. Ajouter / mettre à jour un mod

### Étape 1 — Préparer le fichier .jar

1. Télécharge le mod (ex: `cobblemon-fabric-1.6.1+1.21.1.jar`)
2. Calcule son MD5 et sa taille → [voir section 9](#9-générer-les-md5-dun-fichier)
3. Upload le fichier sur le serveur :
   - Mods **obligatoires** → `www.nerysia.fr/launcher/servers/Nerysia-1.21.1/fabricmods/required/`
   - Mods **optionnels désactivés par défaut** → `.../optionaloff/`
   - Mods **optionnels activés par défaut** → `.../optionalon/`

### Étape 2 — Ajouter l'entrée dans distribution.json

**Mod obligatoire :**
```json
{
  "id": "com.cobblemon.mod:cobblemon:1.6.1+1.21.1@jar",
  "name": "Cobblemon",
  "type": "FabricMod",
  "artifact": {
    "size": 120710175,
    "MD5": "cefe6ab687c39e1a7fe9b2bf96b09188",
    "url": "https://www.nerysia.fr/launcher/servers/Nerysia-1.21.1/fabricmods/required/cobblemon-fabric-1.6.1+1.21.1.jar"
  }
}
```

**Mod optionnel (désactivé par défaut) :**
```json
{
  "id": "net.irisshaders:iris:1.8.8+mc1.21.1@jar",
  "name": "Iris Shaders",
  "type": "FabricMod",
  "artifact": {
    "size": 2690177,
    "MD5": "1179fe09b9ba970e84ed59259adfe65a",
    "url": "https://www.nerysia.fr/launcher/servers/Nerysia-1.21.1/fabricmods/optionaloff/iris-fabric-1.8.8+mc1.21.1.jar"
  },
  "required": {
    "value": false,
    "def": false
  }
}
```

**Mod optionnel (activé par défaut) :**
```json
{
  "required": {
    "value": false,
    "def": true
  }
}
```

### Format de l'ID de mod

L'ID suit le format Maven : `groupId:artifactId:version@extension`

- Mods officiels : `net.fabricmc:fabric-api:0.116.7+1.21.1@jar`
- Mods sans groupId connu : `generated.fabricmod:sodium:0.6.13+mc1.21.1@jar`

> ⚠️ **Chaque mod doit avoir un ID unique.** Si tu mets à jour un mod, change la version dans l'ID.

### Étape 3 — Mettre à jour distribution.json

1. Édite le fichier `distribution.json`
2. Incrémente le champ `"version"` du serveur (ex: `"1.0.0"` → `"1.0.1"`)
3. Upload le fichier à jour sur `www.nerysia.fr/launcher/distribution.json`

Le launcher le téléchargera automatiquement au prochain démarrage des joueurs.

---

## 4. Mettre à jour Fabric Loader

> Exemple : passer de fabric-loader 0.17.3 à 0.17.5

### Fichiers à préparer

1. `fabric-loader-0.17.5.jar` → depuis [fabricmc.net](https://fabricmc.net/use/installer/)
2. `1.21.1-fabric-0.17.5.json` → le version manifest Fabric

**Obtenir le version manifest Fabric :**
```
https://meta.fabricmc.net/v2/versions/loader/1.21.1/0.17.5/stable/profile/json
```
Télécharge ce JSON et renomme-le `1.21.1-fabric-0.17.5.json`.

### Upload sur le serveur

```
www.nerysia.fr/launcher/repo/lib/net/fabricmc/fabric-loader/0.17.5/fabric-loader-0.17.5.jar
www.nerysia.fr/launcher/repo/versions/1.21.1-fabric-0.17.5/1.21.1-fabric-0.17.5.json
```

### Modifier distribution.json

Dans le bloc `"modules"`, modifie l'entrée Fabric :

```json
{
  "id": "net.fabricmc:fabric-loader:0.17.5",
  "name": "Fabric (fabric-loader)",
  "type": "Fabric",
  "artifact": {
    "size": TAILLE_EN_BYTES,
    "MD5": "MD5_DU_NOUVEAU_JAR",
    "url": "https://www.nerysia.fr/launcher/repo/lib/net/fabricmc/fabric-loader/0.17.5/fabric-loader-0.17.5.jar"
  },
  "subModules": [
    {
      "id": "1.21.1-fabric-0.17.5",
      "name": "Fabric (version.json)",
      "type": "VersionManifest",
      "artifact": {
        "size": TAILLE_EN_BYTES,
        "MD5": "MD5_DU_JSON",
        "url": "https://www.nerysia.fr/launcher/repo/versions/1.21.1-fabric-0.17.5/1.21.1-fabric-0.17.5.json"
      }
    },
    // ... garder les autres subModules (asm, sponge-mixin, etc.)
  ]
}
```

---

## 5. Mettre à jour la version de Minecraft

> Exemple : passer de 1.21.1 à 1.21.4

C'est un changement majeur. Il faut :

1. Créer un **nouveau bloc server** dans `distribution.json` (avec un nouvel `id`)
2. Reconfigurer tous les mods compatibles 1.21.4
3. Obtenir le nouveau version manifest Fabric pour 1.21.4
4. Mettre `"mainServer": true` sur le nouveau et `false` sur l'ancien

```json
{
  "id": "Nerysia-1.21.4",
  "name": "Nerysia (Minecraft 1.21.4)",
  "minecraftVersion": "1.21.4",
  ...
}
```

> 💡 Tu peux conserver les deux versions dans `distribution.json` simultanément, les joueurs pourront choisir.

---

## 6. Poster des news dans le launcher

Le launcher lit un **flux RSS** à partir de l'URL définie dans `distribution.json` :

```json
"rss": "https://www.nerysia.fr/feed/"
```

### Option A — WordPress (recommandé)

Si ton site `www.nerysia.fr` tourne sous **WordPress** :
- Chaque article publié est automatiquement disponible dans le flux RSS `/feed/`
- Le launcher affiche : titre, date, auteur, contenu, commentaires
- Aucune action supplémentaire : publie un article → il apparaît dans le launcher ✅

**URL du flux WordPress :** `https://www.nerysia.fr/feed/`  
(ou `https://www.nerysia.fr/?feed=rss2`)

### Option B — Flux RSS statique

Crée un fichier `feed.xml` manuellement et héberge-le :

```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"
     xmlns:dc="http://purl.org/dc/elements/1.1/"
     xmlns:slash="http://purl.org/rss/1.0/modules/slash/">
  <channel>
    <title>Nerysia News</title>
    <link>https://www.nerysia.fr</link>
    <description>Actualités du serveur Nerysia</description>
    <item>
      <title>Mise à jour 1.0.1 — Nouveaux mods</title>
      <link>https://www.nerysia.fr/news/mise-a-jour-101</link>
      <pubDate>Fri, 02 May 2026 12:00:00 +0200</pubDate>
      <dc:creator>Lightshadow02</dc:creator>
      <slash:comments>0</slash:comments>
      <content:encoded><![CDATA[
        <p>Voici les changements de la version 1.0.1 :</p>
        <ul>
          <li>Ajout de Iris Shaders en optionnel</li>
          <li>Mise à jour de Cobblemon vers 1.6.2</li>
        </ul>
      ]]></content:encoded>
    </item>
  </channel>
</rss>
```

Héberge ce fichier à `https://www.nerysia.fr/launcher/feed.xml` et mets cette URL dans `distribution.json`.

> ⚠️ Le RSS doit être accessible en HTTPS et sans erreurs CORS.

---

## 7. Mettre à jour le launcher lui-même

### Mise à jour mineure (correction de bugs, changement d'URL)

1. Modifie les fichiers dans le projet local
2. Incrémente la version dans `package.json` :
   ```json
   "version": "1.0.2"
   ```
3. Commit et push sur GitHub
4. Crée un GitHub Release avec le tag `v1.0.2`

Le launcher utilise `electron-updater` avec GitHub Releases. Les utilisateurs verront une notification de mise à jour automatiquement.

### Build pour distribution

```bash
# Windows
npm run dist:win

# Le fichier .exe installateur sera dans dist/
```

> ⚠️ Pour que l'auto-update fonctionne, le repository GitHub doit être **public** ou tu dois configurer un token d'accès dans `electron-builder.yml`.

### Fichier dev-app-update.yml

Pour tester l'auto-update en développement :
```yaml
provider: github
owner: Lightshadow02
repo: Nerysia-LAUCHER
```

---

## 8. Fichiers à héberger sur www.nerysia.fr

Voici tous les fichiers que le launcher doit trouver sur le serveur web :

```
www.nerysia.fr/
├── Logo.png                                    ← Icône du serveur dans le launcher
└── launcher/
    ├── distribution.json                       ← ⭐ Fichier principal (toujours à jour)
    ├── feed.xml (ou utiliser /feed/ WordPress) ← Flux RSS des news
    ├── repo/
    │   ├── lib/net/fabricmc/
    │   │   ├── fabric-loader/0.17.3/fabric-loader-0.17.3.jar
    │   │   ├── intermediary/1.21.1/intermediary-1.21.1.jar
    │   │   └── sponge-mixin/0.16.5+mixin.0.8.7/sponge-mixin-0.16.5+mixin.0.8.7.jar
    │   ├── lib/org/ow2/asm/
    │   │   ├── asm/9.9/asm-9.9.jar
    │   │   ├── asm-analysis/9.9/asm-analysis-9.9.jar
    │   │   ├── asm-commons/9.9/asm-commons-9.9.jar
    │   │   ├── asm-tree/9.9/asm-tree-9.9.jar
    │   │   └── asm-util/9.9/asm-util-9.9.jar
    │   └── versions/
    │       └── 1.21.1-fabric-0.17.3/1.21.1-fabric-0.17.3.json
    └── servers/Nerysia-1.21.1/
        ├── fabricmods/
        │   ├── required/
        │   │   ├── cobblemon-fabric-1.6.1+1.21.1.jar
        │   │   ├── fabric-api-0.116.7+1.21.1.jar
        │   │   └── sodium-fabric-0.6.13+mc1.21.1.jar
        │   └── optionaloff/
        │       └── iris-fabric-1.8.8+mc1.21.1.jar
        └── files/resourcepacks/
            └── Default-Dark-Mode-1.20.2+-2025.5.0.zip
```

> ⚠️ **Important** : Les fichiers doivent être accessibles en HTTPS. Si ton serveur web a une redirection HTTP→HTTPS, vérifie que les liens dans `distribution.json` utilisent bien `https://`.

---

## 9. Générer les MD5 d'un fichier

Le launcher vérifie l'intégrité des fichiers via leur hash MD5 et leur taille en bytes.

### Sur Windows (PowerShell)

```powershell
# MD5
Get-FileHash "chemin\vers\mod.jar" -Algorithm MD5

# Taille en bytes
(Get-Item "chemin\vers\mod.jar").Length
```

### Sur Linux/Mac (Terminal)

```bash
# MD5
md5sum chemin/vers/mod.jar

# Taille en bytes
wc -c < chemin/vers/mod.jar
```

### Script PowerShell automatique

Crée un fichier `get-mod-info.ps1` :

```powershell
param([string]$FilePath)

$file = Get-Item $FilePath
$md5 = (Get-FileHash $FilePath -Algorithm MD5).Hash.ToLower()
$size = $file.Length

Write-Host "Fichier : $($file.Name)"
Write-Host "Taille  : $size"
Write-Host "MD5     : $md5"
Write-Host ""
Write-Host "JSON snippet :"
Write-Host "  `"size`": $size,"
Write-Host "  `"MD5`": `"$md5`","
```

Utilisation :
```powershell
.\get-mod-info.ps1 "C:\mods\cobblemon-fabric-1.6.2+1.21.1.jar"
```

---

## 10. Checklist de mise à jour complète

### ✅ Ajouter un nouveau mod

- [ ] Télécharger le fichier `.jar` du mod
- [ ] Calculer MD5 et taille (section 9)
- [ ] Uploader le jar sur le serveur web
- [ ] Ajouter l'entrée dans `distribution.json`
- [ ] Incrémenter la version du serveur dans `distribution.json`
- [ ] Uploader le `distribution.json` mis à jour
- [ ] Tester en lançant le launcher

### ✅ Mettre à jour un mod existant

- [ ] Télécharger la nouvelle version du `.jar`
- [ ] Calculer MD5 et taille du nouveau fichier
- [ ] Uploader le nouveau jar (garder l'ancien ou l'écraser)
- [ ] Modifier l'entrée dans `distribution.json` : nouveau `id`, `size`, `MD5`, `url`
- [ ] Incrémenter la version du serveur
- [ ] Uploader le `distribution.json` mis à jour
- [ ] Tester

### ✅ Poster une news

- [ ] **Avec WordPress** : publier un article sur `www.nerysia.fr` → automatique ✅
- [ ] **Sans WordPress** : éditer `feed.xml` et ajouter un bloc `<item>`, uploader

### ✅ Mettre à jour le launcher

- [ ] Modifier le code dans le projet
- [ ] Incrémenter `version` dans `package.json`
- [ ] Commit + push GitHub
- [ ] Créer un GitHub Release avec tag `vX.X.X`
- [ ] Les utilisateurs reçoivent la notif automatiquement

---

## 🔗 Ressources utiles

| Lien | Description |
|------|-------------|
| [FabricMC Meta API](https://meta.fabricmc.net/) | Obtenir les manifests Fabric |
| [Modrinth](https://modrinth.com/) | Télécharger des mods Fabric |
| [CurseForge](https://www.curseforge.com/minecraft) | Autre source de mods |
| [Cobblemon Releases](https://modrinth.com/mod/cobblemon/versions) | Versions officielles de Cobblemon |
| [GitHub Releases](https://github.com/Lightshadow02/Nerysia-LAUCHER/releases) | Releases du launcher |
