// =====================================================================
// Plan core: data model, dimension solver, room areas, drawing primitives, 3D mesh.
// Pure functions (no DOM) so they can be tested in Node.
// Units: model geometry in metres. Picture geometry in image pixels (y down).
// =====================================================================
const Plan = (() => {
'use strict';
const uid = p => p + Math.random().toString(36).slice(2, 9);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const hyp = (x, y) => Math.sqrt(x * x + y * y);
const DEG = Math.PI / 180;

// ---------- lengths ----------
function parseLength(s, units) {
  if (s == null) return null;
  s = String(s).trim().toLowerCase().replace(',', '.');
  if (!s) return null;
  let m = s.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft|feet|foot)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)?)?$/);
  if (m) return (+m[1]) * 0.3048 + (m[2] ? (+m[2]) * 0.0254 : 0);
  m = s.match(/^(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)$/); if (m) return (+m[1]) * 0.0254;
  m = s.match(/^(\d+(?:\.\d+)?)\s*(mm|cm|m)?$/);
  if (!m) return null;
  const v = +m[1], u = m[2];
  if (u === 'mm') return v / 1000;
  if (u === 'cm') return v / 100;
  if (u === 'm') return v;
  if (units === 'ft') return v * 0.3048;
  // bare number in metric: guess the unit from its size (4.2 → m, 420 → cm, 4200 → mm)
  if (v >= 1000) return v / 1000;
  if (v >= 60) return v / 100;
  return v;
}
function fmtLen(m, style) {
  if (m == null || !isFinite(m)) return '–';
  switch (style) {
    case 'cm': return String(Math.round(m * 100));
    case 'mm': return String(Math.round(m * 1000));
    case 'ft': { let inch = Math.round(m / 0.0254); const ft = Math.floor(inch / 12); inch -= ft * 12; return `${ft}'-${inch}"`; }
    default: return (Math.round(m * 100) / 100).toFixed(2);
  }
}
const unitLabel = style => ({ m: 'm', cm: 'cm', mm: 'mm', ft: 'ft-in' }[style] || 'm');
function fmtArea(a, style) { return style === 'ft' ? `${(a * 10.7639).toFixed(0)} ft²` : `${a.toFixed(1)} m²`; }

// ---------- project ----------
function newProject(name) {
  return {
    v: 1, id: uid('p'), name: name || 'Untitled plan', created: new Date().toISOString(),
    image: null, // {src, w, h}
    nodes: [], walls: [], openings: [], rooms: [],
    settings: { dimStyle: 'm', wallHeight: 2.6, extThick: 0.30, intThick: 0.12, squareUp: true, snapDeg: 12,
      doorH: 2.05, winSill: 0.9, winH: 1.3, slab: 0.2, paper: 'A4', scale: 'auto', north: 0, author: '' }
  };
}
const nodeById = (P, id) => P.nodes.find(n => n.id === id);
const wallById = (P, id) => P.walls.find(w => w.id === id);
const wallThick = (P, w) => w.thick != null ? w.thick : (w.ext ? P.settings.extThick : P.settings.intThick);

// Remove nodes nobody uses and walls of zero length
function tidy(P, keep) {
  P.walls = P.walls.filter(w => w.a !== w.b && nodeById(P, w.a) && nodeById(P, w.b));
  const used = new Set(keep || []); P.walls.forEach(w => { used.add(w.a); used.add(w.b); });
  P.nodes = P.nodes.filter(n => used.has(n.id));
  P.openings = P.openings.filter(o => wallById(P, o.wall));
  P.nodes.forEach(n => { if (n.on && !wallById(P, n.on)) delete n.on; });
}

// ---------- classification ----------
function wallAxis(P, w) {
  const a = nodeById(P, w.a), b = nodeById(P, w.b);
  const ang = Math.atan2(b.y - a.y, b.x - a.x) / DEG; // -180..180
  const tol = P.settings.squareUp ? P.settings.snapDeg : 0.5;
  const m = ((ang % 180) + 180) % 180; // 0..180
  if (w.axis === 'free') return 'F';
  if (Math.min(m, 180 - m) <= tol) return 'H';
  if (Math.abs(m - 90) <= tol) return 'V';
  return 'F';
}

