(() => {
'use strict';
// =====================================================================
// Sketch to Plan — editor and app shell
// =====================================================================
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KEY = 'sketchplan-v1';
const ROOM_NAMES = ['Living room', 'Kitchen', 'Bedroom', 'Bathroom', 'Hall', 'WC', 'Dining', 'Office', 'Garage', 'Storage', 'Utility', 'Wardrobe'];

// ---------- storage ----------
let store = { current: null, projects: {} };
try { const s = localStorage.getItem(KEY); if (s) store = JSON.parse(s); } catch (e) {}
let P = null, saveWarned = false;
function persist() {
  if (!P) return; P.modified = new Date().toISOString(); store.projects[P.id] = P; store.current = P.id;
  try { localStorage.setItem(KEY, JSON.stringify(store)); }
  catch (e) { // picture too big for this browser's storage: keep the drawing, drop old pictures
    try { const slim = JSON.parse(JSON.stringify(store)); Object.values(slim.projects).forEach(p => { if (p.id !== P.id && p.image) p.image.src = null; }); localStorage.setItem(KEY, JSON.stringify(slim)); }
    catch (e2) { if (!saveWarned) { toast('This browser is out of space. Download a project file to keep your work.'); saveWarned = true; } } }
}

// ---------- state ----------
let buildWall = null, buildView = 'wall', buildFace = null;
let STEP = 'plan', tool = 'wall', wallKind = 'ext', sel = null, chain = null, hover = null, planView = '2d', sheetZoom = 1;
let view = null, SOL = null, RAS = null, dirty = true, SAMPLE = null, SAMPLE_IMG = false, detecting = null;
const hist = [], fut = [];
function snapshot() { const c = JSON.parse(JSON.stringify(Object.assign({}, P, { image: null }))); c.image = P.image ? Object.assign({}, P.image) : null; return c; }
function change(fn, keepRedo) { hist.push(snapshot()); if (hist.length > 80) hist.shift(); if (!keepRedo) fut.length = 0; fn(); Plan.tidy(P, chain ? [chain] : []); dirty = true; persist(); render(); }
function undo() { if (!hist.length) return; fut.push(snapshot()); restore(hist.pop()); }
function redo() { if (!fut.length) return; hist.push(snapshot()); restore(fut.pop()); }
function restore(s) { Object.assign(P, s); sel = null; chain = null; dirty = true; view = null; persist(); render(); }
function solved() { if (dirty || !SOL) { SOL = Plan.solve(P); try { RAS = P.walls.length ? Plan.raster(P, SOL) : null; } catch (e) { RAS = null; } dirty = false; } return SOL; }

// ---------- small UI helpers ----------
function toast(t) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 2800); }
const armed = new Map();
function confirmTap(el, label) { const k = el.dataset.act + (el.dataset.id || ''); if (armed.has(k) && Date.now() - armed.get(k) < 4000) { armed.delete(k); return true; }
  armed.set(k, Date.now()); const old = el.textContent; el.textContent = label || 'Tap again to confirm'; el.classList.add('armed');
  setTimeout(() => { if (el.isConnected && armed.has(k)) { el.textContent = old; el.classList.remove('armed'); armed.delete(k); } }, 4000); return false; }
function openModal(html) { $('modalCard').innerHTML = html; $('modal').hidden = false; }
function closeModal() { $('modal').hidden = true; $('modalCard').innerHTML = ''; }
const wallName = w => 'W' + (P.walls.indexOf(w) + 1);
const dimStyle = () => P.settings.dimStyle;
const fmt = m => Plan.fmtLen(m, dimStyle()) + (dimStyle() === 'ft' ? '' : ' ' + Plan.unitLabel(dimStyle()));

// =====================================================================
// Step navigation and rendering
// =====================================================================
function go(step) { STEP = step; if (step !== 'trace') chain = null; if (step === 'measure' && sel && sel.kind !== 'wall') sel = null; render(); }
function render() {
  document.querySelectorAll('nav.steps button').forEach(b => b.setAttribute('aria-selected', b.dataset.step === STEP));
  $('projName').value = P.name;
  if (STEP === 'plan') renderPlanBoard(); else if (STEP === 'build') renderBuildBoard(); else renderEditor();
  renderTray();
}

