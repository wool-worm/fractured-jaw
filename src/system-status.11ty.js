// Eleventy JavaScript template — emits /system-status.json at build time.
//
// Feeds the real-data portion of the systems widget (the pinned
// "system_status" panel on the left center of the viewport). Counts
// posts, tags, words, and groups posts by author for the "intercepted
// transmission origin" bar race. Fake metrics (CPU load, antenna
// status, etc.) live entirely in the widget JS — only the real-world
// numbers come from this emitter.

const fs = require("fs");
const slugify = require("./utils/slugify");
const { parseAuthorField, resolveAuthors } = require("./utils/authors");

const CONTENT_ROOT = "src/content";

function readBody(inputPath) {
  try {
    const raw = fs.readFileSync(inputPath, "utf8");
    // Strip a leading YAML frontmatter block so the word count
    // doesn't include frontmatter keys/values.
    const m = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
    return m ? m[1] : raw;
  } catch (e) {
    return "";
  }
}

function countWords(body) {
  // Strip wikilink target paths (the part before `|` in
  // [[section/.../File|alias]]) so they don't inflate word counts —
  // we want to count what a reader actually sees, not the link
  // plumbing. Then count whitespace-delimited tokens that contain
  // at least one letter.
  const visible = body.replace(/\[\[([^\]]*?)\|([^\]]+)\]\]/g, "$2");
  const tokens = visible.match(/[\p{L}][\p{L}\p{N}'-]*/gu) || [];
  return tokens.length;
}

class SystemStatus {
  data() {
    return {
      permalink: "/system-status.json",
      eleventyExcludeFromCollections: true,
    };
  }

  render({ collections }) {
    const items = (collections && collections.all_content) || [];
    const authorsCollection = (collections && collections.authors) || [];

    let totalWords = 0;
    const authorCounts = {};
    const tagSet = new Set();
    const sectionCounts = {};

    for (const item of items) {
      const data = item.data || {};

      // Word count from raw markdown body.
      const body = readBody(item.inputPath);
      totalWords += countWords(body);

      // Author tallies — resolve wikilink frontmatter through the authors
      // collection so the bucket key matches the rendered display name.
      // Posts with no resolvable author bucket as "unknown" so the widget
      // never silently drops them.
      const parsedAuthors = parseAuthorField(data.author, CONTENT_ROOT);
      const resolved = resolveAuthors(parsedAuthors, authorsCollection);
      const bucket = resolved.length
        ? resolved.map((r) => r.displayName)
        : ["unknown"];
      for (const author of bucket) {
        authorCounts[author] = (authorCounts[author] || 0) + 1;
      }

      // Section tallies — useful for future widget variations.
      const section = data.section || "other";
      sectionCounts[section] = (sectionCounts[section] || 0) + 1;

      // Tags — normalize by slug, the same key the tagList collection
      // dedupes on, so the widget's tag_index count always matches the
      // number of tag pages ("Post Punk" and "post-punk" are one tag).
      const rawTags = data.tags;
      const tagList = Array.isArray(rawTags) ? rawTags : rawTags ? [rawTags] : [];
      for (const tag of tagList) {
        const slug = slugify(String(tag));
        if (slug) tagSet.add(slug);
      }
    }

    const authors = Object.entries(authorCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    return JSON.stringify({
      counts: {
        posts: items.length,
        tags: tagSet.size,
        words: totalWords,
      },
      sections: sectionCounts,
      authors: authors,
    });
  }
}

module.exports = SystemStatus;
