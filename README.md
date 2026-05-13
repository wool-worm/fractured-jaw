# Fractured Jaw

A zine and blog at [fractured-jaw.com](https://fractured-jaw.com). Writing, music, politics. Anonymous, intermittent, hand-built.

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

## Licensing

This repository carries two licenses — one for the code, one for the writing — because they protect different things.

- **Code** (`LICENSE`, [MIT](https://opensource.org/license/mit/)) — everything that builds the site: Eleventy config, templates, stylesheets, JavaScript, build tooling. Reuse is permitted, including commercially, as long as the copyright notice and license text are retained.
- **Content** (`LICENSE-CONTENT`, [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)) — every Markdown file under `src/content/`: blog posts, essays, fragments, media reviews, pages. You may share and adapt with attribution to *wool-worm* / *Fractured Jaw*. Commercial use, including training generative-AI models, is not permitted.

The site also publishes a `robots.txt` and an `ai.txt` that opt out of common AI-training crawlers as a technical companion to the content license.