// ---------- linear least squares ----------
function lsq(n, rows) { // rows: {idx:[...], coef:[...], rhs, w}
  const A = Array.from({ length: n }, () => new Float64Array(n)), b = new Float64Array(n);
  for (const r of rows) {
    for (let i = 0; i < r.idx.length; i++) {
      b[r.idx[i]] += r.w * r.coef[i] * r.rhs;
      for (let j = 0; j < r.idx.length; j++) A[r.idx[i]][r.idx[j]] += r.w * r.coef[i] * r.coef[j];
    }
  }
  for (let i = 0; i < n; i++) A[i][i] += 1e-12;
  // Gaussian elimination with partial pivoting
  const x = new Float64Array(n), M = A.map((row, i) => { const r = new Float64Array(n + 1); r.set(row); r[n] = b[i]; return r; });
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c]; if (Math.abs(d) < 1e-15) continue;
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / d; if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = Math.abs(M[r][r]) < 1e-15 ? 0 : s / M[r][r]; }
  return x;
}

// ---------- dimension solver ----------
// Squares up near-horizontal / near-vertical walls, honours the lengths the user typed,
// and keeps everything else in proportion to the picture. Returns metre coordinates.
function solve(P) {
  const res = { pos: {}, scale: null, conflicts: [], axis: {}, given: 0, ok: false, len: {} };
  if (!P.walls.length) return res;
  const ids = P.nodes.map(n => n.id), idx = Object.fromEntries(ids.map((id, i) => [id, i]));
  const px = n => nodeById(P, n);
  // scale (metres per pixel) from the typed lengths
  const ratios = [];
  P.walls.forEach(w => { res.axis[w.id] = wallAxis(P, w); const a = px(w.a), b = px(w.b); const pl = hyp(b.x - a.x, b.y - a.y);
    if (w.len > 0 && pl > 0) ratios.push(w.len / pl); });
  res.given = ratios.length;
  ratios.sort((x, y) => x - y);
  let s = ratios.length ? ratios[Math.floor(ratios.length / 2)] : null;
  if (!s) { // no dimension yet: assume the drawing is about 12 m wide
    const xs = P.nodes.map(n => n.x); s = 12 / Math.max(1, Math.max(...xs) - Math.min(...xs)); res.assumed = true; }
  res.scale = s;
  // union-find classes: vertical walls share x, horizontal walls share y
  const uf = n => { const p = [...Array(n).keys()]; const f = i => p[i] === i ? i : (p[i] = f(p[i])); return { f, u: (a, b) => { p[f(a)] = f(b); } }; };
  const UX = uf(ids.length), UY = uf(ids.length);
  P.walls.forEach(w => { const ax = res.axis[w.id]; if (ax === 'V') UX.u(idx[w.a], idx[w.b]); if (ax === 'H') UY.u(idx[w.a], idx[w.b]); });
  // T-junctions: a node that ends on another wall lines up with that wall
  P.nodes.forEach(n => { const host = n.on && wallById(P, n.on); if (!host) return; const ax = res.axis[host.id];
    if (ax === 'H') UY.u(idx[n.id], idx[host.a]); if (ax === 'V') UX.u(idx[n.id], idx[host.a]); });
  const cls = (U) => { const m = {}; let k = 0; ids.forEach((id, i) => { const r = U.f(i); if (m[r] == null) m[r] = k++; }); return { m, k }; };
  const CX = cls(UX), CY = cls(UY);
  const cx = id => CX.m[UX.f(idx[id])], cy = id => CY.m[UY.f(idx[id])];
  const rowsX = [], rowsY = [];
  const STRONG = 1e4, WEAK = 1, ANCHOR = 1e-4;
  // average picture position of each class (for anchoring and weak edges)
  const avg = (C, f, key) => { const sum = new Float64Array(C.k), cnt = new Float64Array(C.k); P.nodes.forEach(n => { const c = f(n.id); sum[c] += n[key]; cnt[c]++; }); return [...sum].map((v, i) => v / cnt[i]); };
  const mx = avg(CX, cx, 'x'), my = avg(CY, cy, 'y');
  P.walls.forEach(w => {
    const a = px(w.a), b = px(w.b), dx = b.x - a.x, dy = b.y - a.y, pl = hyp(dx, dy), ax = res.axis[w.id];
    const L = w.len > 0 ? w.len : null;
    if (ax === 'H') { const sgn = Math.sign(dx) || 1; if (cx(w.a) !== cx(w.b)) rowsX.push({ idx: [cx(w.b), cx(w.a)], coef: [1, -1], rhs: L ? sgn * L : dx * s, w: L ? STRONG : WEAK }); }
    else if (ax === 'V') { const sgn = Math.sign(dy) || 1; if (cy(w.a) !== cy(w.b)) rowsY.push({ idx: [cy(w.b), cy(w.a)], coef: [1, -1], rhs: L ? sgn * L : dy * s, w: L ? STRONG : WEAK }); }
    else { const k = L ? L / pl : s; const wt = L ? STRONG : WEAK;
      if (cx(w.a) !== cx(w.b)) rowsX.push({ idx: [cx(w.b), cx(w.a)], coef: [1, -1], rhs: dx * k, w: wt });
      if (cy(w.a) !== cy(w.b)) rowsY.push({ idx: [cy(w.b), cy(w.a)], coef: [1, -1], rhs: dy * k, w: wt }); }
  });
  for (let c = 0; c < CX.k; c++) rowsX.push({ idx: [c], coef: [1], rhs: mx[c] * s, w: ANCHOR });
  for (let c = 0; c < CY.k; c++) rowsY.push({ idx: [c], coef: [1], rhs: my[c] * s, w: ANCHOR });
  const X = lsq(CX.k, rowsX), Y = lsq(CY.k, rowsY);
  let minX = Infinity, minY = Infinity;
  P.nodes.forEach(n => { const p = { x: X[cx(n.id)], y: Y[cy(n.id)] }; res.pos[n.id] = p; minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); });
  Object.values(res.pos).forEach(p => { p.x -= minX; p.y -= minY; });
  // check typed lengths against the solved geometry
  P.walls.forEach(w => { const a = res.pos[w.a], b = res.pos[w.b]; const l = hyp(b.x - a.x, b.y - a.y); res.len[w.id] = l;
    if (w.len > 0 && Math.abs(l - w.len) > 0.02) res.conflicts.push({ wall: w.id, given: w.len, got: l }); });
  res.ok = res.given > 0;
  // affine map picture → plan (for rooms and anything not tied to a node)
  res.affine = fitAffine(P.nodes.map(n => [n.x, n.y]), P.nodes.map(n => [res.pos[n.id].x, res.pos[n.id].y]));
  return res;
}
function fitAffine(src, dst) {
  if (src.length < 3) return { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 };
  const rows = (k) => src.map((p, i) => ({ idx: [0, 1, 2], coef: [p[0], p[1], 1], rhs: dst[i][k], w: 1 }));
  const u = lsq(3, rows(0)), v = lsq(3, rows(1));
  return { a: u[0], b: u[1], c: u[2], d: v[0], e: v[1], f: v[2] };
}
function mapPoint(P, S, p) {
  const A = S.affine; let x = A.a * p.x + A.b * p.y + A.c, y = A.d * p.x + A.e * p.y + A.f;
  // inverse-distance correction from nearby nodes
  let sw = 0, sx = 0, sy = 0;
  P.nodes.forEach(n => { const q = S.pos[n.id]; const ax = A.a * n.x + A.b * n.y + A.c, ay = A.d * n.x + A.e * n.y + A.f;
    const d = hyp(n.x - p.x, n.y - p.y) + 1e-6; const wt = 1 / (d * d); sw += wt; sx += wt * (q.x - ax); sy += wt * (q.y - ay); });
  if (sw) { x += sx / sw; y += sy / sw; }
  return { x, y };
}

