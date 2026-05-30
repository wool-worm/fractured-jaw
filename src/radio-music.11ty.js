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
const { parseWikilink } = require("./utils/wikilinks");
const { vaultPathToUrl } = require("./utils/permalink");

const SOURCE_PATH = path.join(__dirname, "content", "_data", "radio-music.md");
const WIKILINK_RE = /^\s*\[\[([^\]\n]+?)\]\]\s*$/;

// js-yaml turns unquoted ISO dates into JS Date objects, quoted ones into
// strings. Normalize both to YYYY-MM-DD so the public JSON is uniform and
// the build's local timezone never leaks (Date.toISOString() is UTC).
function normalizeDate(value) {
  if (value == null || value === "") return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

// Wikilink string -> { url, alias } using the same primitives the rest of
// the site uses (so a review link here resolves to the same URL the body
// wikilink to that review would). Returns null when the value is empty, not
// a strict wikilink, or points outside KNOWN_SECTIONS.
//
// TODO (deferred): wire this through the build-report validator the same
// way body wikilinks and the `author` frontmatter field do. Today this is a
// silent best-effort resolve: a typo, a deleted review file, or a draft/
// excluded target all return null and the link just doesn't render. The
// existing wikilink validator in src/utils/wikilinks.js (vaultPathExists +
// vaultPathTargetIsExcluded) plus reportIssue() at fatal-in-prod would catch
// "album points at a draft review" and "album points at a deleted review"
// at build time, preventing a published album from shipping with a 404
// link. Pattern to copy: parseAuthorField in src/utils/authors.js.
function resolveReviewLink(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const m = s.match(WIKILINK_RE);
  if (!m) return null;
  const { vaultPath, alias } = parseWikilink(m[1]);
  const cleanPath = vaultPath.replace(/\.md$/i, "");
  const url = vaultPathToUrl(cleanPath);
  return url ? { url, alias } : null;
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
