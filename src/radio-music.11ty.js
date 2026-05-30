// Eleventy JavaScript template: emits /radio-music.json at build time.
//
// Feeds the radio widget's `bandcamp` signal type. Reads the meta-bind-edited
// data note at src/content/_data/radio-music.md (tracked in git, pipeline-
// excluded via .eleventyignore so it never renders as a page), filters to
// stations that have been populated with a bandcamp ID, and emits a clean
// JSON the widget can consume at boot.
//
// Unpopulated entries (no `bandcamp_album_id`) are SKIPPED on purpose. Their
// pre-assigned (band, freq) coords were all carrier_wave under the widget's
// hash-based signalAt() to begin with, so skipping them here means those
// coords stay carrier_wave channels with no special handling. Populate a slot
// and it becomes a bandcamp station; clear it and it goes back to carrier_wave.
//
// Embed URL styling params (size, artwork, bgcol, linkcol, etc.) are NOT
// baked into this JSON. The widget owns those constants so iteration on look
// stays in one place; the widget composes the embed URL from the id we emit
// here plus its own param constants.
//
// review_link wikilinks are resolved to {url, alias} at build time so the
// widget can render a clickable link with no runtime resolver.

const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");
const { parseWikilink, vaultPathExists } = require("./utils/wikilinks");
const { vaultPathToUrl } = require("./utils/permalink");
const { reportIssue } = require("./utils/build-report");

const CONTENT_ROOT = path.join(__dirname, "content");
const SOURCE_PATH = path.join(CONTENT_ROOT, "_data", "radio-music.md");
const HOST_FILE = "src/content/_data/radio-music.md";
const WIKILINK_RE = /^\s*\[\[([^\]\n]+?)\]\]\s*$/;

// Cache: vaultPath -> target file's parsed frontmatter (or null on read error).
// One build invocation = one Node process = fresh cache, so no staleness.
const targetFmCache = new Map();
function readTargetFrontmatter(vaultPath) {
  if (targetFmCache.has(vaultPath)) return targetFmCache.get(vaultPath);
  const abs = path.join(CONTENT_ROOT, `${vaultPath}.md`);
  let data = null;
  try {
    data = matter(fs.readFileSync(abs, "utf8")).data || {};
  } catch (e) {
    data = null;
  }
  targetFmCache.set(vaultPath, data);
  return data;
}

// js-yaml turns unquoted ISO dates into JS Date objects, quoted ones into
// strings. Normalize both to YYYY-MM-DD so the public JSON is uniform and
// the build's local timezone never leaks (Date.toISOString() is UTC).
function normalizeDate(value) {
  if (value == null || value === "") return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

// Wikilink string -> { url, alias }, or null when the link shouldn't render.
// Validates against the same rules the rest of the site uses for wikilinks
// (vaultPathExists + frontmatter draft/exclude flags + reportIssue at
// fatal-in-prod severity), with one tweak: this returns null for bad targets
// so the widget never renders a dead link. Body wikilinks render a live <a>
// either way and rely on reportIssue to halt the prod build; the radio
// widget is a clientside fetch consumer, so swallowing the bad URL is the
// only way to prevent a 404 from shipping if the report's prod-fatal halt
// somehow doesn't fire (e.g. host-context quirks for a pipeline-excluded
// data file).
//
// Specifically:
//   - Not a strict wikilink, unknown section, malformed path, or missing
//     target file -> null + report (dead link).
//   - Target has `exclude: true` -> null + report (would 404 in prod).
//   - Target has `draft: true`:
//       - in production -> null + report.
//       - in dev -> render the link (drafts are reachable in dev).
//   - Otherwise -> { url, alias }.
//
// All reports use `isDraft: false, isExcluded: false` on the host context so
// the issue is fatal-in-prod regardless of the data file's own pipeline-
// excluded status. The radio-music file is technically excluded from the
// content pipeline, but it's an author-authored source that should be
// validated as strictly as any content post.
function resolveReviewLink(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  const m = s.match(WIKILINK_RE);
  if (!m) {
    reportIssue({
      kind: "review-link",
      file: HOST_FILE,
      offending: s,
      reason: "review_link must be a strict wikilink (`[[<section>/<...>]]`)",
      isDraft: false,
      isExcluded: false,
    });
    return null;
  }

  const { vaultPath, alias } = parseWikilink(m[1]);
  const cleanPath = vaultPath.replace(/\.md$/i, "");
  const url = vaultPathToUrl(cleanPath);
  if (!url) {
    reportIssue({
      kind: "review-link",
      file: HOST_FILE,
      offending: `[[${m[1]}]]`,
      reason: "unknown section or malformed path",
      isDraft: false,
      isExcluded: false,
    });
    return null;
  }
  if (!vaultPathExists(cleanPath, CONTENT_ROOT)) {
    reportIssue({
      kind: "review-link",
      file: HOST_FILE,
      offending: `[[${m[1]}]]`,
      reason: "no matching .md file in src/content/",
      isDraft: false,
      isExcluded: false,
    });
    return null;
  }

  const data = readTargetFrontmatter(cleanPath) || {};
  if (data.exclude === true) {
    reportIssue({
      kind: "review-link",
      file: HOST_FILE,
      offending: `[[${m[1]}]]`,
      reason: "target is excluded (`exclude: true`); URL would 404 in production",
      isDraft: false,
      isExcluded: false,
    });
    return null;
  }
  if (data.draft === true) {
    // Always report draft targets. reportIssue routes severity by env:
    // warn in dev (so authors see the warning that the link will 404 in
    // prod) and fatal in prod (build halts). We additionally return null
    // in prod so the link doesn't render even if the report somehow
    // doesn't halt the build.
    reportIssue({
      kind: "review-link",
      file: HOST_FILE,
      offending: `[[${m[1]}]]`,
      reason: "target is draft (`draft: true`); URL will 404 in production",
      isDraft: false,
      isExcluded: false,
    });
    if (process.env.ELEVENTY_ENV === "production") return null;
    // Dev: drafts are reachable at their URL, so render the link.
  }

  return { url, alias };
}

class RadioMusic {
  data() {
    return {
      permalink: "/radio-music.json",
      eleventyExcludeFromCollections: true,
    };
  }

  render() {
    let parsed;
    try {
      const raw = fs.readFileSync(SOURCE_PATH, "utf8");
      parsed = matter(raw);
    } catch (e) {
      return JSON.stringify({ stations: [] });
    }

    const all = parsed.data && Array.isArray(parsed.data.stations)
      ? parsed.data.stations
      : [];

    const populated = all
      .filter((s) => s && s.bandcamp_album_id)
      .map((s) => ({
        artists: Array.isArray(s.artists) ? s.artists.slice() : [],
        album_name: s.album_name || "",
        track_name: s.track_name || "",
        label: s.label || "",
        bandcamp_album_id: s.bandcamp_album_id,
        bandcamp_track_id: s.bandcamp_track_id || null,
        date_released: normalizeDate(s.date_released),
        date_updated: normalizeDate(s.date_updated),
        genre: s.genre || "",
        subgenre: Array.isArray(s.subgenre) ? s.subgenre.slice() : [],
        tts_readout: s.tts_readout || "",
        review: resolveReviewLink(s.review_link),
        station_band: s.station_band,
        station_freq: s.station_freq,
      }));

    return JSON.stringify({ stations: populated });
  }
}

module.exports = RadioMusic;