// ---------- geometry helpers ----------
function wallGeom(P, S, w) {
  const a = S.pos[w.a], b = S.pos[w.b]; const dx = b.x - a.x, dy = b.y - a.y, L = hyp(dx, dy) || 1e-9;
  const ux = dx / L, uy = dy / L, nx = -uy, ny = ux, t = wallThick(P, w);
  return { a, b, L, ux, uy, nx, ny, t };
}
function wallPoly(P, S, w, ext) {
  const g = wallGeom(P, S, w), e = ext == null ? g.t / 2 : ext, h = g.t / 2;
  const ax = g.a.x - g.ux * e, ay = g.a.y - g.uy * e, bx = g.b.x + g.ux * e, by = g.b.y + g.uy * e;
  return [[ax + g.nx * h, ay + g.ny * h], [bx + g.nx * h, by + g.ny * h], [bx - g.nx * h, by - g.ny * h], [ax - g.nx * h, ay - g.ny * h]];
}
function openingGeom(P, S, o) {
  const w = wallById(P, o.wall), g = wallGeom(P, S, w);
  const half = Math.min(o.width / 2, g.L / 2);
  const c = clamp(o.t, half / g.L, 1 - half / g.L) * g.L;
  const p0 = { x: g.a.x + g.ux * (c - half), y: g.a.y + g.uy * (c - half) }, p1 = { x: g.a.x + g.ux * (c + half), y: g.a.y + g.uy * (c + half) };
  return { g, w, p0, p1, s0: c - half, s1: c + half, width: half * 2 };
}
function bounds(P, S) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  P.walls.forEach(w => wallPoly(P, S, w).forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }));
  if (!isFinite(x0)) return { x0: 0, y0: 0, x1: 10, y1: 10 };
  return { x0, y0, x1, y1 };
}

