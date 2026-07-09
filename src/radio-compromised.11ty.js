// Eleventy JavaScript template — emits /radio-compromised.json at build
// time. Mirrors haunted.11ty.js but for the `compromised` channels.
//
// The source file at src/content/_data/radio-compromised.md contains
// one or more termination-message templates separated by `---` on its
// own line. Each template is a plain string with placeholders:
//
//   {CODE}       — substituted with a 3-digit number (100-999), fixed per channel
//   {SECTION}    — substituted with N + letter, e.g. "12c", fixed per channel
//   {AUTHORITY}  — substituted with a fictional issuing body, fixed per channel
//
// Substitution happens client-side at message-build time. The emitter
// just ships the template strings. Channel assignment is round-robin in
// band-then-index order (same as the cipher emitter).
//
// Reading/splitting/cleaning lives in src/utils/segmented-note.js
// (shared with the cipher, haunted, and FJR emitters).

const path = require("path");
const { loadSegments } = require("./utils/segmented-note");

const SOURCE_PATH = path.join(__dirname, "content", "_data", "radio-compromised.md");

const FALLBACK_TEMPLATE =
  "This station's operations have been terminated due to violation of " +
  "L M M C code {CODE}, section {SECTION}. By order of the {AUTHORITY}. " +
  "Report dissidents to your nearest party office. " +
  "This message will now repeat.";

class RadioCompromised {
  data() {
    return {
      permalink: "/radio-compromised.json",
      eleventyExcludeFromCollections: true,
    };
  }

  render() {
    const templates = loadSegments(SOURCE_PATH, FALLBACK_TEMPLATE, { collapse: true });
    return JSON.stringify({ templates });
  }
}

module.exports = RadioCompromised;
