// Force-directed graph for /network_nodes/.
//
// Renders to <canvas id="graph-canvas">, fed by /graph-data.json (built
// by src/graph-data.11ty.js). Two modes:
//   links — only page nodes; edges are wikilinks (one post → another)
//   tags  — page nodes + tag nodes; edges connect posts to their tags
//
// No external dependencies. The simulation is a naive O(n²) force layout
// (Coulomb-style repulsion + Hooke-style edge springs + center gravity).
// That's fine for the scale we expect (10s–low 100s of nodes). If the
// graph ever pushes 1000+ nodes, swap the inner loop for a Barnes-Hut
// quadtree.
//
// Click a node = navigate. Drag = pin. Mouse leaves canvas = release pin.
// Phase 8 styling should override the inline colors via CSS classes if
// the brutalist palette wants different hues.

(function () {
  if (typeof document === "undefined") return;

  var DATA_URL = "/graph-data.json";

  // Tuning — adjust these if the layout feels too crowded or too loose.
  // Repulsion + edge length scaled ~15% above the original 1200 / 90 so
  // nodes settle with more breathing room (less label-on-label overlap
  // and more diagram readability). Keep the two in proportion when
  // adjusting again: bumping just one warps the cluster shape.
  var REPULSION = 1380;       // node-to-node push strength
  var EDGE_LENGTH = 104;      // resting length of an edge spring
  var EDGE_STIFFNESS = 0.04;  // spring constant
  var GRAVITY = 0.004;        // pull toward canvas center
  var DAMPING = 0.82;         // velocity decay per tick (higher = looser)
  var NODE_RADIUS = 6;
  var HOVER_RADIUS = 9;
  var CLICK_THRESHOLD = 5;    // pixels of cursor movement under which a mouseup is treated as a click

  // Label truncation: titles longer than this many characters get shortened
  // with an ellipsis suffix. 32 chars at 11px monospace ≈ 220px wide.
  var MAX_TITLE_CHARS = 32;
  // Pixel buffer around each label's measured bbox. A label whose bbox
  // (plus this padding) overlaps a label already drawn this frame gets
  // skipped. Higher value = sparser placement.
  var LABEL_BBOX_PADDING = 4;

  function truncateTitle(title) {
    var t = String(title == null ? "" : title);
    if (t.length <= MAX_TITLE_CHARS) return t;
    return t.slice(0, MAX_TITLE_CHARS - 1).replace(/\s+$/, "") + "…";
  }


  var SECTION_COLORS = {
    blog: "#0a0",
    essays: "#06c",
    fragments: "#c0c",
    media: "#c80",
    pages: "#888",
    // Series + authors are navigation-hub sections (not content posts) but
    // still appear as nodes when graph_enabled is on. Pick colors distinct
    // from the four content sections so they read as their own category in
    // the legend.
    series: "#0bc",   // teal — series as woven threads
    authors: "#fc0",  // gold — author voices
  };
  var TAG_COLOR = "#f80";

  var canvas = document.getElementById("graph-canvas");
  if (!canvas) return;
  var ctx = canvas.getContext("2d");

  var data = null;
  var nodes = [];
  var byId = new Map();
  var mode = "links";
  var hoverNode = null;
  var dragging = null;
  var mouseDown = null;
  var rafHandle = null;

  // Wheel-driven zoom + click-drag panning. Both apply as a single
  // transform around the canvas center:
  //   translate(cx + panX, cy + panY) → scale(zoom) → translate(-cx, -cy)
  // Hit tests run in world coordinates, so getPos() un-projects
  // screen → world accounting for both pan and zoom. Labels render
  // OUTSIDE the transform so their font stays a consistent screen size.
  var zoom = 1;
  var ZOOM_MIN = 0.3;
  var ZOOM_MAX = 4;
  var ZOOM_STEP = 1.1;
  var panX = 0;
  var panY = 0;
  // Click-drag pan state. Active when a mousedown lands on empty canvas
  // (not on a node). panStart captures the screen-coord origin + the
  // pan offset at gesture start so mousemove can compute the delta.
  var panning = false;
  var panStart = null;

  // Legend filter state. Sections in this set are excluded from
  // activeNodes() — both rendering AND the simulation, so removing
  // sections re-balances the layout. Tag-mode toggles the synthetic
  // "tag" key (matched against node.type === "tag", not by section
  // name).
  var disabledSections = new Set();

  function resize() {
    // Scale to the device pixel ratio so the lines stay crisp on hi-dpi
    // displays. We render in CSS pixels but the backing buffer is larger.
    var dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function loadData() {
    return fetch(DATA_URL)
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function init(d) {
    if (!d) return;
    data = d;

    var w = canvas.clientWidth;
    var h = canvas.clientHeight;
    nodes = (d.nodes || []).map(function (n) {
      return Object.assign({}, n, {
        x: w / 2 + (Math.random() - 0.5) * Math.min(w, h) * 0.5,
        y: h / 2 + (Math.random() - 0.5) * Math.min(w, h) * 0.5,
        vx: 0,
        vy: 0,
      });
    });
    byId = new Map(nodes.map(function (n) { return [n.id, n]; }));

    setupListeners();
    rafHandle = requestAnimationFrame(tick);
  }

  function activeEdges() {
    if (!data) return [];
    return mode === "links" ? data.linkEdges : data.tagEdges;
  }

  function activeNodes() {
    var base = (mode === "links")
      ? nodes.filter(function (n) { return n.type === "page"; })
      : nodes;
    if (disabledSections.size === 0) return base;
    return base.filter(function (n) {
      // Tag nodes don't have a section; they live under the synthetic
      // "tag" key so the legend's tag toggle controls them in tag mode.
      var key = n.type === "tag" ? "tag" : n.section;
      return !disabledSections.has(key);
    });
  }

  function activeNodeSet() {
    var set = new Set();
    var list = activeNodes();
    for (var i = 0; i < list.length; i++) set.add(list[i].id);
    return set;
  }

  function simulate() {
    var visible = activeNodes();
    var visibleIds = new Set(visible.map(function (n) { return n.id; }));
    var edges = activeEdges();

    // Repulsion — every visible pair pushes each other.
    for (var i = 0; i < visible.length; i++) {
      var a = visible[i];
      for (var j = i + 1; j < visible.length; j++) {
        var b = visible[j];
        var dx = b.x - a.x;
        var dy = b.y - a.y;
        var distSq = dx * dx + dy * dy + 0.01;
        var dist = Math.sqrt(distSq);
        var force = REPULSION / distSq;
        var fx = (dx / dist) * force;
        var fy = (dy / dist) * force;
        a.vx -= fx; a.vy -= fy;
        b.vx += fx; b.vy += fy;
      }
    }

    // Spring force along each visible edge.
    for (var k = 0; k < edges.length; k++) {
      var e = edges[k];
      if (!visibleIds.has(e.source) || !visibleIds.has(e.target)) continue;
      var s = byId.get(e.source);
      var t = byId.get(e.target);
      if (!s || !t) continue;
      var ex = t.x - s.x;
      var ey = t.y - s.y;
      var ed = Math.sqrt(ex * ex + ey * ey) || 0.01;
      var spring = (ed - EDGE_LENGTH) * EDGE_STIFFNESS;
      var sx = (ex / ed) * spring;
      var sy = (ey / ed) * spring;
      s.vx += sx; s.vy += sy;
      t.vx -= sx; t.vy -= sy;
    }

    // Pull toward the center so the graph doesn't drift off-screen.
    var cx = canvas.clientWidth / 2;
    var cy = canvas.clientHeight / 2;
    for (var m = 0; m < visible.length; m++) {
      var n = visible[m];
      n.vx += (cx - n.x) * GRAVITY;
      n.vy += (cy - n.y) * GRAVITY;
    }

    // Integrate, except for the node currently being dragged (it's pinned
    // to the cursor, so applying velocity to it would fight the drag).
    for (var p = 0; p < visible.length; p++) {
      var node = visible[p];
      if (node === dragging) continue;
      node.vx *= DAMPING;
      node.vy *= DAMPING;
      node.x += node.vx;
      node.y += node.vy;
    }
  }

  function draw() {
    var w = canvas.clientWidth;
    var h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    var visible = activeNodes();
    var visibleIds = new Set(visible.map(function (n) { return n.id; }));
    var edges = activeEdges();

    // Edges + nodes inside the pan + zoom transform. Labels are drawn
    // after restore() so they stay readable at any zoom level.
    var cx = w / 2;
    var cy = h / 2;
    ctx.save();
    if (zoom !== 1 || panX !== 0 || panY !== 0) {
      ctx.translate(cx + panX, cy + panY);
      ctx.scale(zoom, zoom);
      ctx.translate(-cx, -cy);
    }

    // Edges first, so nodes draw on top.
    ctx.strokeStyle = "#3d3322";
    ctx.lineWidth = 1;
    for (var i = 0; i < edges.length; i++) {
      var e = edges[i];
      if (!visibleIds.has(e.source) || !visibleIds.has(e.target)) continue;
      var s = byId.get(e.source);
      var t = byId.get(e.target);
      if (!s || !t) continue;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.stroke();
    }

    // Nodes.
    for (var j = 0; j < visible.length; j++) {
      var n = visible[j];
      var r = n === hoverNode ? HOVER_RADIUS : NODE_RADIUS;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = colorFor(n);
      ctx.fill();
      ctx.strokeStyle = "#0a0a0a";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    ctx.restore();

    // Labels rendered in screen space (post-restore) so the 11px font
    // stays legible at every zoom level. Project each node's world
    // coords back to screen coords for placement. The "showAll" cutoff
    // keeps the canvas from being carpeted in text on large graphs.
    //
    // Collision avoidance: as each label is laid out, its measured bbox
    // (plus LABEL_BBOX_PADDING) is added to `placedBboxes`. Subsequent
    // labels that intersect any placed bbox are skipped. Long titles
    // get truncated via truncateTitle() before measurement.
    //
    // The hover label is always drawn LAST and ignores collision so it
    // overlays whatever's beneath. Keeps the hover target's name
    // readable even in dense regions.
    ctx.font = "11px monospace";
    ctx.fillStyle = "#c9a961";
    var showAll = visible.length < 30;
    var placedBboxes = [];

    function labelBbox(node) {
      var label = truncateTitle(node.title);
      // Project world → screen, accounting for pan as well as zoom.
      var lx = cx + (node.x - cx) * zoom + panX + 10;
      var ly = cy + (node.y - cy) * zoom + panY + 4;
      var w = ctx.measureText(label).width;
      // ly is the baseline; the visible glyph extends ~9px above and
      // ~3px below that line for the 11px monospace font.
      return {
        x: lx - LABEL_BBOX_PADDING,
        y: ly - 9 - LABEL_BBOX_PADDING,
        w: w + LABEL_BBOX_PADDING * 2,
        h: 13 + LABEL_BBOX_PADDING * 2,
        drawX: lx,
        drawY: ly,
        text: label,
      };
    }

    function bboxesOverlap(a, b) {
      return !(a.x + a.w < b.x || b.x + b.w < a.x ||
               a.y + a.h < b.y || b.y + b.h < a.y);
    }

    if (showAll) {
      for (var l = 0; l < visible.length; l++) {
        var node = visible[l];
        if (node === hoverNode) continue; // drawn last, unconditionally
        var bbox = labelBbox(node);
        var collides = false;
        for (var p = 0; p < placedBboxes.length; p++) {
          if (bboxesOverlap(bbox, placedBboxes[p])) {
            collides = true;
            break;
          }
        }
        if (collides) continue;
        ctx.fillText(bbox.text, bbox.drawX, bbox.drawY);
        placedBboxes.push(bbox);
      }
    }

    if (hoverNode) {
      var hbb = labelBbox(hoverNode);
      // Slightly brighter so the hovered name stands out from any
      // earlier labels it might be drawn over.
      ctx.fillStyle = "#f5c66e";
      ctx.fillText(hbb.text, hbb.drawX, hbb.drawY);
    }

    updateEmptyState(edges, visibleIds);
    updateLegend();
  }

  function updateEmptyState(edges, visibleIds) {
    var empty = document.getElementById("graph-empty");
    if (!empty) return;
    var anyEdges = false;
    for (var i = 0; i < edges.length; i++) {
      if (visibleIds.has(edges[i].source) && visibleIds.has(edges[i].target)) {
        anyEdges = true;
        break;
      }
    }
    empty.hidden = anyEdges;
  }

  function updateLegend() {
    var tagItem = document.querySelector(".graph-legend .legend-tag");
    if (tagItem) tagItem.hidden = mode !== "tags";
  }

  function colorFor(n) {
    if (n.type === "tag") return TAG_COLOR;
    return SECTION_COLORS[n.section] || "#aaa";
  }

  function tick() {
    simulate();
    draw();
    rafHandle = requestAnimationFrame(tick);
  }

  function getPos(e) {
    var rect = canvas.getBoundingClientRect();
    var sx = e.clientX - rect.left;
    var sy = e.clientY - rect.top;
    // Un-project screen → world. The full transform is:
    //   translate(cx + panX, cy + panY) → scale(zoom) → translate(-cx, -cy)
    // so the inverse from screen back to world is:
    //   worldX = cx + (sx - cx - panX) / zoom
    var cx = canvas.clientWidth / 2;
    var cy = canvas.clientHeight / 2;
    return {
      x: cx + (sx - cx - panX) / zoom,
      y: cy + (sy - cy - panY) / zoom,
    };
  }

  function nodeAt(x, y) {
    var visible = activeNodes();
    // Iterate in reverse so the topmost (most recently drawn) node wins.
    for (var i = visible.length - 1; i >= 0; i--) {
      var n = visible[i];
      var dx = n.x - x;
      var dy = n.y - y;
      if (dx * dx + dy * dy < (HOVER_RADIUS + 4) * (HOVER_RADIUS + 4)) return n;
    }
    return null;
  }

  function setMode(next) {
    if (next === mode) return;
    mode = next;
    var buttons = document.querySelectorAll(".graph-controls button[data-mode]");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute(
        "aria-pressed",
        buttons[i].dataset.mode === mode ? "true" : "false"
      );
    }
  }

  function setupListeners() {
    canvas.addEventListener("mousedown", function (e) {
      var pos = getPos(e);
      mouseDown = pos;
      var n = nodeAt(pos.x, pos.y);
      if (n) {
        dragging = n;
        canvas.classList.add("is-grabbing");
      } else {
        // Empty canvas → start a pan gesture. Capture the screen-coord
        // origin and the pan offset at gesture start so mousemove can
        // compute deltas in screen space (independent of zoom).
        panning = true;
        panStart = { mx: e.clientX, my: e.clientY, panX: panX, panY: panY };
        canvas.classList.add("is-grabbing");
      }
    });

    canvas.addEventListener("mousemove", function (e) {
      var pos = getPos(e);
      if (dragging) {
        dragging.x = pos.x;
        dragging.y = pos.y;
        dragging.vx = 0;
        dragging.vy = 0;
      } else if (panning) {
        panX = panStart.panX + (e.clientX - panStart.mx);
        panY = panStart.panY + (e.clientY - panStart.my);
      } else {
        hoverNode = nodeAt(pos.x, pos.y);
        canvas.style.cursor = hoverNode ? "pointer" : "grab";
      }
    });

    canvas.addEventListener("mouseup", function (e) {
      var pos = getPos(e);
      if (dragging && mouseDown) {
        var dx = pos.x - mouseDown.x;
        var dy = pos.y - mouseDown.y;
        var moved = Math.sqrt(dx * dx + dy * dy);
        if (moved < CLICK_THRESHOLD && dragging.url) {
          window.location.href = dragging.url;
        }
      }
      dragging = null;
      mouseDown = null;
      panning = false;
      panStart = null;
      canvas.classList.remove("is-grabbing");
    });

    canvas.addEventListener("mouseleave", function () {
      dragging = null;
      mouseDown = null;
      hoverNode = null;
      panning = false;
      panStart = null;
      canvas.classList.remove("is-grabbing");
    });

    // Wheel zoom. preventDefault() requires the listener to be non-passive
    // (modern browsers default wheel listeners to passive for scroll perf).
    canvas.addEventListener("wheel", function (e) {
      e.preventDefault();
      var factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom * factor));
    }, { passive: false });

    var buttons = document.querySelectorAll(".graph-controls button[data-mode]");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener("click", function (ev) {
        setMode(ev.currentTarget.dataset.mode);
      });
    }

    // Zoom buttons share the same step + clamp as the wheel handler.
    // "reset" snaps zoom back to 1x AND clears any pan offset so the
    // graph re-centers. The draw loop already runs on
    // requestAnimationFrame so no explicit redraw is needed.
    var zoomButtons = document.querySelectorAll(".graph-controls button[data-zoom]");
    for (var z = 0; z < zoomButtons.length; z++) {
      zoomButtons[z].addEventListener("click", function (ev) {
        var dir = ev.currentTarget.dataset.zoom;
        if (dir === "in") {
          zoom = Math.min(ZOOM_MAX, zoom * ZOOM_STEP);
        } else if (dir === "out") {
          zoom = Math.max(ZOOM_MIN, zoom / ZOOM_STEP);
        } else if (dir === "reset") {
          zoom = 1;
          panX = 0;
          panY = 0;
        }
      });
    }

    // Legend toggles. Clicking a legend row flips a section between
    // visible and hidden — affecting both rendering AND the
    // simulation (filtered nodes are dropped from activeNodes() so
    // they don't exert force on what remains). aria-pressed mirrors
    // the section's enabled state for screen readers and for the CSS
    // style hooks.
    var legendButtons = document.querySelectorAll(".graph-legend .legend-toggle");
    for (var lb = 0; lb < legendButtons.length; lb++) {
      legendButtons[lb].addEventListener("click", function (ev) {
        var btn = ev.currentTarget;
        var section = btn.dataset.section;
        if (!section) return;
        if (disabledSections.has(section)) {
          disabledSections.delete(section);
          btn.setAttribute("aria-pressed", "true");
        } else {
          disabledSections.add(section);
          btn.setAttribute("aria-pressed", "false");
        }
      });
    }

    // Scramble button — re-randomizes every node's position inside the
    // same band the initial layout uses, and zeros velocities. The force
    // simulation immediately starts pulling the new chaos back into
    // shape; useful when the current settled layout has overlaps or
    // awkward clusters and you want to roll the dice on a different one.
    var actionButtons = document.querySelectorAll(".graph-controls button[data-action]");
    for (var a = 0; a < actionButtons.length; a++) {
      actionButtons[a].addEventListener("click", function (ev) {
        var action = ev.currentTarget.dataset.action;
        if (action === "scramble") {
          var w = canvas.clientWidth;
          var h = canvas.clientHeight;
          var spread = Math.min(w, h) * 0.5;
          for (var i = 0; i < nodes.length; i++) {
            nodes[i].x = w / 2 + (Math.random() - 0.5) * spread;
            nodes[i].y = h / 2 + (Math.random() - 0.5) * spread;
            nodes[i].vx = 0;
            nodes[i].vy = 0;
          }
        }
      });
    }

    window.addEventListener("resize", resize);
  }

  function boot() {
    resize();
    loadData().then(init);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