// ---------- raster: room areas and floor outline ----------
function raster(P, S) {
  const B = bounds(P, S), pad = 1.0;
  const W0 = B.x1 - B.x0 + pad * 2, H0 = B.y1 - B.y0 + pad * 2;
  let r = 0.05; while ((W0 / r) * (H0 / r) > 1.6e6) r *= 1.5;
  const W = Math.ceil(W0 / r), H = Math.ceil(H0 / r), ox = B.x0 - pad, oy = B.y0 - pad;
  const g = new Uint8Array(W * H); // 1 = wall, 2 = outside, 3+ = rooms
  const inPoly = (pts, x, y) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c; } return c; };
  P.walls.forEach(w => { const pts = wallPoly(P, S, w, wallThick(P, w) / 2 + r); let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    pts.forEach(([x, y]) => { bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); });
    for (let j = Math.max(0, Math.floor((by0 - oy) / r)); j <= Math.min(H - 1, Math.ceil((by1 - oy) / r)); j++)
      for (let i = Math.max(0, Math.floor((bx0 - ox) / r)); i <= Math.min(W - 1, Math.ceil((bx1 - ox) / r)); i++)
        if (inPoly(pts, ox + (i + 0.5) * r, oy + (j + 0.5) * r)) g[j * W + i] = 1; });
  const fill = (i0, j0, v) => { if (i0 < 0 || j0 < 0 || i0 >= W || j0 >= H || g[j0 * W + i0] !== 0) return 0; const st = [j0 * W + i0]; g[st[0]] = v; let n = 0, touches = false;
    while (st.length) { const k = st.pop(); n++; const i = k % W, j = (k - i) / W; if (i === 0 || j === 0 || i === W - 1 || j === H - 1) touches = true;
      if (i > 0 && g[k - 1] === 0) { g[k - 1] = v; st.push(k - 1); } if (i < W - 1 && g[k + 1] === 0) { g[k + 1] = v; st.push(k + 1); }
      if (j > 0 && g[k - W] === 0) { g[k - W] = v; st.push(k - W); } if (j < H - 1 && g[k + W] === 0) { g[k + W] = v; st.push(k + W); } }
    return { n, touches }; };
  fill(0, 0, 2);
  const rooms = {};
  P.rooms.forEach((rm, k) => { const p = mapPoint(P, S, rm); const i = Math.floor((p.x - ox) / r), j = Math.floor((p.y - oy) / r);
    const cell = (i >= 0 && j >= 0 && i < W && j < H) ? g[j * W + i] : 2;
    if (cell === 0) { const f = fill(i, j, 3 + k); rooms[rm.id] = { area: f.n * r * r, at: p, ok: true }; }
    else if (cell >= 3) { rooms[rm.id] = { area: 0, at: p, ok: false, why: 'shares a space with another label' }; }
    else rooms[rm.id] = { area: 0, at: p, ok: false, why: cell === 2 ? 'is outside the walls or the walls do not close' : 'sits on a wall' }; });
  let inside = 0; for (let k = 0; k < g.length; k++) if (g[k] !== 2) inside++;
  return { g, W, H, r, ox, oy, rooms, gross: inside * r * r, isOutside: (x, y) => { const i = Math.floor((x - ox) / r), j = Math.floor((y - oy) / r); return i < 0 || j < 0 || i >= W || j >= H || g[j * W + i] === 2; } };
}
// greedy rectangles covering everything inside the outer walls (for the floor slab)
function insideRects(R) {
  const { g, W, H, r, ox, oy } = R, used = new Uint8Array(W * H), out = [];
  const ins = k => g[k] !== 2 && !used[k];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const k = j * W + i; if (!ins(k)) continue;
    let i2 = i; while (i2 + 1 < W && ins(j * W + i2 + 1)) i2++;
    let j2 = j; outer: while (j2 + 1 < H) { for (let x = i; x <= i2; x++) if (!ins((j2 + 1) * W + x)) break outer; j2++; }
    for (let y = j; y <= j2; y++) for (let x = i; x <= i2; x++) used[y * W + x] = 1;
    out.push([ox + i * r, oy + j * r, ox + (i2 + 1) * r, oy + (j2 + 1) * r]); }
  return out;
}

