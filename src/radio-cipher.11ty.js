// Eleventy JavaScript template — emits /radio-cipher.json at build time.
//
// Feeds the `lock` channels of the pirate-radio widget. The source text
// lives at src/content/_local/radio/radio-source.md, which is gitignored
// (see .gitignore and .eleventyignore) — author-only, never ships. This
// emitter reads it if present, splits on `---` lines into individual
// passages, encodes each via A1Z26 (a=01..z=26, space=00, everything
// else skipped), chunks into 5-digit groups, and emits one digit-group
// array per passage. Public artifact contains digits only; the plaintext
// source never enters the published site.
//
// Channel assignment is round-robin: scanning bands ALPHA→DELTA and
// index 0x00→0x3F, the Nth lock channel encountered plays passage
// (N mod passages.length). So passages map to lock channels in
// band-then-index order — write passages in the order you want them
// aired across the dial.
//
// If the source file is absent (e.g. on a fresh checkout where _local/
// has not yet been populated), a baked-in fallback passage is used so
// the lock channels still broadcast something atmospheric.

const fs = require("fs");
const path = require("path");

const SOURCE_PATH = path.join(__dirname, "content", "_local", "radio", "radio-source.md");

const FALLBACK_SOURCE =
  "transmission acknowledged hold position the signal is stable repeat the signal is stable";

// Strip a leading YAML frontmatter block in case the user adds one via
// Obsidian out of habit. The regex is anchored to ^, so body-level
// `---` separators between passages are not consumed.
function stripFrontmatter(raw) {
  const m = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
  return m ? m[1] : raw;
}

// Split body on a `---` line (allowing surrounding whitespace) and drop
// empty segments. Trim each segment to remove leading/trailing blank
// lines without affecting interior whitespace.
function splitPassages(body) {
  const parts = body.split(/\r?\n\s*---\s*\r?\n/);
  const cleaned = [];
  for (const p of parts) {
    const trimmed = p.trim();
    if (trimmed.length) cleaned.push(trimmed);
  }
  return cleaned;
}

// A1Z26 with 00 for space. Non-letter / non-space characters (digits,
// punctuation, markdown syntax) are silently dropped so the source can
// be edited in Obsidian without worrying about exact format. Consecutive
// whitespace collapses to a single 00 separator.
function encodeA1Z26(text) {
  const out = [];
  const lower = text.toLowerCase();
  for (let i = 0; i < lower.length; i++) {
    const code = lower.charCodeAt(i);
    if (code >= 97 && code <= 122) {
      out.push(String(code - 96).padStart(2, "0"));
    } else if (code === 32 || code === 10 || code === 13 || code === 9) {
      if (out.length && out[out.length - 1] !== "00") out.push("00");
    }
  }
  return out.join("");
}

// Chunk digit string into 5-character groups. Pads the last group with
// trailing zeros (which decode as spaces) so every group reads with the
// same cadence.
function chunkIntoGroups(digits) {
  const groups = [];
  for (let i = 0; i < digits.length; i += 5) {
    let group = digits.slice(i, i + 5);
    while (group.length < 5) group += "0";
    groups.push(group);
  }
  return groups;
}

function readSource() {
  try {
    if (fs.existsSync(SOURCE_PATH)) {
      return fs.readFileSync(SOURCE_PATH, "utf8");
    }
  } catch (e) {
    // Fall through to fallback. Don't break the build over a missing
    // author-side file.
  }
  return FALLBACK_SOURCE;
}

class RadioCipher {
  data() {
    return {
      permalink: "/radio-cipher.json",
      eleventyExcludeFromCollections: true,
    };
  }

  render() {
    const raw = readSource();
    const body = stripFrontmatter(raw);
    const sections = splitPassages(body);
    // Guarantee at least one passage so lock channels always have
    // something to broadcast — fall back to the entire body if no
    // separators are present.
    const passages = sections.length ? sections : [body.trim()];
    const encoded = passages.map((p) => chunkIntoGroups(encodeA1Z26(p)));
    return JSON.stringify({ passages: encoded });
  }
}

module.exports = RadioCipher;
