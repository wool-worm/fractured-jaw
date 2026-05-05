// markdown-it plugin: turn Obsidian-style scoped wikilinks into real <a> tags.
//
// Syntax (always fully scoped, with explicit alias after the pipe):
//   [[blog/2026/02-Feb/First Test Post|click here]]
//                                       ^^^^^^^^^^ alias (link text)
//   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ vault path (relative to src/content/)
//
// Output:
//   <a href="/blog/first-test-post/" class="wikilink">click here</a>
//
// Resolution rules:
//   - The vault path's first segment is the section (blog/essays/fragments/
//     media/pages); date folders in between get stripped; the filename is
//     slugified into the URL slug. (Same transform as src/content/<file> →
//     published URL — see permalink.js for the canonical logic.)
//   - If the alias is missing (just [[path]]), the filename is used as link text.
//   - If the target file doesn't exist on disk, render the alias as plaintext
//     and emit a build-time warning. Dead links are visible in build logs but
//     don't break readers.
//   - `![[path|alias]]` (image embed) is intentionally NOT handled here —
//     when a future phase adds Obsidian attachment support, this is where
//     to extend.

const fs = require("fs");
const path = require("path");
const { vaultPathToUrl } = require("./permalink");

const OPEN = 0x5b; // [
const BANG = 0x21; // !

// Module-level cache: vault path → boolean (file exists). Cleared per build
// is unnecessary — Eleventy spawns a fresh Node process for each build, and
// the dev server invalidates between rebuilds via require cache. fs.existsSync
// is fast enough that this cache is more about keeping logs tidy (warn once
// per dead link per build) than about performance.
const existsCache = new Map();
const warnedThisBuild = new Set();

function vaultPathExists(vaultPath, contentRoot) {
  const cacheKey = `${contentRoot}::${vaultPath}`;
  if (existsCache.has(cacheKey)) return existsCache.get(cacheKey);
  const abs = path.join(contentRoot, `${vaultPath}.md`);
  const exists = fs.existsSync(abs);
  existsCache.set(cacheKey, exists);
  return exists;
}

function parseWikilink(content) {
  const pipeIdx = content.indexOf("|");
  if (pipeIdx === -1) {
    const trimmed = content.trim();
    // No alias supplied — fall back to the filename portion of the path.
    const lastSlash = trimmed.lastIndexOf("/");
    const fallback = lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed;
    return { vaultPath: trimmed, alias: fallback };
  }
  return {
    vaultPath: content.slice(0, pipeIdx).trim(),
    alias: content.slice(pipeIdx + 1).trim(),
  };
}

function makeWikilinkRule(options) {
  const contentRoot = options.contentRoot;

  return function wikilinkRule(state, silent) {
    const start = state.pos;
    const max = state.posMax;

    // Need at least "[[x]]" — five chars minimum.
    if (start + 4 >= max) return false;
    if (state.src.charCodeAt(start) !== OPEN) return false;
    if (state.src.charCodeAt(start + 1) !== OPEN) return false;

    // Skip if preceded by `!` so `![[image]]` is left alone for future
    // attachment-handling. Without this, my rule would consume the brackets
    // and the leading `!` would render as a stray exclamation mark.
    if (start > 0 && state.src.charCodeAt(start - 1) === BANG) return false;

    // Find closing `]]`. Bail if the wikilink spans newlines or contains
    // nested `[[` — those aren't well-formed wikilinks.
    const end = state.src.indexOf("]]", start + 2);
    if (end === -1 || end >= max) return false;
    const inner = state.src.slice(start + 2, end);
    if (inner.includes("\n") || inner.includes("[[")) return false;
    if (inner.length === 0) return false;

    if (silent) {
      // Silent mode = "would you handle this?" without producing tokens.
      state.pos = end + 2;
      return true;
    }

    const { vaultPath, alias } = parseWikilink(inner);
    const url = vaultPathToUrl(vaultPath);
    const exists = url ? vaultPathExists(vaultPath, contentRoot) : false;

    if (!url || !exists) {
      // Dead link: warn once, render the alias as plaintext.
      const warnKey = `${state.env && state.env.page && state.env.page.inputPath} :: ${vaultPath}`;
      if (!warnedThisBuild.has(warnKey)) {
        const where = (state.env && state.env.page && state.env.page.inputPath) || "(unknown source)";
        const reason = !url ? "unknown section or malformed path" : "no matching .md file in src/content/";
        console.warn(`[fractured-jaw] dead wikilink in ${where}: [[${inner}]] — ${reason}`);
        warnedThisBuild.add(warnKey);
      }
      const token = state.push("text", "", 0);
      token.content = alias;
    } else {
      const open = state.push("link_open", "a", 1);
      open.attrs = [
        ["href", url],
        ["class", "wikilink"],
      ];
      const text = state.push("text", "", 0);
      text.content = alias;
      state.push("link_close", "a", -1);
    }

    state.pos = end + 2;
    return true;
  };
}

function plugin(md, options = {}) {
  if (!options.contentRoot) {
    throw new Error("wikilinks plugin requires options.contentRoot");
  }
  // Register before `link` so we get first crack at `[[`. Without this,
  // markdown-it's stock link/reference rules can match the inner brackets
  // and produce confused output.
  md.inline.ruler.before("link", "wikilink", makeWikilinkRule(options));
}

module.exports = plugin;
module.exports.parseWikilink = parseWikilink;
module.exports.vaultPathExists = vaultPathExists;
