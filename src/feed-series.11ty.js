// Eleventy JavaScript template — emits one Atom feed per series parent
// (collections.series). Lives outside src/content/ so content.11tydata.js
// doesn't try to compute a permalink for it: the pagination-driven
// permalink below has to win.
//
// Subscribers to /series/<slug>/feed.xml get every entry whose
// `series_name:` frontmatter resolves to that parent, newest first.

const { renderAtomFeed } = require("./utils/atom-feed");

const MAX_ENTRIES = 50;

class FeedSeries {
  data() {
    return {
      pagination: {
        data: "collections.series",
        size: 1,
        alias: "parent",
      },
      // collections.series items have a .url like "/series/transmissions/".
      // Append "feed.xml" to land at /series/transmissions/feed.xml.
      permalink: (data) => `${data.parent.url}feed.xml`,
      eleventyExcludeFromCollections: true,
    };
  }

  render(data) {
    const { parent, collections, site } = data;
    const seriesEntries = (collections && collections.seriesEntries) || {};
    const entries = seriesEntries[parent.url] || [];
    // Each `entry` is { post, entryNumber } — feed wants just the posts,
    // newest-first (the collection already sorts that way for display).
    const items = entries.slice(0, MAX_ENTRIES).map((e) => e.post);

    const parentData = parent.data || {};
    const seriesTitle = parentData.title || "Series";
    const feedUrl = `${parent.url}feed.xml`;

    return renderAtomFeed({
      id: `${site.url}${feedUrl}`,
      title: `Fractured Jaw — ${seriesTitle}`,
      subtitle:
        parentData.description ||
        `Entries in the ${seriesTitle} series, newest first.`,
      siteUrl: site.url,
      feedUrl,
      pageUrl: parent.url,
      items,
      defaultAuthor: site.defaultAuthor,
    });
  }
}

module.exports = FeedSeries;
