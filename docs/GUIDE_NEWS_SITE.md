# 📰 Plan — Système de News pour www.nerysia.fr (site codé à la main)

## Comment le launcher consomme les news

Le launcher Nerysia lit un **flux RSS** à l'URL définie dans `distribution.json` :
```json
"rss": "https://www.nerysia.fr/feed.xml"
```

Il s'attend à un XML au format RSS 2.0 avec ces champs par article :
- `<title>` — Titre
- `<link>` — URL vers l'article
- `<pubDate>` — Date de publication
- `<dc:creator>` — Auteur
- `<content:encoded>` — Contenu HTML de l'article
- `<slash:comments>` — Nombre de commentaires

---

## Architecture recommandée (site codé à la main)

### Option A — Simple et statique (recommandé pour débuter)

```
www.nerysia.fr/
├── index.html            ← Page d'accueil
├── news/
│   ├── index.html        ← Liste des articles
│   ├── mise-a-jour-101.html
│   └── evenement-mai.html
├── feed.xml              ← Flux RSS (mis à jour manuellement)
└── assets/
    ├── css/style.css
    └── js/main.js
```

**Avantage :** Zéro serveur backend, fonctionne avec n'importe quel hébergement statique.  
**Inconvénient :** Tu dois éditer `feed.xml` à la main à chaque article.

### Option B — Backend minimal PHP (recommandé si tu veux du dynamique)

```
www.nerysia.fr/
├── index.php
├── news/
│   ├── index.php         ← Liste des articles
│   └── article.php       ← Affiche un article
├── feed.php              ← Génère le RSS dynamiquement
├── admin/
│   ├── login.php
│   ├── dashboard.php
│   └── new-article.php   ← Formulaire d'écriture d'article
└── data/
    └── articles.json     ← Base de données JSON des articles
```

**Avantage :** Tu publies un article via une interface web, le RSS se génère automatiquement.  
**Pas besoin de MySQL** — un simple fichier JSON suffit.

---

## Plan d'implémentation — Option B (PHP + JSON)

### 1. Structure d'un article dans `data/articles.json`

```json
[
  {
    "id": "mise-a-jour-101",
    "title": "Mise à jour 1.0.1 — Nouveaux mods",
    "slug": "mise-a-jour-101",
    "date": "2026-05-02T12:00:00+02:00",
    "author": "Lightshadow02",
    "category": "update",
    "summary": "Ajout de nouveaux mods et corrections.",
    "content": "<p>Voici les changements :</p><ul><li>Cobblemon mis à jour</li></ul>",
    "published": true
  },
  {
    "id": "event-tournoi-pokemon",
    "title": "Tournoi Pokémon — Samedi 10 Mai",
    "slug": "event-tournoi-pokemon",
    "date": "2026-05-05T10:00:00+02:00",
    "author": "Lightshadow02",
    "category": "event",
    "summary": "Rejoignez notre premier tournoi Pokémon !",
    "content": "<p>Inscrivez-vous avant le 9 mai...</p>",
    "published": true
  }
]
```

### 2. `feed.php` — Génère le RSS pour le launcher

```php
<?php
header('Content-Type: application/rss+xml; charset=UTF-8');

$articles = json_decode(file_get_contents(__DIR__ . '/data/articles.json'), true);
// Trier du plus récent au plus ancien
usort($articles, fn($a, $b) => strtotime($b['date']) - strtotime($a['date']));
// Garder seulement les articles publiés
$articles = array_filter($articles, fn($a) => $a['published']);

$siteUrl = 'https://www.nerysia.fr';
$buildDate = date('r');
?>
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:slash="http://purl.org/rss/1.0/modules/slash/">
  <channel>
    <title>Nerysia News</title>
    <link><?= $siteUrl ?></link>
    <description>Actualités du serveur Nerysia</description>
    <lastBuildDate><?= $buildDate ?></lastBuildDate>
    <?php foreach ($articles as $article): ?>
    <item>
      <title><?= htmlspecialchars($article['title']) ?></title>
      <link><?= $siteUrl ?>/news/<?= $article['slug'] ?></link>
      <pubDate><?= date('r', strtotime($article['date'])) ?></pubDate>
      <dc:creator><?= htmlspecialchars($article['author']) ?></dc:creator>
      <slash:comments>0</slash:comments>
      <content:encoded><![CDATA[<?= $article['content'] ?>]]></content:encoded>
    </item>
    <?php endforeach; ?>
  </channel>
</rss>
```

