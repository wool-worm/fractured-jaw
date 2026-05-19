// Eleventy JavaScript template — emits one Atom feed per author record
// (collections.authors). Lives outside src/content/ so content.11tydata.js
// doesn't try to compute a permalink for it: the pagination-driven
// permalink below has to win.
//
// Subscribers to /authors/<slug>/feed.xml get every post whose `author`
// frontmatter resolves to that author,  newest first. 

const { renderAtomFeed } = require("./utils/atom-feed");
const { indexAuthorsByUrl } = require("./utils/authors");

const MAX_ENTRIES = 50;

class FeedAuthor {
  data() {
    return {
      pagination: {
        data: "collections.authors",
        size: 1,
        alias: "authorRecord",
      },
      // collections.authors items have a .url like "/authors/wool-worm/".
      // Append "feed.xml" to land at /authors/wool-worm/feed.xml.
      permalink: (data) => `${data.authorRecord.url}feed.xml`,
      eleventyExcludeFromCollections: true,
    };
  }

  render(data) {
    const { authorRecord, collections, site } = data;
    const authorPosts = (collections && collections.authorPosts) || {};
    const items = (authorPosts[authorRecord.url] || []).slice(0, MAX_ENTRIES);

    const recordData = authorRecord.data || {};
    const authorTitle = recordData.title || "author";
    const feedUrl = `${authorRecord.url}feed.xml`;

    return renderAtomFeed({
      id: `${site.url}${feedUrl}`,
      title: `Fractured Jaw — ${authorTitle}`,
      subtitle:
        recordData.description ||
        `Posts by ${authorTitle}, newest first.`,
      siteUrl: site.url,
      feedUrl,
      pageUrl: authorRecord.url,
      items,
      defaultAuthor: site.defaultAuthor,
      authorsByUrl: indexAuthorsByUrl(collections && collections.authors),
    });
  }
}

module.exports = FeedAuthor;
