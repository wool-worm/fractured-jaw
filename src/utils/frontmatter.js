// Frontmatter validation rules for content posts.
//
// Required fields fail the build (always-fatal severity through the
// build-report so the writer sees every issue in one pass). Recommended
// fields produce a warning so you notice you forgot, but the build still
// succeeds.
//
// URL collisions (two posts that resolve to the same /<section>/<slug>/)
// also go through the build-report at always-fatal severity. Two posts
// at the same URL would silently overwrite each other on disk and break
// every wikilink pointing at one of them.

const { reportIssue } = require("./build-report");

const REQUIRED_DEFAULT = ["title", "date_published"];
// Top-level pages (/, /about/, section landings, ...) are navigation
// surfaces, not dated entries — title is the only hard requirement.
const REQUIRED_FOR_PAGES = ["title"];
const RECOMMENDED_DEFAULT = ["author", "description"];
// Pages carry no author byline; description still matters because it
// drives the meta-description tag (head.njk) for every landing surface.
const RECOMMENDED_FOR_PAGES = ["description"];
// Series parents are aggregators, not authored entries. They group posts;
// the individual posts carry the author bylines. Description still matters
// because it appears in the series-card on the /series/ landing.
const RECOMMENDED_FOR_SERIES = ["description"];
// Author files ARE the author — checking for an `author:` field on an
// author record would be circular. Description still matters because it
// appears under the display name on the /authors/ index.
const RECOMMENDED_FOR_AUTHORS = ["description"];
const RECOMMENDED_FOR_MEDIA = ["rating"];

function recommendedFieldsFor(inputPath) {
  if (!inputPath) return RECOMMENDED_DEFAULT;
  if (inputPath.includes("/series/")) return RECOMMENDED_FOR_SERIES;
  if (inputPath.includes("/authors/")) return RECOMMENDED_FOR_AUTHORS;
  if (inputPath.includes("/pages/")) return RECOMMENDED_FOR_PAGES;
  return RECOMMENDED_DEFAULT;
}

function requiredFieldsFor(inputPath) {
  if (inputPath && inputPath.includes("/pages/")) return REQUIRED_FOR_PAGES;
  return REQUIRED_DEFAULT;
}

// Check a single Eleventy collection item. Returns { errors, warnings }.
function inspect(item) {
  const errors = [];
  const warnings = [];
  const data = item.data || {};

  for (const field of requiredFieldsFor(item.inputPath)) {
    if (isMissing(data[field])) {
      errors.push({ field });
    }
  }
  for (const field of recommendedFieldsFor(item.inputPath)) {
    if (isMissing(data[field])) {
      warnings.push({ field });
    }
  }
  // Media reviews benefit from a rating, but it's optional.
  if (item.inputPath && item.inputPath.includes("/media/")) {
    for (const field of RECOMMENDED_FOR_MEDIA) {
      if (isMissing(data[field])) {
        warnings.push({ field, mediaOnly: true });
      }
    }
  }
  return { errors, warnings };
}

function isMissing(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

// Validate a whole collection. Required-field misses route through the
// build-report at always-fatal severity (one entry per missing field per
// post; aggregated and surfaced together at the end of the build).
// Recommended-field misses still print as warnings.
function validateCollection(items, sectionName) {
  for (const item of items) {
    // Shape check: `tags` must be a YAML list (or absent). The tag
    // collections would tolerate a bare string, but post-card.njk and
    // post-meta.njk iterate `tags` directly, and Nunjucks iterating a
    // string walks it character by character — a scalar tag renders as
    // one tag chip per letter. Same severity model as bare-string
    // author/series_name: warn in dev, fatal in prod unless the post
    // is draft/excluded.
    const rawTags = item.data && item.data.tags;
    if (rawTags !== undefined && rawTags !== null && rawTags !== "" && !Array.isArray(rawTags)) {
      reportIssue({
        kind: "tags-frontmatter",
        file: item.inputPath,
        offending: `tags: ${JSON.stringify(rawTags)}`,
        reason: `must be a YAML list (tags: [one, two]); a bare string would render one tag chip per character (section "${sectionName}")`,
        isDraft: item.data.draft === true,
        isExcluded: item.data.exclude === true,
      });
    }

    const { errors, warnings } = inspect(item);
    for (const err of errors) {
      reportIssue({
        kind: "missing-frontmatter",
        file: item.inputPath,
        offending: err.field,
        reason: `required frontmatter "${err.field}" is missing or empty (section "${sectionName}")`,
        severity: "always-fatal",
      });
    }
    for (const w of warnings) {
      const scope = w.mediaOnly ? "recommended media" : "recommended";
      reportIssue({
        kind: "missing-frontmatter",
        file: item.inputPath,
        offending: w.field,
        reason: `${scope} frontmatter "${w.field}" is missing or empty (advisory only, not required)`,
        severity: "warn-only",
      });
    }
  }
}

// Detect URL collisions inside a section. Two posts that resolve to the
// same URL would silently overwrite each other on disk, and would also
// break wikilink resolution. Always-fatal so the writer can fix every
// collision in one pass.
function detectCollisions(items, sectionName) {
  const seen = new Map();
  for (const item of items) {
    if (!item.url) continue; // excluded items have url === false
    if (seen.has(item.url)) {
      reportIssue({
        kind: "url-collision",
        file: item.inputPath,
        offending: item.url,
        reason:
          `another post in section "${sectionName}" already produces ${item.url} ` +
          `(${seen.get(item.url)}). Rename one of these files so the slugs differ.`,
        severity: "always-fatal",
      });
      continue;
    }
    seen.set(item.url, item.inputPath);
  }
}

module.exports = {
  inspect,
  validateCollection,
  detectCollisions,
};
