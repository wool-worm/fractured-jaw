// Eleventy JavaScript template — emits /radio-compromised.json at build
// time. Mirrors radio-cipher.11ty.js but for the `compromised` channels.
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

const fs = require("fs");
const path = require("path");

const SOURCE_PATH = path.join(__dirname, "content", "_data", "radio-compromised.md");

const FALLBACK_TEMPLATE =
  "This station's operations have been terminated due to violation of " +
  "L M M C code {CODE}, section {SECTION}. By order of the {AUTHORITY}. " +
  "Report dissidents to your nearest party office. " +
  "This message will now repeat.";

function stripFrontmatter(raw) {
  const m = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
  return m ? m[1] : raw;
}

function splitTemplates(body) {
  const parts = body.split(/\r?\n\s*---\s*\r?\n/);
  const cleaned = [];
  for (const p of parts) {
    // Collapse interior whitespace runs into single spaces — TTS reads
    // line breaks as long pauses, which sounds wrong inside a single
    // announcement.
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

class RadioCompromised {
  data() {
    return {
      permalink: "/radio-compromised.json",
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

module.exports = RadioCompromised;
