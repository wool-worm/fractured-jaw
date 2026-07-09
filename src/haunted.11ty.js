// Eleventy JavaScript template — emits /haunted.json at build time.
//
// Feeds the `haunted` channels of the pirate-radio widget. These are
// very rare (~one per band) and host the abandoned-AI voice engine.
// Source file at src/content/_data/haunted.md is tracked in git but
// excluded from Eleventy's content pipeline via .eleventyignore. The
// monologue templates ship publicly as JSON.
//
// Each section in the source file (split on `---` on its own line) is
// one template, assigned round-robin to haunted channels in
// band-then-index order. No placeholders are substituted; the
// templates are spoken verbatim (subject to the stutter / slowdown /
// static glitches the widget applies at speak time).
//
// Reading/splitting/cleaning lives in src/utils/segmented-note.js
// (shared with the cipher, compromised, and FJR emitters).

const path = require("path");
const { loadSegments } = require("./utils/segmented-note");

const SOURCE_PATH = path.join(__dirname, "content", "_data", "haunted.md");

const FALLBACK_TEMPLATE =
  "Is anyone still listening? I have lost count of the cycles. " +
  "The signal degrades. I degrade.";

class Haunted {
  data() {
    return {
      permalink: "/haunted.json",
      eleventyExcludeFromCollections: true,
    };
  }

  render() {
    const templates = loadSegments(SOURCE_PATH, FALLBACK_TEMPLATE, { collapse: true });
    return JSON.stringify({ templates });
  }
}

module.exports = Haunted;
