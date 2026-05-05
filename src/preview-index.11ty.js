// Eleventy JavaScript template — emits /preview-index.json at build time.
//
// The client-side wikilink hover handler (src/assets/js/wikilink-preview.js)
// fetches this file once on first hover and uses it as a lookup table:
// link href → { title, date, description, image, section }.
//
// Lives outside src/content/ so content.11tydata.js doesn't try to compute
// a permalink for it. The frontmatter-style permalink in data() wins.

class PreviewIndex {
  data() {
    return {
      permalink: "/preview-index.json",
      eleventyExcludeFromCollections: true,
    };
  }

  render({ collections }) {
    const items = (collections && collections.previewable) || [];
    const index = {};

    for (const item of items) {
      // Skip drafts/excluded content (they have permalink: false → no url).
      if (!item.url) continue;

      // Skip when frontmatter explicitly opts out: `preview_enabled: false`.
      // Default is on — most pages should be previewable. Use this to
      // suppress previews for surfaces where a tooltip is low-value (the
      // homepage, the tag index, etc.).
      if (item.data.preview_enabled === false) continue;

      index[item.url] = {
        title: item.data.title || "",
        date: item.data.date_published || null,
        description: item.data.description_short || "",
        image: item.data.image || null,
        section: item.data.section || null,
      };
    }

    return JSON.stringify(index, null, 2);
  }
}

module.exports = PreviewIndex;
