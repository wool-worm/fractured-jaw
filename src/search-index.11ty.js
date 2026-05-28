// Eleventy JavaScript template — emits /search-index.json at build time.
//
// The client-side search script (src/assets/js/search.js) fetches this once
// on /search/ and uses it as the source of truth for every query. One record
// per published post in collections.all_content.
//
// Lives outside src/content/ so content.11tydata.js doesn't try to compute
// a permalink for it. The data() permalink wins.
//
// Image markup is pre-rendered at build time (image_html field) using the
// same eleventy-img widths/formats as the transform plugin's <img> output.
// This lets the client-side renderer inject the same optimized <picture>
// markup the rest of the site uses instead of falling back to raw jpegs.
// The Sharp processing dedupes against the transform plugin via shared
// content-hashed output filenames, so each unique source image is only
// processed once per build.

const path = require("path");
const Image = require("@11ty/eleventy-img");
const slugify = require("./utils/slugify");
const { parseAuthorField, resolveAuthors } = require("./utils/authors");

const CONTENT_ROOT = "src/content";

const IMG_OPTIONS = {
  widths: [400, 800, 1200, 1600],
  formats: ["webp", "jpeg"],
  outputDir: "_site/img/",
  urlPath: "/img/",
};
const IMG_SIZES = "(max-width: 720px) 100vw, 720px";

async function buildImageHtml(data) {
  const imageSrc = data.image_src;
  if (!imageSrc) return null;
  const diskPath = path.join("src", imageSrc);
  const metadata = await Image(diskPath, IMG_OPTIONS);
  const attrs = {
    alt: data.image_alt || "",
    sizes: IMG_SIZES,
    class: "post-card-image",
    loading: "lazy",
    decoding: "async",
  };
  if (data.image_focus) {
    attrs.style = `object-position: ${data.image_focus}`;
  }
  return Image.generateHTML(metadata, attrs);
}

class SearchIndex {
  data() {
    return {
      permalink: "/search-index.json",
      eleventyExcludeFromCollections: true,
    };
  }

  async render({ collections }) {
    const items = (collections && collections.all_content) || [];
    const authorsCollection = (collections && collections.authors) || [];
    const records = [];

    for (const item of items) {
      if (!item.url) continue;

      const data = item.data || {};
      // Strip HTML tags from the rendered body so the index holds plain text.
      // templateContent is the post-Markdown HTML; we lowercase and collapse
      // whitespace so the runtime can do cheap substring + token matching.
      const rawHtml = item.templateContent || "";
      const plain = stripHtml(rawHtml);

      const tags = toStringArray(data.tags);
      // Resolve `author` frontmatter (wikilink-only) to author display
      // names + slugs. The same shape the index used to carry — the search
      // runtime stays unchanged.
      const parsedAuthors = parseAuthorField(data.author, CONTENT_ROOT);
      const resolved = resolveAuthors(parsedAuthors, authorsCollection);
      const authors = resolved.map((r) => r.displayName);
      const authorSlugs = resolved.map((r) => r.slug);
      // Pre-render the <picture> markup so the runtime renderer can inject
      // it directly instead of building a raw <img> from a URL. Awaiting
      // sequentially is fine here — Sharp's disk cache makes repeat calls
      // for the same source nearly free.
      const imageHtml = await buildImageHtml(data);
      records.push({
        url: item.url,
        title: data.title || "",
        description: data.description || "",
        tags: tags,
        // Pre-slugified so the client doesn't have to mirror our slugify
        // rules (underscore preservation, diacritic stripping) in JS.
        tagSlugs: tags.map((t) => slugify(t)),
        authors: authors,
        authorSlugs: authorSlugs,
        section: data.section || "",
        date: data.date_published || null,
        image_html: imageHtml,
        content: plain,
      });
    }

    return JSON.stringify(records);
  }
}

function stripHtml(html) {
  if (!html) return "";
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function toStringArray(value) {
  if (value === null || value === undefined || value === "") return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map((v) => String(v)).filter(Boolean);
}

module.exports = SearchIndex;