// ---------- editor board (picture / trace / measure) ----------
function boardSize() { const r = $('board').getBoundingClientRect(); return { w: Math.max(50, r.width), h: Math.max(50, r.height) }; }
function fitView() {
  let x0 = 0, y0 = 0, x1 = 1000, y1 = 750;
  if (P.image) { x1 = P.image.w; y1 = P.image.h; }
  if (P.nodes.length) { const xs = P.nodes.map(n => n.x), ys = P.nodes.map(n => n.y); x0 = Math.min(x0, ...xs); y0 = Math.min(y0, ...ys); x1 = Math.max(x1, ...xs); y1 = Math.max(y1, ...ys); }
  const pad = Math.max(x1 - x0, y1 - y0) * 0.05; view = { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
  const B = boardSize(), ar = B.w / B.h; if (view.w / view.h < ar) { const nw = view.h * ar; view.x -= (nw - view.w) / 2; view.w = nw; } else { const nh = view.w / ar; view.y -= (nh - view.h) / 2; view.h = nh; }
}
const unit = () => view.w / boardSize().w; // picture pixels per screen pixel
function renderEditor() {
  const board = $('board');
  if (!board.querySelector('svg.ed')) { board.innerHTML = `<svg class="ed" id="ed" preserveAspectRatio="xMidYMid meet"></svg><div class="float tl" id="edTop"></div><div class="float br">
      <button class="b sm" data-act="zoomIn" aria-label="Zoom in">+</button><button class="b sm" data-act="zoomOut" aria-label="Zoom out">−</button><button class="b sm" data-act="fit">Fit</button></div><div class="hint" id="edHint"></div>`; view = null; }
  if (!view) fitView();
  drawEditor();
}
function drawEditor() {
  const svg = $('ed'); if (!svg) return; const S = solved(), u = unit(), mPerPx = S.scale || 0.02;
  svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
  let h = '';
  if (P.image && P.image.src) h += `<image href="${P.image.src}" x="0" y="0" width="${P.image.w}" height="${P.image.h}" opacity="${STEP === 'picture' ? 1 : (P.settings.imgOpacity != null ? P.settings.imgOpacity : 0.55)}"/>`;
  else { const g = 50; h += `<defs><pattern id="grid" width="${g}" height="${g}" patternUnits="userSpaceOnUse"><path d="M ${g} 0 L 0 0 0 ${g}" fill="none" stroke="var(--line)" stroke-width="1" vector-effect="non-scaling-stroke"/></pattern></defs><rect x="${view.x}" y="${view.y}" width="${view.w}" height="${view.h}" fill="url(#grid)"/>`; }
  if (STEP !== 'picture' || P.walls.length) {
    const conflict = new Set((S.conflicts || []).map(c => c.wall));
    P.walls.forEach(w => { const a = Plan.nodeById(P, w.a), b = Plan.nodeById(P, w.b); const isSel = sel && sel.kind === 'wall' && sel.id === w.id;
      const col = isSel ? 'var(--select)' : STEP === 'measure' && conflict.has(w.id) ? 'var(--bad)' : STEP === 'measure' && w.len > 0 ? 'var(--given)' : w.ext ? 'var(--ink)' : 'var(--muted)';
      h += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${col}" stroke-width="${w.ext ? 7 : 4}" stroke-linecap="round" vector-effect="non-scaling-stroke" opacity="${STEP === 'picture' ? 0.6 : 0.9}"/>`; });
    P.openings.forEach(o => { const w = Plan.wallById(P, o.wall); if (!w) return; const a = Plan.nodeById(P, w.a), b = Plan.nodeById(P, w.b);
      const L = Plan.hyp(b.x - a.x, b.y - a.y) || 1, ux = (b.x - a.x) / L, uy = (b.y - a.y) / L, half = Math.min(o.width / mPerPx / 2, L / 2), c = Plan.clamp(o.t, half / L, 1 - half / L) * L;
      const p0 = [a.x + ux * (c - half), a.y + uy * (c - half)], p1 = [a.x + ux * (c + half), a.y + uy * (c + half)], isSel = sel && sel.kind === 'opening' && sel.id === o.id;
      const col = isSel ? 'var(--select)' : o.type === 'window' ? '#2f8fd1' : o.type === 'door' ? '#c77d16' : '#7a8a96';
      h += `<line x1="${p0[0]}" y1="${p0[1]}" x2="${p1[0]}" y2="${p1[1]}" stroke="var(--board)" stroke-width="9" vector-effect="non-scaling-stroke"/><line x1="${p0[0]}" y1="${p0[1]}" x2="${p1[0]}" y2="${p1[1]}" stroke="${col}" stroke-width="5" vector-effect="non-scaling-stroke"/>`;
      if (o.type === 'door') { const s = o.side || 1, hg = o.hinge === 'b' ? p1 : p0, nx = -uy * s, ny = ux * s, r = half * 2, ox = o.hinge === 'b' ? p0 : p1;
        h += `<path d="M ${hg[0]} ${hg[1]} L ${hg[0] + nx * r} ${hg[1] + ny * r} A ${r} ${r} 0 0 ${(o.hinge === 'b') === (s > 0) ? 1 : 0} ${ox[0]} ${ox[1]}" fill="none" stroke="${col}" stroke-width="1.5" vector-effect="non-scaling-stroke" stroke-dasharray="4 3"/>`; } });
    if (STEP !== 'picture') P.nodes.forEach(n => { const isSel = sel && sel.kind === 'node' && sel.id === n.id, isChain = chain === n.id;
      h += `<circle cx="${n.x}" cy="${n.y}" r="${(isSel || isChain ? 6 : 4) * u}" fill="${isSel || isChain ? 'var(--select)' : 'var(--surface)'}" stroke="var(--ink)" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`; });
    if (STEP === 'measure') P.walls.forEach(w => { const a = Plan.nodeById(P, w.a), b = Plan.nodeById(P, w.b); const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const L = Plan.hyp(b.x - a.x, b.y - a.y) || 1, nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L, off = 14 * u; const given = w.len > 0;
      const t = `${wallName(w)}  ${Plan.fmtLen(given ? w.len : S.len[w.id], dimStyle())}`;
      h += `<text x="${mx + nx * off}" y="${my + ny * off}" font-size="${12 * u}" text-anchor="middle" dominant-baseline="middle" font-family="IBM Plex Mono,monospace" font-weight="${given ? 600 : 400}" fill="${given ? 'var(--given)' : 'var(--muted)'}" stroke="var(--board)" stroke-width="${3 * u}" paint-order="stroke">${esc(t)}</text>`; });
    P.rooms.forEach(r => { const isSel = sel && sel.kind === 'room' && sel.id === r.id;
      h += `<text x="${r.x}" y="${r.y}" font-size="${14 * u}" text-anchor="middle" dominant-baseline="middle" font-weight="600" font-family="Archivo,sans-serif" fill="${isSel ? 'var(--select)' : 'var(--ink)'}" stroke="var(--board)" stroke-width="${4 * u}" paint-order="stroke">${esc(r.name)}</text>`; });
    if (STEP === 'trace' && tool === 'wall' && chain && hover) { const a = Plan.nodeById(P, chain); if (a) h += `<line x1="${a.x}" y1="${a.y}" x2="${hover.x}" y2="${hover.y}" stroke="var(--select)" stroke-width="2" stroke-dasharray="6 5" vector-effect="non-scaling-stroke"/>`; }
    if (STEP === 'trace' && hover && hover.snap) h += `<circle cx="${hover.x}" cy="${hover.y}" r="${9 * u}" fill="none" stroke="var(--select)" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
  }
  svg.innerHTML = h;
  const hint = $('edHint');
  if (hint) { hint.textContent = STEP === 'picture' ? (P.image ? 'Your picture. Next: trace the walls or detect them automatically.' : 'Add a photo or scan of your sketch.')
    : STEP === 'measure' ? 'Tap a wall and type its approximate length.'
    : ({ wall: chain ? 'Tap the next corner. Tap the first corner to close, or Done.' : 'Tap a corner to start a wall.', select: 'Tap to select. Drag corners to move them.', door: 'Tap a wall to add a door.', window: 'Tap a wall to add a window.', opening: 'Tap a wall to add an opening without a door.', room: 'Tap inside a room to name it.', erase: 'Tap anything to delete it.' })[tool];
    hint.hidden = false; }
  const top = $('edTop'); if (top) top.innerHTML = STEP === 'trace' ? `<button class="b sm" data-act="undo" ${hist.length ? '' : 'disabled'}>Undo</button><button class="b sm" data-act="redo" ${fut.length ? '' : 'disabled'}>Redo</button>${chain ? '<button class="b sm primary" data-act="done">Done</button>' : ''}` : '';
}

// ---------- geometry helpers in picture space ----------
function toImg(e) { const svg = $('ed'); const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const m = svg.getScreenCTM(); if (!m) return { x: 0, y: 0 }; const q = pt.matrixTransform(m.inverse()); return { x: q.x, y: q.y }; }
function nearestNode(p, tol, except) { let best = null, bd = tol; P.nodes.forEach(n => { if (n.id === except) return; const d = Plan.hyp(n.x - p.x, n.y - p.y); if (d < bd) { bd = d; best = n; } }); return best; }
function projOnWall(p, w) { const a = Plan.nodeById(P, w.a), b = Plan.nodeById(P, w.b); const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1; const t = Plan.clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / L2, 0, 1); const x = a.x + dx * t, y = a.y + dy * t; return { t, x, y, d: Plan.hyp(p.x - x, p.y - y) }; }
function nearestWall(p, tol) { let best = null; P.walls.forEach(w => { const q = projOnWall(p, w); if (q.d < tol && (!best || q.d < best.q.d)) best = { w, q }; }); return best; }
function nearestOpening(p, tol) { const S = solved(), mPerPx = S.scale || 0.02; let best = null;
  P.openings.forEach(o => { const w = Plan.wallById(P, o.wall); if (!w) return; const q = projOnWall(p, w), a = Plan.nodeById(P, w.a), b = Plan.nodeById(P, w.b), L = Plan.hyp(b.x - a.x, b.y - a.y);
    if (q.d < tol && Math.abs(q.t - o.t) * L < o.width / mPerPx / 2 + tol && (!best || q.d < best.d)) best = { o, d: q.d }; }); return best && best.o; }
function nearestRoom(p, tol) { let best = null, bd = tol * 2.5; P.rooms.forEach(r => { const d = Plan.hyp(r.x - p.x, r.y - p.y); if (d < bd) { bd = d; best = r; } }); return best; }
function snapPoint(p) {
  const tol = 16 * unit();
  const n = nearestNode(p, tol); if (n) return { x: n.x, y: n.y, node: n.id, snap: true };
  let q = { x: p.x, y: p.y };
  if (chain && P.settings.squareUp) { const a = Plan.nodeById(P, chain); const ang = Math.atan2(q.y - a.y, q.x - a.x) / Math.PI * 180; const r = Math.round(ang / 90) * 90;
    if (Math.abs(ang - r) < 10) { const d = Plan.hyp(q.x - a.x, q.y - a.y); q = { x: a.x + Math.cos(r * Math.PI / 180) * d, y: a.y + Math.sin(r * Math.PI / 180) * d }; }
    // also line up with other corners horizontally / vertically
    P.nodes.forEach(m => { if (m.id === chain) return; if (Math.abs(m.x - q.x) < tol * 0.6) q.x = m.x; if (Math.abs(m.y - q.y) < tol * 0.6) q.y = m.y; }); }
  const ww = nearestWall(q, tol); if (ww && !(chain && (ww.w.a === chain || ww.w.b === chain))) return { x: ww.q.x, y: ww.q.y, on: ww.w.id, t: ww.q.t, snap: true };
  return q;
}
function placeNode(sp) {
  if (sp.node) return sp.node;
  const n = { id: Plan.uid('n'), x: sp.x, y: sp.y };
  if (sp.on) { // landing on a wall: split it so both halves keep a corner here
    const w = Plan.wallById(P, sp.on);
    if (w && sp.t > 0.02 && sp.t < 0.98) { const w2 = { id: Plan.uid('w'), a: n.id, b: w.b, ext: w.ext, thick: w.thick }; const oldB = w.b; w.b = n.id;
      if (w.len > 0) { const f = sp.t; w.len = +(w.len * f).toFixed(3); w2.len = null; }
      P.openings.forEach(o => { if (o.wall !== w.id) return; if (o.t > sp.t) { o.wall = w2.id; o.t = (o.t - sp.t) / (1 - sp.t); } else o.t = o.t / sp.t; });
      P.walls.splice(P.walls.indexOf(w) + 1, 0, w2); void oldB; }
  }
  P.nodes.push(n); return n.id;
}

// ---------- pointer handling (tap = tool action, drag = pan, two fingers = zoom) ----------
const ptrs = new Map(); let gesture = null;
function onDown(e) {
  if (STEP === 'plan') return; if (!$('ed') || !e.target.closest('#ed')) return;
  $('board').setPointerCapture && $('board').setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; gesture = { kind: 'pinch', d: Plan.hyp(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, view: Object.assign({}, view) }; return; }
  const p = toImg(e); gesture = { kind: 'tap', sx: e.clientX, sy: e.clientY, p, view: Object.assign({}, view) };
  if (STEP === 'trace' && tool === 'select') { const n = nearestNode(p, 16 * unit()); if (n) { gesture = { kind: 'drag', node: n.id, moved: false, sx: e.clientX, sy: e.clientY }; sel = { kind: 'node', id: n.id }; } }
}
function onMove(e) {
  if (STEP === 'plan' || !$('ed')) return;
  if (!ptrs.has(e.pointerId)) { if (e.pointerType === 'mouse' && STEP === 'trace' && e.target.closest && e.target.closest('#ed')) { hover = snapPoint(toImg(e)); drawEditor(); } return; }
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (gesture && gesture.kind === 'pinch' && ptrs.size >= 2) { const [a, b] = [...ptrs.values()]; const d = Plan.hyp(a.x - b.x, a.y - b.y), f = gesture.d / Math.max(10, d);
    const B = $('board').getBoundingClientRect(), v0 = gesture.view; const fx = (gesture.cx - B.left) / B.width, fy = (gesture.cy - B.top) / B.height;
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, nw = v0.w * f, nh = v0.h * f;
    view = { x: v0.x + v0.w * fx - nw * fx - (cx - gesture.cx) * nw / B.width, y: v0.y + v0.h * fy - nh * fy - (cy - gesture.cy) * nh / B.height, w: nw, h: nh }; drawEditor(); return; }
  if (!gesture) return;
  if (gesture.kind === 'drag') { if (!gesture.moved) { hist.push(snapshot()); fut.length = 0; gesture.moved = true; } const n = Plan.nodeById(P, gesture.node), p = toImg(e); n.x = p.x; n.y = p.y; dirty = true; drawEditor(); return; }
  const dx = e.clientX - gesture.sx, dy = e.clientY - gesture.sy;
  if (gesture.kind === 'tap' && Plan.hyp(dx, dy) > 8) gesture.kind = 'pan';
  if (gesture.kind === 'pan') { const u = unit(); view.x = gesture.view.x - dx * u; view.y = gesture.view.y - dy * u; drawEditor(); }
}
function onUp(e) {
  if (!ptrs.has(e.pointerId)) return; ptrs.delete(e.pointerId);
  if (gesture && gesture.kind === 'pinch') { if (ptrs.size === 0) gesture = null; return; }
  const g = gesture; gesture = null; if (!g) return;
  if (g.kind === 'drag') { if (g.moved) { persist(); render(); } else { renderTray(); drawEditor(); } return; }
  if (g.kind === 'tap') tap(g.p);
}
function tap(p) {
  const tol = 16 * unit();
  if (STEP === 'picture') return;
  if (STEP === 'measure') { const ww = nearestWall(p, tol * 1.5); sel = ww ? { kind: 'wall', id: ww.w.id } : null; render(); const inp = sel && $('selLen'); if (inp) inp.focus(); return; }
  if (tool === 'wall') { const sp = snapPoint(p);
    if (!chain) { change(() => { chain = placeNode(sp); }); return; }
    if (sp.node === chain) return;
    const start = chain; let closes = false;
    change(() => { const id = placeNode(sp); const n = Plan.nodeById(P, id); if (sp.on && !sp.node && n) { /* T-junction already split */ }
      if (!P.walls.some(w => (w.a === start && w.b === id) || (w.b === start && w.a === id))) P.walls.push({ id: Plan.uid('w'), a: start, b: id, ext: wallKind === 'ext' });
      closes = !!sp.node; chain = closes ? null : id; });
    return; }
  if (tool === 'door' || tool === 'window' || tool === 'opening') { const ww = nearestWall(p, tol * 1.8); if (!ww) { toast('Tap on a wall.'); return; }
    const o = { id: Plan.uid('o'), wall: ww.w.id, t: ww.q.t, width: tool === 'door' ? 0.9 : tool === 'window' ? 1.2 : 1.0, type: tool, side: 1, hinge: 'a' };
    change(() => { P.openings.push(o); sel = { kind: 'opening', id: o.id }; }); return; }
  if (tool === 'room') { const r0 = nearestRoom(p, tol); if (r0) { sel = { kind: 'room', id: r0.id }; render(); return; }
    const used = new Set(P.rooms.map(r => r.name)); const name = ROOM_NAMES.find(n => !used.has(n)) || 'Room ' + (P.rooms.length + 1);
    const r = { id: Plan.uid('r'), x: p.x, y: p.y, name }; change(() => { P.rooms.push(r); sel = { kind: 'room', id: r.id }; }); setTimeout(() => { const i = $('roomName'); if (i) { i.focus(); i.select(); } }, 50); return; }
  if (tool === 'erase') { const hit = hitAny(p, tol); if (!hit) return; change(() => deleteItem(hit)); return; }
  if (tool === 'select') { sel = hitAny(p, tol); render(); }
}
function hitAny(p, tol) { const n = nearestNode(p, tol); if (n) return { kind: 'node', id: n.id }; const o = nearestOpening(p, tol); if (o) return { kind: 'opening', id: o.id };
  const r = nearestRoom(p, tol); if (r) return { kind: 'room', id: r.id }; const w = nearestWall(p, tol); if (w) return { kind: 'wall', id: w.w.id }; return null; }
function deleteItem(it) {
  if (it.kind === 'node') { P.walls = P.walls.filter(w => w.a !== it.id && w.b !== it.id); if (chain === it.id) chain = null; }
  if (it.kind === 'wall') P.walls = P.walls.filter(w => w.id !== it.id);
  if (it.kind === 'opening') P.openings = P.openings.filter(o => o.id !== it.id);
  if (it.kind === 'room') P.rooms = P.rooms.filter(r => r.id !== it.id);
  sel = null;
}
function zoom(f, cx, cy) { const nw = view.w * f, nh = view.h * f; const fx = cx == null ? 0.5 : cx, fy = cy == null ? 0.5 : cy; view = { x: view.x + (view.w - nw) * fx, y: view.y + (view.h - nh) * fy, w: nw, h: nh }; drawEditor(); }

// =====================================================================
// Plan board: drawing sheet or 3D
// =====================================================================
function renderPlanBoard() {
  const board = $('board'); const S = solved();
  if (!P.walls.length) { board.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;padding:24px;text-align:center"><div style="max-width:360px;display:flex;flex-direction:column;gap:10px"><h2>No walls yet</h2><p class="muted">Add a picture and trace the walls, or load the example to see how it works.</p><div class="row" style="justify-content:center"><button class="b primary" data-act="goto" data-step="picture">Add a picture</button><button class="b" data-act="example">Load example</button></div></div></div>`; return; }
  if (planView === '3d') { board.innerHTML = `<canvas class="three" id="three"></canvas><div class="float br"><button class="b sm" data-act="v3reset">Reset view</button></div><div class="hint">Drag to turn · pinch or scroll to zoom</div>`; start3D(); return; }
  const sh = Exporters.svgSheet(P, S, RAS);
  board.innerHTML = `<div class="sheet-wrap" id="sheetWrap"><div class="sheet" id="sheet" style="width:${Math.round(92 * sheetZoom)}%">${sh.svg}</div></div><div class="float br"><button class="b sm" data-act="sheetIn" aria-label="Zoom in">+</button><button class="b sm" data-act="sheetOut" aria-label="Zoom out">−</button></div>`;
}

// ---------- tiny 3D viewer (canvas, painter's algorithm) ----------
let cam = { yaw: -0.7, pitch: 0.75, dist: null }, v3 = null;
function start3D() {
  const cv = $('three'); if (!cv) return; const S = solved(); const M = Plan.mesh(P, S, RAS);
  const tris = []; const COL = { Walls: [236, 233, 226, 1], Glass: [150, 195, 222, 0.5], Floor: [190, 172, 150, 1], Doors: [140, 100, 70, 1] };
  Object.entries(M.groups).forEach(([g, list]) => list.forEach(t => tris.push({ t, c: COL[g], n: Plan.norm3(...t) })));
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; tris.forEach(o => o.t.forEach(p => p.forEach((v, i) => { mn[i] = Math.min(mn[i], v); mx[i] = Math.max(mx[i], v); })));
  const ctr = mn.map((v, i) => (v + mx[i]) / 2), size = Math.max(mx[0] - mn[0], mx[1] - mn[1], 3);
  if (!cam.dist) cam.dist = size * 1.6;
  v3 = { cv, tris, ctr, size };
  draw3D();
}
function draw3D() {
  if (!v3 || !v3.cv.isConnected) return; const { cv, tris, ctr } = v3, dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const dark = matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light' || document.documentElement.dataset.theme === 'dark';
  g.fillStyle = dark ? '#1d262e' : '#eef1f2'; g.fillRect(0, 0, W, H);
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const eye = [ctr[0] + cam.dist * cp * cy, ctr[1] + cam.dist * cp * sy, ctr[2] + cam.dist * sp];
  const f = [ctr[0] - eye[0], ctr[1] - eye[1], ctr[2] - eye[2]], fl = Plan.hyp(Plan.hyp(f[0], f[1]), f[2]); f.forEach((v, i) => f[i] = v / fl);
  let r = [f[1], -f[0], 0]; const rl = Plan.hyp(r[0], r[1]) || 1; r = [r[0] / rl, r[1] / rl, 0];
  const up = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const foc = Math.min(W, H) * 1.1;
  const proj = p => { const d = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]]; const z = d[0] * f[0] + d[1] * f[1] + d[2] * f[2]; const x = d[0] * r[0] + d[1] * r[1] + d[2] * r[2], y = d[0] * up[0] + d[1] * up[1] + d[2] * up[2];
    return [W / 2 + x / z * foc, H / 2 - y / z * foc, z]; };
  const L = [0.35, -0.55, 0.76];
  const list = [];
  tris.forEach(o => { const q = o.t.map(proj); if (q.some(v => v[2] < 0.05)) return;
    const area = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]);
    if (o.c[3] === 1 && area > 0) return; // back face (screen y points down)
    list.push({ q, z: (q[0][2] + q[1][2] + q[2][2]) / 3, o }); });
  list.sort((a, b) => b.z - a.z);
  list.forEach(({ q, o }) => { const lam = Math.max(0, o.n[0] * L[0] + o.n[1] * L[1] + o.n[2] * L[2]); const k = 0.55 + 0.45 * lam;
    g.fillStyle = `rgba(${Math.round(o.c[0] * k)},${Math.round(o.c[1] * k)},${Math.round(o.c[2] * k)},${o.c[3]})`;
    g.strokeStyle = g.fillStyle; g.lineWidth = 0.6; g.beginPath(); g.moveTo(q[0][0], q[0][1]); g.lineTo(q[1][0], q[1][1]); g.lineTo(q[2][0], q[2][1]); g.closePath(); g.fill(); if (o.c[3] === 1) g.stroke(); });
}
let orbit = null; const optrs = new Map();
function onDown3(e) { if (!e.target.closest || !e.target.closest('#three')) return; optrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId);
  if (optrs.size === 2) { const [a, b] = [...optrs.values()]; orbit = { pinch: Plan.hyp(a.x - b.x, a.y - b.y), dist: cam.dist }; } else orbit = { x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch }; }
