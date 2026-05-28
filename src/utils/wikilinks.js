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
//     <img src="/content/_attachments/blog/post-name/cover.jpg" alt="caption" style="width:400px" sizes="400px">
//     <figcaption>caption</figcaption>
//   </figure>
//
// Output (no caption):
//   <img src="/content/_attachments/blog/post-name/cover.jpg" alt="" class="image-embed" style="width:400px" sizes="400px">
//
// The emitted <img src> is the INPUT-relative attachment path (via
// vaultPathToAttachmentSrc), NOT the public /attachments/ URL. This lets
// the eleventyImageTransformPlugin (registered in .eleventy.js) locate the
// source file on disk and rewrite the <img> to a <picture> with webp + jpeg
// srcset variants in the final HTML. The reader never sees the intermediate
// /content/_attachments/ path — the plugin replaces it with /img/<hash>...
// The `sizes` attribute reflects the embed's display width so the browser
// can pick the right variant; bare/uncapped embeds fall back to the
// column-width pattern used by heroes and cards.
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
const {
  vaultPathToUrl,
  vaultPathToAttachmentUrl,
  vaultPathToAttachmentSrc,
  VAULT_ATTACHMENT_DIR,
} = require("./permalink");
const { reportIssue } = require("./build-report");

const OPEN = 0x5b; // [
const BANG = 0x21; // !

// Module-level cache: vault path → boolean (file exists). Cleared per build
// is unnecessary — Eleventy spawns a fresh Node process for each build, and
// the dev server invalidates between rebuilds via require cache. fs.existsSync
// is fast enough that this cache is just there to avoid hammering the disk
// during a single build with many references to the same target.
const existsCache = new Map();

// Pull host-page context off the markdown-it `state.env` Eleventy supplies.
// We need the input path (to attribute errors), plus draft/exclude flags so
// the reporter can suppress prod errors for posts that won't ship anyway.
//
// Eleventy 3.x exposes the full data cascade AS the markdown-it env object
// (not nested under env.data). `env.page` is a property carrying inputPath,
// url, etc. `env.draft` / `env.exclude` are the frontmatter flags. The
// `page.data` fallback is a defensive catch in case Eleventy ever moves
// where the cascade lives.
function envContext(state) {
  const env = (state && state.env) || {};
  const page = env.page || {};
  const data = (page.data && typeof page.data === "object") ? page.data : env;
  return {
    file: page.inputPath || env.inputPath || "(unknown source)",
    isDraft: data.draft === true,
    isExcluded: data.exclude === true,
  };
}

function vaultPathExists(vaultPath, contentRoot) {
  const cacheKey = `${contentRoot}::${vaultPath}`;
  if (existsCache.has(cacheKey)) return existsCache.get(cacheKey);
  const abs = path.join(contentRoot, `${vaultPath}.md`);
  const exists = fs.existsSync(abs);
  existsCache.set(cacheKey, exists);
  return exists;
}

