# ERA Internal Tools

Hub des outils internes ERA Music. Hébergé sur Vercel, déployé automatiquement à chaque push.

## Outils

| Outil | Statut | URL |
|---|---|---|
| Competitor Intel | Live | [/competitor-intel/](/competitor-intel/) |
| Fan Link Generator | Live | [/fan-link-generator/](/fan-link-generator/) |
| Sound Intel | Beta | [/sound-intel/](/sound-intel/) |

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
└── sound-intel/
    └── index.html           # UGC extraction TikTok + Instagram
```

Chaque nouvel outil = un nouveau dossier avec son propre `index.html`. Le hub liste les outils disponibles + roadmap.

## Jobs planifiés (GitHub Actions)

Hors site : le dossier `jobs/` et `.github/` sont exclus du déploiement Vercel (`.vercelignore`).

### Spotify streams → Airtable

- **Code** : `jobs/spotify-streams/scrape.mjs` · **Workflow** : `.github/workflows/spotify-streams.yml`
- **Quand** : tous les jours à 16:37 UTC (17:37 Paris l'hiver, 18:37 l'été). Lancement manuel possible depuis l'onglet Actions (dry run par défaut).
- **Quoi** : pour chaque titre de la Matrice (`Origin = ERA`, `spotify_id` renseigné), ouvre la page Spotify dans un Chromium headless et lit le playcount public. Écrit dans la table Songs, ligne `Date = J-1` : `total_streams`, et `daily_streams = total(J-1) − total(J-2)` quand la ligne J-2 existe.
- **Règle** : un nombre illisible n'est jamais écrit. Pas de J-2 ou total en baisse → `daily_streams` laissé vide. Tout échec fait sortir le run en erreur (mail GitHub).
- **Secret requis** : `AIRTABLE_TOKEN` (Settings → Secrets → Actions), scope `data.records:read` + `data.records:write` sur la base `appnSgCIW2ik08BFm`.
- **Étendre à 129 / CR2** : changer `ORIGINS` dans le workflow (ex. `ERA,Agence,CR2 Records`).

## Notes de sécurité

- Les tokens API (Apify, etc.) sont stockés en localStorage côté client — jamais commit
- Le repo est privé
- Les PAT GitHub utilisés pour l'itération sont fine-grained, scopés à ce repo uniquement, expirés à 90j
