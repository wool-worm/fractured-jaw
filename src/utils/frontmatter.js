// Frontmatter validation rules for content posts.
//
// Required fields cause the build to fail loudly — better than shipping
// a post with no title or no date. Recommended fields produce a warning
// so you notice you forgot, but the build still succeeds.

const REQUIRED = ["title", "date_published"];
const RECOMMENDED_DEFAULT = ["author", "description"];
// Series parents are aggregators, not authored entries. They group posts;
// the individual posts carry the author bylines. Description still matters
// because it appears in the series-card on the /series/ landing.
const RECOMMENDED_FOR_SERIES = ["description"];
const RECOMMENDED_FOR_MEDIA = ["rating"];

function recommendedFieldsFor(inputPath) {
  if (!inputPath) return RECOMMENDED_DEFAULT;
  if (inputPath.includes("/series/")) return RECOMMENDED_FOR_SERIES;
  return RECOMMENDED_DEFAULT;
}

// Check a single Eleventy collection item. Returns { errors, warnings }.
function inspect(item) {
  const errors = [];
  const warnings = [];
  const data = item.data || {};

  for (const field of REQUIRED) {
    if (isMissing(data[field])) {
      errors.push(`missing required frontmatter "${field}"`);
    }
  }
  for (const field of recommendedFieldsFor(item.inputPath)) {
    if (isMissing(data[field])) {
      warnings.push(`missing recommended frontmatter "${field}"`);
    }
  }
  // Media reviews benefit from a rating, but it's optional.
  if (item.inputPath && item.inputPath.includes("/media/")) {
    for (const field of RECOMMENDED_FOR_MEDIA) {
      if (isMissing(data[field])) {
        warnings.push(`missing recommended media frontmatter "${field}"`);
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

// Validate a whole collection. Throws on any errors (with all errors
// aggregated into one message); prints warnings to stderr.
function validateCollection(items, sectionName) {
  const allErrors = [];
  for (const item of items) {
    const { errors, warnings } = inspect(item);
    for (const err of errors) {
      allErrors.push(`  ${item.inputPath}: ${err}`);
    }
    for (const w of warnings) {
      console.warn(`[fractured-jaw] ${item.inputPath}: ${w}`);
    }
  }
  if (allErrors.length > 0) {
    throw new Error(
      `Frontmatter validation failed for "${sectionName}":\n${allErrors.join("\n")}`
    );
  }
}

// Detect URL collisions inside a section. Two posts that resolve to the
// same URL would silently overwrite each other on disk, and would also
// break wikilink resolution. Fail loudly instead.
function detectCollisions(items, sectionName) {
  const seen = new Map();
  for (const item of items) {
    if (!item.url) continue; // excluded items have url === false
    if (seen.has(item.url)) {
      throw new Error(
        `URL collision in section "${sectionName}": ${item.url}\n` +
        `  - ${seen.get(item.url)}\n` +
        `  - ${item.inputPath}\n` +
        `Rename one of these files so they produce different slugs.`
      );
    }
    seen.set(item.url, item.inputPath);
  }
}

module.exports = {
  inspect,
  validateCollection,
  detectCollisions,
};
