# ERA Internal Tools

Hub des outils internes ERA Music. Hébergé sur Vercel, déployé automatiquement à chaque push.

## Outils

| Outil | Statut | URL |
|---|---|---|
| Competitor Intel | Live | [/competitor-intel/](/competitor-intel/) |

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
├── index.html           # Hub (liste des outils)
├── README.md
└── competitor-intel/
    └── index.html       # Outil de scraping ad library
```

Chaque nouvel outil = un nouveau dossier avec son propre `index.html`. Le hub liste les outils disponibles + roadmap.

## Notes de sécurité

- Les tokens API (Apify, etc.) sont stockés en localStorage côté client — jamais commit
- Le repo est privé
- Les PAT GitHub utilisés pour l'itération sont fine-grained, scopés à ce repo uniquement, expirés à 90j
