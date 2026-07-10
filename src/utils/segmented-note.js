// Shared reader for "segmented data notes" — the vault-side markdown files
// under src/content/_data/ that the radio emitters consume (fractured-jaw
// radio script, haunted monologues, compromised templates, cipher source).
//
// One file = one or more segments separated by `---` on its own line.
// A leading YAML frontmatter block (added by Obsidian out of habit) is
// stripped; the split regex is anchored to full lines, so body-level `---`
// separators are unaffected by the frontmatter strip and vice versa.
//
// Cleaning modes:
//   collapse: true   — interior whitespace runs collapse to single spaces.
//                      For TTS sources: line breaks read as long pauses,
//                      which sounds wrong inside one spoken segment.
//   collapse: false  — trim only, interior whitespace preserved. For the
//                      cipher source, where the A1Z26 encoder handles
//                      whitespace itself.
//
// Always returns at least one segment: when no `---` separators are present
// the entire body is the single segment, and when the file is missing or
// unreadable the caller's fallback string is processed the same way (so the
// radio still broadcasts something atmospheric on a partial checkout).

const fs = require("fs");

function stripFrontmatter(raw) {
  const m = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
  return m ? m[1] : raw;
}

function clean(text, collapse) {
  return collapse ? text.replace(/\s+/g, " ").trim() : text.trim();
}

function loadSegments(sourcePath, fallback, opts) {
  const collapse = !(opts && opts.collapse === false);

  let raw;
  try {
    raw = fs.existsSync(sourcePath)
      ? fs.readFileSync(sourcePath, "utf8")
      : fallback;
  } catch (e) {
    raw = fallback; // don't break the build over a missing author-side file
  }

  const body = stripFrontmatter(raw);
  const segments = body
    .split(/\r?\n\s*---\s*\r?\n/)
    .map((part) => clean(part, collapse))
    .filter((part) => part.length);

  return segments.length ? segments : [clean(body, collapse)];
}

module.exports = { loadSegments };
