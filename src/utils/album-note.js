// Shared resolver for wikilinks that point at album notes under
// src/content/_data/media/music/. Used by:
//   - src/radio-music.11ty.js   — when a station pointer carries `album:`
//   - .eleventy.js {% bandcamp %} shortcode — when the call passes a wikilink
//   - .eleventy.js {% spotify %} shortcode  — same pattern, different ids
//
// Album notes are gitignored-pipeline data files (not published pages), so
// the resolver only validates wikilink shape + file existence + returns the
// parsed frontmatter. Service-specific id validation (bandcamp_album_id vs
// spotify_album_id etc.) belongs at the call site, since each consumer
// requires different fields. Draft/exclude frontmatter checks are skipped
// (they're never relevant for data notes).
//
// Failed resolves route through reportIssue at fatal-in-prod severity, so a
// typo in a station pointer or a review shortcode halts the prod build but
// just warns in dev.

const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");
const { parseWikilink, vaultPathExists } = require("./wikilinks");
const { reportIssue } = require("./build-report");

const WIKILINK_RE = /^\s*\[\[([^\]\n]+?)\]\]\s*$/;

// Cache keyed by absolute file path so the same album note isn't re-parsed
// repeatedly during a build (the emitter and the shortcode may both hit it).
const fmCache = new Map();
function readFrontmatter(absPath) {
  if (fmCache.has(absPath)) return fmCache.get(absPath);
  let data = null;
  try {
    data = matter(fs.readFileSync(absPath, "utf8")).data || {};
  } catch (e) {
    data = null;
  }
  fmCache.set(absPath, data);
  return data;
}

function isWikilinkString(s) {
  return typeof s === "string" && WIKILINK_RE.test(s);
}

// raw: the wikilink string (e.g. "[[_data/media/music/skee-mask/compro/album]]")
// hostFile: the source file that contains the wikilink, for diagnostic
//   messages (e.g. "src/content/_data/radio-music.md" or a review file path)
// contentRoot: absolute path to src/content/
// Returns { frontmatter, vaultPath } on success, null on any validation
// failure (reportIssue already called).
function resolveAlbumLink(raw, hostFile, contentRoot) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  const m = s.match(WIKILINK_RE);
  if (!m) {
    reportIssue({
      kind: "album-link",
      file: hostFile,
      offending: s,
      reason: "album link must be a strict wikilink (`[[_data/media/music/<artist>/<album>/album]]`)",
      isDraft: false,
      isExcluded: false,
    });
    return null;
  }

  const { vaultPath } = parseWikilink(m[1]);
  const cleanPath = vaultPath.replace(/\.md$/i, "");
  if (!vaultPathExists(cleanPath, contentRoot)) {
    reportIssue({
      kind: "album-link",
      file: hostFile,
      offending: `[[${m[1]}]]`,
      reason: "no matching .md file under src/content/",
      isDraft: false,
      isExcluded: false,
    });
    return null;
  }

  const absPath = path.join(contentRoot, `${cleanPath}.md`);
  const frontmatter = readFrontmatter(absPath) || {};
  return { frontmatter, vaultPath: cleanPath };
}

module.exports = {
  resolveAlbumLink,
  isWikilinkString,
  WIKILINK_RE,
};
