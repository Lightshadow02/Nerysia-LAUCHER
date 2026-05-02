# 🚀 Procédure d'Upload — Mettre en ligne le modpack pour les clients

> Les fichiers du launcher sont hébergés sur **apk.nerysia.fr**.
> Le launcher lit `https://apk.nerysia.fr/nerysia-laucher/distribution.json`.
>
> Pour les news : fonctionnalité prévue plus tard, pas encore active (`"rss": ""`).

---

## 🗂️ Vue d'ensemble — Ce que le launcher télécharge

| Catégorie | Quoi | Où sur apk.nerysia.fr |
|-----------|------|-----------------------|
| **Fabric Core** | JARs internes Fabric (ASM, mixin…) | `/nerysia-laucher/repo/` |
| **Mods** | Fichiers `.jar` de mods | `/nerysia-laucher/servers/Nerysia-1.21.1/fabricmods/` |
| **Fichiers** | Resource packs, configs, shaders… | `/nerysia-laucher/servers/Nerysia-1.21.1/files/` |

Le fichier `distribution.json` indique au launcher **quoi télécharger, où, et comment vérifier** l'intégrité (MD5 + taille).

---

## 🏗️ Structure existante sur apk.nerysia.fr

La structure suivante **existe déjà** — tu n'as qu'à y ajouter tes fichiers :

```
apk.nerysia.fr/
├── Logo.png                                        ← Icône du serveur (garder)
└── nerysia-laucher/
    ├── distribution.json                           ← ⭐ Fichier principal
    ├── repo/                                       ← Fabric Core (déjà en place)
    │   ├── lib/net/fabricmc/fabric-loader/0.17.3/
    │   ├── lib/net/fabricmc/sponge-mixin/...
    │   ├── lib/net/fabricmc/intermediary/...
    │   ├── lib/org/ow2/asm/...
    │   └── versions/1.21.1-fabric-0.17.3/
    └── servers/
        └── Nerysia-1.21.1/
            ├── fabricmods/
            │   ├── required/                       ← Tes mods obligatoires ici
            │   └── optionaloff/                    ← Tes mods optionnels ici
            └── files/
                └── resourcepacks/                  ← Tes resource packs ici
```

> ✅ **Le dossier `repo/` (Fabric Core) est déjà présent et fonctionnel — ne pas y toucher.**

---

## 📋 Ce qu'il faut supprimer sur apk.nerysia.fr

Supprime tout ce qui n'est **pas** dans la liste ci-dessus :
- Pages HTML du site web
- Dossiers CSS, JS du site
- Tout autre contenu non lié au launcher

**Ne supprime PAS :**
- `/nerysia-laucher/` → tout ce dossier
- `/Logo.png`

---

## ✅ Procédure d'upload des mods

### Étape 1 — Uploader tes JARs de mods

Connecte-toi à apk.nerysia.fr via **FTP/SFTP** (FileZilla, WinSCP…) et dépose tes fichiers :

| Type de mod | Dossier de destination |
|-------------|------------------------|
| Mod **obligatoire** | `/nerysia-laucher/servers/Nerysia-1.21.1/fabricmods/required/` |
| Mod **optionnel désactivé** | `/nerysia-laucher/servers/Nerysia-1.21.1/fabricmods/optionaloff/` |
| Resource pack | `/nerysia-laucher/servers/Nerysia-1.21.1/files/resourcepacks/` |
| Config | `/nerysia-laucher/servers/Nerysia-1.21.1/files/config/` |
| Shader | `/nerysia-laucher/servers/Nerysia-1.21.1/files/shaderpacks/` |

### Étape 2 — Calculer MD5 + taille de chaque fichier

Utilise le script PowerShell fourni :

```powershell
cd C:\Users\Light-DESKTOP\Documents\GitHub\Lzucher\Nerysia-LAUCHER
.\tools\get-mod-info.ps1 "C:\chemin\vers\monmod.jar"
```

Il génère directement le snippet JSON à copier dans `distribution.json`.

