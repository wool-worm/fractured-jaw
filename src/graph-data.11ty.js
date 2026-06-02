// Eleventy JavaScript template — emits /graph-data.json at build time.
//
// Powers the force-directed graph at /network_nodes/ and the local-graph
// widget that appears on every other page. Two edge sets are produced so
// the client can flip between modes without rebuilding:
//
//   linkEdges — directed: source post wikilinks to target post
//   tagEdges  — bidirectional in spirit; source post → tag node
//
// Like preview-index.11ty.js this lives outside src/content/ so the
// directory data file doesn't try to compute a permalink for it.

const fs = require("fs");
const slugify = require("./utils/slugify");
const { vaultPathToUrl } = require("./utils/permalink");
const { parseAuthorField } = require("./utils/authors");
const { parseSeriesField } = require("./utils/series");

const CONTENT_ROOT = "src/content";

// Capture [[...]] but skip ![[...]] (image embed syntax — reserved for
// a later Obsidian-attachment phase). Lookbehind is supported in every
// browser/Node version we care about.
const WIKILINK_RE = /(?<!!)\[\[([^\]\n]+?)\]\]/g;

// Strip a leading YAML frontmatter block so we only scan the body for
// wikilinks. Tolerates LF or CRLF line endings.
function stripFrontmatter(raw) {
  const m = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
  return m ? m[1] : raw;
}

class GraphData {
  data() {
    return {
      permalink: "/graph-data.json",
      eleventyExcludeFromCollections: true,
    };
  }

  render({ collections }) {
    const items = (collections && collections.previewable) || [];

    // Page nodes — one per published post or top-level page that has a URL.
    // Skip pages with `graph_enabled: false` in frontmatter (top-level pages
    // like home, about, section landings — they're navigation surfaces, not
    // worth a node in the graph).
    const pageNodes = [];
    const knownUrls = new Set();
    for (const item of items) {
      if (!item.url) continue; // drafts/excluded files have permalink:false
      if (item.data.graph_enabled === false) continue;
      pageNodes.push({
        id: item.url,
        type: "page",
        title: item.data.title || "(untitled)",
        section: item.data.section || null,
        url: item.url,
      });
      knownUrls.add(item.url);
    }

    // Wikilink edges — scan each item's raw markdown for [[path|alias]]
    // and resolve the path through the same transform the markdown-it
    // plugin uses. Edges to unknown targets (typos, dead links, or pages
    // excluded via graph_enabled:false) are dropped silently here; the
    // wikilink plugin still warns at build for genuine dead links.
    const linkEdges = [];
    for (const item of items) {
      if (!item.url) continue;
      // Skip outgoing edges from excluded pages — orphan source IDs
      // would point at nodes that don't exist.
      if (item.data.graph_enabled === false) continue;

      const raw = fs.readFileSync(item.inputPath, "utf8");
      const body = stripFrontmatter(raw);

      WIKILINK_RE.lastIndex = 0; // regex is module-scoped; reset between items
      let m;
      while ((m = WIKILINK_RE.exec(body)) !== null) {
        const [vaultPath] = m[1].split("|");
        const targetUrl = vaultPathToUrl(vaultPath.trim());
        if (!targetUrl || targetUrl === item.url) continue;
        if (!knownUrls.has(targetUrl)) continue;
        linkEdges.push({ source: item.url, target: targetUrl });
      }
    }

    // Author edges synthesized from frontmatter. The wikilink scanner above
    // only reads body content (`[[...]]`), so an `author:` frontmatter
    // wikilink wouldn't otherwise produce an edge — leaving author records
    // floating unconnected in the graph. Walk each item's `author:` value
    // through parseAuthorField (handles single + array shapes, validator
    // already reported any malformed entries elsewhere) and add a
    // post → author edge for every resolved entry.
    for (const item of items) {
      if (!item.url) continue;
      if (item.data.graph_enabled === false) continue;
      // Author files don't carry an `author:` field (circular), and series
      // parents have it as bookkeeping only — neither should produce
      // outgoing author edges from themselves.
      if (item.data.section === "authors") continue;
      if (item.data.section === "series") continue;

      const parsed = parseAuthorField(item.data.author, CONTENT_ROOT);
      if (parsed.kind !== "list") continue;
      for (const entry of parsed.entries) {
        if (entry.kind !== "wikilink") continue;
        if (!knownUrls.has(entry.url)) continue;
        linkEdges.push({ source: item.url, target: entry.url });
      }
    }

    // Series edges synthesized from frontmatter, mirroring the author edges
    // above. A `series_name:` wikilink lives in frontmatter, so the body
    // scanner never sees it; without this a post stays unconnected to its
    // series-parent node in the graph (the parent node exists via the
    // previewable collection, but nothing links to it). parseSeriesField
    // handles the strict wikilink form; malformed/dead entries were already
    // reported by the seriesEntries collection in .eleventy.js, so here we
    // just skip anything that doesn't resolve. series_name is single-valued,
    // so at most one post -> series-parent edge per post.
    for (const item of items) {
      if (!item.url) continue;
      if (item.data.graph_enabled === false) continue;
      // A series parent doesn't carry its own series_name; guard for symmetry
      // with the author block (and to avoid any self-edge).
      if (item.data.section === "series") continue;

      const parsed = parseSeriesField(item.data.series_name, CONTENT_ROOT);
      if (parsed.kind !== "wikilink") continue;
      if (!knownUrls.has(parsed.url)) continue;
      linkEdges.push({ source: item.url, target: parsed.url });
    }

    // Tag nodes + post→tag edges. Tags are a separate node type so the
    // tag-mode view has clear hubs (one node per tag, each post fans
    // out to its tags) instead of the dense post-to-post mesh you'd
    // get from "posts share a tag" edges. Pages excluded from the graph
    // (graph_enabled:false) don't contribute tag edges either.
    const tagNodes = new Map();
    const tagEdges = [];
    for (const item of items) {
      if (!item.url) continue;
      if (item.data.graph_enabled === false) continue;
      const raw = item.data.tags;
      const tags = Array.isArray(raw) ? raw : raw ? [raw] : [];
      for (const rawTag of tags) {
        const slug = slugify(String(rawTag));
        if (!slug) continue;
        const tagId = `tag:${slug}`;
        if (!tagNodes.has(tagId)) {
          tagNodes.set(tagId, {
            id: tagId,
            type: "tag",
            title: String(rawTag),
            url: `/tags/${slug}/`,
          });
        }
        tagEdges.push({ source: item.url, target: tagId });
      }
    }

    return JSON.stringify(
      {
        nodes: [...pageNodes, ...tagNodes.values()],
        linkEdges,
        tagEdges,
      },
      null,
      2
    );
  }
}

module.exports = GraphData;
