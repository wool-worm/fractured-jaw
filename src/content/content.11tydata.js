// Directory data file: applied to every file under src/content/.
//
// Three responsibilities:
//   1. Compute the published URL via computePermalink(). The Obsidian folder
//      structure (content/<section>/YYYY/MM-MMM/<File>.md) gets flattened to
//      /<section>/<slug>/ for readers.
//   2. Pick the right layout based on which section the file lives in,
//      so individual posts don't have to specify `layout:` in frontmatter.
//      Frontmatter `layout:` still wins if a post sets it explicitly.
//   3. Honor the draft/exclude frontmatter flags:
//        draft:   true → hidden in production, visible during `npm start`
//        exclude: true → hidden everywhere (use for internal docs / WIP refs)
//      A file with permalink:false is not written to disk; combined with
//      eleventyExcludeFromCollections:true it disappears from the build entirely.

const fs = require("fs");
const path = require("path");
const { computePermalink, extractSection, vaultPathToAttachmentUrl, VAULT_ATTACHMENT_DIR } = require("../utils/permalink");
const { reportIssue } = require("../utils/wikilink-report");

const isProduction = process.env.ELEVENTY_ENV === "production";

const CONTENT_ROOT = "src/content";

// Match a single wikilink expression as the entire string: "[[...]]".
// Tolerates surrounding whitespace and an optional `!` prefix (Obsidian
// writes `![[…]]` for embeds and `[[…]]` for plain links; either is fine
// in the frontmatter `image:` slot because we always render it as an <img>).
const FRONTMATTER_IMAGE_WIKILINK_RE = /^\s*!?\[\[([^\]\n]+?)\]\]\s*$/;

