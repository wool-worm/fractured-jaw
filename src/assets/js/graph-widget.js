// Graph widget. Renders a small force-directed view inside
// <canvas id="graph-widget-canvas">. The widget appears top-right on
// every page (except /network_nodes/, suppressed in base.njk).
//
// Layout strategy is driven by the `page_type` data attribute on the
// outer <aside id="graph-widget"> element, set by the partial off
// frontmatter:
//
//   top      — global view, no centering (home, about, /tags/ index)
//   content  — pin current page to center, render its 1-hop neighborhood
//              (default for posts; falls back to top if current page
//              isn't graph_enabled)
//   section  — pack nodes from a given section near center
//              (used by /blog/, /essays/, /fragments/, /media/ landings)
//   tag      — pack nodes for a given tag near center
//              (used by /tags/<tag>/ pages)
//
// The user can also toggle between two edge sets at any time:
//
//   links — wikilink edges only; tag nodes are hidden
//   tags  — tag edges only; tag nodes are visible
//
// Header label tracks page_type: global_network, local_network,
// section_network, tag_network (snake_case is intentional aesthetic).
//
// Click any non-pinned node to navigate.

(function () {
  if (typeof document === "undefined") return;

  var canvas = document.getElementById("graph-widget-canvas");
  if (!canvas) return;
  var shell = document.getElementById("graph-widget");
  var ctx = canvas.getContext("2d");

  // Tuning — tighter than the full /network_nodes/ page because the
  // canvas is small.
  var REPULSION = 350;
  var EDGE_LENGTH = 32;
  var EDGE_STIFFNESS = 0.06;
  var GRAVITY = 0.02;
  // Used for anchored nodes in section/tag modes — much stronger than
  // GRAVITY so the cluster packs near center while non-anchor nodes
  // orbit at normal pull.
  var ANCHOR_GRAVITY = 0.18;
  var DAMPING = 0.78;
  var NODE_RADIUS = 4;
  var HOVER_RADIUS = 7;
  var TAG_COMPANIONS_LIMIT = 8;

  var SECTION_COLORS = {
    blog: "#0a0",
    essays: "#06c",
    fragments: "#c0c",
    media: "#c80",
    pages: "#888",
  };
  var TAG_COLOR = "#f80";
  var CURRENT_COLOR = "#000";

  // Page-type → header label. Snake_case matches the cyberpunk aesthetic.
  var LABELS = {
    top: "global_network",
    content: "local_network",
    section: "section_network",
    tag: "tag_network",
  };

  // Read up-front so init() and the mode toggle can both reference them.
  var pageType = (shell && shell.dataset.pageType) || "top";
  var currentSection = (shell && shell.dataset.section) || "";
  var currentTag = (shell && shell.dataset.currentTag) || "";

  var nodes = [];
  var byId = new Map();
  // Set of all link/tag edges; we filter by `mode` per-frame so toggling
  // doesn't reset the simulation.
  var linkEdges = [];
  var tagEdges = [];
  var pinnedId = null;        // single node forced to canvas center (content mode)
  var anchorIds = new Set();  // nodes pulled to center with ANCHOR_GRAVITY (section/tag modes)
  var hoverNode = null;
  var mode = "links";         // edge mode toggle: "links" | "tags"

  function resize() {
    var dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function normalizePath(p) {
    if (!p) return "/";
    if (!/\/$/.test(p)) p += "/";
    return p;
  }

  function hideWidget() {
    if (shell) shell.style.display = "none";
  }

  function setLabel(text) {
    var label = document.getElementById("graph-widget-label");
    if (label) label.textContent = text;
  }

  // 1-hop neighborhood for content (local) mode: current node + every
  // node it has at least one edge to (wikilinks both ways + own tags +
  // a small sample of posts that share its tags).
  function buildNeighborhood(data, current) {
    var ids = new Set([current.id]);
    for (var i = 0; i < data.linkEdges.length; i++) {
      var le = data.linkEdges[i];
      if (le.source === current.id) ids.add(le.target);
      else if (le.target === current.id) ids.add(le.source);
    }

    var myTags = [];
    for (var j = 0; j < data.tagEdges.length; j++) {
      var te = data.tagEdges[j];
      if (te.source === current.id) {
        ids.add(te.target);
        myTags.push(te.target);
      }
    }
    if (myTags.length) {
      var companions = [];
      for (var k = 0; k < data.tagEdges.length; k++) {
        var te2 = data.tagEdges[k];
        if (te2.source !== current.id && myTags.indexOf(te2.target) >= 0) {
          if (companions.indexOf(te2.source) < 0) companions.push(te2.source);
        }
      }
      companions.slice(0, TAG_COMPANIONS_LIMIT).forEach(function (id) {
        ids.add(id);
      });
    }

    return ids;
  }

  // Section anchor: every page node whose section matches currentSection.
  function buildSectionAnchors(data) {
    var ids = new Set();
    for (var i = 0; i < data.nodes.length; i++) {
      var n = data.nodes[i];
      if (n.type === "page" && n.section === currentSection) ids.add(n.id);
    }
    return ids;
  }

  // Tag anchor: the tag node itself + every page node tagged with it.
  function buildTagAnchors(data) {
    var ids = new Set();
    var tagId = "tag:" + currentTag;
    if (byIdHas(data, tagId)) ids.add(tagId);
    for (var i = 0; i < data.tagEdges.length; i++) {
      var te = data.tagEdges[i];
      if (te.target === tagId) ids.add(te.source);
    }
    return ids;
  }

  function byIdHas(data, id) {
    for (var i = 0; i < data.nodes.length; i++) {
      if (data.nodes[i].id === id) return true;
    }
    return false;
  }

  function init(data) {
    if (!data || !data.nodes || data.nodes.length === 0) {
      hideWidget();
      return;
    }

    var here = normalizePath(window.location.pathname);
    var current = null;
    for (var i = 0; i < data.nodes.length; i++) {
      if (data.nodes[i].url === here) {
        current = data.nodes[i];
        break;
      }
    }

    var visibleIds = null;
    var resolvedType = pageType;

    if (resolvedType === "content") {
      if (current) {
        var hood = buildNeighborhood(data, current);
        if (hood.size > 1) {
          pinnedId = current.id;
          visibleIds = hood;
        } else {
          resolvedType = "top"; // isolated node — show full graph instead
        }
      } else {
        resolvedType = "top"; // current page not graphed — full graph
      }
    }

    if (resolvedType === "section") {
      anchorIds = buildSectionAnchors(data);
      if (anchorIds.size === 0) resolvedType = "top";
    }

    if (resolvedType === "tag") {
      anchorIds = buildTagAnchors(data);
      if (anchorIds.size === 0) resolvedType = "top";
    }

    if (!visibleIds) {
      visibleIds = new Set(data.nodes.map(function (n) { return n.id; }));
    }

    setLabel(LABELS[resolvedType] || LABELS.top);

    var w = canvas.clientWidth;
    var h = canvas.clientHeight;
    var cx = w / 2;
    var cy = h / 2;
    nodes = data.nodes
      .filter(function (n) { return visibleIds.has(n.id); })
      .map(function (n) {
        // Anchored nodes start near center so they cohere quickly.
        // Non-anchored start scattered so the cluster has space to form.
        var nearCenter = anchorIds.has(n.id) || n.id === pinnedId;
        var spread = nearCenter ? 0.15 : 0.6;
        return Object.assign({}, n, {
          x: cx + (Math.random() - 0.5) * w * spread,
          y: cy + (Math.random() - 0.5) * h * spread,
          vx: 0,
          vy: 0,
        });
      });
    byId = new Map(nodes.map(function (n) { return [n.id, n]; }));

    // Stash both edge sets; mode-toggle filters at sim/draw time.
    linkEdges = [];
    for (var p = 0; p < data.linkEdges.length; p++) {
      var le3 = data.linkEdges[p];
      if (visibleIds.has(le3.source) && visibleIds.has(le3.target)) linkEdges.push(le3);
    }
    tagEdges = [];
    for (var q = 0; q < data.tagEdges.length; q++) {
      var te3 = data.tagEdges[q];
      if (visibleIds.has(te3.source) && visibleIds.has(te3.target)) tagEdges.push(te3);
    }

    setupListeners();
    requestAnimationFrame(tick);
  }

  // Active set helpers — depend on the current mode toggle.
  function activeNodes() {
    if (mode === "links") {
      return nodes.filter(function (n) { return n.type !== "tag"; });
    }
    return nodes;
  }
  function activeEdges() {
    return mode === "links" ? linkEdges : tagEdges;
  }

  function simulate() {
    var visible = activeNodes();
    var visibleIds = new Set(visible.map(function (n) { return n.id; }));
    var edges = activeEdges();

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

    var cx = canvas.clientWidth / 2;
    var cy = canvas.clientHeight / 2;
    for (var m = 0; m < visible.length; m++) {
      var n = visible[m];
      var g = anchorIds.has(n.id) ? ANCHOR_GRAVITY : GRAVITY;
      n.vx += (cx - n.x) * g;
      n.vy += (cy - n.y) * g;
      n.vx *= DAMPING;
      n.vy *= DAMPING;
      n.x += n.vx;
      n.y += n.vy;
    }

    // Hard-pin (content mode) — set after integration so nothing budges
    // the "you are here" anchor.
    if (pinnedId) {
      var pinned = byId.get(pinnedId);
      if (pinned) {
        pinned.x = cx;
        pinned.y = cy;
        pinned.vx = 0;
        pinned.vy = 0;
      }
    }
  }

  function colorFor(n) {
    if (n.id === pinnedId) return CURRENT_COLOR;
    if (n.type === "tag") return TAG_COLOR;
    return SECTION_COLORS[n.section] || "#aaa";
  }

  function draw() {
    var w = canvas.clientWidth;
    var h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    var visible = activeNodes();
    var visibleIds = new Set(visible.map(function (n) { return n.id; }));
    var edges = activeEdges();

    ctx.strokeStyle = "#999";
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

    for (var j = 0; j < visible.length; j++) {
      var n = visible[j];
      var r = n === hoverNode || n.id === pinnedId ? HOVER_RADIUS : NODE_RADIUS;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = colorFor(n);
      ctx.fill();
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    if (hoverNode) {
      ctx.fillStyle = "#000";
      ctx.font = "10px monospace";
      ctx.fillText(hoverNode.title || "", hoverNode.x + 9, hoverNode.y + 3);
    }
  }

  function tick() {
    simulate();
    draw();
    requestAnimationFrame(tick);
  }

  function getPos(e) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  function nodeAt(x, y) {
    var visible = activeNodes();
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
    var buttons = shell.querySelectorAll(".graph-widget-toggle button[data-mode]");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute(
        "aria-pressed",
        buttons[i].dataset.mode === mode ? "true" : "false"
      );
    }
  }

  function setupListeners() {
    canvas.addEventListener("mousemove", function (e) {
      var pos = getPos(e);
      hoverNode = nodeAt(pos.x, pos.y);
      canvas.style.cursor = hoverNode && hoverNode.id !== pinnedId ? "pointer" : "default";
    });
    canvas.addEventListener("mouseleave", function () {
      hoverNode = null;
    });
    canvas.addEventListener("click", function (e) {
      var pos = getPos(e);
      var n = nodeAt(pos.x, pos.y);
      if (n && n.url && n.id !== pinnedId) {
        window.location.href = n.url;
      }
    });

    var buttons = shell.querySelectorAll(".graph-widget-toggle button[data-mode]");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener("click", function (ev) {
        setMode(ev.currentTarget.dataset.mode);
      });
    }

    window.addEventListener("resize", resize);
  }

  function boot() {
    resize();
    fetch("/graph-data.json")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(init)
      .catch(hideWidget);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
