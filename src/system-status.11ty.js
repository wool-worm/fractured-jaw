// Eleventy JavaScript template — emits /system-status.json at build time.
//
// Feeds the real-data portion of the systems widget (the pinned
// "system_status" panel on the left center of the viewport). Counts
// posts, tags, words, and groups posts by author for the "intercepted
// transmission origin" bar race. Fake metrics (CPU load, antenna
// status, etc.) live entirely in the widget JS — only the real-world
// numbers come from this emitter.

const fs = require("fs");

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

    let totalWords = 0;
    const authorCounts = {};
    const tagSet = new Set();
    const sectionCounts = {};

    for (const item of items) {
      const data = item.data || {};

      // Word count from raw markdown body.
      const body = readBody(item.inputPath);
      totalWords += countWords(body);

      // Author tallies — empty / missing values bucket as "unknown".
      // `author` may be a string OR a string[] (co-authored / guest posts);
      // each named author gets a +1.
      const rawAuthor = data.author;
      const authorList = Array.isArray(rawAuthor)
        ? rawAuthor
        : rawAuthor
        ? [rawAuthor]
        : [];
      const names = authorList
        .map((a) => String(a).trim())
        .filter(Boolean);
      const bucket = names.length ? names : ["unknown"];
      for (const author of bucket) {
        authorCounts[author] = (authorCounts[author] || 0) + 1;
      }

      // Section tallies — useful for future widget variations.
      const section = data.section || "other";
      sectionCounts[section] = (sectionCounts[section] || 0) + 1;

      // Tags — normalize to lowercase, same as the tagList collection.
      const rawTags = data.tags;
      const tagList = Array.isArray(rawTags) ? rawTags : rawTags ? [rawTags] : [];
      for (const tag of tagList) {
        if (tag) tagSet.add(String(tag).toLowerCase());
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
