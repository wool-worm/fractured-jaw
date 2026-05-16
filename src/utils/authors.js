// Parsing for the `author` frontmatter field on content posts.
//
// Strict form (the only allowed shapes):
//   author: "[[authors/<Name>|alias]]"                          (single author)
//   author:
//     - "[[authors/<Name>|alias]]"
//     - "[[authors/<Other>|alias]]"                             (co-authored)
//
// Each entry MUST be quoted in YAML, because bare `[[…]]` is a YAML flow
// sequence (`[[wool-worm]]` parses as `[["wool-worm"]]`, not as a string).
// The strict validator rejects anything that doesn't arrive here as a
// string per entry. Wikilink alias after the pipe is tolerated but ignored
// for display — the author file's `title` frontmatter is the source of
// truth for the display name.
//
// Anything else (plain string author, unquoted brackets, missing parent
// file, draft/excluded parent) is reported through the unified
// build-report (warn in dev, error in prod for any non-draft/non-excluded
// host post). The reporter is invoked by the caller in .eleventy.js so
// it can attach host-page draft/exclude flags before deciding warn vs.
// error.
//
// Per-entry return shape mirrors parseSeriesField so the caller can route
// each entry through reportIssue() the same way:
//   { kind: "bareString",   offending }              not a wikilink at all
//   { kind: "deadWikilink", vaultPath, reason }      bad section / missing
//                                                    parent / draft parent
//   { kind: "wikilink",     vaultPath, alias, url }  resolved + parent exists
//
// Outer return shape:
//   { kind: "empty" }                                field missing / blank
//   { kind: "list", entries: [ ... per-entry ... ] } one or more entries

const { parseWikilink, vaultPathExists, vaultPathTargetIsExcluded } = require("./wikilinks");
const { vaultPathToUrl } = require("./permalink");

// Match a single wikilink as the entire string. Tolerates surrounding
// whitespace. Strict-form: no extra text before / after the brackets.
const WIKILINK_RE = /^\s*\[\[([^\]\n]+?)\]\]\s*$/;

function parseSingleEntry(raw, contentRoot) {
  if (typeof raw !== "string") {
    return { kind: "bareString", offending: String(raw) };
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    // Empty string in an array slot is treated as bareString so the writer
    // gets a clear "you have an empty author entry" rather than a silent
    // drop.
    return { kind: "bareString", offending: "" };
  }

  const match = trimmed.match(WIKILINK_RE);
  if (!match) {
    return { kind: "bareString", offending: trimmed };
  }

  const { vaultPath, alias } = parseWikilink(match[1]);

  // Must point at the authors/ section specifically. Wikilinks to any
  // other section (blog/, essays/, series/, etc.) are bad data — the
  // author field is for author records, not arbitrary links.
  const firstSeg = vaultPath.split("/")[0];
  if (firstSeg !== "authors") {
    return {
      kind: "deadWikilink",
      vaultPath,
      reason: "must point at the authors/ section (e.g. [[authors/<Name>]])",
    };
  }

  const url = vaultPathToUrl(vaultPath);
  if (!url) {
    return {
      kind: "deadWikilink",
      vaultPath,
      reason: "unknown section or malformed path (expected authors/<Name>)",
    };
  }
  if (!vaultPathExists(vaultPath, contentRoot)) {
    return {
      kind: "deadWikilink",
      vaultPath,
      reason: `no file at src/content/${vaultPath}.md`,
    };
  }
  if (vaultPathTargetIsExcluded(vaultPath, contentRoot)) {
    return {
      kind: "deadWikilink",
      vaultPath,
      reason: "author parent is draft or excluded; the author page will 404 in production",
    };
  }

  return { kind: "wikilink", vaultPath, alias, url };
}

// Top-level entry point. Accepts string OR string[] (YAML flow or block
// list of quoted wikilinks). Anything not in {string, string[]} of strings
// degrades to a single bareString report — the writer sees one clear error
// instead of a cryptic shape mismatch.
function parseAuthorField(raw, contentRoot) {
  if (raw === undefined || raw === null) return { kind: "empty" };
  if (typeof raw === "string") {
    if (raw.trim() === "") return { kind: "empty" };
    return { kind: "list", entries: [parseSingleEntry(raw, contentRoot)] };
  }
  if (Array.isArray(raw)) {
    if (raw.length === 0) return { kind: "empty" };
    return {
      kind: "list",
      entries: raw.map((entry) => parseSingleEntry(entry, contentRoot)),
    };
  }
  // Anything else (number, boolean, plain object) — report as bareString
  // so the writer knows the value isn't a recognized form.
  return {
    kind: "list",
    entries: [{ kind: "bareString", offending: String(raw) }],
  };
}

// Given the per-entry parse result(s) for one post's `author` field and
// the collections.authors list, return the resolved display records in
// frontmatter order. Drops entries that didn't resolve (those are already
// reported by the validator). Each record has:
//   { slug, displayName, url, image, image_alt }
//
// The authorsCollection is the array Eleventy passes in for
// collections.authors — each item is a content file with .url, .data,
// etc. We index it by .url so lookup is O(1) per post.
function resolveAuthors(parsed, authorsCollection) {
  if (!parsed || parsed.kind !== "list") return [];
  const byUrl = indexAuthorsByUrl(authorsCollection);
  const result = [];
  for (const entry of parsed.entries) {
    if (entry.kind !== "wikilink") continue;
    const record = byUrl.get(entry.url);
    if (!record) continue; // shouldn't happen — vaultPathExists already checked
    const data = record.data || {};
    result.push({
      slug: lastPathSegment(entry.url),
      displayName: data.title || lastPathSegment(entry.url),
      url: entry.url,
      image: data.image || null,
      image_alt: data.image_alt || "",
    });
  }
  return result;
}

// Cache the URL → author-item map per authorsCollection identity. The
// collection array reference is stable across a single build, so a
// WeakMap keyed on it avoids rebuilding the lookup for every post.
const indexCache = new WeakMap();
function indexAuthorsByUrl(authorsCollection) {
  if (!Array.isArray(authorsCollection)) return new Map();
  const cached = indexCache.get(authorsCollection);
  if (cached) return cached;
  const map = new Map();
  for (const item of authorsCollection) {
    if (item && item.url) map.set(item.url, item);
  }
  indexCache.set(authorsCollection, map);
  return map;
}

function lastPathSegment(url) {
  // "/authors/wool-worm/" → "wool-worm"
  const trimmed = String(url || "").replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

module.exports = {
  parseAuthorField,
  resolveAuthors,
  indexAuthorsByUrl,
};