function onMove3(e) { if (!optrs.has(e.pointerId) || !orbit) return; optrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (orbit.pinch && optrs.size >= 2) { const [a, b] = [...optrs.values()]; cam.dist = Plan.clamp(orbit.dist * orbit.pinch / Math.max(10, Plan.hyp(a.x - b.x, a.y - b.y)), 2, 300); }
  else if (!orbit.pinch) { cam.yaw = orbit.yaw - (e.clientX - orbit.x) * 0.008; cam.pitch = Plan.clamp(orbit.pitch + (e.clientY - orbit.y) * 0.008, 0.05, 1.5); }
  draw3D(); }
function onUp3(e) { optrs.delete(e.pointerId); if (!optrs.size) orbit = null; }

// =====================================================================
// Tray (right panel / below on phones)
// =====================================================================
function renderTray() {
  const t = $('tray'); const S = solved();
  const H = ({ picture: trayPicture, trace: trayTrace, measure: trayMeasure, plan: trayPlan, build: trayBuild })[STEP](S);
  t.innerHTML = H;
}
function trayPicture() {
  let h = '';
  if (P.example) h += `<p class="notice info">This is an example sketch with example dimensions. Start a new project from Projects to use your own picture.</p>`;
  h += `<div class="group"><h3>Your sketch</h3>
    <label class="drop" id="drop"><b>${P.image ? 'Replace the picture' : 'Choose a photo or scan'}</b><span class="small muted">A hand-drawn floor plan, a photo of a paper sketch, or a screenshot. Dimensions on it are not needed.</span>
    <span class="b primary">Choose picture</span><input type="file" id="fileImg" accept="image/*" hidden></label></div>`;
  if (P.image) {
    h += `<div class="group"><h3>Find the walls</h3>`;
    if (SAMPLE_IMG) h += `<button class="b primary" data-act="detect" ${detecting ? 'disabled' : ''}>${detecting ? 'Reading the sketch…' : 'Detect walls, doors and rooms'}</button>
      ${detecting ? '<button class="b sm" data-act="stopDetect">Stop</button>' : ''}<p class="small muted">Claude reads the picture and draws walls, doors, windows and room names for you to check. This uses your Claude usage and asks permission the first time.</p>`;
    else h += `<p class="small muted">${window.AndroidApp ? 'Automatic detection needs Claude, so it is only in the online version. ' : 'Automatic detection works when this page is opened in Claude. '}Trace the walls by hand in the next step: it takes a minute for a small house.</p>`;
    h += `<button class="b" data-act="goto" data-step="trace">Trace by hand</button></div>
    <div class="group"><h3>Picture</h3><label class="f">Visibility while tracing<input type="range" id="imgOp" min="0.1" max="1" step="0.05" value="${P.settings.imgOpacity != null ? P.settings.imgOpacity : 0.55}"></label>
    <div class="row"><button class="b sm" data-act="rotate" data-deg="-90">Rotate left</button><button class="b sm" data-act="rotate" data-deg="90">Rotate right</button><button class="b sm danger" data-act="removeImg" data-confirm="1">Remove picture</button></div></div>`;
  } else h += `<div class="group"><h3>Or try it first</h3><button class="b" data-act="example">Load the example sketch</button></div>`;
  h += `<div class="group"><h3>Tips</h3><p class="small muted">Photograph the sketch from straight above, in good light. Crooked lines are fine: the app squares them up. You only need a few rough measurements, such as the outside length and width.</p></div>`;
  return h;
}
function trayTrace(S) {
  const T = [['select', 'Select', '<path d="M5 3l12 9-5 1 3 6-2 1-3-6-4 4z"/>'], ['wall', 'Wall', '<path d="M4 20V4h16"/><path d="M4 4l3 3"/>'], ['door', 'Door', '<path d="M5 20V4h9v16"/><path d="M14 20a9 9 0 0 0-9-9"/>'],
    ['window', 'Window', '<rect x="4" y="9" width="16" height="6"/><path d="M4 12h16"/>'], ['room', 'Room', '<path d="M4 7h16M7 7v12M12 11h6M12 15h4"/>'], ['opening', 'Opening', '<path d="M4 12h5M15 12h5"/><path d="M9 9v6M15 9v6"/>'], ['erase', 'Delete', '<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/>']];
  let h = `<div class="group"><h3>Tools</h3><div class="tools">${T.map(([k, n, ic]) => `<button class="b" data-act="tool" data-tool="${k}" aria-pressed="${tool === k}"><svg viewBox="0 0 24 24">${ic}</svg>${n}</button>`).join('')}</div>`;
  if (tool === 'wall') h += `<div class="row"><button class="b sm" data-act="wallKind" data-k="ext" aria-pressed="${wallKind === 'ext'}">Outside wall</button><button class="b sm" data-act="wallKind" data-k="int" aria-pressed="${wallKind === 'int'}">Inside wall</button>${chain ? '<button class="b sm primary" data-act="done">Done</button>' : ''}</div>`;
  h += `</div>`;
  h += inspector(S);
  h += `<div class="group"><h3>Drawing so far</h3><div class="kv"><span>Walls</span><span class="v">${P.walls.length}</span><span>Doors and windows</span><span class="v">${P.openings.length}</span><span>Rooms</span><span class="v">${P.rooms.length}</span></div>
    <label class="chk"><input type="checkbox" id="squareUp" ${P.settings.squareUp ? 'checked' : ''}> Square up nearly straight walls</label>
    <label class="f">Picture visibility<input type="range" id="imgOp2" min="0.1" max="1" step="0.05" value="${P.settings.imgOpacity != null ? P.settings.imgOpacity : 0.55}"></label></div>
    <button class="b primary" data-act="goto" data-step="measure" ${P.walls.length ? '' : 'disabled'}>Next: add measurements</button>`;
  return h;
}
function inspector(S) {
  if (!sel) return `<p class="small muted">Draw the outside walls first, corner by corner, then the inside walls. Inside walls that end on another wall join it automatically.</p>`;
  if (sel.kind === 'wall') { const w = Plan.wallById(P, sel.id); if (!w) return '';
    return `<div class="group"><h3>Wall ${wallName(w)}</h3><div class="row"><button class="b sm" data-act="setExt" data-v="1" aria-pressed="${!!w.ext}">Outside</button><button class="b sm" data-act="setExt" data-v="0" aria-pressed="${!w.ext}">Inside</button></div>
      <div class="grid2"><label class="f">Thickness (cm)<input type="number" id="wallThick" min="5" max="80" step="1" value="${Math.round(Plan.wallThick(P, w) * 100)}"></label>
      <label class="f">Direction<select id="wallAxis"><option value="auto"${w.axis !== 'free' ? ' selected' : ''}>Square up</option><option value="free"${w.axis === 'free' ? ' selected' : ''}>Keep the angle</option></select></label></div>
      <div class="row"><button class="b sm" data-act="split" data-id="${w.id}">Split in two</button><button class="b sm danger" data-act="delSel" data-confirm="1">Delete wall</button></div></div>`; }
  if (sel.kind === 'opening') { const o = P.openings.find(x => x.id === sel.id); if (!o) return '';
    return `<div class="group"><h3>${{ door: 'Door', window: 'Window', opening: 'Opening' }[o.type]}</h3>
      <div class="grid2"><label class="f">Type<select id="opType"><option value="door"${o.type === 'door' ? ' selected' : ''}>Door</option><option value="window"${o.type === 'window' ? ' selected' : ''}>Window</option><option value="opening"${o.type === 'opening' ? ' selected' : ''}>Opening</option></select></label>
      <label class="f">Width (cm)<input type="number" id="opWidth" min="30" max="600" step="5" value="${Math.round(o.width * 100)}"></label>
      ${o.type === 'window' ? `<label class="f">Sill height (cm)<input type="number" id="opSill" min="0" max="250" step="5" value="${Math.round((o.sill != null ? o.sill : P.settings.winSill) * 100)}"></label><label class="f">Window height (cm)<input type="number" id="opH" min="20" max="300" step="5" value="${Math.round((o.height || P.settings.winH) * 100)}"></label>` : ''}
      ${o.type === 'door' ? `<label class="f">Door height (cm)<input type="number" id="opH" min="150" max="300" step="5" value="${Math.round((o.height || P.settings.doorH) * 100)}"></label>` : ''}</div>
      <div class="row">${o.type === 'door' ? '<button class="b sm" data-act="flipSide">Swing other side</button><button class="b sm" data-act="flipHinge">Hinge other end</button>' : ''}<button class="b sm danger" data-act="delSel" data-confirm="1">Delete</button></div>
      <p class="small muted">Move it along the wall in 10 cm steps:</p><div class="row"><button class="b sm" data-act="nudge" data-d="-1">◀ Move</button><button class="b sm" data-act="nudge" data-d="1">Move ▶</button></div></div>`; }
  if (sel.kind === 'room') { const r = P.rooms.find(x => x.id === sel.id); if (!r) return '';
    return `<div class="group"><h3>Room</h3><label class="f">Name<input id="roomName" value="${esc(r.name)}" autocomplete="off"></label>
      <div class="chips">${ROOM_NAMES.map(n => `<button class="chip" data-act="roomPick" data-n="${esc(n)}">${esc(n)}</button>`).join('')}</div>
      <button class="b sm danger" data-act="delSel" data-confirm="1">Delete label</button></div>`; }
  if (sel.kind === 'node') return `<div class="group"><h3>Corner</h3><p class="small muted">Drag it to move it. Deleting a corner deletes its walls.</p><button class="b sm danger" data-act="delSel" data-confirm="1">Delete corner</button></div>`;
  return '';
}
function trayMeasure(S) {
  let h = `<div class="group"><h3>Measurements</h3><p class="small muted">Type the approximate length of any walls you know, in ${dimStyle() === 'ft' ? 'feet and inches (12\' 6")' : 'metres or centimetres (4.2 or 420 cm)'}. One is enough to set the size; more make it accurate. Everything else is worked out from the picture.</p></div>`;
  if (!S.given) h += `<p class="notice">Add at least one measurement. Until then, the plan assumes the drawing is about 12 m wide.</p>`;
  else if (S.conflicts.length) h += `<p class="notice bad">${S.conflicts.length} measurement${S.conflicts.length > 1 ? 's don\'t' : ' doesn\'t'} fit with the others. ${S.conflicts.map(c => `${wallName(Plan.wallById(P, c.wall))}: you typed ${fmt(c.given)}, the plan closes at ${fmt(c.got)}`).join('; ')}. Check them, or mark a wall as keeping its angle.</p>`;
  else h += `<p class="notice ok">All ${S.given} measurement${S.given > 1 ? 's fit' : ' fits'} together.</p>`;
  if (sel && sel.kind === 'wall') { const w = Plan.wallById(P, sel.id); if (w) h += `<div class="group"><h3>Wall ${wallName(w)}</h3><label class="f">Length<input id="selLen" data-wall="${w.id}" inputmode="decimal" placeholder="${Plan.fmtLen(S.len[w.id], dimStyle())}" value="${w.len > 0 ? Plan.fmtLen(w.len, dimStyle()) : ''}"></label><p class="small muted">Currently ${fmt(S.len[w.id])}${w.len > 0 ? ' (your measurement)' : ' (worked out)'}.</p></div>`; }
  const conflict = new Set(S.conflicts.map(c => c.wall));
  h += `<div class="group"><h3>All walls</h3><div class="walls">${P.walls.map(w => `<div class="wl${sel && sel.id === w.id ? ' sel' : ''}${conflict.has(w.id) ? ' bad' : ''}"><span class="id">${wallName(w)}</span><span class="calc">${Plan.fmtLen(S.len[w.id], dimStyle())} ${w.ext ? 'outside' : 'inside'}</span><input data-wall="${w.id}" inputmode="decimal" aria-label="Length of ${wallName(w)}" placeholder="–" value="${w.len > 0 ? Plan.fmtLen(w.len, dimStyle()) : ''}"></div>`).join('')}</div></div>
  <div class="group"><h3>Units</h3><select id="dimStyle"><option value="m"${dimStyle() === 'm' ? ' selected' : ''}>Metres (4.20)</option><option value="cm"${dimStyle() === 'cm' ? ' selected' : ''}>Centimetres (420)</option><option value="mm"${dimStyle() === 'mm' ? ' selected' : ''}>Millimetres (4200)</option><option value="ft"${dimStyle() === 'ft' ? ' selected' : ''}>Feet and inches (13'-9")</option></select></div>
  <button class="b primary" data-act="goto" data-step="plan">Next: see the plan</button>`;
  return h;
}
function trayPlan(S) {
  if (!P.walls.length) return `<p class="small muted">The plan appears here once walls are traced.</p>`;
  const R = RAS, st = P.settings;
  let h = '';
  if (P.example) h += `<p class="notice info">Example project: a sketch with example measurements. Open Picture or Trace to see how it was made, or start a new project from Projects.</p>`;
  if (!S.given) h += `<p class="notice">No measurements yet, so the sizes are a guess. Add at least one in Measure.</p>`;
  else if (S.conflicts.length) h += `<p class="notice bad">Some measurements don't fit together. See Measure.</p>`;
  h += `<div class="row"><button class="b sm" data-act="planView" data-v="2d" aria-pressed="${planView === '2d'}">Drawing</button><button class="b sm" data-act="planView" data-v="3d" aria-pressed="${planView === '3d'}">3D model</button></div>`;
  const rooms = P.rooms.map(r => ({ r, i: R && R.rooms[r.id] }));
  h += `<div class="group"><h3>Areas</h3><div class="kv">${rooms.map(({ r, i }) => `<span>${esc(r.name)}</span><span class="v">${i && i.ok ? Plan.fmtArea(i.area, dimStyle()) : '<span title="' + esc(i ? i.why : '') + '">–</span>'}</span>`).join('')}
    <span><b>Gross floor area</b></span><span class="v"><b>${R ? Plan.fmtArea(R.gross, dimStyle()) : '–'}</b></span></div>
    ${rooms.some(x => x.i && !x.i.ok) ? `<p class="small muted">A room shows – when its label ${esc((rooms.find(x => x.i && !x.i.ok).i || {}).why || '')}.</p>` : ''}</div>`;
  h += `<div class="group"><h3>Export</h3><div class="exports">
    <button class="b" data-act="exp" data-f="pdf">PDF<small>Printable, to scale</small></button>
    <button class="b" data-act="exp" data-f="png">PNG<small>Image</small></button>
    <button class="b" data-act="exp" data-f="svg">SVG<small>Vector drawing</small></button>
    <button class="b" data-act="exp" data-f="dxf">DXF<small>2D CAD, layers</small></button>
    <button class="b" data-act="exp" data-f="dae">DAE<small>SketchUp Go / Pro 3D</small></button>
    <button class="b" data-act="exp" data-f="rb">SketchUp script<small>Native groups (.rb)</small></button>
    <button class="b" data-act="exp" data-f="stl">STL<small>SketchUp Free, 3D print</small></button>
    <button class="b" data-act="exp" data-f="obj">OBJ<small>3D, most apps</small></button>
    <button class="b" data-act="exp" data-f="gltf">glTF<small>3D for web, Blender</small></button>
    <button class="b" data-act="exp" data-f="ifc">IFC<small>BIM: Revit, ArchiCAD, SketchUp Pro</small></button>
    <button class="b" data-act="exp" data-f="glb">GLB<small>3D in one file, phones, AR</small></button>
    <button class="b" data-act="exp" data-f="3mf">3MF<small>3D printing, in mm</small></button>
    <button class="b" data-act="exp" data-f="ply">PLY<small>Coloured 3D mesh</small></button>
    <button class="b" data-act="exp" data-f="kmz">KMZ<small>Google Earth</small></button>
    <button class="b" data-act="exp" data-f="csv">CSV<small>Rooms, walls, doors, windows</small></button>
    <button class="b" data-act="exp" data-f="jpg">JPG<small>Smaller image</small></button>
    <button class="b" data-act="exp" data-f="json">Project file<small>Reopen and edit later</small></button>
    <button class="b primary" data-act="exp" data-f="zip" style="grid-column:1/-1">Everything (.zip)<small style="color:inherit;opacity:.8">All formats above in one download</small></button></div>
    <p class="small muted">CAD and 3D files download inside a .zip file here; unzip it to get the file.</p>
    <details><summary class="small" style="cursor:pointer">How to get a .skp SketchUp file</summary><div class="small muted" style="display:flex;flex-direction:column;gap:6px;padding-top:6px">
      <p>SketchUp's own .skp format can only be written by SketchUp itself, so take one of these routes and then use File › Save As.</p>
      <p><b>SketchUp Pro or Make (desktop):</b> download the SketchUp script (a .rb file), open Extensions › Developer › Ruby Console and type <span class="mono">load "</span>path to the file<span class="mono">"</span>. Walls, windows and the floor arrive as tidy groups on their own tags.</p>
      <p><b>SketchUp Go or Pro:</b> File › Import the DAE file (3D model) or the DXF file (2D plan).</p>
      <p><b>SketchUp Free (web):</b> Import the STL file. It arrives as one plain mesh in metres.</p></div></details></div>`;
  h += `<div class="group"><h3>Drawing settings</h3><div class="grid2">
    <label class="f">Dimensions in<select id="dimStyle"><option value="m"${dimStyle() === 'm' ? ' selected' : ''}>Metres</option><option value="cm"${dimStyle() === 'cm' ? ' selected' : ''}>Centimetres</option><option value="mm"${dimStyle() === 'mm' ? ' selected' : ''}>Millimetres</option><option value="ft"${dimStyle() === 'ft' ? ' selected' : ''}>Feet and inches</option></select></label>
    <label class="f">Paper (PDF)<select id="paper">${['A4', 'A3', 'A2', 'Letter'].map(p => `<option${st.paper === p ? ' selected' : ''}>${p}</option>`).join('')}</select></label>
    <label class="f">Scale (PDF)<select id="scale"><option value="auto"${st.scale === 'auto' ? ' selected' : ''}>Fit the paper</option>${[50, 100, 200].map(s => `<option value="${s}"${+st.scale === s ? ' selected' : ''}>1:${s}</option>`).join('')}</select></label>
    <label class="f">North arrow (°)<input type="number" id="north" step="15" value="${st.north || 0}"></label>
    <label class="f">Outside walls (cm)<input type="number" id="extThick" min="5" max="80" value="${Math.round(st.extThick * 100)}"></label>
    <label class="f">Inside walls (cm)<input type="number" id="intThick" min="5" max="50" value="${Math.round(st.intThick * 100)}"></label>
    <label class="f">Wall height (cm, 3D)<input type="number" id="wallHeight" min="200" max="600" value="${Math.round(st.wallHeight * 100)}"></label>
    <label class="f">Drawn by<input id="author" value="${esc(st.author || '')}" autocomplete="off"></label>
    <label class="f">Latitude (KMZ)<input id="lat" inputmode="decimal" placeholder="52.2297" value="${st.lat != null ? esc(st.lat) : ''}"></label>
    <label class="f">Longitude (KMZ)<input id="lon" inputmode="decimal" placeholder="21.0122" value="${st.lon != null ? esc(st.lon) : ''}"></label></div>
    <p class="small muted">Latitude and longitude place the house in Google Earth. Find them by long-pressing the spot in Google Maps.</p></div>`;
  return h;
}

