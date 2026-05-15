// Central registry of every "fixed" Atom feed (everything except the
// per-series feeds, which paginate over collections.series — see
// src/feed-series.11ty.js).
//
// Each entry drives three things:
//   1. The output file path emitted by src/feed.11ty.js.
//   2. The autodiscovery <link rel="alternate" type="application/atom+xml">
//      injected into the page's <head> (matched by `pageUrl`).
//   3. The bottom-of-page RSS icon partial (matched by `pageUrl`).
//
// pageUrl is the HTML page the feed mirrors; feedUrl is the feed's own URL.
// `scope` is read by src/feed.11ty.js to pick the right collection:
//   all              — collections.all_content
//   section:<name>   — collections[name]    (blog/essays/fragments/media)
//   series-aggregate — every post whose series_name resolves to a real parent
module.exports = [
  {
    key: "all",
    scope: "all",
    pageUrl: "/",
    feedUrl: "/feed.xml",
    title: "Fractured Jaw",
    subtitle: "All posts. Newest first.",
  },
  {
    key: "blog",
    scope: "section:blog",
    pageUrl: "/blog/",
    feedUrl: "/blog/feed.xml",
    title: "Fractured Jaw — blog",
    subtitle: "Long-form posts.",
  },
  {
    key: "essays",
    scope: "section:essays",
    pageUrl: "/essays/",
    feedUrl: "/essays/feed.xml",
    title: "Fractured Jaw — essays",
    subtitle: "Self-contained pieces.",
  },
  {
    key: "fragments",
    scope: "section:fragments",
    pageUrl: "/fragments/",
    feedUrl: "/fragments/feed.xml",
    title: "Fractured Jaw — fragments",
    subtitle: "Errata and idea-level notes.",
  },
  {
    key: "media",
    scope: "section:media",
    pageUrl: "/media/",
    feedUrl: "/media/feed.xml",
    title: "Fractured Jaw — media",
    subtitle: "Reviews of books, film, music.",
  },
  {
    key: "series",
    scope: "series-aggregate",
    pageUrl: "/series/",
    feedUrl: "/series/feed.xml",
    title: "Fractured Jaw — series",
    subtitle: "New entries across every series.",
  },
];
