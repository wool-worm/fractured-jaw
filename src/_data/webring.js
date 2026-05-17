// Global data loader for the webring neighbor list.
//
// Reads src/content/_data/webring.md (a single markdown file with a YAML
// frontmatter array of neighbors), returns it as the `webring` global so
// templates can iterate `webring.neighbors`. The actual data file lives
// inside the vault so neighbors can be edited in Obsidian; it's tracked
// in git but pipeline-excluded via .eleventyignore so it never tries to
// render as a standalone page.
//
// Frontmatter shape:
//   neighbors:
//     - name: Example Zine
//       url: https://example.com
//       description: One-liner (optional).
//
// Order is preserved. Missing file or empty array both render the
// /webring/ page in its "no neighbors yet" state.

const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");

const SOURCE_PATH = path.join(
  __dirname,
  "..",
  "content",
  "_data",
  "webring.md"
);

module.exports = function () {
  if (!fs.existsSync(SOURCE_PATH)) {
    return { neighbors: [], notes: "" };
  }
  const raw = fs.readFileSync(SOURCE_PATH, "utf8");
  const parsed = matter(raw);
  const neighbors = Array.isArray(parsed.data && parsed.data.neighbors)
    ? parsed.data.neighbors.filter((n) => n && n.url)
    : [];
  return {
    neighbors,
    notes: (parsed.content || "").trim(),
  };
};
