"use strict";

// Spotify embed URL builder. Used by the {% spotify %} Eleventy shortcode
// at build time. Unlike bandcamp-embed.js this module is Node-only — the
// site doesn't build Spotify URLs in the browser (Spotify is never on the
// radio, by design). Click-to-load behavior for the rendered shells is
// handled separately by /assets/js/spotify-embed-shell.js.
//
// Two variants are exposed:
//   - "compact":  152 px tall, single-row player (no visible tracklist).
//   - "full":     352 px tall, player + visible tracklist. The default.
//
// Spotify ids are base62 (a-zA-Z0-9), typically 22 chars. The shortcode
// validator pins this; the builder itself trusts its input.

const VARIANTS = {
  "compact": { height: 152 },
  "full":    { height: 352 },
};

function pick(val, fallback) {
  return (val === undefined || val === null) ? fallback : val;
}

function buildSpotifyEmbed(opts) {
  opts = opts || {};
  if (!opts.album && !opts.track) {
    throw new Error("buildSpotifyEmbed: album or track id is required");
  }
  const variantName = opts.variant || "full";
  const variant = VARIANTS[variantName];
  if (!variant) {
    throw new Error(`buildSpotifyEmbed: unknown variant "${variantName}"`);
  }

  const type = opts.track ? "track" : "album";
  const id = opts.track || opts.album;
  const src = `https://open.spotify.com/embed/${type}/${id}`;

  return {
    src,
    height: pick(opts.height, variant.height),
    variant: variantName,
  };
}

module.exports = { buildSpotifyEmbed, VARIANTS };
