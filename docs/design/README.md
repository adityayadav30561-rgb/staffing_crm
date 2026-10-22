# Nirman design hand-off

| File | What it is |
|---|---|
| `crm-screens.html` | The five Nirman CRM screens from the homepage (Dashboard, Pipeline, Leads, Follow-ups, Reports) as static HTML with the site's CSS inlined. Desktop size, 1240 × 590. Open in a browser at least 1024px wide. |
| `design-system.html` | Principles, colours, typography, CRM layout and components, radius, shadows, icons, motion and website buttons, with live samples. |
| `tokens.css` | The same values as CSS custom properties, plus the type voices (`.display`, `.heading`, `.title`, `.mock-display`). |
| `tokens.json` | The same values as JSON, for design tools or other code. |

Fonts load from Google Fonts (Mona Sans and Funnel Sans), so the HTML files
need an internet connection to show the right type.

## Regenerating the CRM screens

`crm-screens.html` is rendered from the real component, so it stays in sync
with the site. From `nirman-site/`:

```bash
npm run build
npx tsx scripts/export-crm-screens.tsx
```

Names, companies and figures in the screens are sample data.
