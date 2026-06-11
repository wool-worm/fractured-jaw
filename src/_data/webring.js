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
//   neighbors:                     // blogroll (curated outbound links)
//     - name: Example Zine
//       url: https://example.com
//       description: One-liner (optional).
//   rings:                         // webring memberships (inline nav rows)
//     - name: Hotline Webring       // bare prev/next style:
//       url: https://hotlinewebring.club/   // ring hub; optional
//       prev: https://.../slug/previous     // required (unless embed)
//       next: https://.../slug/next         // required (unless embed)
//       random: https://.../slug/random     // optional
//     - name: Some Ring             // iframe-widget style:
//       embed: "<iframe ...></iframe>"      // raw HTML; renders in place
//
// Order is preserved. Missing file or empty arrays render the /webring/
// page in its "no neighbors yet" state (and hide the rings section).

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
  // A ring entry is usable if it can navigate: either a raw `embed` (iframe
  // widget pasted from the ring) OR a bare `prev`+`next` link pair.
  const rings = Array.isArray(parsed.data && parsed.data.rings)
    ? parsed.data.rings.filter((r) => r && (r.embed || (r.prev && r.next)))
    : [];
  return {
    neighbors,
    rings,
    notes: (parsed.content || "").trim(),
  };
};
