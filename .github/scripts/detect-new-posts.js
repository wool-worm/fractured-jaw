#!/usr/bin/env node
// Compare a previously-live Atom feed against the freshly-built feed
// and emit a JSON payload of newly-published posts for the Discord
// dispatch webhook.
//
// Inputs:
//   argv[2] — path to previous feed XML (live snapshot captured before build)
//   argv[3] — path to new feed XML (_site/feed.xml)
//   argv[4] — path to search-index.json (used to enrich entries with the
//             hero image; the feed itself doesn't carry it)
//   argv[5] — path to write the JSON payload to
//
// Behavior:
//   - "New" = an <entry> whose <id> (URL) is in the new feed but absent
//     from the previous feed. Edits to existing posts do not trigger
//     announcements (their <id> stays the same).
//   - Exits 1 with an explanatory message if the previous feed parses to
//     zero entries — that's the "live feed unreachable / wiped" signal
//     and should fail the workflow rather than fall through to
//     over-announcing. Bypass with ALLOW_EMPTY_PREVIOUS_FEED=true.
//   - The atom-feed renderer (src/utils/atom-feed.js) escapes XML
//     entities, so a regex parse over our known shape is safe. No npm
//     dependency added.

const fs = require("fs");

const ALLOW_EMPTY = String(process.env.ALLOW_EMPTY_PREVIOUS_FEED || "")
  .toLowerCase()
  === "true";

function fail(msg) {
  console.error(`[detect-new-posts] ${msg}`);
  process.exit(1);
}

function readFile(path) {
  try {
    return fs.readFileSync(path, "utf8");
  } catch (err) {
    fail(`cannot read ${path}: ${err.message}`);
  }
}

// Pull <entry>...</entry> blocks out of the feed.
function parseEntries(xml) {
  const entries = [];
  const re = /<entry>([\s\S]*?)<\/entry>/g;
  let match;
  while ((match = re.exec(xml)) !== null) {
    entries.push(match[1]);
  }
  return entries;
}

// Pull a single top-level element's inner text from an entry block.
// The renderer emits each tag on its own line, no nested children
// inside the ones we care about (title, id, published, summary).
function pickText(entryBlock, tag) {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`);
  const match = re.exec(entryBlock);
  return match ? unescapeXml(match[1].trim()) : "";
}

// Pull all matches for a tag (used for author/category which repeat).
function pickAll(entryBlock, tag, attr) {
  if (attr) {
    const re = new RegExp(`<${tag}\\b[^>]*\\b${attr}="([^"]*)"`, "g");
    const results = [];
    let match;
    while ((match = re.exec(entryBlock)) !== null) {
      results.push(unescapeXml(match[1]));
    }
    return results;
  }
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "g");
  const results = [];
  let match;
  while ((match = re.exec(entryBlock)) !== null) {
    results.push(unescapeXml(match[1].trim()));
  }
  return results;
}