// Check whether the wikilink TARGET file carries `draft: true` or
// `exclude: true` in its frontmatter. A published host post linking at an
// excluded target would render a live <a> in dev (drafts visible) but the
// URL would 404 in production. Strictly a YAML-head scan — we don't want
// to instantiate a full markdown parser per target.
const targetExcludedCache = new Map();
function vaultPathTargetIsExcluded(vaultPath, contentRoot) {
  const cacheKey = `${contentRoot}::${vaultPath}`;
  if (targetExcludedCache.has(cacheKey)) return targetExcludedCache.get(cacheKey);
  const abs = path.join(contentRoot, `${vaultPath}.md`);
  let excluded = false;
  try {
    const content = fs.readFileSync(abs, "utf8");
    const head = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
    if (head) {
      // Match the frontmatter line for `draft:` or `exclude:` evaluating to
      // a truthy literal. We accept `true`, `True`, or `yes` (the same set
      // YAML parses as boolean true). Anything else, including quoted
      // strings like "true", is treated as not-excluded — matches the rest
      // of the codebase, which checks strict `=== true`.
      const truthy = /^\s*(draft|exclude)\s*:\s*(true|True|yes)\s*$/m;
      excluded = truthy.test(head[1]);
    }
  } catch (e) {
    excluded = false;
  }
  targetExcludedCache.set(cacheKey, excluded);
  return excluded;
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

// The `sizes` attribute the eleventyImageTransformPlugin needs to choose a
// responsive variant. When the embed specifies a pixel width, the displayed
// image is that wide, so `sizes` is just that width. Without an explicit
// width the image fills its column, so fall back to the same viewport-based
// sizes pattern heroes and cards use.
function sizesFromSize(size) {
  if (size && size.width) return `${size.width}px`;
  return "(max-width: 720px) 100vw, 720px";
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
    const ctx = envContext(state);
    let reason;
    if (!url) {
      // Special-case: writer probably meant an image embed but forgot the
      // leading `!`. The `_?attachments/` prefix is never a valid section
      // for a content link.
      if (/^_?attachments\//.test(vaultPath)) {
        reason = "looks like an image embed missing the leading '!'. Use ![[_attachments/...]] to render as an image";
      } else {
        reason = "unknown section or malformed path";
      }
    } else {
      reason = "no matching .md file in src/content/";
    }
    reportIssue({
      kind: "wikilink",
      file: ctx.file,
      offending: `[[${inner}]]`,
      reason,
      isDraft: ctx.isDraft,
      isExcluded: ctx.isExcluded,
    });
    const token = state.push("text", "", 0);
    token.content = alias;
    return;
  }

  // Target file exists on disk — but if it's draft or excluded, it won't
  // ship in production, so a live <a> here would 404 once deployed. The
  // reporter still treats host draft/exclude as warn-only, matching the
  // existing rule.
  if (vaultPathTargetIsExcluded(vaultPath, contentRoot)) {
    const ctx = envContext(state);
    reportIssue({
      kind: "wikilink",
      file: ctx.file,
      offending: `[[${inner}]]`,
      reason: "target is draft or excluded; the URL will 404 in production",
      isDraft: ctx.isDraft,
      isExcluded: ctx.isExcluded,
    });
    // Fall through to render as a live link anyway — in dev the target
    // page IS reachable, so the link works. In prod, the reporter has
    // already thrown for non-draft hosts and the build halts.
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
    const ctx = envContext(state);
    reportIssue({
      kind: "image-embed",
      file: ctx.file,
      offending: `![[${inner}]]`,
      reason: !url
        ? "path must start with _attachments/ (or attachments/)"
        : `no file at src/content/_attachments/${vaultPath.replace(/^\/+/, "").replace(/^(?:_?attachments)\//, "")}`,
      isDraft: ctx.isDraft,
      isExcluded: ctx.isExcluded,
    });
    // Render a visible placeholder rather than swallowing the embed silently.
    // A broken image in dev is a stronger signal than a missing one.
    const token = state.push("html_inline", "", 0);
    token.content = `<!-- broken image embed: ${state.md.utils.escapeHtml(inner)} -->`;
    return;
  }

  const esc = state.md.utils.escapeHtml;
  const style = styleFromSize(size);
  const styleAttr = style ? ` style="${esc(style)}"` : "";
  // Input-relative path for the transform plugin (resolves under src/).
  // We already confirmed url + on-disk existence above, so this resolves
  // too; fall back to the public url defensively if it somehow doesn't.
  const src = vaultPathToAttachmentSrc(vaultPath) || url;
  const sizesAttr = ` sizes="${esc(sizesFromSize(size))}"`;

  if (caption) {
    // NOTE: <figure> is block-level and `<p><figure>...</figure></p>` is invalid
    // HTML5 nesting. Browsers auto-close the `<p>` when they hit `<figure>` so
    // the rendered DOM ends up correct; HTML5 validators will still grumble.
    // Acceptable trade for keeping this in the inline ruler — a block-level
    // rule would also work but doubles the code. Revisit if validation matters.
    const html =
      `<figure class="image-embed">` +
      `<img src="${esc(src)}" alt="${esc(caption)}"${styleAttr}${sizesAttr}>` +
      `<figcaption>${esc(caption)}</figcaption>` +
      `</figure>`;
    const token = state.push("html_inline", "", 0);
    token.content = html;
  } else {
    const html = `<img src="${esc(src)}" alt="" class="image-embed"${styleAttr}${sizesAttr}>`;
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
module.exports.vaultPathTargetIsExcluded = vaultPathTargetIsExcluded;
