// Eleventy config for fractured-jaw.com.
//
// Most "magic" lives in three places:
//   - src/content/content.11tydata.js: computes per-page permalinks and
//     handles the draft/exclude frontmatter flags.
//   - src/utils/permalink.js: the URL transform itself
//     (content/<section>/YYYY/MM-MMM/<File>.md → /<section>/<slug>/).
//   - This file: collections, filters, watch targets.

const { eleventyImageTransformPlugin } = require("@11ty/eleventy-img");
const { DateTime } = require("luxon");
const slugify = require("./src/utils/slugify");
const { CONTENT_SECTIONS } = require("./src/utils/permalink");
const {
  validateCollection,
  detectCollisions,
} = require("./src/utils/frontmatter");
const wikilinkPlugin = require("./src/utils/wikilinks");
const { parseSeriesField } = require("./src/utils/series");
const {
  parseAuthorField,
  resolveAuthors,
  indexAuthorsByUrl,
} = require("./src/utils/authors");
const { reportIssue, flush: flushBuildReport } = require("./src/utils/build-report");
const { buildBandcampEmbed } = require("./src/assets/js/bandcamp-embed");
const { resolveAlbumLink, isWikilinkString } = require("./src/utils/album-note");
const pathModule = require("path");
const CONTENT_ROOT_ABS = pathModule.join(__dirname, "src", "content");

const CONTENT_ROOT = "src/content";
const SERIES_GLOB = "src/content/series/**/*.md";
const AUTHORS_GLOB = "src/content/authors/**/*.md";

// Glob patterns that match every published content file.
const CONTENT_GLOBS = CONTENT_SECTIONS.map(
  (section) => `src/content/${section}/**/*.md`
);