function unescapeXml(s) {
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// Extract <name> from each <author> block.
function pickAuthors(entryBlock) {
  const authors = [];
  const blocks = entryBlock.match(/<author>([\s\S]*?)<\/author>/g) || [];
  for (const block of blocks) {
    const name = pickText(block, "name");
    if (name) authors.push(name);
  }
  return authors;
}

function parseEntry(entryBlock) {
  return {
    title:       pickText(entryBlock, "title"),
    url:         pickText(entryBlock, "id"),
    published:   pickText(entryBlock, "published"),
    description: pickText(entryBlock, "summary"),
    authors:     pickAuthors(entryBlock),
    tags:        pickAll(entryBlock, "category", "term"),
  };
}

// Look up a post's cover image from search-index.json and return an absolute
// URL Discord / email can fetch.
//
// The search index stores the cover as pre-rendered <picture> markup in
// `image_html` (the eleventy-img migration replaced the old `image` URL
// field), e.g.:
//   <picture><source type="image/webp" srcset="/img/<h>-400.webp 400w, ...">
//     <img src="/img/<h>-400.jpeg" srcset="/img/<h>-400.jpeg 400w, ..."></picture>
// So we parse it for the largest variant URL: prefer JPEG (renders in every
// mail client + Discord), then webp, then the <img src> fallback, and make the
// root-relative /img/ path absolute. A legacy plain `image` URL / wikilink
// field is still honored if a future index ever carries one.
//
// The record lookup normalizes URLs too: the feed <id> (postUrl) is absolute
// while search-index urls are root-relative, so we compare by pathname (a
// strict-equal compare never matched, compounding the missing-image bug).
//
// Returns null when the post has no cover or nothing parseable is found.
function imageFromSearchIndex(searchIndex, postUrl, siteUrl) {
  if (!Array.isArray(searchIndex)) return null;

  const base = String(siteUrl).replace(/\/+$/, "");
  const toPath = (u) => {
    try { return new URL(String(u || ""), base).pathname; }
    catch (e) { return String(u || ""); }
  };
  const abs = (u) => {
    const s = String(u || "").trim();
    if (!s) return null;
    if (/^https?:\/\//i.test(s)) return s;
    return `${base}/${s.replace(/^\/+/, "")}`;
  };

  const wantPath = toPath(postUrl);
  const record = searchIndex.find((r) => r && toPath(r.url) === wantPath);
  if (!record) return null;

  // Primary: pull the largest variant out of the image_html <picture> markup.
  const html = record.image_html ? String(record.image_html) : "";
  if (html) {
    // From a "url Nw, url Nw" srcset, return the highest-width url.
    const largest = (srcset) => {
      let best = null, bestW = -1, m;
      const re = /([^\s,]+)\s+(\d+)w/g;
      while ((m = re.exec(srcset)) !== null) {
        const w = parseInt(m[2], 10);
        if (w > bestW) { bestW = w; best = m[1]; }
      }
      return best;
    };
    // Prefer the JPEG srcset (on the <img>) for mail-client compatibility.
    const imgSrcset = (html.match(/<img[^>]*\bsrcset="([^"]*)"/i) || [])[1];
    if (imgSrcset && /\.jpe?g/i.test(imgSrcset)) {
      const u = largest(imgSrcset);
      if (u) return abs(u);
    }
    // Else the webp <source srcset>.
    const sourceSrcset = (html.match(/<source[^>]*\bsrcset="([^"]*)"/i) || [])[1];
    if (sourceSrcset) {
      const u = largest(sourceSrcset);
      if (u) return abs(u);
    }
    // Else the single <img src>.
    const imgSrc = (html.match(/<img[^>]*\bsrc="([^"]*)"/i) || [])[1];
    if (imgSrc) return abs(imgSrc);
  }

  // Legacy fallback: a plain `image` URL or wikilink, if a future index has one.
  if (record.image) {
    const raw = String(record.image).trim();
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith("/")) return `${base}${raw}`;
    const m = /^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/.exec(raw);
    if (m) {
      let vaultPath = m[1].trim();
      if (vaultPath.startsWith("_attachments/")) {
        vaultPath = "attachments/" + vaultPath.slice("_attachments/".length);
      }
      return `${base}/${vaultPath.replace(/^\/+/, "")}`;
    }
  }

  return null;
}

function main() {
  const [, , previousPath, newPath, searchIndexPath, outputPath] = process.argv;
  const siteUrl = process.env.SITE_URL || "https://fractured-jaw.com";

  if (!previousPath || !newPath || !searchIndexPath || !outputPath) {
    fail(
      "usage: detect-new-posts.js <previous-feed.xml> <new-feed.xml> " +
      "<search-index.json> <output.json>"
    );
  }

  const previousXml   = readFile(previousPath);
  const newXml        = readFile(newPath);
  const searchIndexJs = readFile(searchIndexPath);

  let searchIndex;
  try {
    searchIndex = JSON.parse(searchIndexJs);
  } catch (err) {
    fail(`cannot parse search-index.json: ${err.message}`);
  }

  const previousEntries = parseEntries(previousXml);
  const newEntries      = parseEntries(newXml);

  if (previousEntries.length === 0 && !ALLOW_EMPTY) {
    fail(
      "previous feed parsed to zero entries. Either the live feed was " +
      "unreachable, malformed, or the site was wiped. Set the repo " +
      "variable ALLOW_EMPTY_PREVIOUS_FEED=true to bypass this guard " +
      "and treat all current posts as new."
    );
  }

  const previousUrls = new Set(
    previousEntries.map((e) => pickText(e, "id")).filter(Boolean)
  );

  const newPosts = [];
  for (const block of newEntries) {
    const entry = parseEntry(block);
    if (!entry.url) continue;
    if (previousUrls.has(entry.url)) continue;
    entry.image = imageFromSearchIndex(searchIndex, entry.url, siteUrl);
    newPosts.push(entry);
  }

  // Oldest-first so the chat reads top-to-bottom in publication order.
  newPosts.sort((a, b) => String(a.published).localeCompare(String(b.published)));

  fs.writeFileSync(outputPath, JSON.stringify(newPosts, null, 2));
  console.log(
    `[detect-new-posts] previous=${previousEntries.length} new=${newEntries.length} ` +
    `to-announce=${newPosts.length}`
  );
}

main();
