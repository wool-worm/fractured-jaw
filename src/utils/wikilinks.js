// markdown-it plugin: turn Obsidian-style scoped wikilinks into real <a> tags,
// and Obsidian-style scoped image embeds (`![[...]]`) into real <img>/<figure>
// markup pointing at the passthrough-copied attachments directory.
//
// Link syntax (always fully scoped, with explicit alias after the pipe):
//   [[blog/2026/02-Feb/First Test Post|click here]]
//                                       ^^^^^^^^^^ alias (link text)
//   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ vault path (relative to src/content/)
//
// Output: <a href="/blog/first-test-post/" class="wikilink">click here</a>
//
// Image-embed syntax (Image Captions plugin format):
//   ![[_attachments/blog/post-name/cover.jpg]]                  bare image
//   ![[_attachments/blog/post-name/cover.jpg|caption]]          caption (alt + figcaption)
//   ![[_attachments/blog/post-name/cover.jpg||400]]             sized only
//   ![[_attachments/blog/post-name/cover.jpg||400x300]]         width × height
//   ![[_attachments/blog/post-name/cover.jpg|caption|400]]      both
//
// First pipe is always the caption, second is always the size. Size is a
// pixel width (e.g. "400") or "WxH" (e.g. "400x300"). Caption doubles as
// the alt attribute when present; bare images ship with empty alt
// (decorative-only).
//
// Output (with caption):
//   <figure class="image-embed">
//     <img src="/attachments/blog/post-name/cover.jpg" alt="caption" style="width:400px">
//     <figcaption>caption</figcaption>
//   </figure>
//
// Output (no caption):
//   <img src="/attachments/blog/post-name/cover.jpg" alt="" class="image-embed" style="width:400px">
//
// Resolution rules (links):
//   - Vault path's first segment is the section (blog/essays/fragments/
//     media/pages); date folders are stripped; filename is slugified.
//     Same transform as src/content/<file> → published URL.
//   - Missing alias falls back to the filename portion of the path.
//   - Dead target (no matching .md on disk) renders the alias as plaintext
//     and emits a build warning. Doesn't break readers.
//
// Resolution rules (image embeds):
//   - Vault path's first segment must be `_attachments` (what Obsidian writes
//     for fully scoped attachment links) or `attachments` (tolerated typo).
//     Resolves via vaultPathToAttachmentUrl() in permalink.js.
//   - Dead target (no file on disk under src/content/_attachments/...) emits
//     a warning and renders an HTML comment placeholder so the missing image
//     is visible in build output without crashing.

const fs = require("fs");
const path = require("path");
const { vaultPathToUrl, vaultPathToAttachmentUrl, VAULT_ATTACHMENT_DIR } = require("./permalink");

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

// Check whether an attachment file exists on disk. Vault path is in the
// form "_attachments/blog/post/img.png" (or the URL-side "attachments/...").
// The actual file always lives under src/content/_attachments/ regardless
// of which spelling the writer used.
function attachmentExists(vaultPath, contentRoot) {
  const cacheKey = `attachment::${contentRoot}::${vaultPath}`;
  if (existsCache.has(cacheKey)) return existsCache.get(cacheKey);
  // Normalize whichever prefix was used back to the on-disk folder name.
  const stripped = vaultPath.replace(/^\/+/, "").replace(/^(?:_?attachments)\//, "");
  const abs = path.join(contentRoot, VAULT_ATTACHMENT_DIR, stripped);
  const exists = fs.existsSync(abs);
  existsCache.set(cacheKey, exists);
  return exists;
}

// Parse "path|caption|size" or any prefix thereof. First pipe is always
// the caption; second is always the size. Empty caption with a size uses
// "path||size". Returns size as { width, height } in px, or null when
// unparseable. Anything malformed in the size slot is dropped silently —
// the image still renders, just without inline sizing.
function parseImageEmbed(inner) {
  const parts = inner.split("|");
  const vaultPath = parts[0].trim();
  const caption = parts.length >= 2 ? parts[1].trim() : "";
  const sizeRaw = parts.length >= 3 ? parts[2].trim() : "";
  return { vaultPath, caption, size: parseSize(sizeRaw) };
}

function parseSize(raw) {
  if (!raw) return null;
  // "400" or "400x300" (case-insensitive on the x).
  const m = raw.match(/^(\d+)(?:\s*[xX]\s*(\d+))?$/);
  if (!m) return null;
  const width = parseInt(m[1], 10);
  const height = m[2] ? parseInt(m[2], 10) : null;
  if (!width || width <= 0) return null;
  return { width, height: height && height > 0 ? height : null };
}

function styleFromSize(size) {
  if (!size) return "";
  if (size.height) return `width:${size.width}px;height:${size.height}px`;
  return `width:${size.width}px`;
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
    const ch0 = state.src.charCodeAt(start);

    // Two forms at this position:
    //   ![[…]]  — image embed, opens at start+1
    //   [[…]]   — content link, opens at start
    const isImage =
      ch0 === BANG &&
      state.src.charCodeAt(start + 1) === OPEN &&
      state.src.charCodeAt(start + 2) === OPEN;
    const isLink =
      !isImage &&
      ch0 === OPEN &&
      state.src.charCodeAt(start + 1) === OPEN;
    if (!isImage && !isLink) return false;

    // Min lengths: ![[x]] = 6 chars; [[x]] = 5.
    if (isImage && start + 5 >= max) return false;
    if (isLink && start + 4 >= max) return false;

    const openAt = isImage ? start + 1 : start;
    const end = state.src.indexOf("]]", openAt + 2);
    if (end === -1 || end >= max) return false;
    const inner = state.src.slice(openAt + 2, end);
    if (inner.includes("\n") || inner.includes("[[")) return false;
    if (inner.length === 0) return false;

    if (silent) {
      state.pos = end + 2;
      return true;
    }

    if (isImage) {
      emitImageEmbed(state, inner, contentRoot);
    } else {
      emitContentLink(state, inner, contentRoot);
    }

    state.pos = end + 2;
    return true;
  };
}

