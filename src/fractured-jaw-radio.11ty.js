// Eleventy JavaScript template — emits /fractured-jaw-radio.json at
// build time. Mirrors haunted.11ty.js / radio-compromised.11ty.js but
// for the Fractured Jaw Radio station (the one fixed channel in the
// dial, located at FJR_BAND / FJR_INDEX in radio-widget.js).
//
// The source file at src/content/_data/fractured-jaw-radio.md contains
// one or more script segments separated by `---` on its own line.
// Unlike the cipher emitter, no encoding is applied — segments ship as
// plain strings and TTS speaks them directly.
//
// Reading/splitting/cleaning lives in src/utils/segmented-note.js
// (shared with the cipher, compromised, and haunted emitters).

const path = require("path");
const { loadSegments } = require("./utils/segmented-note");

const SOURCE_PATH = path.join(
  __dirname, "content", "_data", "fractured-jaw-radio.md"
);

// Fallback script used if the source file is missing (e.g. on a
// partial checkout).
const FALLBACK_SEGMENT =
  "This is Fractured Jaw Radio. You are tuned to the only signal still " +
  "operating on this band. Transmissions resume hourly. Stand by.";

class FracturedJawRadio {
  data() {
    return {
      permalink: "/fractured-jaw-radio.json",
      eleventyExcludeFromCollections: true,
    };
  }

  render() {
    const segments = loadSegments(SOURCE_PATH, FALLBACK_SEGMENT, { collapse: true });
    return JSON.stringify({ segments });
  }
}

module.exports = FracturedJawRadio;
