# ERA Internal Tools

Hub des outils internes ERA Music. Hébergé sur Vercel, déployé automatiquement à chaque push.

## Outils

| Outil | Statut | URL |
|---|---|---|
| Competitor Intel | Live | [/competitor-intel/](/competitor-intel/) |
| Fan Link Generator | Live | [/fan-link-generator/](/fan-link-generator/) |
| Sound Intel | Beta | [/sound-intel/](/sound-intel/) |
| Cockpit royalties | Live | [/royalties/](/royalties/) |

## Formulaire de release (artiste)

Remplace le Fillout « 3 - Master Catalog (Artist Version) ». Page artiste : `/release-form/?t=<lien signé>` (non listée dans le hub, noindex).

**Flux**

1. Airtable, table *Master Catalog (Meta)* : Pipeline → « Lien à envoyer ».
2. L'automation Airtable appelle `GET /api/release/?action=mint&r=<recordId>` : le lien signé est écrit dans « Form Link », Pipeline → « Lien envoyé ». Régénérer le lien révoque l'ancien.
3. L'artiste remplit, enregistre le brouillon autant de fois qu'il veut (autosave), uploade WAV / artwork / photos / contenus vers Drive (relais par morceaux de 4 Mo vers une session resumable).
4. « Submit final release » : validation serveur, résolution artistes / ayants droits (fiches existantes complétées champs vides seulement, nouvelles fiches « À valider »), écriture des champs titre, flags QC, archive JSON dans le dossier Drive, mail interne. Pipeline → « Soumis ».
5. QC dans Airtable : « QC validé » verrouille le formulaire ; « Correction demandée » + note le rouvre avec la note affichée.

**Fichiers**

| Fichier | Rôle |
|---|---|
| `release-form/index.html` | UI artiste (vanilla, ES module) |
| `release-form/rules.js` | Schéma de données + validation, partagé client/serveur |
| `api/release.js` | Routeur `?action=` : mint, config, save, search, upload-start, chunk, artwork, submit |
| `api/_release/*.js` | Airtable (IDs de champs), Google (Drive + mail via Apps Script), tokens HMAC |
| `tools/release-apps-script/` | Apps Script « ERA — Releases » : jeton Drive court + envoi de mail (non déployé par Vercel) |

**Variables Vercel**

| Variable | Obligatoire | Rôle |
|---|---|---|
| `AIRTABLE_TOKEN` | oui | Lecture/écriture base Catalog (ou `RELEASE_AIRTABLE_TOKEN` si le token existant ne couvre pas cette base) |
| `RELEASE_SIGNING_SECRET` | oui | ≥ 32 caractères, signe liens artiste et jetons d'upload |
| `RELEASE_APPS_SCRIPT_URL` | oui | URL `/exec` du web app Apps Script |
| `RELEASE_APPS_SCRIPT_SECRET` | oui | Secret loggé par `setup()` dans l'Apps Script |
| `RELEASE_NOTIFY_EMAILS` | non | Destinataires du mail interne (défaut : acastaldi@eramusic.io) |
| `RELEASE_PUBLIC_BASE` | non | Domaine des liens artiste si différent de l'hôte appelé |

Aucun secret dans le repo. Le lien artiste ne sort jamais de l'API : il est écrit uniquement dans Airtable.

## Stack

- **HTML/CSS/JS vanilla** pour la majorité des outils — pas de build step, pas de dépendances
- **localStorage** pour la persistence (single-user). Migration vers **Supabase** quand un outil devient collaboratif
- **Apify** pour le scraping (Meta Ad Library)
- **Vercel** pour l'hébergement (auto-deploy sur push `main`)

## Workflow d'itération

1. Demander à Claude une nouvelle feature ou un nouvel outil
2. Claude clone le repo, édite, commit + push
3. Vercel redéploie automatiquement en ~30 secondes
4. URL stable, pas de fichiers HTML qui traînent

## Structure

```
era-internal-tools/
├── index.html               # Hub (liste des outils)
├── README.md
├── competitor-intel/
│   └── index.html           # Scraping Meta Ad Library
├── fan-link-generator/
│   └── index.html           # ReleaseConfig Lovable
├── sound-intel/
│   └── index.html           # UGC extraction TikTok + Instagram
├── royalties/               # Cockpit royalties (macro, projet, relevé artiste)
│   ├── index.html · projet/ · artiste/
│   └── lib.js · viz.js · style.css
└── api/
    ├── _royalties.js        # Lecture Airtable + modèle (non routé : préfixe _)
    ├── royalties.js         # Données admin (clé x-admin-key)
    └── royalties-artist.js  # Relevé artiste (lien signé)
```

Chaque nouvel outil = un nouveau dossier avec son propre `index.html`. Le hub liste les outils disponibles + roadmap.

## Jobs planifiés (GitHub Actions)

Hors site : le dossier `jobs/` et `.github/` sont exclus du déploiement Vercel (`.vercelignore`).

### Spotify streams → Airtable

