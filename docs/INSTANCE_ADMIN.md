# 🔒 Instance ADMIN secrète

Une instance Minecraft avec **son propre modpack**, visible dans le launcher **uniquement par les comptes admins**. Les joueurs normaux ne la voient pas, et ne peuvent ni lire ni télécharger son modpack.

> Ce document est public (repo GitHub) : il décrit le **mécanisme**, jamais les admins, les adresses ou le contenu du modpack. La sécurité ne repose pas sur le secret du code.

---

## 🧭 Comment ça marche

```
Launcher (compte admin)                 apk.nerysia.fr/…/admin/api.php            Mojang
        │  1. "ce compte est admin ?" ──────────►│  (404 pour un joueur normal)
        │◄───────────── code à usage unique ─────│
        │  2. "je rejoins ce code" (jeton du joueur) ─────────────────────────────►│
        │  3. "donne l'instance" ───────────────►│  4. "qui a rejoint ce code ?" ──►│
        │                                        │◄──────────── UUID du compte ────│
        │◄── instance + liens signés (24 h) ─────│  (si l'UUID est dans admins.json)
```

| Élément | Où | Public ? |
|---|---|---|
| `api.php` (la porte d'accès) | `Y:\apk\nerysia-laucher\admin\api.php` | Oui (aucun secret dedans) |
| Clé secrète | `Y:\_nerysia_admin\config.php` | **Non** (hors du site web) |
| Liste des admins | `Y:\_nerysia_admin\admins.json` | **Non** |
| Infos du serveur admin | `Y:\_nerysia_admin\admin-server.json` | **Non** |
| Modpack admin | `Y:\_nerysia_admin\servers\<id>\` | **Non** |
| Modpack admin généré | `Y:\_nerysia_admin\distribution-admin.json` | **Non** |

**Ce qui protège :**
- Le jeton Microsoft de l'admin part **uniquement chez Mojang**, jamais chez Nerysia (même mécanisme qu'un serveur Minecraft qui vérifie un joueur).
- Les liens de téléchargement sont signés et expirent après **24 h**. Retirer un admin coupe ses liens **immédiatement**.
- Rien de l'instance admin n'est commité sur GitHub ni affiché dans les logs publics des GitHub Actions.

> [!IMPORTANT]
> **Mets aussi le serveur Minecraft admin en whitelist** (UUID des admins). Le launcher cache l'instance, mais c'est la whitelist qui empêche quelqu'un de s'y **connecter** avec un autre client.

---

## 🚀 Mise en place (une seule fois)

Le drive `Y:` doit être monté.

1. Prépare le dossier privé et déploie `api.php` :
   ```powershell
   & "tools/admin.ps1" init
   ```
   À la fin, le script teste `api.php` en ligne. Il doit afficher `api.php repond : PHP 8.x, ... dossier prive trouve=True`.
   Si ce n'est pas le cas, voir [Dépannage](#-dépannage).
2. Ouvre `Y:\_nerysia_admin\admin-server.json` et remplis au minimum `address` (adresse du serveur Minecraft admin) :
   ```json
   {
     "id": "Nerysia-Admin",
     "name": "Nerysia ADMIN",
     "description": "Instance réservée aux admins",
     "icon": "https://apk.nerysia.fr/Logo.png",
     "address": "mon-serveur-admin.fr:25565",
     "minecraftVersion": "1.21.1",
     "fabricCore": "same"
   }
   ```
   `fabricCore: "same"` = même version de Fabric que le modpack joueur.
3. Ajoute les admins par pseudo (le script récupère l'UUID chez Mojang) :
   ```powershell
   & "tools/admin.ps1" add PseudoAdmin1
   & "tools/admin.ps1" add PseudoAdmin2
   ```
4. Mets les mods et les configs du modpack admin dans `Y:\_nerysia_admin\servers\Nerysia-Admin\`.
   Les sous-dossiers sont les mêmes que pour le modpack joueur :
   - `fabricmods\required\` : mods obligatoires
   - `fabricmods\moyen\`, `ultra\`, `builder\` : préréglages (facultatif)
   - `files\` : `config\`, `resourcepacks\`, `shaderpacks\`…
5. Publie (voir ci-dessous), puis lance le launcher avec un compte admin : l'instance apparaît dans la liste des serveurs.

---

## 🔄 Publier le modpack admin

Les **mêmes commandes** que pour le modpack joueur publient les deux modpacks d'un coup :

| Méthode | Commande |
|---|---|
| En local (`Y:` monté) | `& "tools/generate-distribution.ps1" -Bump patch` |
| Depuis GitHub | Actions → **Update Modpack** → Run workflow |

- La version du modpack admin augmente **toute seule** (+0.0.1) dès que son contenu change.
- Les mêmes contrôles s'appliquent (dépendances, dossiers inconnus, chute du nombre de modules).
- Sur GitHub, les détails du modpack admin sont **masqués** dans les logs. En cas d'erreur de dépendance, lance le script local pour voir les noms.
- Si `admin-server.json` n'existe pas, l'instance admin est simplement ignorée.

---

## 👥 Gérer les admins

| Action | Commande |
|---|---|
| Ajouter | `& "tools/admin.ps1" add <pseudo>` |
| Retirer (accès coupé immédiatement) | `& "tools/admin.ps1" remove <pseudo>` |
| Lister | `& "tools/admin.ps1" list` |
| Tester `api.php` | `& "tools/admin.ps1" test` |

L'UUID ne change jamais, même si l'admin change de pseudo : il garde son accès.

---

## 🛠 Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| `admin.ps1 test` → 404 | `api.php` pas déployé | `& "tools/admin.ps1" init` |
| `admin.ps1 test` → le navigateur télécharge le fichier ou affiche du code | PHP désactivé sur l'hébergement | Espace client OVH → Hébergement → **Multisite** → activer PHP pour `apk.nerysia.fr` |
| `dossier prive trouve=False` | `_nerysia_admin` pas au bon endroit | Il doit être à la racine du FTP (à côté de `apk\`), pas dans `apk\` |
| L'admin ne voit pas l'instance | Compte pas dans `admins.json`, ou modpack admin pas encore publié | `admin.ps1 list`, puis relancer la génération |
| L'admin voit l'instance mais le téléchargement échoue | Lien expiré (launcher ouvert depuis plus de 24 h) | Relancer le launcher |

Les logs du launcher (Ctrl+Shift+I → Console) affichent les messages `[AdminAccess]`.
