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
  var REPULSION = 1200;       // node-to-node push strength
  var EDGE_LENGTH = 90;       // resting length of an edge spring
  var EDGE_STIFFNESS = 0.04;  // spring constant
  var GRAVITY = 0.004;        // pull toward canvas center
  var DAMPING = 0.82;         // velocity decay per tick (higher = looser)
  var NODE_RADIUS = 6;
  var HOVER_RADIUS = 9;
  var CLICK_THRESHOLD = 5;    // pixels of cursor movement under which a mouseup is treated as a click

  var SECTION_COLORS = {
    blog: "#0a0",
    essays: "#06c",
    fragments: "#c0c",
    media: "#c80",
    pages: "#888",
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

  // Wheel-driven zoom. Scales the canvas around its center. Hit tests run
  // in world coordinates, so getPos() un-projects screen → world before
  // calling nodeAt(). Labels render OUTSIDE the scale transform so their
  // font stays a consistent screen size.
  var zoom = 1;
  var ZOOM_MIN = 0.3;
  var ZOOM_MAX = 4;
  var ZOOM_STEP = 1.1;

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
    if (mode === "links") return nodes.filter(function (n) { return n.type === "page"; });
    return nodes;
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

    // Edges + nodes inside the scale-around-center transform so wheel
    // zoom magnifies everything around the canvas center. Labels are
    // drawn after restore() so they stay readable at any zoom.
    var cx = w / 2;
    var cy = h / 2;
    ctx.save();
    if (zoom !== 1) {
      ctx.translate(cx, cy);
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
    ctx.fillStyle = "#c9a961";
    ctx.font = "11px monospace";
    var showAll = visible.length < 30;
    for (var l = 0; l < visible.length; l++) {
      var node = visible[l];
      if (showAll || node === hoverNode) {
        var lx = cx + (node.x - cx) * zoom + 10;
        var ly = cy + (node.y - cy) * zoom + 4;
        ctx.fillText(node.title, lx, ly);
      }
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
    // Un-project screen → world so hit tests + drag positions use the
    // same coordinate space as the simulation.
    var cx = canvas.clientWidth / 2;
    var cy = canvas.clientHeight / 2;
    return {
      x: cx + (sx - cx) / zoom,
      y: cy + (sy - cy) / zoom,
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
      }
    });

    canvas.addEventListener("mousemove", function (e) {
      var pos = getPos(e);
      if (dragging) {
        dragging.x = pos.x;
        dragging.y = pos.y;
        dragging.vx = 0;
        dragging.vy = 0;
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
      canvas.classList.remove("is-grabbing");
    });

    canvas.addEventListener("mouseleave", function () {
      dragging = null;
      mouseDown = null;
      hoverNode = null;
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
