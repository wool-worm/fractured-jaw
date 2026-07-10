// Eleventy JavaScript template — emits /radio-cipher.json at build time.
//
// Feeds the `lock` channels of the pirate-radio widget. The source text
// lives at src/content/_data/radio-source.md (tracked in git but
// excluded from Eleventy's content pipeline via .eleventyignore). The
// plaintext never ships as plaintext: this emitter splits on `---`
// lines into individual passages, encodes each via A1Z26 (a=01..z=26,
// space=00, everything else skipped), chunks into 5-digit groups, and
// emits one digit-group array per passage. The public artifact
// contains digits only.
//
// Channel assignment is round-robin: scanning bands ALPHA→DELTA and
// index 0x00→0x3F, the Nth lock channel encountered plays passage
// (N mod passages.length). So passages map to lock channels in
// band-then-index order — write passages in the order you want them
// aired across the dial.
//
// Reading/splitting lives in src/utils/segmented-note.js (shared with
// the haunted, compromised, and FJR emitters). collapse:false keeps
// interior whitespace intact — the A1Z26 encoder below handles
// whitespace itself (runs collapse to a single 00 separator), unlike
// the TTS emitters that flatten it for speech pacing.

const path = require("path");
const { loadSegments } = require("./utils/segmented-note");

const SOURCE_PATH = path.join(__dirname, "content", "_data", "radio-source.md");

const FALLBACK_SOURCE =
  "transmission acknowledged hold position the signal is stable repeat the signal is stable";

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

class RadioCipher {
  data() {
    return {
      permalink: "/radio-cipher.json",
      eleventyExcludeFromCollections: true,
    };
  }

  render() {
    const passages = loadSegments(SOURCE_PATH, FALLBACK_SOURCE, { collapse: false });
    const encoded = passages.map((p) => chunkIntoGroups(encodeA1Z26(p)));
    return JSON.stringify({ passages: encoded });
  }
}

module.exports = RadioCipher;
