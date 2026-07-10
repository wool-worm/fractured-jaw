// Eleventy JavaScript template — emits /sitemap.xml at build time.
//
// Lists every public HTML URL on the site for search engines. Excludes
// feeds (*.xml), data files (*.json), and anything a page opts out of via
// `sitemap_enabled: false` in frontmatter. Drafts/excluded content are
// already filtered upstream (they have no url).
//
// Lives outside src/content/ so content.11tydata.js doesn't try to compute
// a permalink for it. The frontmatter-style permalink in data() wins.

const { DateTime } = require("luxon");

class Sitemap {
  data() {
    return {
      permalink: "/sitemap.xml",
      eleventyExcludeFromCollections: true,
    };
  }

  render({ collections, site }) {
    const items = (collections && collections.all) || [];
    const urls = [];

    for (const item of items) {
      if (!item.url) continue;
      // Skip non-HTML outputs (feeds, JSON data, etc.). The sitemap is for
      // pages a human would land on from a search result.
      if (/\.(xml|json|txt)$/i.test(item.url)) continue;
      // Honor explicit opt-out.
      if (item.data && item.data.sitemap_enabled === false) continue;

      // lastmod: the LATER of updated/published — the vault plugin's
      // date_updated is file-mtime and can precede a forward-dated
      // date_published; a lastmod older than the publish date reads as
      // nonsense to crawlers. ISO date strings compare safely as strings.
      const updated = toIso(item.data && item.data.date_updated);
      const published = toIso(
        (item.data && item.data.date_published) || item.date
      );
      const lastmod =
        updated && published
          ? (updated > published ? updated : published)
          : updated || published;

      urls.push({
        loc: site.url.replace(/\/$/, "") + item.url,
        lastmod,
      });
    }

    // Per-tag pages. They're pagination output from src/tag.njk, which is
    // eleventyExcludeFromCollections (so it stays out of the content
    // collections) — meaning they never appear in `collections.all` above
    // and have to be added from tagList explicitly. lastmod is the newest
    // date across the tag's member posts, since that's when the tag page's
    // content last changed.
    const tagList = (collections && collections.tagList) || [];
    for (const entry of tagList) {
      let newest = null;
      for (const post of entry.posts) {
        const d = toIso(
          (post.data && (post.data.date_updated || post.data.date_published)) ||
            post.date
        );
        if (d && (!newest || d > newest)) newest = d;
      }
      urls.push({
        loc: site.url.replace(/\/$/, "") + `/tags/${entry.tag}/`,
        lastmod: newest,
      });
    }

    // Stable ordering — alphabetical by loc — so successive builds produce
    // identical sitemaps when nothing changed.
    urls.sort((a, b) => a.loc.localeCompare(b.loc));

    const body = urls
      .map((u) => {
        const lines = [`  <url>`, `    <loc>${escapeXml(u.loc)}</loc>`];
        if (u.lastmod) lines.push(`    <lastmod>${u.lastmod}</lastmod>`);
        lines.push(`  </url>`);
        return lines.join("\n");
      })
      .join("\n");

    return (
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      body +
      `\n</urlset>\n`
    );
  }
}

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return DateTime.fromJSDate(value).toISODate();
  const dt = DateTime.fromISO(String(value));
  return dt.isValid ? dt.toISODate() : null;
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

module.exports = Sitemap;
