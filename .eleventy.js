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
const { parseSeriesField } = require("./src/utils/series");

const CONTENT_ROOT = "src/content";
const SERIES_GLOB = "src/content/series/**/*.md";

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

  // Normalize a scalar-or-array into an array. Used by post-meta.njk so the
  // `author` field can be either a string ("wool-worm") or a string[]
  // (co-authored posts) without branching in the template.
  eleventyConfig.addFilter("asList", (value) => {
    if (value === null || value === undefined || value === "") return [];
    return Array.isArray(value) ? value : [value];
  });

  // Find a series-parent item by its published URL. Used by post-meta.njk
  // to resolve `series_name: "[[series/Transmissions|…]]"` to the parent's
  // canonical title (per the user's decision: parent title always wins
  // over the wikilink alias). Returns null when no match.
  eleventyConfig.addFilter("seriesByUrl", (seriesCollection, url) => {
    if (!Array.isArray(seriesCollection) || !url) return null;
    return seriesCollection.find((item) => item.url === url) || null;
  });

  // Resolve `series_name` frontmatter to the parent's URL (or null when
  // empty/missing/plain-string/dead-pointer). Filter form so post-meta
  // can use it inline.
  eleventyConfig.addFilter("seriesNameToUrl", (value) => {
    const parsed = parseSeriesField(value, CONTENT_ROOT);
    if (parsed.kind === "wikilink" && parsed.url && parsed.exists) {
      return parsed.url;
    }
    return null;
  });

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
  // (about, index, blog/essays/fragments/media landings, tags index) +
  // series parents (so [[series/Transmissions|…]] previews on hover).
  // Used by src/preview-index.11ty.js to generate /preview-index.json.
  eleventyConfig.addCollection("previewable", (api) => {
    return api.getFilteredByGlob([
      ...CONTENT_GLOBS,
      "src/content/pages/**/*.md",
      SERIES_GLOB,
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
    // Sort by post count descending; tiebreak alphabetically by slug so the
    // order is deterministic when counts match.
    return [...map.values()].sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count;
      return a.tag.localeCompare(b.tag);
    });
  });

  // Author index: every unique author (case-normalized) with the posts that
  // carry it. Same shape as tagList. `author` frontmatter accepts a string
  // OR a string[] (for co-authored / guest posts), normalized the same way
  // as tags. Series parents are intentionally excluded — the author field on
  // a parent is bookkeeping, not authorship of an entry.
  eleventyConfig.addCollection("authorList", (api) => {
    const all = api.getFilteredByGlob(CONTENT_GLOBS);
    const map = new Map();
    for (const item of all) {
      const raw = item.data.author;
      const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
      for (const author of list) {
        const key = slugify(String(author));
        if (!key) continue;
        if (!map.has(key)) {
          map.set(key, {
            author: key,
            displayName: String(author),
            count: 0,
            posts: [],
          });
        }
        const entry = map.get(key);
        entry.count++;
        entry.posts.push(item);
      }
    }
    const SECTION_ORDER = ["blog", "essays", "fragments", "media"];
    for (const entry of map.values()) {
      entry.posts.sort(byDatePublishedDesc);
      // Newest post drives the "last published" timestamp; posts are already
      // sorted newest-first above, so it's just posts[0].
      entry.lastPublished =
        (entry.posts[0] && entry.posts[0].data.date_published) || null;

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
      const leftovers = [...groups.entries()].sort(([a], [b]) =>
        a.localeCompare(b)
      );
      for (const [section, posts] of leftovers) {
        entry.bySection.push({ section, posts });
      }
    }
    // Sort by post count descending; tiebreak alphabetically by slug.
    return [...map.values()].sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count;
      return a.author.localeCompare(b.author);
    });
  });

  // Series parents — each file at src/content/series/<Name>.md is a real,
  // navigable page (/series/<slug>/) with full frontmatter (title,
  // description, image, tags). Sorted newest-first by date_published so
  // the /series/ landing grid shows the most recently created series first.
  eleventyConfig.addCollection("series", (api) => {
    const items = api.getFilteredByGlob(SERIES_GLOB);
    validateCollection(items, "series");
    detectCollisions(items, "series");
    return [...items].sort(byDatePublishedDesc);
  });

  // Membership map: parent URL → array of { post, entryNumber }, sorted
  // newest-first for display. Entry numbers are assigned by date_published
  // ASCENDING (oldest = 1, newest = N), independent of display order. Posts
  // opt in via `series_name: "[[series/<Name>|alias]]"` in frontmatter.
  //
  // The map keys are the resolved parent URLs (e.g. /series/transmissions/)
  // so the series-page layout can look up its members with a single lookup
  // against `page.url` — no slug-matching gymnastics.
  //
  // Side effect: emits build warnings for posts whose `series_name` is set
  // but not a wikilink (plain string) or points at a missing parent file.
  // The post still renders; it just isn't grouped.
  eleventyConfig.addCollection("seriesEntries", (api) => {
    const posts = api.getFilteredByGlob(CONTENT_GLOBS);
    const byUrl = new Map();

    for (const post of posts) {
      const parsed = parseSeriesField(post.data.series_name, CONTENT_ROOT);
      if (parsed.kind === "empty") continue;

      if (parsed.kind === "plainString") {
        console.warn(
          `[fractured-jaw] ${post.inputPath}: series_name is a plain string ` +
          `("${parsed.value}"). Use a wikilink like ` +
          `[[series/<Name>|alias]] so the post can be grouped under a ` +
          `series parent file.`
        );
        continue;
      }

      // kind === "wikilink"
      if (!parsed.url || !parsed.exists) {
        console.warn(
          `[fractured-jaw] ${post.inputPath}: series_name points at a ` +
          `missing series parent (${parsed.vaultPath}). Create ` +
          `src/content/${parsed.vaultPath}.md or fix the wikilink.`
        );
        continue;
      }

      if (!byUrl.has(parsed.url)) byUrl.set(parsed.url, []);
      byUrl.get(parsed.url).push(post);
    }

    // Convert each group to a sorted, numbered list. Numbering uses
    // ascending date_published (oldest = #1); display order is descending
    // (newest first). Tiebreaker on identical dates: inputPath, for
    // build-to-build determinism.
    const result = {};
    for (const [url, group] of byUrl.entries()) {
      const ascending = [...group].sort((a, b) => {
        const da = toMillis(a.data.date_published);
        const db = toMillis(b.data.date_published);
        if (da !== db) return da - db;
        return String(a.inputPath).localeCompare(String(b.inputPath));
      });
      const numberByInputPath = new Map();
      ascending.forEach((post, idx) => {
        numberByInputPath.set(post.inputPath, idx + 1);
      });
      result[url] = [...group]
        .sort(byDatePublishedDesc)
        .map((post) => ({
          post,
          entryNumber: numberByInputPath.get(post.inputPath),
        }));
    }
    return result;
  });

  // ---------- Passthrough copy ----------

  // Static assets copied verbatim to _site/. Listed explicitly so that
  // src/assets/brutalist-framework/ (local reference only) never lands in
  // the build output. Add new subdirs here as needed.
  eleventyConfig.addPassthroughCopy({ "src/assets/css": "assets/css" });
  eleventyConfig.addPassthroughCopy({ "src/assets/js":  "assets/js"  });
  eleventyConfig.addPassthroughCopy({ "src/assets/images": "assets/images" });
  // Vault-side content attachments. The underscore prefix marks the folder as
  // plumbing inside Obsidian; we strip it when copying so the public URL is
  // /attachments/<section>/<slug>/<file>, not /_attachments/... The Obsidian
  // plugin (and hand-placement) writes files at
  //   src/content/_attachments/<section>/<slug>/<file>
  // which exactly mirrors the post's published URL path.
  eleventyConfig.addPassthroughCopy({ "src/content/_attachments": "attachments" });
  eleventyConfig.addPassthroughCopy("CNAME");
  // Crawler hints — robots.txt is the conventional signal, ai.txt is the
  // emerging Spawning-style opt-out for AI training crawlers. Both live
  // at the repo root and ship to the site root.
  eleventyConfig.addPassthroughCopy("robots.txt");
  eleventyConfig.addPassthroughCopy("ai.txt");

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