// ---------- 2D drawing primitives (metres, y down) ----------
// {t:'poly',pts,fill,stroke,w,layer} {t:'line',a,b,w,dash,layer} {t:'arc',c,r,a0,a1,w,layer} {t:'text',p,s,h,rot,anchor,bold,layer}
function prims(P, S, R) {
  const out = [], st = P.settings, style = st.dimStyle;
  const INK = '#1d2429', POCHE = '#3a4148';
  P.walls.forEach(w => out.push({ t: 'poly', pts: wallPoly(P, S, w), fill: w.ext ? POCHE : '#6b737a', stroke: INK, w: 0.012, layer: w.ext ? 'WALLS_EXT' : 'WALLS_INT' }));
  // openings: knock out the wall, then draw the symbol
  P.openings.forEach(o => {
    const O = openingGeom(P, S, o), g = O.g, h = g.t / 2 + 0.01;
    const q = (p, k) => [p.x + g.nx * k, p.y + g.ny * k];
    out.push({ t: 'poly', pts: [q(O.p0, h), q(O.p1, h), q(O.p1, -h), q(O.p0, -h)], fill: '#ffffff', stroke: null, w: 0, layer: 'OPENINGS' });
    out.push({ t: 'line', a: q(O.p0, g.t / 2), b: q(O.p0, -g.t / 2), w: 0.012, layer: 'OPENINGS' });
    out.push({ t: 'line', a: q(O.p1, g.t / 2), b: q(O.p1, -g.t / 2), w: 0.012, layer: 'OPENINGS' });
    if (o.type === 'window') {
      [-g.t / 6, g.t / 6].forEach(k => out.push({ t: 'line', a: q(O.p0, k), b: q(O.p1, k), w: 0.01, layer: 'WINDOWS' }));
      out.push({ t: 'line', a: q(O.p0, g.t / 2), b: q(O.p1, g.t / 2), w: 0.008, layer: 'WINDOWS' });
      out.push({ t: 'line', a: q(O.p0, -g.t / 2), b: q(O.p1, -g.t / 2), w: 0.008, layer: 'WINDOWS' });
    } else if (o.type === 'door') {
      const side = o.side || 1, hingeAtB = o.hinge === 'b';
      const hinge = hingeAtB ? O.p1 : O.p0, other = hingeAtB ? O.p0 : O.p1;
      const hp = q(hinge, side * g.t / 2), leafEnd = [hp[0] + g.nx * side * O.width, hp[1] + g.ny * side * O.width];
      out.push({ t: 'line', a: hp, b: leafEnd, w: 0.02, layer: 'DOORS' });
      const op = q(other, side * g.t / 2);
      const a0 = Math.atan2(leafEnd[1] - hp[1], leafEnd[0] - hp[0]), a1 = Math.atan2(op[1] - hp[1], op[0] - hp[0]);
      out.push({ t: 'arc', c: hp, r: O.width, a0, a1, w: 0.008, dash: true, layer: 'DOORS' });
    } else {
      out.push({ t: 'line', a: q(O.p0, 0), b: q(O.p1, 0), w: 0.006, dash: true, layer: 'OPENINGS' });
    }
  });
  // dimensions for every wall, on the outside for exterior walls
  const dim = (A, B, off, lab, layer, small) => {
    const dx = B[0] - A[0], dy = B[1] - A[1], L = hyp(dx, dy); if (L < 0.05) return;
    const ux = dx / L, uy = dy / L, nx = -uy * off, ny = ux * off, sg = Math.sign(off) || 1;
    const a = [A[0] + nx, A[1] + ny], b = [B[0] + nx, B[1] + ny], ov = 0.12 * sg;
    out.push({ t: 'line', a: [A[0] + (-uy) * 0.1 * sg, A[1] + ux * 0.1 * sg], b: [a[0] + (-uy) * ov, a[1] + ux * ov], w: 0.005, layer });
    out.push({ t: 'line', a: [B[0] + (-uy) * 0.1 * sg, B[1] + ux * 0.1 * sg], b: [b[0] + (-uy) * ov, b[1] + ux * ov], w: 0.005, layer });
    out.push({ t: 'line', a: [a[0] - ux * 0.1, a[1] - uy * 0.1], b: [b[0] + ux * 0.1, b[1] + uy * 0.1], w: 0.005, layer });
    const tk = 0.07;[a, b].forEach(p => out.push({ t: 'line', a: [p[0] - (ux + -uy) * tk, p[1] - (uy + ux) * tk], b: [p[0] + (ux + -uy) * tk, p[1] + (uy + ux) * tk], w: 0.014, layer }));
    let rot = Math.atan2(uy, ux) / DEG; if (rot > 90.01 || rot <= -90) rot += 180;
    const up = 0.07; const tp = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; const r2 = rot * DEG;
    out.push({ t: 'text', p: [tp[0] + Math.sin(r2) * up, tp[1] - Math.cos(r2) * up], s: lab, h: small ? 0.16 : 0.18, rot, anchor: 'middle', layer });
  };
  P.walls.forEach(w => {
    const g = wallGeom(P, S, w); if (g.L < 0.2) return;
    const lab = fmtLen(g.L, style);
    if (w.ext) {
      const mid = { x: (g.a.x + g.b.x) / 2, y: (g.a.y + g.b.y) / 2 };
      const outSide = R && R.isOutside(mid.x + g.nx * (g.t / 2 + 0.3), mid.y + g.ny * (g.t / 2 + 0.3)) ? 1 : -1;
      dim([g.a.x, g.a.y], [g.b.x, g.b.y], outSide * (g.t / 2 + 0.75), lab, 'DIMENSIONS');
    } else {
      dim([g.a.x, g.a.y], [g.b.x, g.b.y], g.t / 2 + 0.28, lab, 'DIMENSIONS', true);
    }
  });
  // overall dimensions
  const B = bounds(P, S);
  if (P.walls.length) {
    dim([B.x0, B.y0], [B.x1, B.y0], -(1.55), fmtLen(B.x1 - B.x0, style), 'DIMENSIONS');
    dim([B.x0, B.y1], [B.x0, B.y0], -(1.55), fmtLen(B.y1 - B.y0, style), 'DIMENSIONS');
  }
  // rooms
  P.rooms.forEach(rm => { const info = R && R.rooms[rm.id]; const at = info ? info.at : mapPoint(P, S, rm);
    out.push({ t: 'text', p: [at.x, at.y - 0.06], s: rm.name || 'Room', h: 0.26, bold: true, anchor: 'middle', layer: 'ROOMS' });
    if (info && info.ok) out.push({ t: 'text', p: [at.x, at.y + 0.28], s: fmtArea(info.area, style), h: 0.2, anchor: 'middle', layer: 'ROOMS' }); });
  return out;
}

