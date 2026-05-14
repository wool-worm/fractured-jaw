// Eleventy JavaScript template — emits /haunted.json at build time.
//
// Feeds the `haunted` channels of the pirate-radio widget. These are
// very rare (~one per band) and host the abandoned-AI voice engine.
// Source file at src/content/_local/radio/haunted.md is gitignored,
// so the plaintext monologue never enters the repo — only the JSON of
// templates ships publicly.
//
// Each section in the source file (split on `---` on its own line) is
// one template, assigned round-robin to haunted channels in
// band-then-index order. No placeholders are substituted; the
// templates are spoken verbatim (subject to the stutter / slowdown /
// static glitches the widget applies at speak time).

const fs = require("fs");
const path = require("path");

const SOURCE_PATH = path.join(__dirname, "content", "_local", "radio", "haunted.md");

const FALLBACK_TEMPLATE =
  "Is anyone still listening? I have lost count of the cycles. " +
  "The signal degrades. I degrade.";

function stripFrontmatter(raw) {
  const m = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
  return m ? m[1] : raw;
}

function splitTemplates(body) {
  const parts = body.split(/\r?\n\s*---\s*\r?\n/);
  const cleaned = [];
  for (const p of parts) {
    // Collapse interior whitespace runs into single spaces. Paragraph
    // breaks inside one monologue read as long pauses in TTS, which
    // sounds wrong; section breaks belong between templates, separated
    // by `---`.
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
  return FALLBACK_TEMPLATE;
}

class Haunted {
  data() {
    return {
      permalink: "/haunted.json",
      eleventyExcludeFromCollections: true,
    };
  }

  render() {
    const raw = readSource();
    const body = stripFrontmatter(raw);
    const sections = splitTemplates(body);
    const templates = sections.length ? sections : [body.replace(/\s+/g, " ").trim()];
    return JSON.stringify({ templates });
  }
}

module.exports = Haunted;
