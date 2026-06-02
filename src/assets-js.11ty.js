// Eleventy JavaScript template: emits each client script in src/assets/js/ at
// its content-hashed public URL (e.g. /assets/js/radio-widget.<hash>.js).
//
// This replaces the old blanket `addPassthroughCopy({ "src/assets/js": ... })`.
// The reason is cache-busting: assets are served with a 1-year immutable
// browser cache, so a fixed URL like /assets/js/radio-widget.js would let a
// returning visitor's browser hold stale JS for up to a year after a deploy,
// independent of any Cloudflare edge purge. Hashing the filename makes each
// version a new URL, so the browser fetches changes immediately. The matching
// URLs are exposed to templates via the `assets` global (src/_data/assets.js);
// hashes come from src/utils/asset-manifest.js (the single source of truth).
//
// Emitting via a template (rather than passthrough-with-rename) keeps the dev
// server serving these correctly and writes the file bytes verbatim: .11ty.js
// output is not run through Nunjucks, so JS containing `{{` or `{%` is safe.
// The src/assets/ watch target rebuilds these on edit in `eleventy --serve`.

const fs = require("fs");
const path = require("path");
const { getManifest, JS_DIR } = require("./utils/asset-manifest");

module.exports = class {
  data() {
    const manifest = getManifest();
    // One pagination item per JS file: { name, url } where url is the hashed
    // public path the matching `assets` global entry also points at.
    const scripts = Object.keys(manifest)
      .filter((name) => name.endsWith(".js"))
      .map((name) => ({ name, url: manifest[name] }));
    return {
      scripts,
      pagination: { data: "scripts", size: 1, alias: "script" },
      permalink: ({ script }) => script.url,
      eleventyExcludeFromCollections: true,
    };
  }

  render({ script }) {
    return fs.readFileSync(path.join(JS_DIR, script.name), "utf8");
  }
};
