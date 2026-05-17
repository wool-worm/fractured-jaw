---
neighbors: []
---

# Webring data file

Authored in Obsidian; read by `src/_data/webring.js` at build time so
templates have `webring.neighbors` available globally. This file is
tracked in git (so production builds see it) but excluded from
Eleventy's content pipeline via `.eleventyignore`, the same trick the
radio source files use.

To add a neighbor, append an entry to the `neighbors:` array in the
YAML frontmatter above:

```
neighbors:
  - name: Example Zine
    url: https://example.com
    description: One-line description of the neighbor (optional).
```

Order in the frontmatter is preserved on the page. Leave the array
empty to render the `/webring/` page in its "no neighbors yet" state.
