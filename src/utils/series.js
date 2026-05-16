// Parsing for the `series_name` frontmatter field.
//
// Strict form (the only allowed shape):
//   series_name: "[[series/<Name>|alias]]"
//
// Anything else (plain string, missing parent, unknown section) is reported
// through the unified wikilink-report (warn in dev, error in prod for any
// non-draft/non-excluded post). The reporter is invoked by the caller in
// .eleventy.js so it can attach host-page draft/exclude flags before
// deciding warn vs. error.
//
// Return shapes (use `kind` to discriminate):
//   { kind: "empty" }                              field missing or whitespace
//   { kind: "bareString", offending }              set but not a wikilink
//   { kind: "deadWikilink", vaultPath, reason }    wikilink form, parent file
//                                                  not on disk OR parent is
//                                                  draft/excluded (won't ship
//                                                  in production)
//   { kind: "wikilink", vaultPath, alias, url }    parsed + resolved + parent
//                                                  on disk + not excluded

const { parseWikilink, vaultPathExists, vaultPathTargetIsExcluded } = require("./wikilinks");
const { vaultPathToUrl } = require("./permalink");

// Match a single wikilink as the entire string. Tolerates surrounding
// whitespace. Strict-form by design (no extra text before / after the
// brackets).
const WIKILINK_RE = /^\s*\[\[([^\]\n]+?)\]\]\s*$/;

function parseSeriesField(raw, contentRoot) {
  if (typeof raw !== "string") return { kind: "empty" };
  const trimmed = raw.trim();
  if (trimmed === "") return { kind: "empty" };

  const match = trimmed.match(WIKILINK_RE);
  if (!match) {
    return { kind: "bareString", offending: trimmed };
  }

  const { vaultPath, alias } = parseWikilink(match[1]);
  const url = vaultPathToUrl(vaultPath);
  if (!url) {
    return {
      kind: "deadWikilink",
      vaultPath,
      reason: "unknown section or malformed path (expected series/<Name>)",
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
      reason: "series parent is draft or excluded; the series page will 404 in production",
    };
  }

  return { kind: "wikilink", vaultPath, alias, url };
}

module.exports = { parseSeriesField };