// =====================================================================
// Build step: materials, cut list, manual
// =====================================================================
function svgOf(pr, maxW) { const B = Exporters.primBounds(pr), m = 0.25, w = B.x1 - B.x0 + m * 2, h = B.y1 - B.y0 + m * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${B.x0 - m} ${B.y0 - m} ${w} ${h}" style="width:${Math.min(maxW || 1000, w * 110)}px" font-family="IBM Plex Sans, Arial, sans-serif">${Exporters.svgPrims(pr, 1)}</svg>`; }
function renderBuildBoard() {
  const board = $('board'); if (!P.walls.length) { renderPlanBoard(); return; }
  const S = solved(), out = Build.compute(P, S, RAS);
  if (!buildWall || !out.walls.some(w => w.id === buildWall)) buildWall = out.walls[0] && out.walls[0].id;
  const rec = out.walls.find(w => w.id === buildWall);
  const views = rec ? [[rec.frame ? 'frame' : 'blocks', rec.frame ? 'Frame' : 'Blocks'], ...rec.faces.map((f, i) => ['face:' + i, f.side[0].toUpperCase() + f.side.slice(1)])] : [];
  if (!buildFace || !views.some(v => v[0] === buildFace)) buildFace = views[0] && views[0][0];
  let h = `<div class="float tl"><select id="buildWall" aria-label="Wall" style="width:auto">${out.walls.map(w => `<option value="${w.id}"${w.id === buildWall ? ' selected' : ''}>${w.name} · ${w.ext ? 'outside' : 'inside'} · ${Build.r1(w.L)} mm</option>`).join('')}</select>
    ${views.map(([k, n]) => `<button class="b sm" data-act="bview" data-v="wall" data-face="${k}" aria-pressed="${buildView === 'wall' && buildFace === k}">${n}</button>`).join('')}
    <button class="b sm" data-act="bview" data-v="cuts" aria-pressed="${buildView === 'cuts'}">Cutting plans</button></div><div class="viewer">`;
  if (buildView === 'wall' && rec) {
    h += `<div class="sheetbox">${svgOf(Build.elevation(rec, buildFace), 980)}</div><div class="cap">${buildFace && buildFace.startsWith('face') ? 'Board pieces with their codes and sizes in mm. Red outlines are cut-outs for openings.' : rec.frame ? 'Timber frame, seen from the outside or side A. Codes match the cut list.' : 'Block courses. Pink blocks are cut; numbers are their lengths in mm.'} S marks the start corner.</div>`;
  } else {
    Object.values(out.linear).forEach(x => { h += `<div class="cap"><b>${esc(x.mat.name)}</b>: ${x.bars.length} lengths. Each bar shows the pieces cut from one stock length.</div><div class="sheetbox">${svgOf(Build.barDiagram(x.bars, 1), 980)}</div>`; });
    Object.values(out.sheets).forEach(x => { h += `<div class="cap"><b>${esc(x.mat.name)}</b>: ${x.sheets.length} sheets.</div><div class="row" style="justify-content:center">${x.sheets.map((sh, i) => `<div class="sheetbox"><div class="small muted">Sheet ${i + 1}</div>${svgOf(Build.sheetDiagram(sh, x.mat), 150)}</div>`).join('')}</div>`; });
    Object.values(out.blocks).forEach(x => { h += `<div class="cap"><b>${esc(x.mat.name)}</b>: ${x.full} whole blocks and ${x.cutBlocks} blocks for cut pieces (${Object.entries(x.cuts).sort((a, b) => b[0] - a[0]).map(([k, n]) => `${n} × ${k} mm`).join(', ')}).</div>`; });
  }
  h += `</div>`; board.innerHTML = h;
}
function matOptions(type, sel, allowNone) { return (allowNone ? `<option value=""${!sel ? ' selected' : ''}>None</option>` : '') + P.build.materials.filter(m => m.type === type).map(m => `<option value="${m.id}"${m.id === sel ? ' selected' : ''}>${esc(m.name)}</option>`).join(''); }
function trayBuild(S) {
  if (!P.walls.length) return `<p class="small muted">Trace the walls first. The cut list is made from the finished plan.</p>`;
  const out = Build.compute(P, S, RAS), B = P.build, cur = esc(B.currency || '');
  let h = `<div class="group"><h3>Materials needed</h3><table class="bom"><thead><tr><th>Item</th><th style="text-align:right">Qty</th>${out.total ? '<th style="text-align:right">Cost</th>' : ''}</tr></thead><tbody>
    ${out.bom.map(b => `<tr><td>${esc(b.name)}<br><span class="small muted">${esc(b.note)}</span></td><td class="n">${b.qty} ${esc(b.unit)}</td>${out.total ? `<td class="n">${b.cost ? b.cost.toFixed(2) : ''}</td>` : ''}</tr>`).join('')}
    ${out.total ? `<tr><td><b>Estimated total</b></td><td></td><td class="n"><b>${out.total.toFixed(2)} ${cur}</b></td></tr>` : ''}</tbody></table>
    ${out.warnings.length ? `<details><summary class="small" style="cursor:pointer">${out.warnings.length} note${out.warnings.length > 1 ? 's' : ''} about long pieces</summary><ul class="small muted" style="margin:6px 0 0;padding-left:18px">${out.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></details>` : ''}
    <div class="row"><button class="b primary" data-act="exp" data-f="manual">Build manual (PDF)</button><button class="b" data-act="exp" data-f="cutcsv">Cut list (CSV)</button></div>
    <p class="small muted">The manual has the materials list, cut lists, a cutting plan for every timber length and board, and numbered steps with a drawing for each wall.</p></div>`;
  const sysSel = (k, label) => { const c = B[k]; return `<div class="group"><h3>${label}</h3>
    <label class="f">Built as<select data-b="${k}.system"><option value="frame"${c.system === 'frame' ? ' selected' : ''}>Timber frame</option><option value="blocks"${c.system === 'blocks' ? ' selected' : ''}>Blocks</option></select></label>
    ${c.system === 'frame' ? `<label class="f">Frame timber<select data-b="${k}.frame">${matOptions('linear', c.frame)}</select></label>` : `<label class="f">Blocks<select data-b="${k}.block">${matOptions('block', c.block)}</select></label>`}
    <div class="grid2">${k === 'ext' ? `${c.system === 'frame' ? `<label class="f">Outside boards<select data-b="ext.outside">${matOptions('sheet', c.outside, true)}</select></label>` : ''}<label class="f">Inside boards<select data-b="ext.inside">${matOptions('sheet', c.inside, true)}</select></label>`
      : `<label class="f">Boards, side A<select data-b="int.sideA">${matOptions('sheet', c.sideA, true)}</select></label><label class="f">Boards, side B<select data-b="int.sideB">${matOptions('sheet', c.sideB, true)}</select></label>`}</div></div>`; };
  h += sysSel('ext', 'Outside walls') + sysSel('int', 'Inside walls');
  h += `<div class="group"><h3>Floor</h3><select data-b="floor">${matOptions('floor', B.floor, true)}</select></div>
  <div class="group"><h3>Options</h3><div class="grid2">
    <label class="f">Stud spacing (mm)<input type="number" data-b="spacing" min="200" max="1200" step="10" value="${B.spacing}"></label>
    <label class="f">Saw cut (mm)<input type="number" data-b="kerf" min="0" max="10" step="0.5" value="${B.kerf}"></label>
    <label class="f">Spare material (%)<input type="number" data-b="waste" min="0" max="50" value="${B.waste}"></label>
    <label class="f">Currency<input data-b="currency" value="${cur}"></label></div>
    <label class="chk"><input type="checkbox" data-b="doubleTop" ${B.doubleTop ? 'checked' : ''}> Double top plate</label>
    <label class="chk"><input type="checkbox" data-b="rotate" ${B.rotate ? 'checked' : ''}> Boards may be turned when cutting (no grain)</label>
    <label class="chk"><input type="checkbox" data-b="stagger" ${B.stagger ? 'checked' : ''}> Stagger block joints by half a block</label></div>`;
  const F = { linear: [['w', 'Width mm'], ['d', 'Depth mm'], ['stock', 'Lengths you can buy (m)'], ['price', 'Price per m']], sheet: [['w', 'Width mm'], ['h', 'Height mm'], ['t', 'Thickness mm'], ['price', 'Price per sheet']],
    block: [['l', 'Length mm'], ['h', 'Height mm'], ['t', 'Thickness mm'], ['joint', 'Joint mm'], ['price', 'Price per block']], floor: [['l', 'Length mm'], ['w', 'Width mm'], ['pack', 'Panels per pack'], ['price', 'Price per pack']] };
  const TN = { linear: 'Timber', sheet: 'Board', block: 'Block', floor: 'Floor panel' };
  h += `<div class="group"><h3>Your materials</h3><p class="small muted">Enter the sizes you can buy. The cut list and the number of pieces follow from these.</p>
    ${B.materials.map(m => `<div class="mat"><div class="hd"><span>${TN[m.type]}</span><button class="b sm danger" data-act="delMat" data-id="${m.id}">Delete</button></div>
      <input data-mat="${m.id}" data-k="name" value="${esc(m.name)}" aria-label="Name">
      <div class="grid2">${F[m.type].map(([k, l]) => `<label class="f">${l}<input data-mat="${m.id}" data-k="${k}" ${k === 'stock' ? '' : 'type="number" step="any" min="0"'} value="${esc(m[k] != null ? m[k] : '')}"></label>`).join('')}</div></div>`).join('')}
    <div class="row">${Object.entries(TN).map(([k, n]) => `<button class="b sm" data-act="addMat" data-type="${k}">+ ${n}</button>`).join('')}</div></div>`;
  return h;
}

// =====================================================================
// Pictures
// =====================================================================
function loadImageFile(file) {
  if (!file || !/^image\//.test(file.type)) { toast('Choose an image file (JPG or PNG).'); return; }
  const fr = new FileReader(); fr.onload = () => { const img = new Image(); img.onload = () => {
    const max = 1600, k = Math.min(1, max / Math.max(img.width, img.height)); const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(img, 0, 0, cv.width, cv.height);
    const src = cv.toDataURL('image/jpeg', 0.85);
    change(() => { const old = P.image; const fx = old ? cv.width / old.w : 1, fy = old ? cv.height / old.h : 1;
      if (old && P.nodes.length) { P.nodes.forEach(n => { n.x *= fx; n.y *= fy; }); P.rooms.forEach(r => { r.x *= fx; r.y *= fy; }); }
      P.image = { src, w: cv.width, h: cv.height }; P.example = false; }); view = null; render(); toast('Picture added');
  }; img.onerror = () => toast('That picture could not be opened.'); img.src = fr.result; }; fr.readAsDataURL(file);
}
function rotateImage(deg) {
  if (!P.image) return; const img = new Image(); img.onload = () => { const cv = document.createElement('canvas'); const W = P.image.w, Hh = P.image.h; cv.width = Hh; cv.height = W;
    const g = cv.getContext('2d'); g.translate(cv.width / 2, cv.height / 2); g.rotate(deg * Math.PI / 180); g.drawImage(img, -W / 2, -Hh / 2);
    const src = cv.toDataURL('image/jpeg', 0.85); const rot = p => deg > 0 ? { x: Hh - p.y, y: p.x } : { x: p.y, y: W - p.x };
    change(() => { P.nodes.forEach(n => Object.assign(n, rot(n))); P.rooms.forEach(r => Object.assign(r, rot(r))); P.image = { src, w: cv.width, h: cv.height }; }); view = null; render(); };
  img.src = P.image.src;
}

// ---------- automatic detection with Claude ----------
async function detect() {
  if (!SAMPLE || !P.image) return;
  const img = new Image(); img.src = P.image.src; await img.decode();
  const max = 1280, k = Math.min(1, max / Math.max(img.width, img.height)); const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.88));
  const prompt = `This image is a hand-drawn or scanned FLOOR PLAN sketch, ${cv.width} x ${cv.height} pixels, origin at the top-left, x to the right, y down.
Trace it as a building plan and reply with ONLY one JSON object, no prose:
{"walls":[{"x1":0,"y1":0,"x2":0,"y2":0,"exterior":true}],"doors":[{"x":0,"y":0,"width":0}],"windows":[{"x":0,"y":0,"width":0}],"rooms":[{"name":"Kitchen","x":0,"y":0}],"dimensions":[{"wall":0,"metres":0}]}
Rules:
- walls: one straight segment per wall run along its centreline, in pixels. Where walls meet, their end points must be exactly equal. Split a wall where another wall joins it in a T. exterior=true for the building outline.
- doors and windows: the centre point ON the wall line, and the width in pixels along the wall.
- rooms: room names written in the sketch (keep the sketch's language) at the label position; if a room has no name, guess a sensible one from fixtures or size.
- dimensions: only if numbers are written next to a wall: the wall's index in "walls" and the length in metres. Otherwise an empty array.
- Ignore furniture, text that is not a room name, and pencil smudges.`;
  detecting = new AbortController(); renderTray();
  try {
    const data = await SAMPLE.json(prompt, { images: [blob], modelTier: 'default', signal: detecting.signal });
    applyDetection(data, 1 / k); toast('Walls detected. Check them in Trace.'); go('trace');
  } catch (e) {
    const msg = { cancelled: 'Stopped.', not_granted: 'Claude was not allowed to read the picture. You can trace by hand instead.', rate_limited: 'Too many requests right now. Try again in a minute.', images_unavailable: 'Pictures cannot be sent to Claude from this view.', image_rejected: 'Claude could not read this picture. Try a smaller or clearer photo.' }[e && e.code] || 'Detection did not work this time. Try again, or trace by hand.';
    toast(msg);
  } finally { detecting = null; renderTray(); }
}
function applyDetection(d, scaleBack) {
  if (!d || !Array.isArray(d.walls)) throw { code: 'bad' };
  const W = P.image.w, Hh = P.image.h, tol = Math.max(W, Hh) * 0.018;
  change(() => {
    P.nodes = []; P.walls = []; P.openings = []; P.rooms = [];
    const getNode = (x, y) => { x *= scaleBack; y *= scaleBack; let n = nearestNode({ x, y }, tol); if (n) return n.id; n = { id: Plan.uid('n'), x, y }; P.nodes.push(n); return n.id; };
    d.walls.forEach(w => { if (![w.x1, w.y1, w.x2, w.y2].every(Number.isFinite)) return; const a = getNode(w.x1, w.y1), b = getNode(w.x2, w.y2); if (a !== b) P.walls.push({ id: Plan.uid('w'), a, b, ext: w.exterior !== false }); });
    // end points that stop on another wall become T-junctions
    P.nodes.forEach(n => { const deg = P.walls.filter(w => w.a === n.id || w.b === n.id).length; if (deg !== 1) return;
      const ww = P.walls.filter(w => w.a !== n.id && w.b !== n.id).map(w => ({ w, q: projOnWall(n, w) })).filter(x => x.q.d < tol && x.q.t > 0.02 && x.q.t < 0.98).sort((a, b) => a.q.d - b.q.d)[0];
      if (ww) { n.x = ww.q.x; n.y = ww.q.y; const w = ww.w, w2 = { id: Plan.uid('w'), a: n.id, b: w.b, ext: w.ext }; w.b = n.id; P.walls.push(w2); } });
    const S0 = Plan.solve(P);
    const addOp = (o, type) => { if (!Number.isFinite(o.x) || !Number.isFinite(o.y)) return; const p = { x: o.x * scaleBack, y: o.y * scaleBack }; const ww = nearestWall(p, tol * 2); if (!ww) return;
      const widthM = o.width > 0 ? o.width * scaleBack * (S0.scale || 0.02) : (type === 'door' ? 0.9 : 1.2);
      P.openings.push({ id: Plan.uid('o'), wall: ww.w.id, t: ww.q.t, width: Plan.clamp(widthM, 0.6, type === 'door' ? 1.2 : 3), type, side: 1, hinge: 'a' }); };
    (d.doors || []).forEach(o => addOp(o, 'door')); (d.windows || []).forEach(o => addOp(o, 'window'));
    (d.rooms || []).forEach(r => { if (Number.isFinite(r.x) && Number.isFinite(r.y)) P.rooms.push({ id: Plan.uid('r'), x: r.x * scaleBack, y: r.y * scaleBack, name: String(r.name || 'Room').slice(0, 40) }); });
    (d.dimensions || []).forEach(x => { const w = P.walls[x.wall]; if (w && x.metres > 0) w.len = +x.metres; });
    P.example = false; sel = null; chain = null;
  });
}

// =====================================================================
// Example project
// =====================================================================
function exampleProject() {
  const P0 = Plan.newProject('Example: bungalow sketch'); P0.example = true; P0.build = Build.defaults();
  const s = 52, ox = 70, oy = 60; let seed = 3; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  const pts = { a: [0, 0], b: [11, 0], c: [11, 6], d: [7.5, 6], e: [7.5, 8.5], f: [0, 8.5], g: [4.5, 0], h: [4.5, 8.5], i: [4.5, 3.5], j: [11, 3.5], k: [7.5, 3.5], l: [4.5, 6] };
  const N = {}; Object.entries(pts).forEach(([k, [x, y]]) => { N[k] = { id: 'n' + k, x: ox + x * s * (1 + 0.03 * rnd()) + rnd() * 9, y: oy + y * s * (1 + 0.03 * rnd()) + rnd() * 9 }; P0.nodes.push(N[k]); });
  const W = (a, b, ext, len) => { const w = { id: 'w' + a + b, a: 'n' + a, b: 'n' + b, ext }; if (len) w.len = len; P0.walls.push(w); return w; };
  W('a', 'g', true, 4.5); W('g', 'b', true); W('b', 'j', true); W('j', 'c', true); W('c', 'd', true, 3.5); W('d', 'e', true, 2.5); W('e', 'h', true); W('h', 'f', true); W('f', 'a', true, 8.5);
  W('g', 'i', false); W('i', 'l', false); W('l', 'h', false); W('i', 'k', false); W('k', 'j', false, 3.5); W('k', 'd', false); W('l', 'd', false);
  P0.walls.find(w => w.id === 'wgb').len = 6.5; P0.walls.find(w => w.id === 'wbj').len = 3.5;
  const O = (w, t, width, type, extra) => P0.openings.push(Object.assign({ id: Plan.uid('o'), wall: w, t, width, type, side: 1, hinge: 'a' }, extra || {}));
  O('wag', 0.5, 1.5, 'window'); O('wgb', 0.45, 1.8, 'window'); O('wfa', 0.45, 1.5, 'window'); O('wjc', 0.55, 1.2, 'window'); O('wcd', 0.5, 1.2, 'window');
  O('weh', 0.5, 1.0, 'door', { side: 1 }); O('wlh', 0.45, 0.9, 'door', { side: 1, hinge: 'b' }); O('wgi', 0.55, 0.9, 'door', { side: -1 }); O('wld', 0.5, 0.8, 'door', { side: -1 }); O('wkj', 0.25, 0.8, 'door', { side: 1 });
  const R = (name, x, y) => P0.rooms.push({ id: 'r' + name, name, x: ox + x * s, y: oy + y * s });
  R('Living room', 2.2, 4.3); R('Kitchen', 7.8, 1.7); R('Bathroom', 6, 4.75); R('Bedroom', 9.25, 4.75); R('Hall', 6, 7.3);
  // draw the sketch itself
  const cv = document.createElement('canvas'); cv.width = Math.round(ox * 2 + 11 * s); cv.height = Math.round(oy * 2 + 8.5 * s + 20);
  const g = cv.getContext('2d'); g.fillStyle = '#fbfaf5'; g.fillRect(0, 0, cv.width, cv.height);
  g.strokeStyle = 'rgba(40,45,60,0.85)'; g.lineCap = 'round';
  const pencil = (a, b, wdt) => { for (let pass = 0; pass < 2; pass++) { g.lineWidth = wdt * (pass ? 0.6 : 1); g.beginPath(); const n = 6; for (let i = 0; i <= n; i++) { const t = i / n; const x = a.x + (b.x - a.x) * t + rnd() * 2.2, y = a.y + (b.y - a.y) * t + rnd() * 2.2; i ? g.lineTo(x, y) : g.moveTo(x - (b.x - a.x) * 0.02, y - (b.y - a.y) * 0.02); } g.stroke(); } };
  P0.walls.forEach(w => pencil(Plan.nodeById(P0, w.a), Plan.nodeById(P0, w.b), w.ext ? 3.2 : 1.8));
  g.font = 'italic 19px "Comic Sans MS","Segoe Print","Bradley Hand",cursive'; g.fillStyle = 'rgba(40,45,60,0.9)'; g.textAlign = 'center';
  const lab = { 'Living room': 'living', Kitchen: 'kitchen', Bathroom: 'bath', Bedroom: 'bed', Hall: 'hall' }; P0.rooms.forEach(r => g.fillText(lab[r.name] || r.name, r.x + rnd() * 6, r.y + rnd() * 6));
  P0.openings.forEach(o => { const w = P0.walls.find(x => x.id === o.wall), a = Plan.nodeById(P0, w.a), b = Plan.nodeById(P0, w.b); const L = Plan.hyp(b.x - a.x, b.y - a.y), ux = (b.x - a.x) / L, uy = (b.y - a.y) / L, c = o.t * L, hw = o.width * s / 2;
    const p0 = { x: a.x + ux * (c - hw), y: a.y + uy * (c - hw) }, p1 = { x: a.x + ux * (c + hw), y: a.y + uy * (c + hw) };
    g.strokeStyle = '#fbfaf5'; g.lineWidth = 6; g.beginPath(); g.moveTo(p0.x, p0.y); g.lineTo(p1.x, p1.y); g.stroke(); g.strokeStyle = 'rgba(40,45,60,0.85)';
    if (o.type === 'window') { [-3, 3].forEach(k => pencil({ x: p0.x - uy * k, y: p0.y + ux * k }, { x: p1.x - uy * k, y: p1.y + ux * k }, 1.2)); }
    else { const hg = o.hinge === 'b' ? p1 : p0, sd = o.side || 1; g.lineWidth = 1.4; g.beginPath(); g.moveTo(hg.x, hg.y); g.lineTo(hg.x - uy * sd * hw * 2, hg.y + ux * sd * hw * 2); g.stroke(); } });
  g.font = '14px "Comic Sans MS","Segoe Print",cursive'; g.textAlign = 'left'; g.fillStyle = 'rgba(40,45,60,0.6)'; g.fillText('our house - rough', 14, cv.height - 14);
  P0.image = { src: cv.toDataURL('image/jpeg', 0.85), w: cv.width, h: cv.height };
  return P0;
}

// =====================================================================
// Export
// =====================================================================
const DL_OK = /\.(png|jpe?g|svg|pdf|json|txt|zip|csv|html|md)$/i;
async function toB64(data) { const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
async function saveFile(name, data, mime) {
  if (window.AndroidApp && window.AndroidApp.saveFile) { try { window.AndroidApp.saveFile(name, await toB64(data), mime || 'application/octet-stream'); } catch (e) { toast('Could not save the file.'); } return; }
  try { if (window.claude && window.claude.use) { const dl = await window.claude.use('downloads'); if (dl) {
    if (!DL_OK.test(name)) { const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data; data = Exporters.zip([{ name, data: bytes }]); name = name + '.zip'; } try { await dl.save({ filename: name, data }); toast('Saved ' + name); } catch (e) { if (!e || e.code !== 'declined') toast('Could not save here.'); } return; } } } catch (e) {}
  try { const blob = data instanceof Blob ? data : new Blob([data], { type: mime }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
  catch (e) { toast('Downloads are blocked here.'); }
}
const fileBase = () => (P.name || 'plan').replace(/[^a-z0-9ąćęłńóśźż]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'plan';
async function doExport(f) {
  const S = solved(), R = RAS, M = (['dae', 'obj', 'stl', 'gltf', 'rb', 'glb', '3mf', 'ply', 'kmz'].includes(f)) ? Plan.mesh(P, S, R) : null, b = fileBase();
  switch (f) {
    case 'svg': return saveFile(b + '.svg', Exporters.svgSheet(P, S, R).svg, 'image/svg+xml');
    case 'pdf': { const r = Exporters.pdf(P, S, R); toast(`PDF at 1:${r.scale} on ${P.settings.paper}`); return saveFile(b + '.pdf', new Blob([r.bytes], { type: 'application/pdf' }), 'application/pdf'); }
    case 'png': { const sh = Exporters.svgSheet(P, S, R, { px: 120 }); const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(sh.svg); await img.decode();
      const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; cv.getContext('2d').drawImage(img, 0, 0); const blob = await new Promise(r => cv.toBlob(r, 'image/png')); return saveFile(b + '.png', blob, 'image/png'); }
    case 'dxf': return saveFile(b + '.dxf', Exporters.dxf(P, S, R), 'application/dxf');
    case 'dae': return saveFile(b + '.dae', Exporters.dae(P, M), 'model/vnd.collada+xml');
    case 'obj': return saveFile(b + '.obj', Exporters.obj(P, M), 'text/plain');
    case 'stl': return saveFile(b + '.stl', Exporters.stl(P, M), 'model/stl');
    case 'gltf': return saveFile(b + '.gltf', Exporters.gltf(P, M), 'model/gltf+json');
    case 'rb': return saveFile(b + '-sketchup.rb', Exporters.ruby(P, S, R, M), 'text/plain');
    case 'json': return saveFile(b + '.json', JSON.stringify(P), 'application/json');
    case 'ifc': return saveFile(b + '.ifc', Exporters2.ifc(P, S, R), 'application/x-step');
    case 'glb': return saveFile(b + '.glb', Exporters2.glb(P, M), 'model/gltf-binary');
    case '3mf': return saveFile(b + '.3mf', Exporters2.threeMF(P, M), 'model/3mf');
    case 'ply': return saveFile(b + '.ply', Exporters2.ply(P, M), 'text/plain');
    case 'kmz': if (!(isFinite(+P.settings.lat) && isFinite(+P.settings.lon) && P.settings.lat !== '' && P.settings.lon !== '' && P.settings.lat != null && P.settings.lon != null)) { toast('Enter the latitude and longitude in Drawing settings first.'); const i = $('lat'); if (i) i.focus(); return; }
      return saveFile(b + '.kmz', Exporters2.kmz(P, M), 'application/vnd.google-earth.kmz');
    case 'csv': return saveFile(b + '-schedule.csv', Exporters2.schedule(P, S, R), 'text/csv');
    case 'jpg': { const sh = Exporters.svgSheet(P, S, R, { px: 120 }); const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(sh.svg); await img.decode();
      const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(img, 0, 0); const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.9)); return saveFile(b + '.jpg', blob, 'image/jpeg'); }
    case 'manual': { const out = Build.compute(P, S, R); toast('Making the manual…'); return saveFile(b + '-build-manual.pdf', new Blob([Exporters2.manual(P, S, R, out)], { type: 'application/pdf' }), 'application/pdf'); }
    case 'cutcsv': return saveFile(b + '-cut-list.csv', Build.csv(P, Build.compute(P, S, R)), 'text/csv');
    case 'zip': { const M3 = Plan.mesh(P, S, R), sh = Exporters.svgSheet(P, S, R).svg, pd = Exporters.pdf(P, S, R);
      const z = Exporters.zip([{ name: b + '.pdf', data: pd.bytes }, { name: b + '.svg', data: sh }, { name: b + '.dxf', data: Exporters.dxf(P, S, R) }, { name: b + '.dae', data: Exporters.dae(P, M3) },
        { name: b + '-sketchup.rb', data: Exporters.ruby(P, S, R, M3) }, { name: b + '.stl', data: Exporters.stl(P, M3) }, { name: b + '.obj', data: Exporters.obj(P, M3) }, { name: 'plan.mtl', data: Exporters.mtl() },
        { name: b + '.gltf', data: Exporters.gltf(P, M3) }, { name: b + '.json', data: JSON.stringify(P) },
        { name: b + '.ifc', data: Exporters2.ifc(P, S, R) }, { name: b + '.glb', data: Exporters2.glb(P, M3) }, { name: b + '.3mf', data: Exporters2.threeMF(P, M3) }, { name: b + '.ply', data: Exporters2.ply(P, M3) },
        { name: b + '-schedule.csv', data: Exporters2.schedule(P, S, R) }, { name: b + '-cut-list.csv', data: Build.csv(P, Build.compute(P, S, R)) }, { name: b + '-build-manual.pdf', data: Exporters2.manual(P, S, R, Build.compute(P, S, R)) },
        { name: 'README.txt', data: 'Files exported by Sketch to Plan.\r\n\r\nPDF/SVG: printable drawing. DXF: 2D CAD plan (metres, layers).\r\nDAE: 3D model for SketchUp Go/Pro (File > Import). STL: for SketchUp Free.\r\nSketchUp desktop: Extensions > Developer > Ruby Console, then: load "path/to/' + b + '-sketchup.rb"\r\nThen File > Save As to get a .skp file.\r\nIFC: BIM model for Revit, ArchiCAD, BlenderBIM or SketchUp Pro. GLB/glTF/OBJ/PLY: 3D. 3MF: 3D printing (mm).\r\nCSV: schedules and cut list for Excel. Build manual PDF: materials, cut list, cutting plans and steps per wall.\r\nJSON: open again in Sketch to Plan (Projects > Open project file).\r\n' }]);
      return saveFile(b + '-all-files.zip', z, 'application/zip'); }
  }
}

// =====================================================================
// Projects
// =====================================================================
function openProject(id) { P = store.projects[id]; P.settings = Object.assign(Plan.newProject().settings, P.settings || {}); P.build = Object.assign(Build.defaults(), P.build || {}); hist.length = 0; fut.length = 0; sel = null; chain = null; dirty = true; view = null; persist(); }
function projectsModal() {
  const list = Object.values(store.projects).sort((a, b) => (b.modified || '') < (a.modified || '') ? -1 : 1);
  openModal(`<div class="row" style="justify-content:space-between"><h2>Projects</h2><button class="b sm" data-act="closeModal">Close</button></div>
    <div class="row"><button class="b primary" data-act="newProject">New project</button><button class="b" data-act="example">Example</button><label class="b">Open project file<input type="file" id="fileProj" accept=".json,application/json" hidden></label></div>
    <div class="list">${list.map(p => `<div class="li"><span>${esc(p.name)}${p.id === P.id ? ' <span class="small muted">(open)</span>' : ''}<br><span class="small muted">${p.walls.length} walls · ${p.modified ? new Date(p.modified).toLocaleDateString() : ''}</span></span>
      <span class="row">${p.id !== P.id ? `<button class="b sm" data-act="openProj" data-id="${esc(p.id)}">Open</button>` : ''}<button class="b sm danger" data-act="delProj" data-id="${esc(p.id)}">Delete</button></span></div>`).join('')}</div>
    <p class="small muted">Projects are kept in this browser. Download a project file from Plan › Export to keep a copy or move it to another device.</p>`);
}

// =====================================================================
// Events
// =====================================================================
const ACT = {
  goto: a => go(a.dataset.step),
  tool: a => { tool = a.dataset.tool; if (tool !== 'wall') chain = null; sel = null; render(); },
  wallKind: a => { wallKind = a.dataset.k; renderTray(); },
  done: () => { chain = null; render(); },
  undo, redo,
  zoomIn: () => zoom(0.75), zoomOut: () => zoom(1 / 0.75), fit: () => { fitView(); drawEditor(); },
  sheetIn: () => { sheetZoom = Math.min(4, sheetZoom * 1.3); renderPlanBoard(); }, sheetOut: () => { sheetZoom = Math.max(0.4, sheetZoom / 1.3); renderPlanBoard(); },
  setExt: a => { const v = a.dataset.v === '1'; change(() => { Plan.wallById(P, sel.id).ext = v; }); },
  split: a => change(() => { const w = Plan.wallById(P, a.dataset.id), A = Plan.nodeById(P, w.a), B = Plan.nodeById(P, w.b); const n = { id: Plan.uid('n'), x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }; P.nodes.push(n);
    const w2 = { id: Plan.uid('w'), a: n.id, b: w.b, ext: w.ext, thick: w.thick }; w.b = n.id; if (w.len) { w.len /= 2; w2.len = w.len; }
    P.openings.forEach(o => { if (o.wall !== w.id) return; if (o.t > 0.5) { o.wall = w2.id; o.t = (o.t - 0.5) * 2; } else o.t *= 2; }); P.walls.splice(P.walls.indexOf(w) + 1, 0, w2); sel = { kind: 'node', id: n.id }; }),
  delSel: a => { if (!confirmTap(a, 'Tap again to delete')) return; change(() => deleteItem(sel)); },
  flipSide: () => change(() => { const o = P.openings.find(x => x.id === sel.id); o.side = -(o.side || 1); }),
  flipHinge: () => change(() => { const o = P.openings.find(x => x.id === sel.id); o.hinge = o.hinge === 'b' ? 'a' : 'b'; }),
  nudge: a => change(() => { const o = P.openings.find(x => x.id === sel.id), w = Plan.wallById(P, o.wall), S = solved(); const L = S.len[w.id] || 1; o.t = Plan.clamp(o.t + (+a.dataset.d) * 0.1 / L, 0, 1); }),
  roomPick: a => change(() => { P.rooms.find(r => r.id === sel.id).name = a.dataset.n; }),
  planView: a => { planView = a.dataset.v; render(); }, v3reset: () => { cam = { yaw: -0.7, pitch: 0.75, dist: null }; start3D(); },
  exp: a => doExport(a.dataset.f).catch(() => toast('Export failed.')),
  example: () => { const ex = Object.values(store.projects).find(p => p.example); if (ex) openProject(ex.id); else { P = exampleProject(); hist.length = 0; fut.length = 0; dirty = true; view = null; persist(); }
    closeModal(); STEP = 'plan'; planView = '2d'; render(); toast('Example loaded'); },
  detect: () => detect(), stopDetect: () => { if (detecting) detecting.abort(); },
  rotate: a => rotateImage(+a.dataset.deg),
  removeImg: a => { if (!confirmTap(a, 'Tap again to remove')) return; change(() => { P.image = null; }); view = null; render(); },
  projects: () => projectsModal(), closeModal: () => closeModal(),
  bview: a => { buildView = a.dataset.v; if (a.dataset.face) buildFace = a.dataset.face; renderBuildBoard(); },
  addMat: a => { const t = a.dataset.type; const m = { id: Plan.uid('m'), type: t, price: 0 };
    Object.assign(m, { linear: { name: 'Timber 45×120', w: 45, d: 120, stock: '4.2, 5.4' }, sheet: { name: 'Board 1200×2500', w: 1200, h: 2500, t: 12 }, block: { name: 'Block 500×240×200', l: 500, h: 200, t: 240, joint: 10 }, floor: { name: 'Floor panel 1200×200', l: 1200, w: 200, pack: 8 } }[t]);
    change(() => { P.build.materials.push(m); }); },
  delMat: a => { if (!confirmTap(a, 'Tap again to delete')) return; const id = a.dataset.id;
    change(() => { const B = P.build; B.materials = B.materials.filter(m => m.id !== id); ['ext', 'int'].forEach(k => Object.keys(B[k]).forEach(f => { if (B[k][f] === id) B[k][f] = ''; })); if (B.floor === id) B.floor = ''; }); },
  newProject: () => { P = Plan.newProject('My floor plan'); P.build = Build.defaults(); hist.length = 0; fut.length = 0; dirty = true; view = null; sel = null; chain = null; persist(); closeModal(); STEP = 'picture'; render(); },
  openProj: a => { openProject(a.dataset.id); closeModal(); STEP = 'plan'; render(); },
  delProj: a => { if (!confirmTap(a, 'Tap again')) return; const id = a.dataset.id; delete store.projects[id];
    if (P.id === id) { const rest = Object.values(store.projects); if (rest.length) openProject(rest[0].id); else { P = Plan.newProject('My floor plan'); persist(); } }
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {} projectsModal(); render(); }
};
document.addEventListener('click', e => {
  const st = e.target.closest('nav.steps button'); if (st) { go(st.dataset.step); return; }
  const a = e.target.closest('[data-act]'); if (a && ACT[a.dataset.act]) { e.preventDefault(); ACT[a.dataset.act](a); return; }
  if (e.target.id === 'modal') closeModal();
});
const board = $('board');
board.addEventListener('pointerdown', e => { onDown(e); onDown3(e); });
window.addEventListener('pointermove', e => { onMove(e); onMove3(e); });
window.addEventListener('pointerup', e => { onUp(e); onUp3(e); });
window.addEventListener('pointercancel', e => { ptrs.delete(e.pointerId); optrs.delete(e.pointerId); gesture = null; orbit = null; });
board.addEventListener('wheel', e => { if (STEP === 'plan' && planView === '3d') { e.preventDefault(); cam.dist = Plan.clamp(cam.dist * (e.deltaY > 0 ? 1.1 : 0.9), 2, 300); draw3D(); return; }
  if (STEP === 'plan' || !$('ed')) return; e.preventDefault(); const B = board.getBoundingClientRect(); zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, (e.clientX - B.left) / B.width, (e.clientY - B.top) / B.height); }, { passive: false });
board.addEventListener('pointerleave', () => { if (hover) { hover = null; if (STEP !== 'plan') drawEditor(); } });
window.addEventListener('resize', () => { if (STEP === 'plan') { if (planView === '3d') draw3D(); } else drawEditor(); });
document.addEventListener('keydown', e => { if (e.target.matches('input,textarea,select')) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (e.key === 'Escape') { if (!$('modal').hidden) closeModal(); else { chain = null; sel = null; render(); } }
  if ((e.key === 'Delete' || e.key === 'Backspace') && sel && STEP === 'trace') change(() => deleteItem(sel)); });
document.addEventListener('change', e => {
  const el = e.target;
  if (el.id === 'fileImg') { loadImageFile(el.files[0]); el.value = ''; return; }
  if (el.id === 'fileProj') { const fr = new FileReader(); fr.onload = () => { try { const p = JSON.parse(fr.result); if (!p.walls || !p.nodes) throw 0; p.id = Plan.uid('p'); store.projects[p.id] = p; openProject(p.id); closeModal(); STEP = 'plan'; render(); toast('Project opened'); } catch (_) { toast('That is not a Sketch to Plan project file.'); } }; fr.readAsText(el.files[0]); el.value = ''; return; }
  if (el.id === 'projName') { P.name = el.value.trim() || 'Untitled plan'; persist(); if (STEP === 'plan') renderPlanBoard(); return; }
  if (el.dataset.wall) { const v = el.value.trim(); const L = v ? Plan.parseLength(v, dimStyle() === 'ft' ? 'ft' : 'm') : null;
    if (v && !(L > 0)) { toast('Type a length such as 4.2, 420 cm or 13\'6"'); return; }
    change(() => { Plan.wallById(P, el.dataset.wall).len = L || null; }); return; }
  const num = (id, k, f) => { if (el.id === id) { const v = parseFloat(el.value); if (isFinite(v)) change(() => { f(v); }); return true; } return false; };
  if (num('wallThick', 0, v => { Plan.wallById(P, sel.id).thick = Plan.clamp(v, 5, 80) / 100; })) return;
  if (el.id === 'wallAxis') { change(() => { Plan.wallById(P, sel.id).axis = el.value; }); return; }
  if (el.id === 'opType') { change(() => { const o = P.openings.find(x => x.id === sel.id); o.type = el.value; }); return; }
  if (num('opWidth', 0, v => { P.openings.find(x => x.id === sel.id).width = Plan.clamp(v, 30, 600) / 100; })) return;
  if (num('opSill', 0, v => { P.openings.find(x => x.id === sel.id).sill = Plan.clamp(v, 0, 250) / 100; })) return;
  if (num('opH', 0, v => { P.openings.find(x => x.id === sel.id).height = Plan.clamp(v, 20, 300) / 100; })) return;
  if (el.id === 'roomName') { change(() => { P.rooms.find(r => r.id === sel.id).name = el.value.trim() || 'Room'; }); return; }
  if (el.id === 'squareUp') { change(() => { P.settings.squareUp = el.checked; }); return; }
  if (el.id === 'dimStyle') { change(() => { P.settings.dimStyle = el.value; }); return; }
  if (el.id === 'paper') { change(() => { P.settings.paper = el.value; }); return; }
  if (el.id === 'scale') { change(() => { P.settings.scale = el.value; }); return; }
  if (el.id === 'author') { change(() => { P.settings.author = el.value.trim(); }); return; }
  if (el.id === 'lat' || el.id === 'lon') { const v = el.value.trim().replace(',', '.'); if (v && !isFinite(+v)) { toast('Type a number such as 52.2297'); return; } change(() => { P.settings[el.id] = v === '' ? null : +v; }); return; }
  if (el.id === 'buildWall') { buildWall = el.value; buildFace = null; renderBuildBoard(); return; }
  if (el.dataset.mat) { const m = Build.matById(P.build, el.dataset.mat), k = el.dataset.k; let v = el.value;
    if (!['name', 'stock'].includes(k)) { v = parseFloat(String(v).replace(',', '.')); if (!isFinite(v) || v < 0) { toast('Type a positive number'); renderTray(); return; } }
    change(() => { m[k] = v; }); return; }
  if (el.dataset.b) { const path = el.dataset.b.split('.'); let v = el.type === 'checkbox' ? el.checked : el.value;
    if (['spacing', 'kerf', 'waste', 'bearing'].includes(path[0])) { v = parseFloat(v); if (!isFinite(v) || v < 0) { toast('Type a positive number'); return; } }
    change(() => { let o = P.build; for (let i = 0; i < path.length - 1; i++) o = o[path[i]]; o[path[path.length - 1]] = v; }); return; }
  if (num('north', 0, v => { P.settings.north = v; })) return;
  if (num('extThick', 0, v => { P.settings.extThick = Plan.clamp(v, 5, 80) / 100; })) return;
  if (num('intThick', 0, v => { P.settings.intThick = Plan.clamp(v, 5, 50) / 100; })) return;
  if (num('wallHeight', 0, v => { P.settings.wallHeight = Plan.clamp(v, 200, 600) / 100; })) return;
});
document.addEventListener('input', e => { if (e.target.id === 'imgOp' || e.target.id === 'imgOp2') { P.settings.imgOpacity = +e.target.value; drawEditor(); clearTimeout(window.__opT); window.__opT = setTimeout(persist, 400); } });
document.addEventListener('dragover', e => { const d = e.target.closest && e.target.closest('#drop'); if (d) { e.preventDefault(); d.classList.add('over'); } });
document.addEventListener('dragleave', e => { const d = e.target.closest && e.target.closest('#drop'); if (d) d.classList.remove('over'); });
document.addEventListener('drop', e => { const d = e.target.closest && e.target.closest('#drop'); if (d) { e.preventDefault(); d.classList.remove('over'); loadImageFile(e.dataTransfer.files[0]); } });
document.addEventListener('paste', e => { const f = [...(e.clipboardData ? e.clipboardData.files : [])].find(x => /^image\//.test(x.type)); if (f && STEP === 'picture') loadImageFile(f); });

// ---------- start ----------
(function start() {
  if (store.current && store.projects[store.current]) openProject(store.current);
  else { P = exampleProject(); persist(); }
  STEP = P.walls.length ? 'plan' : 'picture';
  render();
  if (window.claude && window.claude.use) window.claude.use('sample').then(async s => { if (!s) return; SAMPLE = s; try { const l = await s.limits(); SAMPLE_IMG = !!(l && l.images); } catch (e) { SAMPLE_IMG = false; } if (STEP === 'picture') renderTray(); }).catch(() => {});
  window.__app = { P: () => P, solved, go, doExport };
})();
})();