// ---------- 3D mesh (metres, Z up, Y = north = -plan y) ----------
function mesh(P, S, R) {
  const st = P.settings, groups = { Walls: [], Glass: [], Floor: [], Doors: [] }, pieces = [];
  const box = (grp, x0, x1, z0, z1, g, origin, off0, off1) => {
    // a box along the wall from distance x0 to x1, across from off0 to off1, between heights z0..z1
    const P3 = (s, o, z) => [origin.x + g.ux * s + g.nx * o, -(origin.y + g.uy * s + g.ny * o), z];
    const v = [P3(x0, off0, z0), P3(x1, off0, z0), P3(x1, off1, z0), P3(x0, off1, z0), P3(x0, off0, z1), P3(x1, off0, z1), P3(x1, off1, z1), P3(x0, off1, z1)];
    const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
    f.forEach(t => { let a = v[t[0]], b = v[t[1]], c = v[t[2]];
      // make every triangle face outward from the box centre
      const cx = (v[0][0] + v[6][0]) / 2, cy = (v[0][1] + v[6][1]) / 2, cz = (z0 + z1) / 2;
      const n = norm3(a, b, c), m = [(a[0] + b[0] + c[0]) / 3 - cx, (a[1] + b[1] + c[1]) / 3 - cy, (a[2] + b[2] + c[2]) / 3 - cz];
      if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0) [b, c] = [c, b];
      groups[grp].push([a, b, c]); });
    pieces.push({ grp, foot: [P3(x0, off0, 0), P3(x1, off0, 0), P3(x1, off1, 0), P3(x0, off1, 0)].map(p => [p[0], p[1]]), z0, z1 });
  };
  P.walls.forEach(w => {
    const g = wallGeom(P, S, w), h = g.t / 2, e = h, H = st.wallHeight;
    const ops = P.openings.filter(o => o.wall === w.id).map(o => ({ o, O: openingGeom(P, S, o) })).sort((a, b) => a.O.s0 - b.O.s0);
    let cur = -e;
    ops.forEach(({ o, O }) => {
      if (O.s0 > cur + 1e-6) box('Walls', cur, O.s0, 0, H, g, g.a, -h, h);
      const head = o.type === 'window' ? Math.min(H, (o.sill != null ? o.sill : st.winSill) + (o.height || st.winH)) : Math.min(H, o.height || st.doorH);
      if (o.type === 'window') { const sill = o.sill != null ? o.sill : st.winSill; if (sill > 0) box('Walls', O.s0, O.s1, 0, sill, g, g.a, -h, h);
        box('Glass', O.s0, O.s1, sill, head, g, g.a, -0.01, 0.01); }
      if (head < H) box('Walls', O.s0, O.s1, head, H, g, g.a, -h, h);
      cur = Math.max(cur, O.s1); });
    if (g.L + e > cur + 1e-6) box('Walls', cur, g.L + e, 0, H, g, g.a, -h, h);
  });
  if (R) insideRects(R).forEach(([x0, y0, x1, y1]) => {
    const origin = { x: x0, y: y0 }, g = { ux: 1, uy: 0, nx: 0, ny: 1 };
    box('Floor', 0, x1 - x0, -st.slab, 0, g, origin, 0, y1 - y0); });
  return { groups, pieces };
}
function norm3(a, b, c) { const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; const l = hyp(hyp(n[0], n[1]), n[2]) || 1; return [n[0] / l, n[1] / l, n[2] / l]; }

return { uid, clamp, hyp, parseLength, fmtLen, fmtArea, unitLabel, newProject, nodeById, wallById, wallThick, tidy, wallAxis, solve, mapPoint,
  wallGeom, wallPoly, openingGeom, bounds, raster, insideRects, prims, mesh, norm3 };
})();
if (typeof module !== 'undefined') module.exports = Plan;
