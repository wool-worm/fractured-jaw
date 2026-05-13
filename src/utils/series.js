// Parsing for the `series_name` frontmatter field.
//
// Accepted shape (post-redesign):
//   series_name: "[[series/Transmissions|Transmissions]]"
//
// The string must be a wikilink pointing at a file under src/content/series/.
// We resolve it through the same path → URL transform used by inline
// wikilinks (see utils/permalink.js + utils/wikilinks.js) so series
// membership and inline links stay in lockstep.
//
// Return shapes (use `kind` to discriminate):
//   { kind: "empty" }              — field missing or whitespace only
//   { kind: "plainString", value } — set but not a wikilink (warn at build)
//   { kind: "wikilink", vaultPath, alias, url, exists }
//                                    parsed wikilink. `exists` is false if
//                                    the target .md isn't on disk.

const { parseWikilink, vaultPathExists } = require("./wikilinks");
const { vaultPathToUrl } = require("./permalink");

// Match a single wikilink expression as the entire string: "[[...]]".
// Tolerates surrounding whitespace. Does not match if there's extra text
// before/after the brackets (we want strict-form so typos surface).
const WIKILINK_RE = /^\s*\[\[([^\]\n]+?)\]\]\s*$/;

function parseSeriesField(raw, contentRoot) {
  if (typeof raw !== "string") return { kind: "empty" };
  const trimmed = raw.trim();
  if (trimmed === "") return { kind: "empty" };

  const match = trimmed.match(WIKILINK_RE);
  if (!match) {
    return { kind: "plainString", value: trimmed };
  }

  const { vaultPath, alias } = parseWikilink(match[1]);
  const url = vaultPathToUrl(vaultPath);
  const exists = url ? vaultPathExists(vaultPath, contentRoot) : false;

  return { kind: "wikilink", vaultPath, alias, url, exists };
}

module.exports = { parseSeriesField };
