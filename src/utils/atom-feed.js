// Hand-rolled Atom 1.0 feed renderer.
//
// We don't take a dependency on @11ty/eleventy-plugin-rss because the spec
// is small, our entry shape is consistent, and keeping the XML generation
// inline makes it easier for someone new to web dev to read what's being
// emitted to /feed.xml etc.
//
// Atom 1.0 chosen over RSS 2.0 because dates are ISO 8601 (matches our
// frontmatter) and the spec is stricter / cleaner.

const { DateTime } = require("luxon");
const { parseAuthorField, resolveAuthors } = require("./authors");

const CONTENT_ROOT = "src/content";

// XML 1.0 forbids most C0 control characters even when escaped. Strip them
// before encoding so a stray \x01 in pasted content can't break readers.
const XML_INVALID_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;

function escapeXml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(XML_INVALID_CHARS_RE, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toIsoDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const dt = DateTime.fromJSDate(value);
    return dt.isValid ? dt.toUTC().toISO() : null;
  }
  const dt = DateTime.fromISO(String(value));
  return dt.isValid ? dt.toUTC().toISO() : null;
}

// Resolve a relative path to a full URL (most readers tolerate relative
// hrefs inside Atom, but the spec wants absolute, and feed validators
// complain otherwise).
function absUrl(siteUrl, path) {
  if (!path) return siteUrl;
  if (/^https?:\/\//i.test(path)) return path;
  const base = siteUrl.replace(/\/+$/, "");
  const rel = String(path).replace(/^\/+/, "");
  return `${base}/${rel}`;
}

// Resolve a post's author frontmatter into a list of display names.
// `authorsByUrl` is the URL → author-record map built from
// collections.authors (see src/utils/authors.js). When supplied, wikilink
// frontmatter is resolved to author-file titles. defaultAuthor is itself
// a wikilink (or a bare display name as a transitional fallback) and goes
// through the same resolver. The feed always ends up with at least one
// <author> per entry.
function resolveEntryAuthors(data, defaultAuthor, authorsByUrl) {
  if (authorsByUrl) {
    const parsed = parseAuthorField(data.author, CONTENT_ROOT);
    const resolved = resolveAuthors(parsed, mapToArray(authorsByUrl));
    if (resolved.length) return resolved.map((r) => r.displayName);
    // Fall through to defaultAuthor resolution when the post has no
    // author frontmatter.
    if (defaultAuthor) {
      const parsedDefault = parseAuthorField(defaultAuthor, CONTENT_ROOT);
      const resolvedDefault = resolveAuthors(parsedDefault, mapToArray(authorsByUrl));
      if (resolvedDefault.length) return resolvedDefault.map((r) => r.displayName);
    }
  }
  // Legacy / fallback path: treat frontmatter as raw strings. This branch
  // is hit when authorsByUrl wasn't passed (caller hasn't been updated)
  // or when defaultAuthor resolves to nothing. Keeps the renderer from
  // ever emitting a <feed> entry with no <author> block.
  if (Array.isArray(data.author) && data.author.length) {
    return data.author.map((a) => String(a));
  }
  if (data.author) return [String(data.author)];
  return [defaultAuthor ? String(defaultAuthor) : ""];
}

// resolveAuthors expects an array (the iterable Eleventy hands to filters).
// FeedAuthor passes a Map for O(1) URL lookups; both shapes have to work
// through resolveAuthors' internal indexAuthorsByUrl. Cheapest reconciliation:
// convert Map values back to an array here.
function mapToArray(authorsLookup) {
  if (Array.isArray(authorsLookup)) return authorsLookup;
  if (authorsLookup && typeof authorsLookup.values === "function") {
    return [...authorsLookup.values()];
  }
  return [];
}

// Render one <entry>. `item` is an Eleventy collection item.
function renderEntry(item, siteUrl, defaultAuthor, authorsByUrl) {
  const data = item.data || {};
  const url = absUrl(siteUrl, item.url);
  const title = data.title || "(untitled)";
  const published = toIsoDate(data.date_published) || toIsoDate(item.date);
  // <updated> is required by the spec; fall back to published when no
  // explicit date_updated. Clamped so it never precedes <published> —
  // the vault plugin tracks date_updated as file-mtime, which can sit
  // earlier than a forward-dated date_published, and "updated before
  // published" confuses feed readers. (UTC ISO strings compare safely
  // as strings.)
  let updated = toIsoDate(data.date_updated) || published;
  if (published && updated && updated < published) updated = published;

  const authors = resolveEntryAuthors(data, defaultAuthor, authorsByUrl);

  const tags = Array.isArray(data.tags)
    ? data.tags
    : data.tags
    ? [data.tags]
    : [];

  // Rewrite root-relative URLs in the post body to absolute so the feed
  // renders correctly in standalone readers.
  const html = absolutizeUrls(item.templateContent || "", siteUrl);

  const parts = [];
  parts.push("  <entry>");
  parts.push(`    <title>${escapeXml(title)}</title>`);
  parts.push(`    <id>${escapeXml(url)}</id>`);
  parts.push(`    <link rel="alternate" type="text/html" href="${escapeXml(url)}"/>`);
  if (published) parts.push(`    <published>${escapeXml(published)}</published>`);
  if (updated) parts.push(`    <updated>${escapeXml(updated)}</updated>`);
  for (const a of authors) {
    parts.push("    <author>");
    parts.push(`      <name>${escapeXml(a)}</name>`);
    parts.push("    </author>");
  }
  for (const tag of tags) {
    parts.push(`    <category term="${escapeXml(tag)}"/>`);
  }
  if (data.description) {
    parts.push(`    <summary>${escapeXml(data.description)}</summary>`);
  }
  parts.push(`    <content type="html">${escapeXml(html)}</content>`);
  parts.push("  </entry>");
  return parts.join("\n");
}

// Make root-relative hrefs/srcs absolute against siteUrl. Best-effort —
// covers the common cases (<a href="/...">, <img src="/...">) without
// pulling in a full HTML parser.
//
// Body HTML comes from item.templateContent, which is the markdown render
// captured BEFORE the eleventyImageTransformPlugin rewrites <img> tags on
// the final page output. So inline image embeds here still carry the
// input-relative src the wikilinks plugin emits (/content/_attachments/...),
// which is NOT a served path. Rewrite it to the public /attachments/ URL
// (the raw passthrough-copied original, which IS served) so feed readers
// get a working image. Feeds can't use the optimized /img/ variants — those
// only exist via the transform plugin, which doesn't touch feed content.
function absolutizeUrls(html, siteUrl) {
  const base = siteUrl.replace(/\/+$/, "");
  return String(html)
    .replace(/(\ssrc=")\/content\/_attachments\//gi, "$1/attachments/")
    .replace(/(\shref=")\/(?!\/)/gi, `$1${base}/`)
    .replace(/(\ssrc=")\/(?!\/)/gi, `$1${base}/`);
}

// Render a full Atom 1.0 feed.
//
// opts: {
//   id        — required, the feed's stable identifier (usually the feed URL)
//   title     — required
//   subtitle  — optional, human-readable description
//   siteUrl   — required, the site's base URL (e.g. https://fractured-jaw.com)
//   feedUrl   — required, the feed's own URL (used in <link rel="self">)
//   pageUrl   — required, the HTML page this feed mirrors (used in
//               <link rel="alternate">)
//   items     — required, array of Eleventy collection items, newest first
//   defaultAuthor — used when an item has no `author` frontmatter
//   authorsByUrl — optional, URL → author-record map (or the
//                  collections.authors array). When present, item.author
//                  wikilinks are resolved to the author file's title.
// }
function renderAtomFeed(opts) {
  const {
    id,
    title,
    subtitle,
    siteUrl,
    feedUrl,
    pageUrl,
    items,
    defaultAuthor,
    authorsByUrl,
  } = opts;

  // <updated> at the feed level: newest entry's updated/published, or now.
  let feedUpdated = null;
  for (const item of items) {
    const data = item.data || {};
    const candidate =
      toIsoDate(data.date_updated) ||
      toIsoDate(data.date_published) ||
      toIsoDate(item.date);
    if (candidate && (!feedUpdated || candidate > feedUpdated)) {
      feedUpdated = candidate;
    }
  }
  if (!feedUpdated) feedUpdated = DateTime.utc().toISO();

  const lines = [];
  lines.push('<?xml version="1.0" encoding="utf-8"?>');
  lines.push('<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en">');
  lines.push(`  <title>${escapeXml(title)}</title>`);
  if (subtitle) lines.push(`  <subtitle>${escapeXml(subtitle)}</subtitle>`);
  lines.push(`  <id>${escapeXml(id)}</id>`);
  lines.push(`  <link rel="self" type="application/atom+xml" href="${escapeXml(absUrl(siteUrl, feedUrl))}"/>`);
  lines.push(`  <link rel="alternate" type="text/html" href="${escapeXml(absUrl(siteUrl, pageUrl))}"/>`);
  lines.push(`  <updated>${escapeXml(feedUpdated)}</updated>`);
  lines.push("  <generator>fractured-jaw / eleventy</generator>");

  for (const item of items) {
    lines.push(renderEntry(item, siteUrl, defaultAuthor, authorsByUrl));
  }

  lines.push("</feed>");
  return lines.join("\n") + "\n";
}

module.exports = { renderAtomFeed, escapeXml };