### Étape 3 — Mettre à jour distribution.json

Ouvre `docs/distribution.json` et :
1. Ajoute/modifie l'entrée du mod avec les nouvelles valeurs (size, MD5, url)
2. Incrémente la version du serveur : `"version": "1.0.0"` → `"1.0.1"`

### Étape 4 — Uploader distribution.json EN DERNIER

```
apk.nerysia.fr/nerysia-laucher/distribution.json
```

> ⚠️ Toujours uploader `distribution.json` en **dernier**, après tous les fichiers JAR.
> Sinon un joueur qui lance le launcher pendant l'upload verra une erreur.

---

## ⚙️ Ajouter des configs, resource packs ou autres fichiers

Utilise le type `"File"` dans `distribution.json`. Le champ `"path"` indique où le fichier sera placé dans le `.minecraft` du joueur.

**Resource pack :**
```json
{
  "id": "mon-resource-pack.zip",
  "name": "Mon Resource Pack",
  "type": "File",
  "artifact": {
    "size": 748843,
    "MD5": "HASH_MD5",
    "url": "https://apk.nerysia.fr/nerysia-laucher/servers/Nerysia-1.21.1/files/resourcepacks/mon-resource-pack.zip",
    "path": "resourcepacks/mon-resource-pack.zip"
  }
}
```

**Config de mod :**
```json
{
  "id": "cobblemon-config",
  "name": "Config Cobblemon",
  "type": "File",
  "artifact": {
    "size": 1024,
    "MD5": "HASH_MD5",
    "url": "https://apk.nerysia.fr/nerysia-laucher/servers/Nerysia-1.21.1/files/config/cobblemon/main.json",
    "path": "config/cobblemon/main.json"
  }
}
```

---

## 🔄 Procédure de mise à jour d'un mod existant

```
1. Télécharger la nouvelle version du .jar
2. Calculer MD5 + taille → tools/get-mod-info.ps1
3. Uploader le nouveau .jar sur apk.nerysia.fr
4. Modifier l'entrée dans docs/distribution.json
   (id, size, MD5, url avec le nouveau nom de fichier)
5. Incrémenter "version" du serveur dans distribution.json
6. Uploader le distribution.json mis à jour
7. Tester avec le launcher
```

---

## ✅ Vérification finale

Après chaque upload, ouvre ces URLs dans le navigateur pour vérifier :

```
https://apk.nerysia.fr/nerysia-laucher/distribution.json     → doit afficher le JSON
https://apk.nerysia.fr/nerysia-laucher/servers/Nerysia-1.21.1/fabricmods/required/[TON_MOD].jar
→ doit déclencher un téléchargement (pas une erreur 404)
```

---

## 📰 News dans le launcher (à faire plus tard)

Pour l'instant `"rss": ""` — les news sont désactivées dans le launcher.

Quand tu seras prêt à ajouter les news :
1. Crée un flux RSS (WordPress ou fichier XML statique)
2. Mets l'URL dans `distribution.json` : `"rss": "https://apk.nerysia.fr/feed.xml"`
3. Upload le `distribution.json` mis à jour
4. Voir `docs/GUIDE_NEWS_SITE.md` pour les détails

---

## ⚡ Récapitulatif express

| Action | Dossier sur apk.nerysia.fr | Fichier à modifier |
|--------|----------------------------|--------------------|
| Ajouter un mod obligatoire | `.../fabricmods/required/` | `distribution.json` → type FabricMod |
| Ajouter un mod optionnel | `.../fabricmods/optionaloff/` | `distribution.json` → required.value: false |
| Ajouter un resource pack | `.../files/resourcepacks/` | `distribution.json` → type File, path resourcepacks/ |
| Ajouter une config | `.../files/config/` | `distribution.json` → type File, path config/ |
| Mettre à jour un mod | Remplacer le .jar | `distribution.json` → nouveau size, MD5, url |
| Publier les changements | — | Uploader `distribution.json` EN DERNIER |
