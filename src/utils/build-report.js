// Unified reporter for every build-level issue that should fail a prod
// build. Used by:
//
//   - Body wikilinks               (src/utils/wikilinks.js)
//   - Body image embeds            (src/utils/wikilinks.js)
//   - Frontmatter `image:`         (src/content/content.11tydata.js)
//   - Frontmatter `series_name:`   (.eleventy.js, seriesEntries collection)
//   - Required-field validation    (src/utils/frontmatter.js)
//   - URL collisions               (src/utils/frontmatter.js)
//
// Severity model (passed via the `severity` parameter):
//
//   "fatal-in-prod" (default):
//     Warn in dev. Fatal in prod ONLY when the host page is not draft and
//     not excluded; otherwise warn. This is the wikilink / image / series
//     rule: a dead link in a draft is information, not a release blocker.
//
//   "always-fatal":
//     Always counted as fatal, regardless of dev/prod or draft status.
//     This is for structural issues that mean the build is malformed at
//     a level beyond per-post correctness, e.g. two posts that resolve
//     to the same URL, or a post missing its title. Reported in dev too
//     so the writer sees it before they ship.
//
// Fatal errors are NOT thrown immediately. They are collected in
// `pendingFatalErrors` and aggregated. `.eleventy.js` registers an
// `eleventy.after` event that calls `flush()`, which throws a single
// aggregated Error containing every fatal message from the build.
// This gives the writer one full pass to see every prod-blocking issue
// instead of fix-build-fix-build cycling on the first one.
//
// Files do get written to `_site/` before flush throws, which is harmless:
// the npm script still exits non-zero, so CI/deploy gates on it. The
// `_site/` directory is local-only build output, gitignored.

const isProduction = () => process.env.ELEVENTY_ENV === "production";

// Per-build dedup so the same offender doesn't spam the log on every page
// that includes it. Cleared implicitly by the Node process exiting between
// builds (or explicitly by flush()).
const seen = new Set();

// Collected fatal-severity messages, flushed once at end of build.
const pendingFatalErrors = [];

// kind:       short category label, e.g. "wikilink", "image-embed",
//             "image-frontmatter", "series-name", "missing-frontmatter",
//             "url-collision"
// file:       source file the issue is attributed to (repo-relative path)
// offending:  exact text the writer wrote, when applicable. Free-form for
//             non-wikilink issues (e.g. "title" for a missing field).
// reason:     human-readable resolution failure
// isDraft:    host page has draft: true (used by "fatal-in-prod" severity)
// isExcluded: host page has exclude: true (used by "fatal-in-prod" severity)
// severity:   "fatal-in-prod" (default) or "always-fatal" — see header
function reportIssue({
  kind,
  file,
  offending,
  reason,
  isDraft = false,
  isExcluded = false,
  severity = "fatal-in-prod",
}) {
  const dedupKey = `${kind}::${file}::${offending}`;
  if (seen.has(dedupKey)) return;
  seen.add(dedupKey);

  const message =
    `[fractured-jaw] ${kind} ${file}: ${offending}\n` +
    `  reason: ${reason}`;

  let isFatal = false;
  if (severity === "always-fatal") {
    isFatal = true;
  } else if (severity === "fatal-in-prod") {
    isFatal = isProduction() && !isDraft && !isExcluded;
  }

  if (isFatal) pendingFatalErrors.push(message);
  console.warn(message);
}

// Throw an aggregated error if any fatal-severity issues were collected
// during the build. Called from `eleventy.after` in .eleventy.js. No-op
// when there are no pending errors.
function flush() {
  if (pendingFatalErrors.length === 0) return;
  const count = pendingFatalErrors.length;
  const banner = `\n[fractured-jaw] ${count} build error${count === 1 ? "" : "s"} blocked this build:\n`;
  const body = pendingFatalErrors
    .map((m, i) => `\n--- error ${i + 1}/${count} ---\n${m}`)
    .join("\n");
  const aggregated = `${banner}${body}\n\nFix the issues above (or mark the offending posts draft: true / exclude: true where appropriate) and rerun the build.`;
  // Reset for any subsequent build call in the same process (e.g. tests).
  pendingFatalErrors.length = 0;
  seen.clear();
  throw new Error(aggregated);
}

// Helpful for tests / scripts that want to reset state between runs
// without spinning a fresh process.
function _resetForTests() {
  seen.clear();
  pendingFatalErrors.length = 0;
}

module.exports = { reportIssue, flush, _resetForTests };
