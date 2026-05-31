// Eleventy JavaScript template: emits /radio-music.json at build time.
//
// Feeds the radio widget's `bandcamp` signal type. Reads the station-pointer
// note at src/content/_data/radio-music.md (tracked in git, pipeline-excluded
// via .eleventyignore so it never renders as a page).
//
// Each station entry is a thin pointer: coordinates plus a wikilink to the
// canonical album note under
// src/content/_data/media/music/<artist>/<album>/album.md. The emitter
// resolves the wikilink, reads the album note's frontmatter, and pulls
// bandcamp_album_id / artists / album_name / tts_readout / etc. forward
// into the emitted JSON.
//
//   - band: ALPHA
//     frequency: 6
//     album: "[[_data/media/music/skee-mask/compro/album]]"
//     review_link:   # optional per-station override
//
// Unpopulated entries (no `album:` wikilink — i.e. just band+frequency) are
// SKIPPED on purpose. Their pre-assigned (band, freq) coords were all
// carrier_wave under the widget's hash-based signalAt() to begin with, so
// skipping them here means those coords stay carrier_wave channels with no
// special handling.
//
// Embed URL styling params (size, artwork, bgcol, linkcol, etc.) are NOT
// baked into this JSON. The widget owns those constants (via
// src/assets/js/bandcamp-embed.js's PRESETS.radio) so iteration on look
// stays in one place; the widget composes the embed URL from the id we
// emit here plus its own params.
//
// review_link wikilinks are resolved to {url, alias} at build time so the
// widget can render a clickable link with no runtime resolver.

const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");
const { parseWikilink, vaultPathExists } = require("./utils/wikilinks");
const { vaultPathToUrl } = require("./utils/permalink");
const { reportIssue } = require("./utils/build-report");
const { resolveAlbumLink, WIKILINK_RE } = require("./utils/album-note");

const CONTENT_ROOT = path.join(__dirname, "content");
const SOURCE_PATH = path.join(CONTENT_ROOT, "_data", "radio-music.md");
const HOST_FILE = "src/content/_data/radio-music.md";

// Cache: vaultPath -> target file's parsed frontmatter (or null on read
// error). Used by the review-link resolver below; the album-link resolver
// has its own cache inside src/utils/album-note.js.
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
// fatal-in-prod severity). Returns null for bad targets so the widget never
// ships a dead link even if reportIssue's prod-fatal halt somehow doesn't
// fire.
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
    reportIssue({
      kind: "review-link",
      file: HOST_FILE,
      offending: `[[${m[1]}]]`,
      reason: "target is draft (`draft: true`); URL will 404 in production",
      isDraft: false,
      isExcluded: false,
    });
    if (process.env.ELEVENTY_ENV === "production") return null;
  }

  return { url, alias };
}

// Builds the widget-ready station record from a parsed album-note
// frontmatter plus the station-pointer's own fields (coord + optional
// review_link override).
function mapFromAlbumNote(pointer, albumFm) {
  return {
    artists: Array.isArray(albumFm.artists) ? albumFm.artists.slice() : [],
    album_name: albumFm.album_name || "",
    track_name: albumFm.track_name || "",
    label: albumFm.label || "",
    bandcamp_album_id: albumFm.bandcamp_album_id,
    bandcamp_track_id: albumFm.bandcamp_track_id || null,
    date_released: normalizeDate(albumFm.date_released),
    date_updated: normalizeDate(albumFm.date_updated),
    genre: albumFm.genre || "",
    subgenre: Array.isArray(albumFm.subgenre) ? albumFm.subgenre.slice() : [],
    tts_readout: albumFm.tts_readout || "",
    // review_link normally lives on the album note (single source of
    // truth: a review belongs to the album, not the dial slot). Station
    // pointer may still override per-station for the rare case where
    // the radio should link somewhere other than the album's canonical
    // review.
    review: resolveReviewLink(pointer.review_link || albumFm.review_link),
    station_band: pointer.band != null ? pointer.band : pointer.station_band,
    station_freq: pointer.frequency != null ? pointer.frequency : pointer.station_freq,
  };
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

    const populated = [];
    for (const s of all) {
      if (!s || !s.album) continue;  // empty slot, stays carrier_wave on its coord
      const resolved = resolveAlbumLink(s.album, HOST_FILE, CONTENT_ROOT);
      if (!resolved) continue;
      populated.push(mapFromAlbumNote(s, resolved.frontmatter));
    }

    return JSON.stringify({ stations: populated });
  }
}

module.exports = RadioMusic;