// Cache attachment-existence lookups. Same dynamic as in wikilinks.js: just
// keeps the disk quiet when many posts reference the same image.
const attachmentExistsCache = new Map();
function attachmentExists(vaultPath) {
  if (attachmentExistsCache.has(vaultPath)) return attachmentExistsCache.get(vaultPath);
  const stripped = vaultPath.replace(/^\/+/, "").replace(/^(?:_?attachments)\//, "");
  const abs = path.join(CONTENT_ROOT, VAULT_ATTACHMENT_DIR, stripped);
  const exists = fs.existsSync(abs);
  attachmentExistsCache.set(vaultPath, exists);
  return exists;
}

// Parse the frontmatter `image:` field. Returns one of:
//   { kind: "empty" }                                — field absent / blank
//   { kind: "wikilink", url, alt }                   — resolved + file exists
//   { kind: "deadWikilink", offending, reason }      — wikilink form, but
//                                                       unknown section or
//                                                       missing file on disk
//   { kind: "bareString", offending }                — not a wikilink at all
//
// The reporter sits outside this function so the caller can attach host-page
// context (file path, draft / excluded flags) before deciding warn vs. error.
function parseFrontmatterImage(raw) {
  if (raw === undefined || raw === null) return { kind: "empty" };
  if (typeof raw !== "string") return { kind: "bareString", offending: String(raw) };
  const trimmed = raw.trim();
  if (!trimmed) return { kind: "empty" };

  const match = trimmed.match(FRONTMATTER_IMAGE_WIKILINK_RE);
  if (!match) {
    return { kind: "bareString", offending: trimmed };
  }

  // First pipe is caption (alt); second is size. Frontmatter doesn't use
  // size, but we tolerate it being present and ignore the segment.
  const parts = match[1].split("|");
  const vaultPath = parts[0].trim();
  const alt = parts.length >= 2 ? parts[1].trim() : "";
  const url = vaultPathToAttachmentUrl(vaultPath);

  if (!url) {
    return {
      kind: "deadWikilink",
      offending: trimmed,
      reason: "path must start with _attachments/ (or attachments/)",
    };
  }
  if (!attachmentExists(vaultPath)) {
    const stripped = vaultPath.replace(/^\/+/, "").replace(/^(?:_?attachments)\//, "");
    return {
      kind: "deadWikilink",
      offending: trimmed,
      reason: `no file at src/content/_attachments/${stripped}`,
    };
  }
  return { kind: "wikilink", url, alt };
}

// Compute a `{ url, alt }` pair from `data.image`, reporting any issue
// against the host page's input path + draft/excluded flags.
function resolveFrontmatterImage(data) {
  const parsed = parseFrontmatterImage(data.image);
  const file = (data.page && data.page.inputPath) || "(unknown source)";
  const isDraft = data.draft === true;
  const isExcluded = data.exclude === true;

  if (parsed.kind === "empty") return { url: null, alt: "" };

  if (parsed.kind === "bareString") {
    reportIssue({
      kind: "image-frontmatter",
      file,
      offending: `image: ${parsed.offending}`,
      reason: "must be a wikilink (image: \"[[_attachments/<section>/<slug>/<file>|alt text]]\"); bare strings are not allowed",
      isDraft,
      isExcluded,
    });
    return { url: null, alt: "" };
  }

  if (parsed.kind === "deadWikilink") {
    reportIssue({
      kind: "image-frontmatter",
      file,
      offending: `image: ${parsed.offending}`,
      reason: parsed.reason,
      isDraft,
      isExcluded,
    });
    return { url: null, alt: "" };
  }

  return { url: parsed.url, alt: parsed.alt };
}

const LAYOUT_BY_SECTION = {
  blog: "layouts/post.njk",
  essays: "layouts/essay.njk",
  fragments: "layouts/fragment.njk",
  media: "layouts/media.njk",
  pages: "layouts/page.njk",
  series: "layouts/series-page.njk",
};

function shouldExclude(data) {
  if (data.exclude === true) return true;
  if (isProduction && data.draft === true) return true;
  return false;
}

module.exports = {
  eleventyComputed: {
    eleventyExcludeFromCollections: (data) => shouldExclude(data),
    permalink: (data) => {
      if (shouldExclude(data)) return false;
      return computePermalink(data);
    },
    // NOTE: this directory data file always computes the permalink — we do
    // NOT honor frontmatter `permalink:` here. Reading `data.permalink`
    // inside this function returns the function itself (not the static
    // frontmatter value), and returning that confuses Eleventy into using
    // the default filesystem permalink.
    //
    // If a file under src/content/ ever needs to override its URL, the
    // workaround is to move it OUTSIDE src/content/ (the way src/tag.njk
    // works) so this directory data file doesn't apply at all.
    layout: (data) => {
      // Respect explicit layout in frontmatter.
      if (data.layout) return data.layout;
      const section = extractSection(data.page && data.page.filePathStem);
      return LAYOUT_BY_SECTION[section];
    },
    // Convenience: expose the section name to templates so partials can
    // render different things for blog vs media vs pages without re-parsing
    // the file path.
    section: (data) => extractSection(data.page && data.page.filePathStem),
    // page_type controls how the local-graph widget centers its layout:
    //   top      — global view, no centering (home, about, /tags/ index, etc.)
    //   section  — pack all nodes of this section near the center
    //              (used by /blog/, /essays/, /fragments/, /media/ landings)
    //   content  — pin the current node to center, render its neighborhood
    //              (default for actual posts)
    //   tag      — pack all nodes for this tag near the center
    //              (injected into per-tag pages by src/tag.njk)
    // Frontmatter `page_type:` always wins. Defaults: pages/ → top,
    // everything else → content.
    page_type: (data) => {
      if (data.page_type) return data.page_type;
      const section = extractSection(data.page && data.page.filePathStem);
      // pages/ and series/ are navigational hubs — global graph view.
      // Everything else (blog/essays/fragments/media) pins the current node.
      if (section === "pages" || section === "series") return "top";
      return "content";
    },
    // Resolve the frontmatter `image:` field once, before any template
    // reads it. Strict-form: must be a wikilink (`[[_attachments/...|alt]]`)
    // pointing at a real file on disk. Bare strings (URLs, paths) warn in
    // dev and error in prod via [src/utils/wikilink-report.js]. Caption
    // after the pipe is exposed as `image_alt` for templates that want
    // alt text without re-parsing.
    image: (data) => resolveFrontmatterImage(data).url,
    image_alt: (data) => resolveFrontmatterImage(data).alt,
  },
};
