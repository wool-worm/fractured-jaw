const slugify = require("./slugify");

// Sections that map directly to /<section>/<slug>/ URLs.
const CONTENT_SECTIONS = ["blog", "essays", "fragments", "media"];

// "pages" is special: it produces top-level URLs (/about/, /contributors/, /).
const PAGES_SECTION = "pages";

// "series" is a navigational section — each file at src/content/series/<Name>.md
// is the parent page for a series of posts. Routes to /series/<slug>/ via the
// same filename-slug transform as the content sections, but kept out of
// CONTENT_SECTIONS so it doesn't accidentally end up in tagList, featured,
// or the all_content cross-section feed.
const SERIES_SECTION = "series";

// "authors" mirrors series: each file at src/content/authors/<Name>.md is a
// real author record with bio body + frontmatter (title = display name).
// Routes to /authors/<slug>/. Kept out of CONTENT_SECTIONS so author files
// don't appear in cross-section feeds or featured rows — they're navigation,
// not authored entries themselves.
const AUTHORS_SECTION = "authors";

const KNOWN_SECTIONS = [...CONTENT_SECTIONS, PAGES_SECTION, SERIES_SECTION, AUTHORS_SECTION];

// Attachments: stored at src/content/_attachments/ in the vault, served at
// /attachments/ on the site (passthrough copy in .eleventy.js strips the
// underscore). The underscore inside the vault marks it as plumbing so it
// reads as "not a section I write in" to the author; the public URL doesn't
// expose that convention. Both VAULT_ and URL_ forms are accepted by
// vaultPathToAttachmentUrl so frontmatter or inline references with either
// spelling resolve correctly.
const VAULT_ATTACHMENT_DIR = "_attachments";
const URL_ATTACHMENT_DIR = "attachments";

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

// Compute the served URL for an attachment given its vault path. Accepts
// either spelling — "_attachments/blog/foo/img.png" (what Obsidian writes
// for a fully scoped link) or "attachments/blog/foo/img.png" (tolerant
// fallback in case a writer types the URL-side form by hand). Returns null
// for anything else so callers can fall back to plaintext / dead-link
// handling.
function vaultPathToAttachmentUrl(vaultPath) {
  if (!vaultPath || typeof vaultPath !== "string") return null;
  const trimmed = vaultPath.trim().replace(/^\/+/, "");
  const slashIdx = trimmed.indexOf("/");
  if (slashIdx === -1) return null;
  const head = trimmed.slice(0, slashIdx);
  const tail = trimmed.slice(slashIdx + 1);
  if (head !== VAULT_ATTACHMENT_DIR && head !== URL_ATTACHMENT_DIR) return null;
  if (!tail) return null;
  return `/${URL_ATTACHMENT_DIR}/${tail}`;
}

// Compute the INPUT-relative source path for an attachment — the form the
// eleventyImageTransformPlugin needs to locate the file on disk. The plugin
// joins the Eleventy input dir (src/) to this path, so it must point at the
// real on-disk location: src/content/_attachments/<tail>.
//
// Accepts the same two spellings as vaultPathToAttachmentUrl (_attachments/
// or attachments/), and returns null for anything else. Distinct from
// vaultPathToAttachmentUrl, which returns the PUBLIC URL (/attachments/<tail>)
// used for og:image meta and as the eventual served path. A template/markdown
// renderer passes THIS value as <img src> when it wants the transform plugin
// to optimize the image; the plugin rewrites it to /img/<hash>... in the
// final HTML, so this intermediate path never reaches the reader.
function vaultPathToAttachmentSrc(vaultPath) {
  if (!vaultPath || typeof vaultPath !== "string") return null;
  const trimmed = vaultPath.trim().replace(/^\/+/, "");
  const slashIdx = trimmed.indexOf("/");
  if (slashIdx === -1) return null;
  const head = trimmed.slice(0, slashIdx);
  const tail = trimmed.slice(slashIdx + 1);
  if (head !== VAULT_ATTACHMENT_DIR && head !== URL_ATTACHMENT_DIR) return null;
  if (!tail) return null;
  return `/content/${VAULT_ATTACHMENT_DIR}/${tail}`;
}

module.exports = {
  computePermalink,
  extractSection,
  vaultPathToUrl,
  vaultPathToAttachmentUrl,
  vaultPathToAttachmentSrc,
  CONTENT_SECTIONS,
  PAGES_SECTION,
  SERIES_SECTION,
  AUTHORS_SECTION,
  KNOWN_SECTIONS,
  VAULT_ATTACHMENT_DIR,
  URL_ATTACHMENT_DIR,
};
