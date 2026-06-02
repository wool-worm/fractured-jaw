// Eleventy JavaScript template. Emits the bundled stylesheet at build time.
//
// Source CSS lives as separate authoring modules in src/_css/ (one file per
// concern: variables, fonts, base, layout, components, etc.). The module list
// and the concatenation live in src/utils/asset-manifest.js (CSS_MODULES /
// buildCss) so the bundler, the fingerprint hash, and the `assets` global all
// agree. To add a module, edit CSS_MODULES there, in the right cascade
// position.
//
// Why bundle: the previous @import-chain site.css (eleven serial `@import`
// requests) was render-blocking. Shipping one concatenated file collapses that
// waterfall to a single round-trip.
//
// Why the hashed filename: the published path is /assets/css/site.<hash>.css,
// not a fixed /assets/css/site.css. Assets are served with a 1-year immutable
// browser cache, so a fixed URL would strand returning visitors on stale CSS
// for up to a year after a deploy (Cloudflare's edge purge can't evict a
// max-age already in a browser). The content hash changes the URL whenever the
// bundle's bytes change, so browsers fetch the new version immediately.
// head.njk references it via the `assets` global: {{ assets["site.css"] }}.
//
// Relative URLs inside modules (e.g. fonts.css → url('fonts/...')) resolve
// against the bundle's directory (/assets/css/), which the filename hash does
// not change, so the passthrough-copied fonts/ subdir keeps resolving. No URL
// rewriting needed.

const { buildCss, getManifest } = require("./utils/asset-manifest");

module.exports = class {
  data() {
    return {
      permalink: getManifest()["site.css"],
      eleventyExcludeFromCollections: true,
    };
  }

  render() {
    return buildCss();
  }
};
