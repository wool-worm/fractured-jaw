# Fractured Jaw

A zine and blog at [fractured-jaw.blog](https://fractured-jaw.blog). Writing, music, politics. Anonymous, intermittent, hand-built.

Static site authored in Obsidian, built with [Eleventy](https://www.11ty.dev/), hosted on GitHub Pages.

## Develop

```bash
npm install
npm start          # dev server with drafts visible
npm run build      # production build (drafts excluded)
```

## Project layout

- `src/content/` — Obsidian vault. Posts live under `blog/`, `essays/`, `fragments/`, `media/`, and `pages/`.
- `src/_includes/` — layouts and partials.
- `src/_data/` — site metadata and navigation.
- `src/utils/` — slug generation, permalink computation, frontmatter validation.
- `.eleventy.js` — Eleventy config (collections, filters, watch targets).

A full development guide will land in Phase 5. For now, the inline comments in each module are the documentation.

## Phases

This repo is being rebuilt in phases. See `MEMORY.md` files in `~/.claude/projects/` for the complete plan.

1. ✅ Core Eleventy structure + draft/exclude system
2. ⏳ Wikilink markdown plugin
3. ⏳ Traditional navigation (homepage, archives, tag pages)
4. ⏳ Link preview tooltips
5. ⏳ Comprehensive documentation
6. ⏳ Graph visualization (optional)
7. ⏳ Deploy pipeline (GitHub Actions)
8. ⏳ Brutalist styling (optional)
9. ⏳ RSS, sitemap, polish
