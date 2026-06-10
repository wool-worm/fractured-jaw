// Eleventy JavaScript template: emits /newsletter.json at build time.
//
// The allowlist of post URLs eligible for the email newsletter: every post
// that is NOT opted out via `newsletter_enabled: false` in its frontmatter.
// The Buttondown sender (.github/scripts/post-buttondown.js) intersects this
// list with the new-posts payload (the same feed diff the Discord dispatch
// uses) so a suppressed post is never drafted into an email.
//
// Built from collections.all_content (the same four sections: blog, essays,
// fragments, media) that feed feed.xml and the dispatch webhook, so the
// newsletter's scope matches the public feed. Drafts are already excluded
// from all_content in production, the only context that consumes this file.
//
// Fail-closed by design: a post must appear in this list to be emailed. The
// flag defaults to true (opt-out model, matching `graph_enabled` /
// `preview_enabled`), so a post lands here unless it explicitly carries
// `newsletter_enabled: false`.
//
// HARD SAFEGUARD: a `draft: true` or `exclude: true` post is barred from this
// list unconditionally, even if `newsletter_enabled` is true (or absent). In
// production these are already absent from all_content (draft/exclude set
// eleventyExcludeFromCollections), and the feed the sender diffs excludes them
// too, so this is the belt to those suspenders: the allowlist is the
// authoritative eligibility gate, and a draft/excluded post is never in it.
// Net effect: an unpublished or hidden post can NEVER be drafted into an email.
//
// Nothing here is sensitive: these URLs are all public in the feed already.

class NewsletterFeed {
  data() {
    return {
      permalink: "/newsletter.json",
      eleventyExcludeFromCollections: true,
    };
  }

  render({ collections }) {
    const items = (collections.all_content || [])
      .filter((item) =>
        item.data.draft !== true &&
        item.data.exclude !== true &&
        item.data.newsletter_enabled !== false
      )
      .filter((item) => item.url)
      // { url, reading_time }: the feed/new-posts payload doesn't carry
      // reading_time, so the sender pulls it from here to print in each card's
      // meta line. reading_time is an Obsidian-plugin-computed frontmatter
      // string (may be absent; the sender just omits it then).
      .map((item) => ({ url: item.url, reading_time: item.data.reading_time || "" }));
    return JSON.stringify(items);
  }
}

module.exports = NewsletterFeed;
