// Eleventy JavaScript template — emits /assets/css/site.css at build time.
//
// Source CSS lives as separate authoring modules in src/_css/ (one file
// per concern: variables, fonts, base, layout, components, etc.). This
// template concatenates them in load order into a single bundled file
// served at /assets/css/site.css.
//
// Why bundle: Lighthouse flagged the previous @import-chain site.css
// (eleven `@import url(...)` statements) as render-blocking — every
// @import is a serial blocking request from the browser, producing a
// long CSS waterfall. Shipping one bundled file collapses that waterfall
// to a single round-trip and cuts ~550ms off mobile LCP on cold loads.
//
// Author workflow is unchanged: edit the files in src/_css/, build
// concatenates them. To add a new module, drop it in src/_css/ and add
// the filename to MODULES below in the right position.
//
// Relative URLs inside modules (e.g. fonts.css → url('fonts/...')) resolve
// against the bundle's published URL (/assets/css/site.css), which is
// the same /assets/css/ path the fonts/ subdir is passthrough-copied to.
// No URL rewriting needed.

const fs = require("fs");
const path = require("path");

// Load order matters:
//   variables.css  — CSS custom properties consumed by every later module
//   fonts.css      — @font-face rules referenced by base + components
//   base.css       — element resets / typography defaults
//   layout.css     — page-level grid / responsive breakpoints
//   components.css — post-card, post-meta, widgets, etc.
//   decoration.css — borders, dividers, ornamental flourishes
//   effects.css    — keyframes / transitions / filter primitives
//   graph.css      — local-graph widget styling
//   radio.css      — radio widget styling
//   systems.css    — system-status widget styling
//   cult.css       — site-wide aesthetic overrides; must win cascade ties
//   zen.css        — calm reading mode; scoped under html.zen, must win over cult
const MODULES = [
  "variables.css",
  "fonts.css",
  "base.css",
  "layout.css",
  "components.css",
  "decoration.css",
  "effects.css",
  "graph.css",
  "radio.css",
  "systems.css",
  "cult.css",
  "zen.css",
];

const MODULE_DIR = path.join(__dirname, "_css");

module.exports = class {
  data() {
    return {
      permalink: "/assets/css/site.css",
      eleventyExcludeFromCollections: true,
    };
  }

  render() {
    return MODULES.map((name) => {
      const filePath = path.join(MODULE_DIR, name);
      const contents = fs.readFileSync(filePath, "utf8");
      return `/* ===== ${name} ===== */\n${contents}`;
    }).join("\n\n");
  }
};
