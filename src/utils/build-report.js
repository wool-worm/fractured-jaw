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

// Count of fatal-severity issues collected this build. Only the count is
// needed: each issue is already printed individually via console.warn
// when reportIssue records it. flush() throws a short summary that fails
// the build; the detail lives in the warning stream above.
let pendingFatalCount = 0;

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

  if (isFatal) pendingFatalCount++;
  console.warn(message);
}

// Throw a short aggregated error if any fatal-severity issues were
// collected during the build. Called from `eleventy.after` in
// .eleventy.js. No-op when there are no pending errors.
//
// Intentionally short: every issue was already printed to stderr by the
// reportIssue() call that recorded it. Eleventy's error reporter prints
// the thrown Error's .message + .stack at both the template-write stage
// AND the CLI fatal stage (so anything in the message body shows up
// four times). The detail belongs in the warning stream above; this
// throw is just the gate that fails the build.
function flush() {
  if (pendingFatalCount === 0) return;
  const count = pendingFatalCount;
  const summary =
    `${count} build error${count === 1 ? "" : "s"} blocked this build ` +
    `(see [fractured-jaw] warnings above). Fix the issues, or mark ` +
    `offending posts draft: true / exclude: true, then rerun.`;
  // Reset for any subsequent build call in the same process (e.g. tests).
  pendingFatalCount = 0;
  seen.clear();
  throw new Error(summary);
}

// Helpful for tests / scripts that want to reset state between runs
// without spinning a fresh process.
function _resetForTests() {
  seen.clear();
  pendingFatalCount = 0;
}

module.exports = { reportIssue, flush, _resetForTests };
