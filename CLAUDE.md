# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Vite dev server on http://localhost:5173
npm run build    # production build to dist/
npm run preview  # serve the built dist/ (only way to exercise the service worker)
npm run lint     # eslint over the repo
```

No test runner is configured.

## What this is

University project (Univ. of Brescia, Mobile Application Development) — a **PWA**, graded on both the app and a LaTeX technical report. Two user roles with separate app sections: **Gym Member** and **Personal Trainer (admin)**.

The code in `src/` is still the stock Vite React template. `doc/` is the real source of truth for what must be built.

## Docs that drive the work

- `doc/context.md` — course + PWA requirements. Read before touching build/PWA config. Notably: the app must be installable, work offline, and use a **custom MUI theme** (`createTheme` + `responsiveFontSizes`) because "MUI is mobile friendly but not natively responsive". Also lists still-open items (e.g. PWA manifest `icons`).
- `doc/trainhub.md` — navigation map: the full page list per role, and their nesting. Use it as the routing spec.
- `doc/assets/variables.tokens.json` — Figma design tokens (W3C design-token format; each entry has `$type`/`$value` with a `hex`). Source for the MUI theme palette. Brand is `#FE6363`, background `#F9FAFB` — these already appear in `vite.config.js`'s manifest, keep them in sync.
- `doc/assets/pt/*.png`, `doc/assets/gym_member/*.png` — Figma screen wireframes, named/numbered per screen. `doc/assets/components/**` — component-level wireframes. These are the visual spec; match them rather than inventing layout.
- `doc/technical_report_examples/*.md` — prior-year reports showing the expected report structure.

## Stack notes

- React 19 + Vite 8, plain JS + JSX (no TypeScript), ESM (`"type": "module"`).
- MUI v9 with Emotion is installed but not yet used anywhere.
- `vite-plugin-pwa` in `autoUpdate` mode; the manifest lives inline in `vite.config.js`, not a separate `manifest.json`. `registerSW({ immediate: true })` is already wired in `src/main.jsx`.
- The service worker is not generated in `dev` — verify PWA behaviour with `npm run build && npm run preview`.
- No router installed yet; `doc/trainhub.md` implies React Router will be needed.
- Not a git repository.
