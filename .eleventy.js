// Eleventy config for fractured-jaw.com.
//
// Most "magic" lives in three places:
//   - src/content/content.11tydata.js: computes per-page permalinks and
//     handles the draft/exclude frontmatter flags.
//   - src/utils/permalink.js: the URL transform itself
//     (content/<section>/YYYY/MM-MMM/<File>.md → /<section>/<slug>/).
//   - This file: collections, filters, watch targets.

const { DateTime } = require("luxon");
const slugify = require("./src/utils/slugify");
const { CONTENT_SECTIONS } = require("./src/utils/permalink");
const {
  validateCollection,
  detectCollisions,
} = require("./src/utils/frontmatter");
const wikilinkPlugin = require("./src/utils/wikilinks");

const CONTENT_ROOT = "src/content";

// Glob patterns that match every published content file.
const CONTENT_GLOBS = CONTENT_SECTIONS.map(
  (section) => `src/content/${section}/**/*.md`
);

module.exports = function (eleventyConfig) {
  // ---------- Markdown ----------

  // Extend Eleventy's bundled markdown-it instance with our wikilink plugin
  // (so [[blog/2026/.../My Post|alias]] becomes a real <a>). amendLibrary
  // preserves whatever options Eleventy itself sets — using setLibrary would
  // wipe those out.
  eleventyConfig.amendLibrary("md", (md) => {
    md.use(wikilinkPlugin, { contentRoot: CONTENT_ROOT });
  });

  // ---------- Filters ----------

  // Convert a date (Date object or ISO string) into another format.
  // Default format matches our display style; pass a luxon format string to override.
  eleventyConfig.addFilter("humanDate", (value, format = "LLLL d, yyyy") => {
    const dt = toDateTime(value);
    return dt && dt.isValid ? dt.toFormat(format) : "";
  });

  // ISO 8601 string for <time datetime="..."> attributes and JSON output.
  eleventyConfig.addFilter("isoDate", (value) => {
    const dt = toDateTime(value);
    return dt && dt.isValid ? dt.toISO() : "";
  });

  // Current year (used in footer copyright).
  eleventyConfig.addShortcode("currentYear", () =>
    DateTime.now().toFormat("yyyy")
  );

  // Slugify (exposed in templates so tag links can compute /tags/<slug>/).
  eleventyConfig.addFilter("slug", slugify);

  // Take the first N items of an array. Used in templates to cap "recent
  // posts" lists without computing slices in JS.
  eleventyConfig.addFilter("take", (value, n) =>
    Array.isArray(value) ? value.slice(0, n) : value
  );

  // ---------- Collections ----------

  // One collection per section, sorted newest-first by date_published.
  // Each collection runs frontmatter validation and URL collision detection
  // before returning items, so build errors fire as early as possible.
  for (const section of CONTENT_SECTIONS) {
    eleventyConfig.addCollection(section, (api) => {
      const items = api.getFilteredByGlob(`src/content/${section}/**/*.md`);
      validateCollection(items, section);
      detectCollisions(items, section);
      return [...items].sort(byDatePublishedDesc);
    });
  }

  // Cross-section feed of every published post.
  eleventyConfig.addCollection("all_content", (api) => {
    const items = api.getFilteredByGlob(CONTENT_GLOBS);
    return [...items].sort(byDatePublishedDesc);
  });

  // Everything wikilink-targetable: content posts + top-level pages
  // (about, index, blog/essays/fragments/media landings, tags index).
  // Used by src/preview-index.11ty.js to generate /preview-index.json.
  eleventyConfig.addCollection("previewable", (api) => {
    return api.getFilteredByGlob([
      ...CONTENT_GLOBS,
      "src/content/pages/**/*.md",
    ]);
  });

  // Posts flagged `featured: true` in frontmatter, newest-first.
  eleventyConfig.addCollection("featured", (api) => {
    const items = api
      .getFilteredByGlob(CONTENT_GLOBS)
      .filter((item) => item.data.featured === true);
    return [...items].sort(byDatePublishedDesc);
  });

  // Tag index: every unique tag (case-normalized) with the posts that carry it.
  // Each entry: { tag, displayName, count, posts: [...] }.
  eleventyConfig.addCollection("tagList", (api) => {
    const all = api.getFilteredByGlob(CONTENT_GLOBS);
    const map = new Map();
    for (const item of all) {
      const raw = item.data.tags;
      const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
      for (const tag of list) {
        const key = slugify(String(tag));
        if (!key) continue;
        if (!map.has(key)) {
          map.set(key, {
            tag: key,
            displayName: String(tag),
            count: 0,
            posts: [],
          });
        }
        const entry = map.get(key);
        entry.count++;
        entry.posts.push(item);
      }
    }
    // For each tag: sort posts newest-first, and group them by section so
    // tag pages can render `/tags/<tag>/` as "blog posts, then essays, then
    // fragments, then media" with chronological order inside each group.
    const SECTION_ORDER = ["blog", "essays", "fragments", "media"];
    for (const entry of map.values()) {
      entry.posts.sort(byDatePublishedDesc);

      const groups = new Map();
      for (const post of entry.posts) {
        const section = (post.data && post.data.section) || "other";
        if (!groups.has(section)) groups.set(section, []);
        groups.get(section).push(post);
      }
      entry.bySection = [];
      for (const s of SECTION_ORDER) {
        if (groups.has(s)) {
          entry.bySection.push({ section: s, posts: groups.get(s) });
          groups.delete(s);
        }
      }
      // Anything not in the canonical order goes at the end, alphabetically.
      const leftovers = [...groups.entries()].sort(([a], [b]) =>
        a.localeCompare(b)
      );
      for (const [section, posts] of leftovers) {
        entry.bySection.push({ section, posts });
      }
    }
    return [...map.values()].sort((a, b) => a.tag.localeCompare(b.tag));
  });

  // ---------- Passthrough copy ----------

  // Static assets copied verbatim to _site/. Listed explicitly so that
  // src/assets/brutalist-framework/ (local reference only) never lands in
  // the build output. Add new subdirs here as needed.
  eleventyConfig.addPassthroughCopy({ "src/assets/css": "assets/css" });
  eleventyConfig.addPassthroughCopy({ "src/assets/js":  "assets/js"  });
  eleventyConfig.addPassthroughCopy({ "src/assets/images": "assets/images" });
  eleventyConfig.addPassthroughCopy("CNAME");

  // ---------- Watch targets ----------

  // Rebuild on changes to utility code or static assets.
  eleventyConfig.addWatchTarget("src/utils/");
  eleventyConfig.addWatchTarget("src/assets/");

  // ---------- Directory config ----------

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
    // Include "11ty.js" so JavaScript templates (e.g. preview-index.11ty.js)
    // are picked up. Eleventy's default templateFormats include 11ty.js but
    // this override would drop it without an explicit mention.
    templateFormats: ["njk", "md", "html", "11ty.js"],
  };
};

// ---------- Helpers ----------

function toDateTime(value) {
  if (!value) return null;
  if (value instanceof Date) return DateTime.fromJSDate(value);
  if (typeof value === "string") return DateTime.fromISO(value);
  if (typeof value === "object" && typeof value.toISO === "function") {
    return value; // already a DateTime
  }
  return null;
}

function byDatePublishedDesc(a, b) {
  const da = toMillis(a.data.date_published);
  const db = toMillis(b.data.date_published);
  return db - da;
}

function toMillis(value) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  const dt = DateTime.fromISO(String(value));
  return dt.isValid ? dt.toMillis() : 0;
}
