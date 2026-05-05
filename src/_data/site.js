// Site-wide metadata. Available in templates as `site.title`, `site.url`, etc.

module.exports = {
  title: "Fractured Jaw",
  description:
    "A zine and blog. Writing, music, politics. Anonymous, intermittent, hand-built.",
  url: "https://fractured-jaw.com",
  language: "en",
  // Default author shown when a post's frontmatter doesn't override it.
  defaultAuthor: "wool-worm",
  // Whether the build is running in production. Templates that need to behave
  // differently in dev (e.g. show drafts) should read this rather than calling
  // process.env directly.
  isProduction: process.env.ELEVENTY_ENV === "production",
};
