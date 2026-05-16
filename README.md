# Fractured Jaw

A zine and blog at [fractured-jaw.com](https://fractured-jaw.com). Writing, music, politics. Anonymous, intermittent, hand-built.

Static site authored in [Obsidian](https://obsidian.md), built with [Eleventy](https://www.11ty.dev/), hosted on GitHub Pages.

## Develop

```bash
npm install
npm start          # dev server; drafts visible
npm run build      # production build; drafts hidden
npm run build:dev  # production build with dev-mode env (drafts visible)
npm run clean      # rimraf _site
```

`cross-env` sets `ELEVENTY_ENV` so the scripts work on PowerShell, bash, and zsh.

## Stack

| Layer       | Choice                                      |
|-------------|---------------------------------------------|
| SSG         | Eleventy 3.x (CommonJS)                     |
| Templates   | Nunjucks (`.njk`) + Markdown                |
| Dates       | Luxon                                       |
| Author tool | Obsidian (vault rooted at `src/content/`)   |
| Hosting     | GitHub Pages                                |
| DNS / proxy | Cloudflare (apex `fractured-jaw.com`)       |

No JS framework, no bundler, no CSS preprocessor, no analytics, no comments, no third-party JS. The site is plain HTML, vanilla JS, plain CSS. This is deliberate.

## Project layout

```
.eleventy.js             Eleventy config (collections, filters, watch targets)
package.json             Scripts: start, build, build:dev, clean
.eleventyignore          Paths Eleventy must not read
.gitignore               Paths git must not track
CNAME                    Custom-domain marker for GitHub Pages
robots.txt               Crawler rules (allow conventional, deny AI training)
ai.txt                   AI-training opt-out (Spawning convention)
src/
  _data/                 Global data: site.js, navigation.json, feeds.js
  _includes/
    layouts/             Page-type templates (post, essay, fragment, ...)
    partials/            Header, footer, head, widgets, post-card, ...
  assets/
    css/                 Stylesheets (modular; site.css imports the rest)
    js/                  Vanilla JS (widgets, search, wikilink-preview, ...)
    images/              Skull logo, favicon, default OG image
  content/               Obsidian vault
    blog/                Long-form posts
    essays/              Self-contained pieces
    fragments/           Short notes
    media/               Reviews
    pages/               Top-level pages (/, /about/, section landings, ...)
    series/              Series parents (group posts across sections)
    _attachments/        Images, routed by the Obsidian attachment-scrubber plugin
    _local/              Author scratch + documentation (gitignored)
    .obsidian/           Vault config (gitignored; syncs via Obsidian Sync)
  utils/                 permalink, slugify, frontmatter, wikilinks, series, atom-feed
  preview-index.11ty.js  Generates /preview-index.json (wikilink hover previews)
  graph-data.11ty.js     Generates /graph-data.json (graph widget + backlinks)
  search-index.11ty.js   Generates /search-index.json (in-page search)
  sitemap.11ty.js        Generates /sitemap.xml
  system-status.11ty.js  Generates /system-status.json (systems widget data)
  haunted.11ty.js        Generates /haunted.json (haunted radio channels)
  radio-cipher.11ty.js   Generates /radio-cipher.json
  radio-compromised.11ty.js   Generates /radio-compromised.json
  fractured-jaw-radio.11ty.js Generates /fractured-jaw-radio.json
  feed.11ty.js           Atom feed emitter (master + per-section + series-aggregate)
  feed-series.11ty.js    Per-series Atom feeds
  search.njk             /search/ results page
  author.njk             Per-author pages
  tag.njk                Per-tag pages
.github/workflows/       GitHub Pages deploy workflow
_site/                   Build output (gitignored)
```

## Authoring

Write posts in Obsidian under `src/content/<section>/YYYY/MM-MMM/<File>.md`. Eleventy reads the same files; the date-based folder structure exists for the author's sanity and is stripped from public URLs.

URL transform: `content/blog/2026/05-May/My Great Post.md` becomes `/blog/my-great-post/`.

Wikilinks are fully scoped:

```markdown
[[blog/2026/05-May/My Great Post|alias text]]
```

The vault path (before the pipe) is resolved to the public URL; the alias is what readers see. Body wikilinks, frontmatter `image:`, and `series_name:` all use the same syntax. Build-time validation catches dead or malformed wikilinks.

Frontmatter (all sections):

| Field             | Notes                                                       |
|-------------------|-------------------------------------------------------------|
| `title`           | Required. Post title.                                       |
| `date_published`  | Required. ISO 8601 with timezone offset.                    |
| `date_updated`    | Maintained by an Obsidian plugin.                           |
| `author`          | String or string[] for co-authored posts.                   |
| `tags`            | List of tags. Lowercased + slug-normalized for URLs.        |
| `description`     | <50 words. Drives social-card description + previews.       |
| `featured`        | Boolean. `true` puts the post on the homepage featured row. |
| `draft`           | Boolean. Visible in dev only.                               |
| `exclude`         | Boolean. Hidden in both dev and prod.                       |
| `preview_enabled` | Boolean (default true). False = omit from wikilink hover.   |
| `graph_enabled`   | Boolean (default true). False = omit from graph data.       |
| `image`           | Wikilink to `_attachments/<section>/<slug>/<file>` (required form). Caption after the pipe drives the alt text on cards + og:image. Bare URLs and bare strings are rejected by the strict validator. |
| `reading_time`    | Auto-computed by an Obsidian plugin.                        |
| `series_name`     | Wikilink to `[[series/<Name>|...]]` (optional).             |
| `rating`          | Media section only. Free-form scale.                        |

## Branching + deploy

Two long-lived branches:
- `main` is production. `fractured-jaw.com` serves whatever is on `main`. Pushes to `main` trigger the GitHub Actions deploy.
- `dev` is the always-ahead draft branch where feature work lands first.

Flow: `feature/<name>` -> `dev` -> PR -> `main` -> deploy.

PRs to `main` run a build check without deploying; merging the PR is what fires the actual deploy.

## Features

- Wikilinks (fully scoped, with build-time validation) and on-hover wikilink previews
- Tags, per-tag pages, tag index
- Authors, per-author pages, author index
- Series (first-class section; parent files have full frontmatter, posts opt in via `series_name:`)
- Graph widget (in-page local graph) + dedicated `/network_nodes/` full graph
- Atom feeds: master, per-section (blog, essays, fragments, media), series-aggregate, per-series
- DIY in-page search (build-emitted index, client-side ranking; no remote service)
- Pirate-radio scanner widget (six signal types + pinned FJR channel; haunted stations)
- Systems-status panel widget (real-data stats + encryption state machine)
- Responsive staircase (1400 / 1200 / 1100 / 1000 / 720) with JS-driven widget fold
- Inline image attachments via Obsidian `![[_attachments/...]]` syntax with EXIF stripping done vault-side
- Brutalist styling: void / brass / blood / sodium palette, layered masthead glitch, scanline, sawtooth section dividers
- SEO surface: sitemap, Open Graph + Twitter cards, default skull OG image, robots.txt + ai.txt
- Skip-to-content link, reduced-motion handling, semantic HTML throughout

## Licensing

Two licenses because code and writing protect different things.

- **Code** (`LICENSE`, [MIT](https://opensource.org/license/mit/)): Eleventy config, templates, stylesheets, JavaScript, build tooling. Reuse is permitted including commercially, as long as the copyright notice and license text are retained.
- **Content** (`LICENSE-CONTENT`, [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)): every Markdown file under `src/content/`. Share and adapt with attribution to *wool-worm* / *Fractured Jaw*. Commercial use, including training generative-AI models, is not permitted.

`robots.txt` and `ai.txt` opt out common AI-training crawlers as the technical companion to the content license.
