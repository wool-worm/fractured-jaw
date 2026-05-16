// Unified reporter for every wikilink-resolution failure in the build.
//
// Three call sites share this:
//   - Body wikilinks               (src/utils/wikilinks.js)
//   - Body image embeds            (src/utils/wikilinks.js)
//   - Frontmatter `image:`         (src/content/content.11tydata.js)
//   - Frontmatter `series_name:`   (.eleventy.js, seriesEntries collection)
//
// Severity rules:
//   - Production (ELEVENTY_ENV=production), host page NOT draft/excluded → throw
//   - All other cases (dev mode, OR draft/excluded host in any mode)    → warn
//
// Drafts and excluded posts always warn-only because they are removed
// from the production build before deploy. A dead link in a draft is
// useful information ("fix before promoting"), not a release blocker.

const isProduction = () => process.env.ELEVENTY_ENV === "production";

// Per-build dedup so the same offender doesn't spam the log on every page
// that includes it. Cleared implicitly by the Node process exiting between
// builds.
const seen = new Set();

// kind: short category label ("wikilink" | "image-embed" | "image-frontmatter" | "series-name")
// file: source file the issue is attributed to (absolute or repo-relative path)
// offending: exact text the writer wrote (e.g. "[[blog/foo|bar]]")
// reason: human-readable resolution failure ("no matching .md file in src/content/")
// isDraft: host page has draft: true
// isExcluded: host page has exclude: true
function reportIssue({ kind, file, offending, reason, isDraft = false, isExcluded = false }) {
  const dedupKey = `${kind}::${file}::${offending}`;
  if (seen.has(dedupKey)) return;
  seen.add(dedupKey);

  const message =
    `[fractured-jaw] ${kind} ${file}: ${offending}\n` +
    `  reason: ${reason}`;

  const isFatal = isProduction() && !isDraft && !isExcluded;
  if (isFatal) {
    throw new Error(message);
  }
  console.warn(message);
}

// Helpful for tests / scripts that want to reset the dedup cache between
// runs without spinning a fresh process.
function _resetForTests() {
  seen.clear();
}

module.exports = { reportIssue, _resetForTests };
