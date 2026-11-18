# ERA Internal Tools — instructions for Claude

Internal tools of ERA Music. Vanilla HTML/CSS/JS, no build step, Vercel serverless functions in `api/` (ESM, `export default handler(req, res)`; files starting with `_` are shared modules, not routes). Push to `main` deploys to production (era-internal-tools.vercel.app).

## Design guideline (UI/UX)

Any change to how a page looks, reads or behaves follows two layers, in this order of precedence:

1. **ERA house style (wins on look):**
   - Theme: dark. `--bg #050507`, `--bg2 #0c0c10`, `--bg3 #13131a`, `--border #1e1e2a`, `--text #e8e8f0`, `--text2 #7878a0`, `--accent #6c63ff`.
   - Type: Space Grotesk (UI), JetBrains Mono (labels, numbers, code).
   - Language of the UI: French, figures in fr-FR (`1 234 €`, `12,5 %`).
   - Charts (`royalties/viz.js` is the reference): one y-axis per chart (never dual axis), 2px lines, thin bars with 4px rounded ends on the baseline, legend from 2 series, hover tooltip on every chart, text in ink tokens and never in the series colour. Series: blue `#3987e5` = revenue / recovered, orange `#d95926` = spend, aqua `#199e70` = streams. Status colours always with an icon and a label: good `#0ca30c`, warning `#fab219`, critical `#d03b3b`.
2. **UI/UX Pro Max (wins on usability):** project skill in `.claude/skills/ui-ux-pro-max/` (vendored, MIT). Use it for accessibility, interaction, layout, forms, navigation, chart choice and the pre-delivery review.
   - Search from the repo root: `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<query>" --domain ux` (domains: `ux`, `chart`, `icons`, `typography`, `color`, `style`, `landing`, `web`).
   - Its `--design-system` output (palette, fonts, landing pattern) applies only to a brand-new tool with no style of its own, and only after Antoine validates it. It never overrides the house theme of existing pages.
   - Before delivering a page: priorities 1–5 of `SKILL.md` (accessibility, interaction, performance, style consistency, responsive) and `references/quick-reference.md` §1–§3. `references/pro-rules.md` targets native/mobile apps: use it only for mobile-specific checks.
   - Render the page headless (desktop 1360 px and mobile 390 px) and look at it before calling it done.

Updating the vendored skill: re-copy `SKILL.md`, `references/`, `data/`, `scripts/*.py` and `LICENSE` from github.com/nextlevelbuilder/ui-ux-pro-max-skill (`.claude/skills/ui-ux-pro-max/`), keep the repo-root script paths, and note the upstream commit in `SKILL.md`.

## Security

- Never commit a token, key or secret. Server secrets live in Vercel env vars (e.g. `AIRTABLE_TOKEN`, `ROYALTIES_ADMIN_KEY`); browser-only tokens stay in localStorage.
- Admin APIs fail closed when their key is missing. Money figures never leave an API without the admin key or a signed link.
- `.claude/`, `jobs/`, `.github/` and this file are excluded from the Vercel deploy (`.vercelignore`).
