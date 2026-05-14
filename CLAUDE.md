# CLAUDE.md — Instructions Claude pour ce projet

Ce fichier est chargé automatiquement par Claude Code quand on travaille sur le launcher Nerysia. Hugo peut l'éditer librement pour ajuster les règles.

---

## 🔁 Workflow modpack — quand Hugo dit "j'ai modifié mon modpack"

**Trigger phrases (et variantes)** :
- "j'ai mis à jour mon modpack"
- "j'ai modifié le modpack"
- "j'ai ajouté un mod / une config / un resourcepack"
- "j'ai changé un fichier dans le modpack"
- "le modpack a bougé"

**Action immédiate à effectuer** :

1. **Demander à Hugo le type de bump** avant de lancer le script, car le script a maintenant un param `-Bump` qui incrémente automatiquement `servers[0].version` :
   - `-Bump patch` : 1.0.0 → 1.0.1 (MAJ d'un mod existant, fix config, resourcepack)
   - `-Bump minor` : 1.0.0 → 1.1.0 (ajout d'un nouveau mod ou système)
   - `-Bump major` : 1.0.0 → 2.0.0 (change Minecraft/Fabric majeur)
   - sans param : régen sans toucher la version (utile si on a déjà bumpé manuellement ou que c'est juste un re-scan)

2. **Exécuter le script** avec le bump choisi :
   ```powershell
   & "tools/generate-distribution.ps1" -Bump patch  # ou minor / major / sans param
   ```
   (via le tool PowerShell, timeout 5 min)

3. **Vérifier le résultat** dans la sortie :
   - "Version serveur : X.Y.Z -> X.Y.(Z+1)" affiché au début si bump
   - "Version modpack: X.Y.Z" affiché à la fin
   - "Total modules : N" en fin de log
   - "Upload OK : Y:\apk\nerysia-laucher\distribution.json" doit apparaître
   - Si le drive `Y:` n'est pas monté → prévenir Hugo

4. **Proposer commit + push GitHub** pour archive (le repo n'est qu'un backup, les joueurs fetchent depuis `apk.nerysia.fr`).

---

## 📊 Système de version `distribution.json`

Deux champs `version` à ne pas confondre :

| Position | Rôle | Bumper ? |
|---|---|---|
| `version` (top-level, ligne 2) | Schema version du format Helios | **❌ Non, reste à 1.0.0** |
| `servers[0].version` | **Version du modpack Nerysia** | **✅ À chaque update** |

La version `servers[0].version` est affichée aux joueurs dans le launcher (overlay sélection serveur). Le launcher ne déclenche pas de logique spéciale au changement, mais c'est une **info importante pour les utilisateurs**.

---

## 🏗️ Architecture rapide

- **Launcher** : Electron + helios-core. Code à la racine (`index.js`) + `app/`
- **Modpack** : hébergé sur `apk.nerysia.fr/nerysia-laucher/` (FTP via `Y:\apk\` chez Hugo)
- **Distribution** : `docs/distribution.json` (local) + `Y:\apk\nerysia-laucher\distribution.json` (web)
- **News RSS** : `docs/feed.xml` → upload manuel vers `apk.nerysia.fr/nerysia-laucher/feed.xml`
- **Auth Microsoft** : Client ID Helios partagé (`1ce6e35a-...`) en attendant whitelist Nerysia (`4979ff0d-...`). Procédure dans `docs/AUTH_AZURE.md`
- **Build** : push tag `v*` → GitHub Actions build Win + Linux + release publique automatique
- **Theme launcher** : auto jour/nuit selon l'heure (7h-19h = clair, sinon sombre). Fichiers dans `app/assets/images/backgrounds/clair/` et `sombre/`

---

## 🎨 Règles de communication

- **Français toujours** avec Hugo
- Hugo n'est **pas dev senior** — expliquer avec contexte, pas en jargon
- Préférer **étapes numérotées** + tableaux markdown à des paragraphes denses
- Liens cliquables type `[fichier.ext:line](path/fichier.ext#Lline)` (extension VSCode active)

---

## ⚠️ Sécurité

- **Repo public sur GitHub** → ne JAMAIS commiter :
  - Client Secret Azure (la valeur, pas l'ID)
  - Tokens GitHub
  - Mots de passe
- Le **Client ID Azure est public** par design (cf `docs/AUTH_AZURE.md` ligne 30)
- Ne pas écrire `dist/`, `node_modules/`, `.claude/` dans git (déjà dans `.gitignore`)
- En général : ne JAMAIS demander à Hugo de copier-coller la valeur d'un secret Azure dans le chat

---

## 🐛 Pièges connus

1. **`Y:` non monté** : si Hugo n'a pas monté son drive FTP, `tools/generate-distribution.ps1` échouera avec "fichier introuvable". Le prévenir gentiment.
2. **`fancymenu_data/`** : exclus par défaut dans le script (configs perso joueur, ne pas distribuer). Liste dans `tools/generate-distribution.ps1` `$excludePatterns`.
3. **`Get-FileHash`** sur fichier verrouillé : retourne maintenant un MD5 vide (`00000000...`) au lieu de crasher. Si tu vois un mod avec ce hash, c'est qu'il était ouvert au moment du scan.
4. **Tags Git** : `v1.0.0`, `v1.0.1`, etc. existent dans l'historique Helios upstream du fork — ils pointent vers de vieux commits Helios. Pour une nouvelle release, on force-update le tag (`git push origin vX.Y.Z --force`).

---

## 🛠️ Commandes pratiques

```powershell
# Regénérer distribution.json + upload
& "tools/generate-distribution.ps1"

# Calculer MD5 + taille d'un mod manuellement
& "tools/get-mod-info.ps1" "C:\chemin\mod.jar"

# Lancer le launcher en dev (depuis le repo)
npm start

# Build Windows local (sans publish)
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
npm run dist -- -w -p never
```

---

## 📌 État actuel à retenir

- Microsoft whitelist du Client ID Nerysia : **demandé le 2026-05-02**, en attente (24-72h délai)
- Build v1.0.2 : **publiée** sur GitHub Releases (Win .exe + Linux AppImage)
- Mod DefaultOptions + `config/defaultoptions/options.txt` : ajoutés au modpack pour fixer le pb de GUI scale auto
- Bug fix critique gardé : `decodeURI → decodeURIComponent` dans `index.js:155` (parsing OAuth code)
