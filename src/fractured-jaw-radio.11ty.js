// Eleventy JavaScript template — emits /fractured-jaw-radio.json at
// build time. Mirrors radio-cipher.11ty.js / radio-compromised.11ty.js
// but for the Fractured Jaw Radio station (the one fixed channel in
// the dial, located at FJR_BAND / FJR_INDEX in radio-widget.js).
//
// The source file at src/content/_data/fractured-jaw-radio.md contains
// one or more script segments separated by `---` on its own line.
// Unlike the cipher emitter, no encoding is applied — segments ship as
// plain strings and TTS speaks them directly.

const fs = require("fs");
const path = require("path");

const SOURCE_PATH = path.join(
  __dirname, "content", "_data", "fractured-jaw-radio.md"
);

// Fallback script used if the source file is missing (e.g. on a
// partial checkout).
const FALLBACK_SEGMENT =
  "This is Fractured Jaw Radio. You are tuned to the only signal still " +
  "operating on this band. Transmissions resume hourly. Stand by.";

function stripFrontmatter(raw) {
  const m = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
  return m ? m[1] : raw;
}

function splitSegments(body) {
  const parts = body.split(/\r?\n\s*---\s*\r?\n/);
  const cleaned = [];
  for (const p of parts) {
    // Collapse interior whitespace runs into single spaces — TTS reads
    // raw line breaks as long pauses, which sounds wrong inside a
    // single segment. Paragraph-style breaks belong between segments
    // (separated by `---`), not inside one.
    const flattened = p.replace(/\s+/g, " ").trim();
    if (flattened.length) cleaned.push(flattened);
  }
  return cleaned;
}

function readSource() {
  try {
    if (fs.existsSync(SOURCE_PATH)) {
      return fs.readFileSync(SOURCE_PATH, "utf8");
    }
  } catch (e) {
    // Fall through to fallback.
  }
  return FALLBACK_SEGMENT;
}

class FracturedJawRadio {
  data() {
    return {
      permalink: "/fractured-jaw-radio.json",
      eleventyExcludeFromCollections: true,
    };
  }

  render() {
    const raw = readSource();
    const body = stripFrontmatter(raw);
    const sections = splitSegments(body);
    const segments = sections.length ? sections : [body.replace(/\s+/g, " ").trim()];
    return JSON.stringify({ segments });
  }
}

module.exports = FracturedJawRadio;
