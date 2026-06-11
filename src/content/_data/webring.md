---
neighbors: []
rings:
  - name: Hotline Webring
    url: https://hotlinewebring.club/
    prev: https://hotlinewebring.club/YOUR-SLUG/previous
    next: https://hotlinewebring.club/YOUR-SLUG/next
    # random: https://hotlinewebring.club/YOUR-SLUG/random   # optional
---

# Webring data file

Authored in Obsidian; read by `src/_data/webring.js` at build time so
templates have `webring.neighbors` and `webring.rings` available
globally. This file is tracked in git (so production builds see it) but
excluded from Eleventy's content pipeline via `.eleventyignore`, the
same trick the radio source files use.

## Neighbors (blogroll)

Curated outbound links. To add one, append to the `neighbors:` array:

```
neighbors:
  - name: Example Zine
    url: https://example.com
    description: One-line description of the neighbor (optional).
```

Order is preserved. Empty array renders the "no neighbors yet" state.

## Rings (membership nav)

Webrings you've joined. Each entry renders as a single inline nav row on
`/webring/`: `← previous | name | next →`. To add one, append to the
`rings:` array:

```
rings:
  - name: Hotline Webring                 # ring's display name
    url: https://hotlinewebring.club/      # the ring's hub (name links here); optional
    prev: https://.../YOUR-SLUG/previous   # the ring's "previous" endpoint
    next: https://.../YOUR-SLUG/next       # the ring's "next" endpoint
    random: https://.../YOUR-SLUG/random   # optional; rendered only if present
```

`prev` and `next` are the only required fields for a bare entry (a ring
with no prev/next isn't a ring). `url` and `random` are optional and
dropped from the row when absent. **Replace `YOUR-SLUG`** with the slug
the ring assigned you when you joined; the seeded Hotline entry is a
placeholder until then.

### Iframe/widget rings

Some rings hand you an `<iframe>` widget instead of bare prev/next URLs.
Give that entry an `embed:` field (raw HTML) instead of `prev`/`next`,
and it renders in place among the other rings:

```
rings:
  - name: Some Iframe Ring
    embed: |
      <iframe src="https://example-ring.org/widget?id=fractured-jaw"
              width="300" height="60" frameborder="0"></iframe>
```

`embed:` is rendered as raw HTML (`| safe`), so only paste widgets from
rings you trust. The widget carries the ring's own styling, which won't
match the site palette the way the bare rows do.

Bare and iframe entries can mix freely in one `rings:` list; they render
in list order. Order is preserved. Empty/missing array hides the
memberships section.
