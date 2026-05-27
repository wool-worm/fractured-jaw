// Eleventy JavaScript template — emits /preview-index.json at build time.
//
// The client-side wikilink hover handler (src/assets/js/wikilink-preview.js)
// fetches this file once on first hover and uses it as a lookup table:
// link href → { title, date, description, image_html, section }.
//
// Lives outside src/content/ so content.11tydata.js doesn't try to compute
// a permalink for it. The frontmatter-style permalink in data() wins.
//
// image_html is the pre-rendered <picture> markup using the same eleventy-img
// widths/formats as the rest of the site. Tooltip width caps at ~320px, so
// the sizes attribute is set narrower than the card/hero pattern to let the
// browser pick the smallest appropriate variant. Sharp's disk cache dedupes
// these against the transform plugin's calls on shared sources.

const path = require("path");
const Image = require("@11ty/eleventy-img");

const IMG_OPTIONS = {
  widths: [400, 800, 1200, 1600],
  formats: ["webp", "jpeg"],
  outputDir: "_site/img/",
  urlPath: "/img/",
};
// Tooltips are bounded at 320px by their inline max-width; on 2x DPI
// displays the browser will choose 800w as the closest >=640px variant.
const IMG_SIZES = "320px";

async function buildImageHtml(data) {
  const imageSrc = data.image_src;
  if (!imageSrc) return null;
  const diskPath = path.join("src", imageSrc);
  const metadata = await Image(diskPath, IMG_OPTIONS);
  const attrs = {
    alt: data.image_alt || "",
    sizes: IMG_SIZES,
    class: "wikilink-preview-image",
    loading: "lazy",
    decoding: "async",
    // Inline style retained from the previous <img>-only version so the
    // tooltip layout works without depending on a stylesheet that may not
    // exist yet (Phase 8 CSS pass would move this to a class rule).
    style: "display:block;max-width:100%;margin:0.25rem 0;",
  };
  if (data.image_focus) {
    attrs.style += ` object-position: ${data.image_focus};`;
  }
  return Image.generateHTML(metadata, attrs);
}

class PreviewIndex {
  data() {
    return {
      permalink: "/preview-index.json",
      eleventyExcludeFromCollections: true,
    };
  }

  async render({ collections }) {
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

      const imageHtml = await buildImageHtml(item.data);
      index[item.url] = {
        title: item.data.title || "",
        date: item.data.date_published || null,
        description: item.data.description || "",
        image_html: imageHtml,
        section: item.data.section || null,
      };
    }

    return JSON.stringify(index, null, 2);
  }
}

module.exports = PreviewIndex;