### 3. `admin/new-article.php` — Formulaire de publication

```php
<?php
// Protection basique par mot de passe (à améliorer avec sessions)
session_start();
if (!isset($_SESSION['admin'])) {
    header('Location: login.php');
    exit;
}

if ($_POST) {
    $articles = json_decode(file_get_contents('../data/articles.json'), true) ?? [];
    
    $slug = strtolower(trim(preg_replace('/[^a-zA-Z0-9]+/', '-', $_POST['title']), '-'));
    
    $articles[] = [
        'id'        => $slug,
        'title'     => $_POST['title'],
        'slug'      => $slug,
        'date'      => date('c'),
        'author'    => $_SESSION['username'],
        'category'  => $_POST['category'],
        'summary'   => $_POST['summary'],
        'content'   => $_POST['content'],
        'published' => isset($_POST['published'])
    ];
    
    // Enregistrer
    file_put_contents('../data/articles.json', json_encode($articles, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    
    header('Location: dashboard.php?success=1');
    exit;
}
?>
<!DOCTYPE html>
<html>
<head><title>Nouvel Article — Admin Nerysia</title></head>
<body>
<h1>Publier un article</h1>
<form method="POST">
    <label>Titre :<br><input type="text" name="title" required></label><br><br>
    <label>Catégorie :
        <select name="category">
            <option value="update">Mise à jour</option>
            <option value="event">Événement</option>
            <option value="news">Annonce</option>
        </select>
    </label><br><br>
    <label>Résumé :<br><textarea name="summary" rows="2" cols="60"></textarea></label><br><br>
    <label>Contenu HTML :<br><textarea name="content" rows="15" cols="80" required></textarea></label><br><br>
    <label><input type="checkbox" name="published" checked> Publier immédiatement</label><br><br>
    <button type="submit">Publier l'article</button>
</form>
</body>
</html>
```

### 4. Afficher les news sur le site — `news/index.php`

```php
<?php
$articles = json_decode(file_get_contents('../data/articles.json'), true);
usort($articles, fn($a, $b) => strtotime($b['date']) - strtotime($a['date']));
$articles = array_filter($articles, fn($a) => $a['published']);
?>
<!DOCTYPE html>
<html>
<head><title>Actualités — Nerysia</title></head>
<body>
<h1>Actualités</h1>
<?php foreach ($articles as $article): ?>
<article>
    <span class="category"><?= $article['category'] ?></span>
    <h2><a href="/news/<?= $article['slug'] ?>"><?= htmlspecialchars($article['title']) ?></a></h2>
    <time><?= date('d/m/Y', strtotime($article['date'])) ?></time>
    <p><?= htmlspecialchars($article['summary']) ?></p>
</article>
<?php endforeach; ?>
</body>
</html>
```

---

## Lier le RSS au launcher

Une fois `feed.php` en ligne, mets à jour `distribution.json` :

```json
"rss": "https://www.nerysia.fr/feed.php"
```

Et dans le launcher (`docs/distribution.json`) aussi.

---

## Résumé — Workflow pour publier une news

```
1. Aller sur https://www.nerysia.fr/admin/
2. Se connecter
3. Remplir le formulaire (titre, contenu HTML)
4. Cliquer "Publier"
   → articles.json mis à jour automatiquement
   → feed.php génère le RSS à la volée
   → Le launcher affiche la news au prochain démarrage ✅
```

---

## Notes importantes

### Sécurité de l'admin
L'exemple ci-dessus est simplifié. Pour une vraie protection :
- Utilise `password_hash()` / `password_verify()` PHP pour les mots de passe
- Stocke les sessions PHP correctement
- Mets le dossier `admin/` derrière une authentification HTTP si possible

### HTTPS obligatoire
Le launcher requiert que l'URL RSS soit en **HTTPS**. Ton hébergeur doit avoir un certificat SSL actif sur `www.nerysia.fr`.

### Format des dates
Le launcher utilise `new Date(pubDate)` en JavaScript. Le format `r` de PHP (`Mon, 02 May 2026 12:00:00 +0200`) est parfaitement compatible.

### Alternative sans PHP
Si ton hébergeur ne supporte que du statique (GitHub Pages, Netlify, etc.) :
- Édite directement `feed.xml` à chaque article
- Utilise un éditeur RSS comme [FeedValidator](https://www.feedvalidator.org/) pour vérifier
