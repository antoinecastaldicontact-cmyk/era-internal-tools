# ERA Internal Tools

Hub des outils internes ERA Music. Hébergé sur Vercel, déployé automatiquement à chaque push.

## Outils

| Outil | Statut | URL |
|---|---|---|
| Competitor Intel | Live | [/competitor-intel/](/competitor-intel/) |
| Fan Link Generator | Live | [/fan-link-generator/](/fan-link-generator/) |
| Sound Intel | Beta | [/sound-intel/](/sound-intel/) |
| Cockpit royalties | Live | [/royalties/](/royalties/) |

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
- **Pages** : `/royalties/` (macro : cash déployé/récupéré, dépenses vs revenus, par titre, top 15 mensuel, kanban de recoupement, table) · `/royalties/projet/?id=rec…` (micro admin : courbe de recoupement, dépensé vs récupéré, dépenses vs écoutes, en cours, deal & splits, dépenses) · `/royalties/artiste/?p=rec…&s=…` (relevé artiste, un seul titre, sans notes internes).
- **Règles de calcul** : KPI = rollups Airtable (source de vérité). Courbes = lignes mensuelles par mois d'écoute ; tout écart > 0,50 € avec les rollups s'affiche en bandeau. Récupéré = Σ min(revenus, marketing) par titre. Mois postérieurs au dernier mois reporté par *tous* les distributeurs = partiels (hachurés).
- **Variables Vercel** : `AIRTABLE_TOKEN` (lecture sur `appBvSWFIA6P36nXu`) · `ROYALTIES_ADMIN_KEY` (secret long : accès admin + signature des liens artistes ; le changer invalide tous les liens artistes envoyés).
- **Diagnostic** : `/api/royalties?health=1` (sans clé, aucun montant) → état du token, de la clé, nombre de projets et d'écarts.
- **Cache** : 10 min par instance. Bouton ↻ = relecture immédiate d'Airtable.

## Notes de sécurité

- Les tokens API (Apify, etc.) sont stockés en localStorage côté client — jamais commit
- Le repo est privé
- Les PAT GitHub utilisés pour l'itération sont fine-grained, scopés à ce repo uniquement, expirés à 90j
