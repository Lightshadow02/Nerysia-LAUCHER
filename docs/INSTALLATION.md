# Installer le Nerysia Launcher

Le launcher installe tout seul Java, Minecraft, Fabric et les mods du serveur. Tu n'as rien d'autre à installer.

💬 Un souci pendant l'installation ? Viens demander sur le **[Discord Nerysia](https://discord.gg/dtvMfS69hU)**.

**Téléchargement** : https://github.com/Lightshadow02/Nerysia-LAUCHER/releases/latest
(tout en bas de la page, rubrique **Assets**)

| Ton système | Fichier à télécharger |
|---|---|
| Windows 10 / 11 | `Nerysia-Launcher-setup-X.Y.Z.exe` |
| Mac avec puce Apple (M1, M2, M3, M4…) | `Nerysia-Launcher-setup-X.Y.Z-arm64.dmg` |
| Mac avec processeur Intel | `Nerysia-Launcher-setup-X.Y.Z-x64.dmg` |
| Ubuntu, Debian, Linux Mint, Pop!_OS | `Nerysia-Launcher-setup-X.Y.Z.deb` |
| Arch Linux, Manjaro, EndeavourOS | `Nerysia-Launcher-setup-X.Y.Z.pacman` |
| N'importe quel Linux | `Nerysia-Launcher-setup-X.Y.Z.AppImage` |

`X.Y.Z` = le numéro de la dernière version (ex : `1.0.5`).

---

## 🪟 Windows

1. Télécharge le fichier `.exe`.
2. Double-clique dessus.
3. Windows peut afficher **« Windows a protégé votre ordinateur »** : c'est normal, le launcher n'a pas de certificat payant.
   Clique sur **Informations complémentaires**, puis sur **Exécuter quand même**.
4. Suis l'installation (tu peux choisir le dossier).
5. Lance **Nerysia Launcher** depuis le menu Démarrer ou le raccourci du bureau.

**Mises à jour** : automatiques. Le launcher télécharge la nouvelle version et l'installe au redémarrage.

---

## 🍎 macOS

### 1. Savoir quel fichier prendre

Menu **** (en haut à gauche) → **À propos de ce Mac** :
- tu vois **« Puce Apple M… »** → prends le fichier **`arm64.dmg`**
- tu vois **« Processeur Intel… »** → prends le fichier **`x64.dmg`**

### 2. Installer

1. Double-clique sur le `.dmg` téléchargé.
2. Dans la fenêtre qui s'ouvre, **glisse Nerysia Launcher dans le dossier Applications**.
3. Éjecte le disque « Nerysia Launcher » (clic droit → Éjecter).

### 3. Premier lancement (une seule fois)

Le launcher n'est pas signé par Apple (le certificat coûte 99 €/an), donc macOS le bloque la première fois.

**macOS 15 Sequoia et plus récent :**
1. Ouvre le launcher depuis Applications : macOS affiche un message de blocage → clique **Terminé** (ou OK).
2. Ouvre **Réglages Système** → **Confidentialité et sécurité**.
3. Descends jusqu'au message sur « Nerysia Launcher » → clique **Ouvrir quand même**, puis confirme avec ton mot de passe.

**macOS 14 et plus ancien :**
1. Dans Applications, fais **clic droit** (ou Ctrl + clic) sur Nerysia Launcher → **Ouvrir**.
2. Dans la fenêtre d'avertissement, clique à nouveau **Ouvrir**.

**Si macOS dit que l'app est « endommagée » :**
1. Ouvre l'app **Terminal** (Cmd + Espace, tape « Terminal »).
2. Copie-colle cette commande puis appuie sur Entrée :
   ```
   xattr -cr "/Applications/Nerysia Launcher.app"
   ```
3. Relance le launcher.

**Mises à jour** : le launcher te prévient quand une nouvelle version sort et le bouton ouvre le téléchargement. Il faut réinstaller le `.dmg` à la main (glisser dans Applications → **Remplacer**).

---

## 🐧 Linux — Ubuntu, Debian, Linux Mint, Pop!_OS

1. Télécharge le fichier `.deb`.
2. Ouvre un terminal dans ton dossier Téléchargements et tape :
   ```
   sudo apt install ./Nerysia*.deb
   ```
   (ou double-clique sur le `.deb` pour l'ouvrir avec la Logithèque / le Gestionnaire de paquets)
3. Lance **Nerysia Launcher** depuis le menu des applications (catégorie Jeux).

**Mises à jour** : le launcher te prévient quand une nouvelle version sort. Si elle ne s'installe pas toute seule, retélécharge le nouveau fichier et relance la même commande.

**Désinstaller** : `sudo apt remove nerysia-launcher`

---

## 🐧 Linux — Arch Linux, Manjaro, EndeavourOS

1. Télécharge le fichier `.pacman`.
2. Ouvre un terminal dans ton dossier Téléchargements et tape :
   ```
   sudo pacman -U ./Nerysia*.pacman
   ```
3. Lance **Nerysia Launcher** depuis le menu des applications.

**Mises à jour** : le launcher te prévient quand une nouvelle version sort. Si elle ne s'installe pas toute seule, retélécharge le nouveau fichier et relance la même commande.

**Désinstaller** : `sudo pacman -R nerysia-launcher`

---

## 🐧 Linux — n'importe quelle distribution (AppImage)

L'AppImage marche partout sans installation et **se met à jour toute seule**.

1. Télécharge le fichier `.AppImage`.
2. Rends-le exécutable :
   - clic droit sur le fichier → **Propriétés** → **Permissions** → coche **Autoriser l'exécution comme un programme**
   - ou dans un terminal : `chmod +x Nerysia*.AppImage`
3. Double-clique dessus pour lancer le launcher.

**Si rien ne se passe**, il manque FUSE (nécessaire aux AppImage) :

| Distribution | Commande |
|---|---|
| Ubuntu 24.04 et plus récent | `sudo apt install libfuse2t64` |
| Ubuntu 22.04, Debian, Mint | `sudo apt install libfuse2` |
| Arch, Manjaro, EndeavourOS | `sudo pacman -S fuse2` |
| Fedora | `sudo dnf install fuse fuse-libs` |

---

## ❓ Problèmes fréquents

| Problème | Solution |
|---|---|
| Le jeu rame | Paramètres → **Mods** → choisis le préréglage **Faible** |
| Le launcher ne trouve pas Java | Rien à faire : il le télécharge tout seul au premier lancement (patiente quelques minutes) |
| Erreur de téléchargement des fichiers | Vérifie ta connexion puis relance le launcher : il reprend là où il s'est arrêté |
| Autre problème | Demande sur le Discord : https://discord.gg/dtvMfS69hU |