function emitContentLink(state, inner, contentRoot) {
  const { vaultPath, alias } = parseWikilink(inner);
  const url = vaultPathToUrl(vaultPath);
  const exists = url ? vaultPathExists(vaultPath, contentRoot) : false;

  if (!url || !exists) {
    const where = (state.env && state.env.page && state.env.page.inputPath) || "(unknown source)";
    const warnKey = `link::${where}::${vaultPath}`;
    if (!warnedThisBuild.has(warnKey)) {
      const reason = !url ? "unknown section or malformed path" : "no matching .md file in src/content/";
      console.warn(`[fractured-jaw] dead wikilink in ${where}: [[${inner}]] — ${reason}`);
      warnedThisBuild.add(warnKey);
    }
    const token = state.push("text", "", 0);
    token.content = alias;
    return;
  }

  const open = state.push("link_open", "a", 1);
  open.attrs = [
    ["href", url],
    ["class", "wikilink"],
  ];
  const text = state.push("text", "", 0);
  text.content = alias;
  state.push("link_close", "a", -1);
}

function emitImageEmbed(state, inner, contentRoot) {
  const { vaultPath, caption, size } = parseImageEmbed(inner);
  const url = vaultPathToAttachmentUrl(vaultPath);
  const exists = url ? attachmentExists(vaultPath, contentRoot) : false;

  if (!url || !exists) {
    const where = (state.env && state.env.page && state.env.page.inputPath) || "(unknown source)";
    const warnKey = `image::${where}::${vaultPath}`;
    if (!warnedThisBuild.has(warnKey)) {
      const reason = !url
        ? "path must start with _attachments/ (or attachments/)"
        : `no file at src/content/_attachments/${vaultPath.replace(/^\/+/, "").replace(/^(?:_?attachments)\//, "")}`;
      console.warn(`[fractured-jaw] dead image embed in ${where}: ![[${inner}]] — ${reason}`);
      warnedThisBuild.add(warnKey);
    }
    // Render a visible placeholder rather than swallowing the embed silently —
    // a broken image in dev is a stronger signal than a missing one.
    const token = state.push("html_inline", "", 0);
    token.content = `<!-- broken image embed: ${state.md.utils.escapeHtml(inner)} -->`;
    return;
  }

  const esc = state.md.utils.escapeHtml;
  const style = styleFromSize(size);
  const styleAttr = style ? ` style="${esc(style)}"` : "";

  if (caption) {
    // NOTE: <figure> is block-level and `<p><figure>...</figure></p>` is invalid
    // HTML5 nesting. Browsers auto-close the `<p>` when they hit `<figure>` so
    // the rendered DOM ends up correct; HTML5 validators will still grumble.
    // Acceptable trade for keeping this in the inline ruler — a block-level
    // rule would also work but doubles the code. Revisit if validation matters.
    const html =
      `<figure class="image-embed">` +
      `<img src="${esc(url)}" alt="${esc(caption)}"${styleAttr}>` +
      `<figcaption>${esc(caption)}</figcaption>` +
      `</figure>`;
    const token = state.push("html_inline", "", 0);
    token.content = html;
  } else {
    const html = `<img src="${esc(url)}" alt="" class="image-embed"${styleAttr}>`;
    const token = state.push("html_inline", "", 0);
    token.content = html;
  }
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
