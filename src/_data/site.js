// Site-wide metadata. Available in templates as `site.title`, `site.url`, etc.

module.exports = {
  title: "Fractured Jaw",
  description:
    "A zine and blog. Writing, music, politics. Anonymous, intermittent, static.",
  // Short brand tagline appended to the homepage <title> (after "Fractured
  // Jaw :: ") so it isn't a too-short bare brand name. Keep it punchy; the
  // full <title> should land roughly 50-60 chars. Empty = bare site.title.
  tagline: "a zine and blog written from the lower half of the dial",
  url: "https://fractured-jaw.com",
  language: "en",
  // Default author shown when a post's frontmatter doesn't override it.
  // Wikilink form — resolved through the `authors` collection so the
  // display name comes from the author file's `title:` frontmatter.
  defaultAuthor: "[[authors/wool-worm|wool-worm]]",
  // Fallback social-card image for pages without per-post frontmatter `image:`.
  // Path is site-absolute; head.njk prefixes site.url to produce a fully
  // qualified URL (Open Graph requires absolute URLs).
  defaultImage: "/assets/images/og-default.png",
  // Pixel dimensions of defaultImage. Emitted as og:image:width / og:image:height
  // (and the twitter:image equivalents) when the page falls back to
  // defaultImage. Helps social scrapers render previews without round-tripping
  // the image first. Per-post images don't emit dimensions because we don't
  // probe them at build time — accept the small degradation rather than add
  // an image-size dependency.
  defaultImageWidth: 1024,
  defaultImageHeight: 1024,
  // Twitter card type for the default image. "summary" = square (1:1),
  // "summary_large_image" = wide (2:1, ~1200x630). Match this to the
  // aspect ratio of defaultImage. Posts can override per-page via
  // `card_type:` frontmatter if they ever ship a wide banner.
  defaultCardType: "summary",
  // Whether the build is running in production. Templates that need to behave
  // differently in dev (e.g. show drafts) should read this rather than calling
  // process.env directly.
  isProduction: process.env.ELEVENTY_ENV === "production",
};
