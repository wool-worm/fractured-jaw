// Eleventy JavaScript template — emits one Atom feed per entry in
// _data/feeds.js. Paginates with size:1 so each spec produces its own
// .xml file at the permalink encoded in the spec.
//
// Per-series feeds (one per parent in collections.series) live in a
// sibling generator: src/feed-series.11ty.js.

const { DateTime } = require("luxon");
const { renderAtomFeed } = require("./utils/atom-feed");

// Cap the number of entries per feed. Most readers display 20-50 anyway,
// and an unbounded feed grows linearly with the archive. 50 is a comfortable
// middle ground; raise here if a reader complains about missing entries.
const MAX_ENTRIES = 50;

class Feed {
  data() {
    return {
      pagination: {
        data: "feeds",
        size: 1,
        alias: "feed",
      },
      // The permalink is encoded on the spec itself, so each iteration writes
      // to its own path (e.g. /blog/feed.xml, /series/feed.xml).
      permalink: (data) => data.feed.feedUrl,
      eleventyExcludeFromCollections: true,
    };
  }

  render(data) {
    const { feed, collections, site } = data;
    const items = pickItems(feed.scope, collections).slice(0, MAX_ENTRIES);

    return renderAtomFeed({
      id: `${site.url}${feed.feedUrl}`,
      title: feed.title,
      subtitle: feed.subtitle,
      siteUrl: site.url,
      feedUrl: feed.feedUrl,
      pageUrl: feed.pageUrl,
      items,
      defaultAuthor: site.defaultAuthor,
    });
  }
}

function pickItems(scope, collections) {
  if (scope === "all") {
    return (collections && collections.all_content) || [];
  }
  if (typeof scope === "string" && scope.startsWith("section:")) {
    const section = scope.slice("section:".length);
    return (collections && collections[section]) || [];
  }
  if (scope === "series-aggregate") {
    return collectSeriesEntries(collections);
  }
  return [];
}

// Flatten collections.seriesEntries (which is a parentUrl → entries map)
// into one newest-first list of posts. Each post appears once, because
// parseSeriesField resolves a post to at most one parent.
function collectSeriesEntries(collections) {
  const map = (collections && collections.seriesEntries) || {};
  const seen = new Set();
  const out = [];
  for (const url of Object.keys(map)) {
    for (const entry of map[url]) {
      const post = entry.post;
      if (!post || !post.url || seen.has(post.url)) continue;
      seen.add(post.url);
      out.push(post);
    }
  }
  out.sort((a, b) => toMillis(b.data.date_published) - toMillis(a.data.date_published));
  return out;
}

function toMillis(value) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  const dt = DateTime.fromISO(String(value));
  return dt.isValid ? dt.toMillis() : 0;
}

module.exports = Feed;
