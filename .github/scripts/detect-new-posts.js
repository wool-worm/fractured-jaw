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

// Look up a post's cover image URL from search-index.json and return an
// absolute URL Discord can fetch. Handles three shapes the `image` field
// may take, in priority order:
//
//   1. Already absolute ("https://..."):  returned as-is
//   2. Resolved root-relative path ("/attachments/.../foo.png"):  current
//      shape emitted by content.11tydata.js's `image` computed property
//      after Eleventy resolves the wikilink. Prepend siteUrl.
//   3. Raw wikilink ("[[_attachments/.../foo.png|alt]]"):  defensive
//      fallback in case the search-index format ever changes back to
//      passing the frontmatter value through verbatim. Strip the
//      _attachments/ prefix (passthrough renames to /attachments/) and
//      prepend siteUrl.
//
// Returns null when there's no image or the field doesn't match any of
// the three known shapes.
function imageFromSearchIndex(searchIndex, postUrl, siteUrl) {
  if (!Array.isArray(searchIndex)) return null;
  const record = searchIndex.find((r) => r && r.url === postUrl);
  if (!record || !record.image) return null;

  const raw = String(record.image).trim();
  const base = String(siteUrl).replace(/\/+$/, "");

  if (/^https?:\/\//i.test(raw)) return raw;

  if (raw.startsWith("/")) {
    return `${base}${raw}`;
  }

  const m = /^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/.exec(raw);
  if (m) {
    let vaultPath = m[1].trim();
    if (vaultPath.startsWith("_attachments/")) {
      vaultPath = "attachments/" + vaultPath.slice("_attachments/".length);
    }
    return `${base}/${vaultPath.replace(/^\/+/, "")}`;
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
