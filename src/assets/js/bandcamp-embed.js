// Shared Bandcamp embed URL builder. Two consumers:
//   1. The radio widget (browser), via window.FJ.bandcampEmbed when this file
//      is loaded as a plain <script> before radio-widget.js.
//   2. The {% bandcamp %} Eleventy shortcode (Node), via require().
// One file owns the URL params, default colors, and natural heights for every
// variant we expose, so a single edit propagates to both surfaces.
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module && typeof module.exports === "object") {
    module.exports = api;
  }
  if (root) {
    root.FJ = root.FJ || {};
    root.FJ.bandcampEmbed = api;
  }
})(typeof window !== "undefined" ? window : null, function () {

  var DEFAULT_BGCOL = "333333";
  var DEFAULT_LINKCOL = "ffaa33";

  // Each preset is a Bandcamp param shape plus the natural iframe height.
  // Width is treated as 100% by all our callers, so only height is captured.
  // Semantics for individual fields:
  //   artwork: "default" | "none" | "small"   ("default" omits the param)
  //   tracklist: true | false                 (true omits, false emits tracklist=false)
  //   minimal: false | true                   (false omits, true emits minimal=true)
  //   transparent: false | true               (false omits, true emits transparent=true)
  // Heights come from Bandcamp's embed wizard ranges; tweak per-call if the
  // content demands it (e.g. a long tracklist needs more vertical room).
  var PRESETS = {
    "slim":             { size: "small", artwork: "default", tracklist: true,  minimal: false, transparent: true,  height: 42  },
    "slim-noart":       { size: "small", artwork: "none",    tracklist: true,  minimal: false, transparent: true,  height: 42  },
    "artwork-only":     { size: "large", artwork: "default", tracklist: true,  minimal: true,  transparent: true,  height: 350 },
    "big-art":          { size: "large", artwork: "default", tracklist: false, minimal: false, transparent: true,  height: 312 },
    "big-art-tracks":   { size: "large", artwork: "default", tracklist: true,  minimal: false, transparent: true,  height: 470 },
    "small-art":        { size: "large", artwork: "small",   tracklist: false, minimal: false, transparent: true,  height: 120 },
    "small-art-tracks": { size: "large", artwork: "small",   tracklist: true,  minimal: false, transparent: true,  height: 208 },
    // The radio widget's combination: large player, no art, no tracklist,
    // minimal=true to surface scrub controls only. transparent=false keeps the
    // exact URL the widget shipped with so the refactor stays equivalent.
    "radio":            { size: "large", artwork: "none",    tracklist: false, minimal: true,  transparent: false, height: 120 },
  };

  function pick(val, fallback) {
    return (val === undefined || val === null) ? fallback : val;
  }

  function buildBandcampEmbed(opts) {
    opts = opts || {};
    if (!opts.album && !opts.track) {
      throw new Error("buildBandcampEmbed: album or track id is required");
    }
    var presetName = opts.preset || "big-art-tracks";
    var preset = PRESETS[presetName];
    if (!preset) {
      throw new Error('buildBandcampEmbed: unknown preset "' + presetName + '"');
    }

    var size        = pick(opts.size,        preset.size);
    var artwork     = pick(opts.artwork,     preset.artwork);
    var tracklist   = pick(opts.tracklist,   preset.tracklist);
    var minimal     = pick(opts.minimal,     preset.minimal);
    var transparent = pick(opts.transparent, preset.transparent);
    var bgcol       = pick(opts.bgcol,       DEFAULT_BGCOL);
    var linkcol     = pick(opts.linkcol,     DEFAULT_LINKCOL);
    var height      = pick(opts.height,      preset.height);

    var idPart = opts.track ? "track=" + opts.track : "album=" + opts.album;

    var parts = ["size=" + size];
    if (artwork && artwork !== "default") parts.push("artwork=" + artwork);
    if (tracklist === false) parts.push("tracklist=false");
    if (minimal === true) parts.push("minimal=true");
    parts.push("bgcol=" + bgcol);
    parts.push("linkcol=" + linkcol);
    if (transparent === true) parts.push("transparent=true");

    var src = "https://bandcamp.com/EmbeddedPlayer/" + idPart + "/" +
              parts.join("/") + "/";

    return { src: src, height: height, preset: presetName };
  }

  return { buildBandcampEmbed: buildBandcampEmbed, PRESETS: PRESETS };
});
