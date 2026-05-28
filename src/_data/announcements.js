// Global data loader for the announcements log shown in the systems widget.
//
// Reads every markdown note under src/content/_announcements/ (recursively,
// since the folder uses year/month subfolders for the author's own
// organization), parses frontmatter + body with gray-matter, and returns a
// reverse-chronological array as the `announcements` global. The systems
// widget partial renders it as a terminal log.
//
// These notes are tracked in git but pipeline-excluded via .eleventyignore,
// so they never render as pages and never touch feeds, search, the graph, or
// tagList. Frontmatter beyond the fields below (e.g. `tags`, `title`) is
// ignored by design — those are for the author's own organization.
//
// Per-note frontmatter (the Obsidian/Templater template targets this):
//   date_created:  ISO 8601  — sort key + the date/time shown in the log
//   date_modified: ISO 8601  — auto-maintained by Obsidian; carried, not shown
//   author:        plain string (e.g. wool-worm) — printed verbatim
//   title:         mandatory in Obsidian, ignored here
//   tags:          author organization only, ignored here
// Field-name aliases are accepted so the loader survives the linter's choices.
//
// Dates are normalized to UTC for display: the build forces UTC everywhere so
// the author's local timezone never leaks (mirrors the isoDate filter). A
// value carrying an offset is converted to UTC; a naive value is read as UTC.

const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");
const { DateTime } = require("luxon");
const { parseWikilink } = require("../utils/wikilinks");

const SOURCE_DIR = path.join(__dirname, "..", "content", "_announcements");

// Dependency-free recursive .md walk so we don't rely on a glob lib or a
// specific Node readdir option.
function collectMarkdown(dir) {
  let out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return out; // folder absent → no announcements
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out = out.concat(collectMarkdown(full));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

function firstDefined(data, keys) {
  for (const k of keys) {
    if (data && data[k] != null && data[k] !== "") return data[k];
  }
  return null;
}

// Resolve the `author` field to a plain display name. The vault authors
// everything as wikilinks, so `author` usually arrives as the quoted string
// "[[authors/<Name>|alias]]". We only need the display text here (the log
// isn't clickable), so reuse the canonical parseWikilink primitive to pull
// the alias (it falls back to the last path segment when there's no pipe).
// A plain string author is used as-is; an array (co-authored) is joined.
const WIKILINK_RE = /^\s*\[\[([^\]\n]+?)\]\]\s*$/;

function oneAuthorName(value) {
  if (value == null) return "";
  const s = String(value).trim();
  const m = s.match(WIKILINK_RE);
  return m ? parseWikilink(m[1]).alias : s;
}

function authorDisplay(raw) {
  const names = (Array.isArray(raw) ? raw : [raw])
    .map(oneAuthorName)
    .filter(Boolean);
  return names.length ? names.join(", ") : "unknown";
}

// Normalize a frontmatter date to a UTC Luxon DateTime, or null. js-yaml
// (via gray-matter) parses an UNQUOTED ISO timestamp into a JS Date object,
// while a quoted value stays a string — handle both. A Date carries an
// absolute instant (so it's expressed in UTC); a string is parsed as ISO,
// converting any offset to UTC and reading a naive value as UTC.
function toUtcDateTime(value) {
  if (value == null || value === "") return null;
  const dt = value instanceof Date
    ? DateTime.fromJSDate(value, { zone: "utc" })
    : DateTime.fromISO(String(value), { zone: "utc" });
  return dt.isValid ? dt : null;
}

module.exports = function () {
  const items = [];

  for (const file of collectMarkdown(SOURCE_DIR)) {
    let parsed;
    try {
      parsed = matter(fs.readFileSync(file, "utf8"));
    } catch (e) {
      continue; // skip an unparseable note rather than fail the whole build
    }
    const data = parsed.data || {};

    const createdRaw = firstDefined(data, ["date_created", "created", "date_published"]);
    const modifiedRaw = firstDefined(data, ["date_modified", "modified", "date_updated"]);
    const author = authorDisplay(firstDefined(data, ["author"]));
    const body = (parsed.content || "").trim();

    const created = toUtcDateTime(createdRaw);

    items.push({
      author,
      body,
      // Epoch millis sort key; undated notes sink to the bottom.
      _sort: created ? created.toMillis() : 0,
      dateDisplay: created ? created.toFormat("yyyy-LL-dd") : "----.--.--",
      timeDisplay: created ? created.toFormat("HH:mm'Z'") : "--:--",
      modified: modifiedRaw ? String(modifiedRaw) : null,
    });
  }

  items.sort((a, b) => b._sort - a._sort); // newest first
  return items;
};
