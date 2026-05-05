// Directory data file: applied to every file under src/content/.
//
// Three responsibilities:
//   1. Compute the published URL via computePermalink(). The Obsidian folder
//      structure (content/<section>/YYYY/MM-MMM/<File>.md) gets flattened to
//      /<section>/<slug>/ for readers.
//   2. Pick the right layout based on which section the file lives in,
//      so individual posts don't have to specify `layout:` in frontmatter.
//      Frontmatter `layout:` still wins if a post sets it explicitly.
//   3. Honor the draft/exclude frontmatter flags:
//        draft:   true → hidden in production, visible during `npm start`
//        exclude: true → hidden everywhere (use for internal docs / WIP refs)
//      A file with permalink:false is not written to disk; combined with
//      eleventyExcludeFromCollections:true it disappears from the build entirely.

const { computePermalink, extractSection } = require("../utils/permalink");

const isProduction = process.env.ELEVENTY_ENV === "production";

const LAYOUT_BY_SECTION = {
  blog: "layouts/post.njk",
  essays: "layouts/essay.njk",
  fragments: "layouts/fragment.njk",
  media: "layouts/media.njk",
  pages: "layouts/page.njk",
};

function shouldExclude(data) {
  if (data.exclude === true) return true;
  if (isProduction && data.draft === true) return true;
  return false;
}

module.exports = {
  eleventyComputed: {
    eleventyExcludeFromCollections: (data) => shouldExclude(data),
    permalink: (data) => {
      if (shouldExclude(data)) return false;
      return computePermalink(data);
    },
    // NOTE: this directory data file always computes the permalink — we do
    // NOT honor frontmatter `permalink:` here. Reading `data.permalink`
    // inside this function returns the function itself (not the static
    // frontmatter value), and returning that confuses Eleventy into using
    // the default filesystem permalink.
    //
    // If a file under src/content/ ever needs to override its URL, the
    // workaround is to move it OUTSIDE src/content/ (the way src/tag.njk
    // works) so this directory data file doesn't apply at all.
    layout: (data) => {
      // Respect explicit layout in frontmatter.
      if (data.layout) return data.layout;
      const section = extractSection(data.page && data.page.filePathStem);
      return LAYOUT_BY_SECTION[section];
    },
    // Convenience: expose the section name to templates so partials can
    // render different things for blog vs media vs pages without re-parsing
    // the file path.
    section: (data) => extractSection(data.page && data.page.filePathStem),
    // page_type controls how the local-graph widget centers its layout:
    //   top      — global view, no centering (home, about, /tags/ index, etc.)
    //   section  — pack all nodes of this section near the center
    //              (used by /blog/, /essays/, /fragments/, /media/ landings)
    //   content  — pin the current node to center, render its neighborhood
    //              (default for actual posts)
    //   tag      — pack all nodes for this tag near the center
    //              (injected into per-tag pages by src/tag.njk)
    // Frontmatter `page_type:` always wins. Defaults: pages/ → top,
    // everything else → content.
    page_type: (data) => {
      if (data.page_type) return data.page_type;
      const section = extractSection(data.page && data.page.filePathStem);
      return section === "pages" ? "top" : "content";
    },
  },
};