module.exports = function (eleventyConfig) {
  // ---------- Build-issue aggregation ----------

  // Every reportIssue() call across the build that resolves to fatal
  // severity gets collected in src/utils/build-report.js's
  // pendingFatalErrors. After Eleventy finishes its render pass, we
  // flush — throwing a single aggregated Error with every blocking
  // issue from this build so the writer can fix them all in one pass
  // rather than fix-build-fix-build cycling on the first one.
  // Files are still written to _site/ before flush throws; that's
  // harmless because the npm script exits non-zero and CI gates on it.
  eleventyConfig.on("eleventy.after", () => flushBuildReport());

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

  // ISO 8601 string for <time datetime="..."> attributes and article time
  // meta. Forced to UTC so the emitted offset is always "Z" — local-zone
  // emission would leak the build machine's timezone (a geolocation hint)
  // into every rendered page. The Atom feed renderer does the same thing
  // via its own toIsoDate helper; this keeps HTML output consistent. GHA
  // runners already build in UTC, so this mostly matters for local builds
  // viewed through the dev server.
  eleventyConfig.addFilter("isoDate", (value) => {
    const dt = toDateTime(value);
    return dt && dt.isValid ? dt.toUTC().toISO() : "";
  });

  // Current year (used in footer copyright).
  eleventyConfig.addShortcode("currentYear", () =>
    DateTime.now().toFormat("yyyy")
  );

  // Bandcamp inline embed. Call shapes:
  //   {% bandcamp "450473414" %}                          → album id, default preset
  //   {% bandcamp "450473414", "slim" %}                  → album id, named preset
  //   {% bandcamp { track: "12345", preset: "slim" } %}   → track id, object form
  //   {% bandcamp "[[_data/media/music/<artist>/<album>/album]]" %}   → wikilink
  //   {% bandcamp "[[_data/media/music/.../album]]", "slim" %}
  // Default preset is big-art-tracks (full player with artwork + tracklist),
  // suitable for a feature embed at the top of a review. Authors switch to
  // "slim" for inline track references inside body prose. Wikilink form
  // resolves to the album note's frontmatter at build time and uses its
  // bandcamp_track_id (preferred when set) or bandcamp_album_id. Builder /
  // preset definitions live in src/assets/js/bandcamp-embed.js (shared with
  // the radio widget); wikilink resolution lives in src/utils/album-note.js
  // (shared with the radio emitter).
  eleventyConfig.addShortcode("bandcamp", function (idOrOpts, maybePreset) {
    var opts;
    if (typeof idOrOpts === "string") {
      opts = { album: idOrOpts };
      if (typeof maybePreset === "string") opts.preset = maybePreset;
    } else {
      opts = idOrOpts || {};
    }

    // Wikilink form: resolve the album note and replace the id field with
    // the actual numeric id from the note's frontmatter. Track id wins when
    // both are set on the note (more specific embed).
    var rawValue = opts.album || opts.track;
    if (typeof rawValue === "string" && isWikilinkString(rawValue)) {
      var hostFile = (this.page && this.page.inputPath) || "(bandcamp shortcode call)";
      var resolved = resolveAlbumLink(rawValue, hostFile, CONTENT_ROOT_ABS);
      if (!resolved) return "";  // reportIssue already called; emit nothing
      var fm = resolved.frontmatter;
      if (fm.bandcamp_track_id) {
        opts.track = String(fm.bandcamp_track_id);
        delete opts.album;
      } else {
        opts.album = String(fm.bandcamp_album_id);
        delete opts.track;
      }
    }

    var id = opts.album || opts.track;
    if (!id || !/^\d+$/.test(String(id))) {
      throw new Error(
        "bandcamp shortcode: album or track id must be a numeric string (got " +
        JSON.stringify(id) + ")"
      );
    }
    var embed = buildBandcampEmbed(opts);
    return '<iframe class="bandcamp-embed-inline" src="' + embed.src +
      '" height="' + embed.height + '" width="100%" style="border:0;"' +
      ' seamless loading="lazy" title="Bandcamp player"></iframe>';
  });

  // ---------- Responsive image transform plugin ----------
  //
  // Rewrites <img src="..."> tags in the rendered HTML to <picture> markup
  // with multi-format srcsets so the browser picks the right variant for
  // the viewport. Operates at the HTML output stage (after Nunjucks render),
  // which sidesteps the Nunjucks limitation where async shortcodes inside
  // {% include %} inside {% for %} silently produce empty output.
  //
  // Templates pass `image_src` (input-relative path computed by
  // src/content/content.11tydata.js, e.g. /content/_attachments/<...>) as
  // the src attribute. The plugin resolves that to a disk file under the
  // input dir, processes it through Sharp, and emits /img/<hash>-<w>w.<ext>
  // variants. `image` (the public /attachments/ URL) stays reserved for
  // og:image meta tags etc. that need the absolute deployed URL.
  //
  // Widths cover small mobile cards through retina desktop heroes.
  // Formats: webp (~30% smaller than jpeg) with a jpeg fallback for
  // browsers without webp support. Skipping avif — encode time is
  // significantly slower and the savings vs. webp are modest at these
  // image sizes.
  //
  // failOnError: true so a missing-file or unreadable image fails the
  // build loudly rather than shipping a broken/mangled <img>.
  eleventyConfig.addPlugin(eleventyImageTransformPlugin, {
    extensions: "html",
    formats: ["webp", "jpeg"],
    widths: [400, 800, 1200, 1600],
    urlPath: "/img/",
    defaultAttributes: {
      loading: "lazy",
      decoding: "async",
    },
    failOnError: true,
  });

  // Slugify (exposed in templates so tag links can compute /tags/<slug>/).
  eleventyConfig.addFilter("slug", slugify);

  // Take the first N items of an array. Used in templates to cap "recent
  // posts" lists without computing slices in JS.
  eleventyConfig.addFilter("take", (value, n) =>
    Array.isArray(value) ? value.slice(0, n) : value
  );

  // Render a media review rating as filled + empty stars. Used by
  // post-meta.njk and post-card.njk for /media/ posts. Accepts:
  //   - a bare number (e.g. 4) — treated as out of 5
  //   - a fraction string (e.g. "8/10") — preserves the denominator
  //   - anything else (letter grade like "B+") — returned as-is
  // Rounds to the nearest whole star. Empty input returns empty string.
  eleventyConfig.addFilter("starRating", (value) => {
    if (value === null || value === undefined || value === "") return "";
    const STAR_FILLED = "★"; // ★
    const STAR_EMPTY  = "☆"; // ☆
    const toStars = (filled, total) => {
      const f = Math.max(0, Math.min(total, Math.round(filled)));
      return STAR_FILLED.repeat(f) + STAR_EMPTY.repeat(total - f);
    };
    if (typeof value === "number") return toStars(value, 5);
    const str = String(value).trim();
    const fraction = str.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+)$/);
    if (fraction) {
      return toStars(parseFloat(fraction[1]), parseInt(fraction[2], 10));
    }
    const asNum = parseFloat(str);
    if (!isNaN(asNum) && /^-?\d+(\.\d+)?$/.test(str)) {
      return toStars(asNum, 5);
    }
    return str;
  });

  // Promote a possibly-relative URL to an absolute one by prefixing site.url.
  // Used in head.njk for og:image (Open Graph rejects relative paths). Passes
  // through any value that already starts with http:// or https://.
  eleventyConfig.addFilter("absoluteUrl", (value, base) => {
    if (!value) return "";
    const s = String(value);
    if (/^https?:\/\//i.test(s)) return s;
    if (!base) return s;
    return String(base).replace(/\/$/, "") + (s.startsWith("/") ? s : "/" + s);
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
  // empty/missing/bare-string/dead-pointer). Filter form so post-meta
  // can use it inline. Validation reporting happens once per build inside
  // the `seriesEntries` collection below; this filter stays silent so we
  // don't double-report.
  eleventyConfig.addFilter("seriesNameToUrl", (value) => {
    const parsed = parseSeriesField(value, CONTENT_ROOT);
    if (parsed.kind === "wikilink") return parsed.url;
    return null;
  });

  // Resolve an `author` frontmatter value (string OR string[] of
  // "[[authors/<Name>|alias]]" wikilinks) into an array of display records
  // pulled from collections.authors. Drops entries that didn't parse or
  // didn't resolve — the validator inside the `authorPosts` collection
  // below has already reported those, so this filter stays silent to
  // avoid double-reporting.
  //
  // Each returned record: { slug, displayName, url, image, image_alt }.
  // Templates iterate and read .displayName + .url for bylines.
  eleventyConfig.addFilter("authorEntries", (rawAuthor, authorsCollection) => {
    const parsed = parseAuthorField(rawAuthor, CONTENT_ROOT);
    return resolveAuthors(parsed, authorsCollection);
  });

  // Look up a single author record by its URL (e.g. "/authors/wool-worm/").
  // Used by the author-page layout to fetch the page's own record when
  // rendering the author header. Returns null when no match.
  eleventyConfig.addFilter("authorByUrl", (authorsCollection, url) => {
    if (!Array.isArray(authorsCollection) || !url) return null;
    return authorsCollection.find((item) => item.url === url) || null;
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
  // series parents + author records (so [[series/…|…]] and
  // [[authors/…|…]] previews on hover). Used by
  // src/preview-index.11ty.js to generate /preview-index.json.
  eleventyConfig.addCollection("previewable", (api) => {
    return api.getFilteredByGlob([
      ...CONTENT_GLOBS,
      "src/content/pages/**/*.md",
      SERIES_GLOB,
      AUTHORS_GLOB,
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

  // Author records — each file at src/content/authors/<Name>.md is a real,
  // navigable author page (/authors/<slug>/) with full frontmatter (title
  // = display name, description, optional image) and an optional bio body.
  // Mirrors the `series` collection shape. Sorted alphabetically by slug
  // so /authors/ renders in a stable order regardless of join date.
  eleventyConfig.addCollection("authors", (api) => {
    const items = api.getFilteredByGlob(AUTHORS_GLOB);
    validateCollection(items, "authors");
    detectCollisions(items, "authors");
    return [...items].sort((a, b) => {
      const an = (a.data && a.data.title) || "";
      const bn = (b.data && b.data.title) || "";
      return String(an).localeCompare(String(bn));
    });
  });

  // Membership map: author URL → array of posts authored, newest-first.
  // Posts opt in via `author: "[[authors/<Name>|alias]]"` (or an array of
  // such wikilinks for co-authored work). Parallel to seriesEntries, but
  // a post can appear under multiple authors, and there is no
  // entry-number concept — authors don't sequence their own work.
  //
  // Side effect: emits build warnings for posts whose `author` field is
  // bare-string, malformed, points at a missing author file, or points at
  // a draft author. Each bad entry inside an array is reported individually
  // so the writer sees every issue in one pass.
  eleventyConfig.addCollection("authorPosts", (api) => {
    const posts = api.getFilteredByGlob(CONTENT_GLOBS);
    const byUrl = new Map();

    for (const post of posts) {
      const parsed = parseAuthorField(post.data.author, CONTENT_ROOT);
      if (parsed.kind === "empty") continue;

      const ctx = {
        file: post.inputPath,
        isDraft: post.data.draft === true,
        isExcluded: post.data.exclude === true,
      };

      for (const entry of parsed.entries) {
        if (entry.kind === "bareString") {
          reportIssue({
            kind: "author",
            file: ctx.file,
            offending: `author entry: ${entry.offending}`,
            reason: "must be a wikilink (\"[[authors/<Name>|alias]]\"); bare strings are not allowed (and YAML requires the wikilink be quoted)",
            isDraft: ctx.isDraft,
            isExcluded: ctx.isExcluded,
          });
          continue;
        }

        if (entry.kind === "deadWikilink") {
          reportIssue({
            kind: "author",
            file: ctx.file,
            offending: `author entry: [[${entry.vaultPath}]]`,
            reason: entry.reason,
            isDraft: ctx.isDraft,
            isExcluded: ctx.isExcluded,
          });
          continue;
        }

        // kind === "wikilink": resolved and target exists. Add the post
        // under that author's URL.
        if (!byUrl.has(entry.url)) byUrl.set(entry.url, []);
        const list = byUrl.get(entry.url);
        if (!list.includes(post)) list.push(post);
      }
    }

    // Sort each author's posts newest-first by date_published, with
    // inputPath as a deterministic tiebreaker.
    const result = {};
    for (const [url, group] of byUrl.entries()) {
      result[url] = [...group].sort((a, b) => {
        const da = toMillis(b.data.date_published) - toMillis(a.data.date_published);
        if (da !== 0) return da;
        return String(a.inputPath).localeCompare(String(b.inputPath));
      });
    }
    return result;
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

      const ctx = {
        file: post.inputPath,
        isDraft: post.data.draft === true,
        isExcluded: post.data.exclude === true,
      };

      if (parsed.kind === "bareString") {
        reportIssue({
          kind: "series-name",
          file: ctx.file,
          offending: `series_name: ${parsed.offending}`,
          reason: "must be a wikilink (series_name: \"[[series/<Name>|alias]]\"); bare strings are not allowed",
          isDraft: ctx.isDraft,
          isExcluded: ctx.isExcluded,
        });
        continue;
      }

      if (parsed.kind === "deadWikilink") {
        reportIssue({
          kind: "series-name",
          file: ctx.file,
          offending: `series_name: [[${parsed.vaultPath}]]`,
          reason: parsed.reason,
          isDraft: ctx.isDraft,
          isExcluded: ctx.isExcluded,
        });
        continue;
      }

      // kind === "wikilink": resolved and target file exists
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
  // Google Search Console domain-ownership verification. The filename
  // is the verification token Google issued; it must be reachable at
  // /google4fac35aefa691e66.html on the live site to verify.
  eleventyConfig.addPassthroughCopy("google4fac35aefa691e66.html");

  // ---------- Watch targets ----------

  // Rebuild on changes to utility code or static assets.
  eleventyConfig.addWatchTarget("src/utils/");
  eleventyConfig.addWatchTarget("src/assets/");
  // CSS modules consumed by src/site-css.11ty.js. Eleventy's automatic
  // template-dependency tracking doesn't see fs.readFileSync calls, so
  // changes to src/_css/*.css need this explicit watch entry to re-trigger
  // the bundle on edit.
  eleventyConfig.addWatchTarget("src/_css/");
  // Announcement notes read by src/_data/announcements.js via fs (the folder
  // is .eleventyignore'd, so Eleventy's content watcher skips it). Explicit
  // watch so adding/editing an announcement rebuilds the dev server.
  eleventyConfig.addWatchTarget("src/content/_announcements/");

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
