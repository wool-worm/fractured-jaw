const slugify = require("./slugify");

// Sections that map directly to /<section>/<slug>/ URLs.
const CONTENT_SECTIONS = ["blog", "essays", "fragments", "media"];

// "pages" is special: it produces top-level URLs (/about/, /contributors/, /).
const PAGES_SECTION = "pages";

const KNOWN_SECTIONS = [...CONTENT_SECTIONS, PAGES_SECTION];

// Extract the section name (first directory under src/content/) from an Eleventy
// `page.filePathStem`. With input dir = "src", the stem looks like
//   "/content/blog/2026/05-May/My Great Post"
//   "/content/pages/about"
// — leading slash, no extension, src/ stripped but content/ preserved. We strip
// the content/ prefix here so callers see the section as the first segment.
function extractSection(filePathStem) {
  return stemSegments(filePathStem)[0] || null;
}

function stemSegments(filePathStem) {
  if (!filePathStem) return [];
  const segments = filePathStem.split("/").filter(Boolean);
  if (segments[0] === "content") segments.shift();
  return segments;
}

// Compute the published URL for a content file.
//
// For blog/essays/fragments/media:
//   src/content/blog/2026/05-May/My Great Post.md → /blog/my-great-post/
//   (date folders are stripped, filename is slugified)
//
// For pages:
//   src/content/pages/index.md  → /
//   src/content/pages/about.md  → /about/
//
// Throws if the file lives directly under src/content/ (no section).
function computePermalink(data) {
  const stem = data.page && data.page.filePathStem;
  if (!stem) return undefined;

  const segments = stemSegments(stem);
  const section = segments[0];
  const fileName = segments[segments.length - 1];

  if (!KNOWN_SECTIONS.includes(section)) {
    throw new Error(
      `Unknown section "${section}" for ${data.page.inputPath}. ` +
      `Files must live under one of: ${KNOWN_SECTIONS.join(", ")}.`
    );
  }

  if (section === PAGES_SECTION) {
    if (fileName === "index") return "/";
    return `/${slugify(fileName)}/`;
  }

  return `/${section}/${slugify(fileName)}/`;
}

// Compute the published URL for a wikilink target — given the raw vault path
// the writer typed inside [[...]] (e.g. "blog/2026/02-Feb/First Test Post"),
// produce the URL the link should point to (/blog/first-test-post/).
//
// Returns null if the path is malformed or the section is unknown — the
// caller should treat that as a dead link and fall back to plaintext.
function vaultPathToUrl(vaultPath) {
  if (!vaultPath || typeof vaultPath !== "string") return null;
  const segments = vaultPath.split("/").filter(Boolean);
  if (segments.length < 2) return null;

  const section = segments[0];
  const fileName = segments[segments.length - 1];

  if (!KNOWN_SECTIONS.includes(section)) return null;

  if (section === PAGES_SECTION) {
    if (fileName === "index") return "/";
    return `/${slugify(fileName)}/`;
  }

  return `/${section}/${slugify(fileName)}/`;
}

module.exports = {
  computePermalink,
  extractSection,
  vaultPathToUrl,
  CONTENT_SECTIONS,
  PAGES_SECTION,
  KNOWN_SECTIONS,
};