- **Code** : `jobs/spotify-streams/scrape.mjs` · **Workflow** : `.github/workflows/spotify-streams.yml`
- **Quand** : tous les jours à 07:37 UTC (08:37 Paris l'hiver, 09:37 l'été — créneau de l'ancien scénario Make). Lancement manuel possible depuis l'onglet Actions (dry run par défaut). Chaque push sur le job lance un dry run (aucune écriture) : complet si le secret existe, sinon 4 titres témoins.
- **Quoi** : pour chaque titre de la Matrice ayant un `spotify_id` (ERA, Agence, CR2 Records — `ORIGINS: ALL`), ouvre la page Spotify dans un Chromium headless et lit le playcount public. Écrit dans la table Songs, ligne `Date = J-1` : `total_streams`, et `daily_streams = total(J-1) − total(J-2)` quand la ligne J-2 existe.
- **Règle** : un nombre illisible n'est jamais écrit. Pas de J-2 ou total en baisse → `daily_streams` laissé vide. Tout échec fait sortir le run en erreur (mail GitHub).
- **Secret requis** : `AIRTABLE_TOKEN` (Settings → Secrets → Actions), scope `data.records:read` + `data.records:write` sur la base `appnSgCIW2ik08BFm`.
- **Restreindre le périmètre** : changer `ORIGINS` dans le workflow (ex. `ERA`). Pour une autre base (129), dupliquer le job avec ses propres IDs de base et de tables.

## Cockpit royalties

- **Source** : base Airtable *ERA Reporting & Royalties* (`appBvSWFIA6P36nXu`), lue côté serveur — tables Projects, Statement Lines, Expenses, Splits, Payees, par field ID (un renommage de colonne ne casse rien).
- **Pages** : `/royalties/repartition/` (mois par mois, deux vitesses : dépensé — capex sur les titres non recoupés, catalogue sur les recoupés et playlists — puis, quand le relevé arrive, marge nette des recoupées nette de royalties, récupéré vs investi des non recoupées, catalogue sans investissement, relevés reçus) · `/royalties/` (macro : cash déployé/récupéré, dépenses vs revenus, par titre, top 15 mensuel, kanban de recoupement, table) · `/royalties/projet/?id=rec…` (micro admin : courbe de recoupement, dépensé vs récupéré, dépenses vs écoutes, en cours, deal & splits, dépenses) · `/royalties/artiste/?p=rec…&s=…` (relevé artiste, un seul titre, sans notes internes).
- **Règles de calcul** : KPI = rollups Airtable (source de vérité). Courbes = lignes mensuelles par mois d'écoute ; tout écart > 0,50 € avec les rollups s'affiche en bandeau. Récupéré = Σ min(revenus, marketing) par titre. Mois postérieurs au dernier mois reporté par *tous* les distributeurs = partiels (hachurés).
- **Décalage de paiement** : relevé Wiseband du 15 = mois M partiel à M+2 (sans Spotify, Deezer, Qobuz), complet à M+3. Le dernier mois d'un export Wiseband est toujours partiel. Âge d'un titre = mois de revenus complets depuis la sortie.
- **Statuts (vitesse, validé par Antoine le 19/11/2026)** : Recoupé · En maturation · Perdant · Sans dépense. Un titre qui recoupe encore est « En maturation » si, au rythme de ses derniers mois complets (moyenne des 3 derniers vs les 3 précédents, revenus jamais projetés à la hausse), il recoupe en 18 mois ou moins, ou s'il est en lancement (moins de 3 mois complets, encore en hausse). Sinon « Perdant ». Pas de plancher sur le % déjà recoupé. Le champ Status d'Airtable reste au calendrier ; l'écart est affiché sur la fiche.
- **Variables Vercel** : `AIRTABLE_TOKEN` (lecture sur `appBvSWFIA6P36nXu`) · `ROYALTIES_ADMIN_KEY` (secret long : accès admin + signature des liens artistes ; le changer invalide tous les liens artistes envoyés).
- **Diagnostic** : `/api/royalties?health=1` (sans clé, aucun montant) → état du token, de la clé, nombre de projets et d'écarts.
- **Cache** : 10 min par instance. Bouton ↻ = relecture immédiate d'Airtable.

## Guideline design

Toute modification d'interface suit `CLAUDE.md` : le style maison ERA (thème sombre, Space Grotesk / JetBrains Mono, règles de graphiques de `royalties/viz.js`) prime sur l'apparence ; la skill **UI/UX Pro Max** (`.claude/skills/ui-ux-pro-max/`, MIT, vendorisée depuis github.com/nextlevelbuilder/ui-ux-pro-max-skill) prime sur l'usage : accessibilité, interactions, responsive, formulaires, choix des graphiques, check-list avant livraison. Recherche : `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<requête>" --domain ux`. Le dossier `.claude/` n'est pas publié sur Vercel.

## Notes de sécurité

- Les tokens API (Apify, etc.) sont stockés en localStorage côté client — jamais commit
- Le repo est privé
- Les PAT GitHub utilisés pour l'itération sont fine-grained, scopés à ce repo uniquement, expirés à 90j
