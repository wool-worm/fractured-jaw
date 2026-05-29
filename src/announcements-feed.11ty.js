// Eleventy JavaScript template: emits /announcements.json at build time.
//
// A small machine-readable mirror of the announcements log (the same data
// the systems widget and the zen panel render from the `announcements`
// global, src/_data/announcements.js). Its job is to give the Discord
// announcements webhook a stable thing to diff against: the deploy workflow
// fetches the currently-live /announcements.json before building, then
// detect-new-announcements.js compares it to the freshly-built one and posts
// only entries whose `id` is new. See [[discord-webhooks]].
//
// Nothing here is sensitive: the bodies are already public in every page's
// widget HTML. Author is the display alias; `iso` is UTC (no local-timezone
// leak). No file paths or frontmatter beyond what the widget already shows.

class AnnouncementsFeed {
  data() {
    return {
      permalink: "/announcements.json",
      eleventyExcludeFromCollections: true,
    };
  }

  render({ announcements }) {
    const items = (announcements || []).map((a) => ({
      // Stable per-announcement id: the UTC publish instant. Survives body
      // edits (so edits don't re-announce), falls back to the sort key for
      // the degenerate undated note.
      id: a.iso || String(a._sort || ""),
      author: a.author,
      body: a.body,
      iso: a.iso,
    }));
    return JSON.stringify(items);
  }
}

module.exports = AnnouncementsFeed;
