// =====================================================================
// Build engine: materials, timber framing, sheet and block layouts, cut optimisation,
// bill of materials and a step-by-step manual. Pure functions; metres inside, mm in the UI.
// =====================================================================
const Build = (() => {
'use strict';
const r1 = v => Math.round(v * 1000); // metres → whole mm
const mm = v => `${r1(v)} mm`;
const uid = p => p + Math.random().toString(36).slice(2, 8);

// ---------- materials ----------
function defaults() {
  return {
    materials: [
      { id: 'tim145', type: 'linear', name: 'Timber 45×145 (C24)', w: 45, d: 145, stock: '4.8, 5.4', price: 0 },
      { id: 'tim95', type: 'linear', name: 'Timber 45×95 (C24)', w: 45, d: 95, stock: '3.6, 4.2', price: 0 },
      { id: 'osb', type: 'sheet', name: 'OSB/3 board 12 mm', w: 1250, h: 2500, t: 12, price: 0 },
      { id: 'gk', type: 'sheet', name: 'Plasterboard 12.5 mm', w: 1200, h: 2600, t: 12.5, price: 0 },
      { id: 'ytong', type: 'block', name: 'Aerated concrete block 590×240×200', l: 590, h: 200, t: 240, joint: 3, price: 0 },
      { id: 'lam', type: 'floor', name: 'Laminate panel 1380×193', l: 1380, w: 193, pack: 8, price: 0 }
    ],
    ext: { system: 'frame', frame: 'tim145', outside: 'osb', inside: 'gk', block: 'ytong' },
    int: { system: 'frame', frame: 'tim95', sideA: 'gk', sideB: 'gk', block: 'ytong' },
    floor: 'lam', spacing: 600, doubleTop: true, kerf: 3, waste: 10, rotate: true, stagger: true, bearing: 250, currency: 'PLN'
  };
}
const matById = (B, id) => B.materials.find(m => m.id === id);
const stockList = m => String(m.stock || '').split(/[;, ]+/).map(Number).filter(v => v > 0).sort((a, b) => a - b);

// ---------- 1D cutting: first-fit decreasing, then shrink each bar to the shortest stock that holds it ----------
function packBars(pieces, stocks, kerf) {
  const max = stocks[stocks.length - 1], bars = [], warnings = [];
  const list = [];
  pieces.forEach(p => { for (let i = 0; i < p.qty; i++) {
    if (p.len > max + 1e-9) { // longer than any stock: split with a joint
      let left = p.len, k = 1; warnings.push(`${p.code} (${p.role || 'piece'}, ${mm(p.len)}) is longer than the longest stock (${mm(max)}), so it is made of ${Math.ceil(p.len / max)} pieces joined over a stud.`);
      while (left > 1e-9) { const part = Math.min(max, left); list.push({ code: p.code + (left > max ? `/${k}` : `/${k}`), len: part, role: p.role, joint: true }); left -= part; k++; }
    } else list.push({ code: p.code, len: p.len, role: p.role }); } });
  list.sort((a, b) => b.len - a.len);
  list.forEach(c => { let best = null, bestLeft = Infinity;
    bars.forEach(b => { const left = b.stock - b.used - (b.cuts.length ? kerf : 0) - c.len; if (left >= -1e-9 && left < bestLeft) { best = b; bestLeft = left; } });
    if (!best) { best = { stock: max, used: 0, cuts: [] }; bars.push(best); }
    best.used += c.len + (best.cuts.length ? kerf : 0); best.cuts.push(c); });
  bars.forEach(b => { const fit = stocks.find(s => s >= b.used - 1e-9); if (fit) b.stock = fit; b.waste = b.stock - b.used; });
  return { bars, warnings };
}

// ---------- 2D cutting: guillotine, best short-side fit, optional rotation ----------
function packSheets(pieces, W, H, kerf, rotate) {
  const sheets = [], unplaced = [];
  const items = pieces.slice().sort((a, b) => b.w * b.h - a.w * a.h);
  items.forEach(p => {
    const w = p.w + kerf, h = p.h + kerf; let best = null;
    sheets.forEach((s, si) => s.free.forEach((f, fi) => {
      [[w, h, false], rotate ? [h, w, true] : null].forEach(o => { if (!o) return; const [pw, ph, rot] = o;
        if (pw <= f.w + kerf + 1e-9 && ph <= f.h + kerf + 1e-9) { const score = Math.min(f.w - pw, f.h - ph); if (!best || score < best.score) best = { si, fi, pw, ph, rot, score }; } }); }));
    if (!best) {
      const fitsN = p.w <= W + 1e-9 && p.h <= H + 1e-9, fitsR = rotate && p.h <= W + 1e-9 && p.w <= H + 1e-9;
      if (!fitsN && !fitsR) { unplaced.push(p); return; }
      sheets.push({ free: [{ x: 0, y: 0, w: W + kerf, h: H + kerf }], placed: [] });
      best = { si: sheets.length - 1, fi: 0, pw: fitsN ? w : h, ph: fitsN ? h : w, rot: !fitsN, score: 0 };
    }
    const s = sheets[best.si], f = s.free.splice(best.fi, 1)[0];
    s.placed.push({ x: f.x, y: f.y, w: best.rot ? p.h : p.w, h: best.rot ? p.w : p.h, code: p.code, rot: best.rot, cut: p.cut });
    // guillotine split along the shorter leftover
    const rw = f.w - best.pw, rh = f.h - best.ph;
    if (rw * f.h > rh * f.w) { if (rw > 0.01) s.free.push({ x: f.x + best.pw, y: f.y, w: rw, h: f.h }); if (rh > 0.01) s.free.push({ x: f.x, y: f.y + best.ph, w: best.pw, h: rh }); }
    else { if (rh > 0.01) s.free.push({ x: f.x, y: f.y + best.ph, w: f.w, h: rh }); if (rw > 0.01) s.free.push({ x: f.x + best.pw, y: f.y, w: rw, h: best.ph }); }
  });
  sheets.forEach(s => { s.usedArea = s.placed.reduce((a, p) => a + p.w * p.h, 0); });
  return { sheets, unplaced };
}

// ---------- per-wall geometry ----------
function wallInfo(P, S, w) {
  const g = Plan.wallGeom(P, S, w), H = P.settings.wallHeight;
  const ops = P.openings.filter(o => o.wall === w.id).map(o => { const O = Plan.openingGeom(P, S, o);
    const isWin = o.type === 'window', sill = isWin ? (o.sill != null ? o.sill : P.settings.winSill) : 0;
    const head = Math.min(H, isWin ? sill + (o.height || P.settings.winH) : (o.type === 'door' ? (o.height || P.settings.doorH) : P.settings.doorH));
    return { o, s0: Math.max(0, O.s0), s1: Math.min(g.L, O.s1), width: O.width, sill, head, type: o.type }; }).sort((a, b) => a.s0 - b.s0);
  return { g, L: g.L, H, ops };
}

// ---------- timber frame for one wall ----------
function frameWall(P, B, wi, mat) {
  const t = mat.w / 1000, d = mat.d / 1000, nTop = B.doubleTop ? 2 : 1, { L, H, ops } = wi, sp = B.spacing / 1000;
  const members = []; // {role, x, z, len, horiz}
  const add = (role, x, z, len, horiz) => { if (len > 0.005) members.push({ role, x, z, len, horiz: !!horiz }); };
  // plates: bottom plate is left out under doors and open passages
  let x = 0; ops.filter(o => o.type !== 'window').forEach(o => { add('Bottom plate', x, 0, o.s0 - x, true); x = o.s1; }); add('Bottom plate', x, 0, L - x, true);
  for (let k = 0; k < nTop; k++) add('Top plate', 0, H - t * (k + 1), L, true);
  const studLen = H - t * (1 + nTop), topOfStud = H - t * nTop;
  // regular studs: both ends plus every spacing, skipping opening zones
  const blocked = ops.map(o => [o.s0 - 2 * t - 0.01, o.s1 + 2 * t + 0.01]);
  const free = xx => !blocked.some(([a, b]) => xx + t > a && xx < b);
  const studX = [0]; for (let c = sp; c < L - t - 0.05; c += sp) studX.push(c - t / 2); studX.push(L - t);
  const reg = [], cripplesAt = [];
  studX.forEach(xx => { if (free(xx)) reg.push(xx); else cripplesAt.push(xx); });
  reg.forEach(xx => add('Stud', xx, t, studLen, false));
  // openings
  ops.forEach((o, i) => {
    const kL = o.s0 - 2 * t, kR = o.s1 + t, jL = o.s0 - t, jR = o.s1;
    if (kL >= -1e-6) add('King stud', Math.max(0, kL), t, studLen, false);
    if (kR + t <= L + 1e-6) add('King stud', Math.min(L - t, kR), t, studLen, false);
    const headerZ = o.head; const hdrLen = o.width + 2 * t;
    add('Jack stud', Math.max(0, jL), t, o.head - t, false); add('Jack stud', Math.min(L - t, jR), t, o.head - t, false);
    const hd = Math.min(d, topOfStud - headerZ); // header depth limited by the room above the opening
    if (hd > 0.02) { add('Header', Math.max(0, o.s0 - t), headerZ, hdrLen, true); add('Header', Math.max(0, o.s0 - t), headerZ, hdrLen, true); }
    const above = topOfStud - (headerZ + Math.max(hd, 0));
    cripplesAt.filter(xx => xx > o.s0 - 1e-6 && xx + t < o.s1 + 1e-6).forEach(xx => { if (above > 0.05) add('Cripple stud', xx, headerZ + hd, above, false); });
    if (o.type === 'window') { add('Sill', o.s0, o.sill - t, o.width, true);
      cripplesAt.filter(xx => xx > o.s0 - 1e-6 && xx + t < o.s1 + 1e-6).forEach(xx => { const below = o.sill - t - t; if (below > 0.05) add('Cripple stud', xx, t, below, false); }); }
  });
  return { members, studLen, t, d, nTop };
}

// ---------- sheet pieces for one wall face ----------
function sheetFace(wi, mat, tag) {
  const SW = mat.w / 1000, SH = mat.h / 1000, { L, H, ops } = wi, pieces = [];
  for (let x = 0; x < L - 0.005; x += SW) {
    const cw = Math.min(SW, L - x);
    for (let z = 0; z < H - 0.005; z += SH) {
      const ch = Math.min(SH, H - z);
      // openings crossing this piece
      const cuts = ops.map(o => { const lo = o.type === 'window' ? o.sill : 0, hi = o.head;
        const cx0 = Math.max(x, o.s0), cx1 = Math.min(x + cw, o.s1), cz0 = Math.max(z, lo), cz1 = Math.min(z + ch, hi);
        return cx1 - cx0 > 0.005 && cz1 - cz0 > 0.005 ? { x: cx0 - x, z: cz0 - z, w: cx1 - cx0, h: cz1 - cz0 } : null; }).filter(Boolean);
      const cutArea = cuts.reduce((a, c) => a + c.w * c.h, 0);
      if (cutArea >= cw * ch - 1e-6) continue; // entirely inside an opening
      pieces.push({ x, z, w: cw, h: ch, cut: cuts, tag });
    }
  }
  return pieces;
}

// ---------- block courses for one wall ----------
function blockWall(wi, mat, stagger) {
  const l = mat.l / 1000, bh = mat.h / 1000, j = (mat.joint || 0) / 1000, { L, H, ops } = wi;
  const nCourses = Math.ceil((H - 0.005) / (bh + j)); const lastH = H - (nCourses - 1) * (bh + j);
  let full = 0; const cuts = [], courses = [];
  for (let c = 0; c < nCourses; c++) {
    const z0 = c * (bh + j), z1 = Math.min(H, z0 + bh), row = [];
    const gaps = ops.filter(o => { const lo = o.type === 'window' ? o.sill : 0; return z1 > lo + 0.01 && z0 < o.head - 0.01; }).map(o => [o.s0, o.s1]).sort((a, b) => a[0] - b[0]);
    const segs = []; let x = 0; gaps.forEach(([a, b]) => { if (a > x) segs.push([x, a]); x = Math.max(x, b); }); if (x < L) segs.push([x, L]);
    const shift = stagger && c % 2 ? l / 2 : 0;
    segs.forEach(([a, b]) => { let xx = a; let first = true;
      while (xx < b - 0.005) { let len = l; if (first && shift) len = Math.min(l, shift); len = Math.min(len, b - xx); first = false;
        const isFull = Math.abs(len - l) < 0.002; if (isFull) full++; else cuts.push(len); row.push({ x: xx, len, full: isFull }); xx += len + j; } });
    courses.push({ z: z0, h: z1 - z0, row });
  }
  const lintels = ops.filter(o => o.type !== 'opening' || true).map(o => ({ code: o.o.id, len: o.width + 2 * 0.25 }));
  return { full, cuts, courses, nCourses, lastH, lintels };
}

// ---------- everything ----------
function compute(P, S, R) {
  const B = P.build || (P.build = defaults());
  const out = { walls: [], linear: {}, sheets: {}, blocks: {}, floor: null, bom: [], warnings: [] };
  const kerf = (B.kerf || 0) / 1000;
  const linPieces = {}, sheetPieces = {}, blockAcc = {};
  const pushLin = (matId, role, len, wallName) => { const k = linPieces[matId] || (linPieces[matId] = {}); const key = role + '|' + r1(len);
    (k[key] || (k[key] = { role, len: r1(len) / 1000, qty: 0, walls: new Set() })).qty++; k[key].walls.add(wallName); };
  P.walls.forEach((w, idx) => {
    const name = 'W' + (idx + 1), wi = wallInfo(P, S, w), sys = w.ext ? B.ext : B.int, rec = { id: w.id, name, ext: !!w.ext, L: wi.L, H: wi.H, ops: wi.ops, system: sys.system, faces: [] };
    if (wi.L < 0.1) return;
    if (sys.system === 'frame') { const m = matById(B, sys.frame); if (m) { rec.frame = frameWall(P, B, wi, m); rec.frameMat = m; rec.frame.members.forEach(mb => pushLin(m.id, mb.role, mb.len, name)); } }
    else { const m = matById(B, sys.block); if (m) { rec.blocks = blockWall(wi, m, B.stagger); rec.blockMat = m; const a = blockAcc[m.id] || (blockAcc[m.id] = { full: 0, cuts: [], lintels: [] }); a.full += rec.blocks.full; a.cuts.push(...rec.blocks.cuts); a.lintels.push(...rec.blocks.lintels.map(x => ({ len: x.len, wall: name }))); } }
    const faceDefs = w.ext ? [['outside', sys.system === 'frame' ? B.ext.outside : null], ['inside', B.ext.inside]] : [['side A', B.int.sideA], ['side B', B.int.sideB]];
    faceDefs.forEach(([side, mid]) => { const m = mid && matById(B, mid); if (!m || m.type !== 'sheet') return;
      const pcs = sheetFace(wi, m, `${name} ${side}`); pcs.forEach(p => { p.wall = name; p.side = side; }); rec.faces.push({ side, mat: m, pieces: pcs }); (sheetPieces[m.id] || (sheetPieces[m.id] = [])).push(...pcs); });
    out.walls.push(rec);
  });
  // codes and bar packing for timber
  let letter = 0; const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  Object.entries(linPieces).forEach(([mid, groups]) => { const m = matById(B, mid), pre = L[letter++ % L.length];
    const list = Object.values(groups).sort((a, b) => b.len - a.len || a.role.localeCompare(b.role)).map((g, i) => ({ code: pre + (i + 1), role: g.role, len: g.len, qty: g.qty, walls: [...g.walls].join(', ') }));
    const stocks = stockList(m); if (!stocks.length) { out.warnings.push(`${m.name}: add at least one stock length.`); return; }
    const packed = packBars(list, stocks, kerf); packed.warnings.forEach(x => { if (!out.warnings.includes(x)) out.warnings.push(x); });
    const byStock = {}; packed.bars.forEach(b => { byStock[b.stock] = (byStock[b.stock] || 0) + 1; });
    out.linear[mid] = { mat: m, pieces: list, bars: packed.bars, byStock, metres: list.reduce((a, p) => a + p.len * p.qty, 0) }; });
  // tell each wall which code each member has
  out.walls.forEach(rec => { if (!rec.frame) return; const lin = out.linear[rec.frameMat.id]; if (!lin) return;
    rec.frame.members.forEach(mb => { const p = lin.pieces.find(p => p.role === mb.role && Math.abs(p.len - r1(mb.len) / 1000) < 1e-9); mb.code = p ? p.code : '?'; }); });
  // sheets
  Object.entries(sheetPieces).forEach(([mid, pcs]) => { const m = matById(B, mid), pre = L[letter++ % L.length];
    pcs.forEach((p, i) => { p.code = pre + (i + 1); });
    const packed = packSheets(pcs.map(p => ({ w: p.w, h: p.h, code: p.code, cut: p.cut })), m.w / 1000, m.h / 1000, kerf, B.rotate);
    out.sheets[mid] = { mat: m, pieces: pcs, sheets: packed.sheets, unplaced: packed.unplaced, area: pcs.reduce((a, p) => a + p.w * p.h - p.cut.reduce((x, c) => x + c.w * c.h, 0), 0) }; });
  // blocks: pair the cut pieces into whole blocks
  Object.entries(blockAcc).forEach(([mid, a]) => { const m = matById(B, mid), l = m.l / 1000;
    const cutsGrouped = {}; a.cuts.forEach(c => { const k = r1(c); cutsGrouped[k] = (cutsGrouped[k] || 0) + 1; });
    const packed = packBars(Object.entries(cutsGrouped).map(([len, qty]) => ({ code: len + ' mm', len: len / 1000, qty, role: 'cut' })), [l], kerf);
    out.blocks[mid] = { mat: m, full: a.full, cutBlocks: packed.bars.length, cuts: cutsGrouped, total: a.full + packed.bars.length, lintels: a.lintels }; });
  // floor
  const fm = matById(B, B.floor);
  if (fm && R) { const area = Object.values(R.rooms).filter(r => r.ok).reduce((s, r) => s + r.area, 0) || 0;
    const pa = (fm.l / 1000) * (fm.w / 1000), n = Math.ceil(area * (1 + B.waste / 100) / pa); out.floor = { mat: fm, area, panels: n, packs: fm.pack ? Math.ceil(n / fm.pack) : null }; }
  // bill of materials
  const W = 1 + (B.waste || 0) / 100, cost = (m, q) => (m.price > 0 ? m.price * q : 0);
  Object.values(out.linear).forEach(x => Object.entries(x.byStock).sort((a, b) => a[0] - b[0]).forEach(([st, n]) => { const q = Math.ceil(n * W);
    out.bom.push({ name: `${x.mat.name}, ${(+st).toFixed(2)} m lengths`, qty: q, unit: 'pcs', note: `${n} needed + ${B.waste}% spare; ${x.metres.toFixed(1)} m of cut pieces`, cost: cost(x.mat, q * +st), priceUnit: 'per m' }); }));
  Object.values(out.sheets).forEach(x => { const q = Math.ceil(x.sheets.length * W); out.bom.push({ name: `${x.mat.name}, ${x.mat.w}×${x.mat.h} mm`, qty: q, unit: 'sheets', note: `${x.sheets.length} needed + spare; covers ${x.area.toFixed(1)} m²`, cost: cost(x.mat, q), priceUnit: 'per sheet' }); });
  Object.values(out.blocks).forEach(x => { const q = Math.ceil(x.total * W); out.bom.push({ name: x.mat.name, qty: q, unit: 'blocks', note: `${x.full} whole + ${x.cutBlocks} for cut pieces, + spare`, cost: cost(x.mat, q), priceUnit: 'per block' });
    if (x.lintels.length) out.bom.push({ name: 'Lintels over openings', qty: x.lintels.length, unit: 'pcs', note: x.lintels.map(l => mm(l.len)).join(', '), cost: 0 }); });
  if (out.floor) { const f = out.floor; out.bom.push({ name: f.mat.name, qty: f.packs || f.panels, unit: f.packs ? 'packs' : 'panels', note: `${f.panels} panels for ${f.area.toFixed(1)} m² + ${B.waste}%`, cost: cost(f.mat, f.packs || f.panels), priceUnit: f.packs ? 'per pack' : 'per panel' }); }
  out.total = out.bom.reduce((a, b) => a + (b.cost || 0), 0);
  // manual
  out.walls.forEach(rec => { rec.steps = steps(P, B, rec, out); });
  return out;
}

// ---------- manual text ----------
function steps(P, B, rec, out) {
  const s = [], kind = rec.ext ? 'outside' : 'inside', ops = rec.ops;
  const opText = o => `${{ door: 'door', window: 'window', opening: 'opening' }[o.type]} ${r1(o.width)} mm wide at ${r1(o.s0)}–${r1(o.s1)} mm from the start${o.type === 'window' ? `, sill at ${r1(o.sill)} mm, head at ${r1(o.head)} mm` : `, ${r1(o.head)} mm high`}`;
  s.push(`Wall ${rec.name} is an ${kind} wall, ${r1(rec.L)} mm long and ${r1(rec.H)} mm high, measured from its start corner (marked S on the drawing).${ops.length ? ' Openings: ' + ops.map(opText).join('; ') + '.' : ''}`);
  if (rec.frame) {
    const F = rec.frame, by = role => { const c = {}; F.members.filter(m => m.role === role).forEach(m => { c[m.code] = c[m.code] || { n: 0, len: m.len }; c[m.code].n++; }); return Object.entries(c).map(([k, v]) => `${v.n} × ${k} (${r1(v.len)} mm)`).join(', '); };
    const studs = F.members.filter(m => m.role === 'Stud').map(m => r1(m.x)).sort((a, b) => a - b);
    s.push(`Cut the plates from ${rec.frameMat.name}: bottom plate ${by('Bottom plate')}${ops.some(o => o.type !== 'window') ? ' (left out under doors)' : ''}; top plate ${by('Top plate')}.`);
    s.push(`Lay the bottom and top plates side by side and mark the studs. Regular studs (${by('Stud')}) have their left edge at: ${studs.join(', ')} mm.`);
    ops.forEach((o, i) => { const parts = ['King stud', 'Jack stud', 'Header', 'Cripple stud', 'Sill'].map(r => { const t = F.members.filter(m => m.role === r && m.x >= o.s0 - 3 * F.t - 1e-6 && m.x <= o.s1 + 2 * F.t + 1e-6); if (!t.length) return null;
      const c = {}; t.forEach(m => { c[m.code] = c[m.code] || { n: 0, len: m.len }; c[m.code].n++; }); return `${r.toLowerCase()}s ${Object.entries(c).map(([k, v]) => `${v.n} × ${k} (${r1(v.len)} mm)`).join(', ')}`; }).filter(Boolean);
      s.push(`Frame the ${opText(o)}: ${parts.join('; ')}. The header sits on the jack studs; nail its two pieces together first.`); });
    s.push(`Nail the frame together flat on the floor${B.doubleTop ? ', add the second top plate overlapping the corner walls' : ''}, raise it, check it is plumb and fix the bottom plate to the floor.`);
  }
  if (rec.blocks) { const b = rec.blocks, cutsTxt = {}; b.cuts.forEach(c => { const k = r1(c); cutsTxt[k] = (cutsTxt[k] || 0) + 1; });
    s.push(`Lay ${b.nCourses} courses of ${rec.blockMat.name}${B.stagger ? ', starting every second course with a half block so the joints are staggered' : ''}. This wall uses ${b.full} whole blocks and these cut pieces: ${Object.entries(cutsTxt).map(([k, n]) => `${n} × ${k} mm`).join(', ') || 'none'}.`);
    if (b.lastH < rec.blockMat.h / 1000 - 0.005) s.push(`Cut the top course down to ${r1(b.lastH)} mm high.`);
    if (b.lintels.length) s.push(`Set a lintel over each opening: ${b.lintels.map(l => mm(l.len)).join(', ')} long (${B.bearing || 250} mm bearing each side).`); }
  rec.faces.forEach(f => { const codes = f.pieces.map(p => p.code); const withCut = f.pieces.filter(p => p.cut.length);
    s.push(`Cover the ${f.side} face with ${f.mat.name}, standing the sheets upright and starting at the start corner: pieces ${codes.join(', ')}.${withCut.length ? ' Cut the openings out of ' + withCut.map(p => `${p.code} (${p.cut.map(c => `${r1(c.w)}×${r1(c.h)} mm, ${r1(c.x)} mm from its left edge and ${r1(c.z)} mm from its bottom`).join('; ')})`).join(', ') + '.' : ''}`); });
  return s;
}

// ---------- drawings (metres, y down, for SVG / PDF) ----------
function elevation(rec, view) {
  const out = [], H = rec.H, Y = z => H - z, INK = '#1d2429';
  out.push({ t: 'poly', pts: [[0, 0], [rec.L, 0], [rec.L, H], [0, H]], fill: '#ffffff', stroke: INK, w: 0.012 });
  if (view === 'frame' && rec.frame) rec.frame.members.forEach(m => { const t = rec.frame.t;
    const pts = m.horiz ? [[m.x, Y(m.z + (m.role === 'Header' ? Math.min(rec.frame.d, 0.3) : t))], [m.x + m.len, Y(m.z + (m.role === 'Header' ? Math.min(rec.frame.d, 0.3) : t))], [m.x + m.len, Y(m.z)], [m.x, Y(m.z)]]
      : [[m.x, Y(m.z + m.len)], [m.x + t, Y(m.z + m.len)], [m.x + t, Y(m.z)], [m.x, Y(m.z)]];
    out.push({ t: 'poly', pts, fill: { Stud: '#e9cf9f', 'King stud': '#dcb77a', 'Jack stud': '#d2a35c', Header: '#c58f45', 'Cripple stud': '#ecd8b2', Sill: '#c58f45', 'Bottom plate': '#c9a26a', 'Top plate': '#c9a26a' }[m.role] || '#e9cf9f', stroke: INK, w: 0.006 });
    if (!m.horiz && m.len > 0.4) out.push({ t: 'text', p: [m.x + t / 2 + 0.04, Y(m.z + m.len / 2)], s: m.code || '', h: 0.09, rot: -90, anchor: 'middle' });
    if (m.horiz && m.len > 0.5) out.push({ t: 'text', p: [m.x + m.len / 2, Y(m.z) - 0.012], s: m.code || '', h: 0.07, anchor: 'middle' }); });
  if (view && view.startsWith('face:')) { const f = rec.faces[+view.split(':')[1]]; if (f) f.pieces.forEach(p => {
    out.push({ t: 'poly', pts: [[p.x, Y(p.z + p.h)], [p.x + p.w, Y(p.z + p.h)], [p.x + p.w, Y(p.z)], [p.x, Y(p.z)]], fill: '#eef2f5', stroke: INK, w: 0.01 });
    p.cut.forEach(c => out.push({ t: 'poly', pts: [[p.x + c.x, Y(p.z + c.z + c.h)], [p.x + c.x + c.w, Y(p.z + c.z + c.h)], [p.x + c.x + c.w, Y(p.z + c.z)], [p.x + c.x, Y(p.z + c.z)]], fill: '#ffffff', stroke: '#b4372f', w: 0.006 }));
    out.push({ t: 'text', p: [p.x + p.w / 2, Y(p.z + p.h / 2)], s: p.code, h: 0.16, anchor: 'middle', bold: true });
    out.push({ t: 'text', p: [p.x + p.w / 2, Y(p.z + p.h / 2) + 0.2], s: `${r1(p.w)}×${r1(p.h)}`, h: 0.09, anchor: 'middle' }); }); }
  if (view === 'blocks' && rec.blocks) rec.blocks.courses.forEach(c => c.row.forEach(b => {
    out.push({ t: 'poly', pts: [[b.x, Y(c.z + c.h)], [b.x + b.len, Y(c.z + c.h)], [b.x + b.len, Y(c.z)], [b.x, Y(c.z)]], fill: b.full ? '#e4e4df' : '#f3d9c4', stroke: INK, w: 0.005 });
    if (!b.full && b.len > 0.12) out.push({ t: 'text', p: [b.x + b.len / 2, Y(c.z + c.h / 2) + 0.03], s: String(r1(b.len)), h: 0.07, anchor: 'middle' }); }));
  rec.ops.forEach(o => { const lo = o.type === 'window' ? o.sill : 0; out.push({ t: 'line', a: [o.s0, Y(lo)], b: [o.s1, Y(o.head)], w: 0.005, dash: true }); out.push({ t: 'line', a: [o.s1, Y(lo)], b: [o.s0, Y(o.head)], w: 0.005, dash: true }); });
  // start marker and overall length
  out.push({ t: 'text', p: [-0.12, H + 0.05], s: 'S', h: 0.16, bold: true, anchor: 'middle' });
  out.push({ t: 'line', a: [0, H + 0.25], b: [rec.L, H + 0.25], w: 0.006 }); out.push({ t: 'line', a: [0, H + 0.18], b: [0, H + 0.32], w: 0.006 }); out.push({ t: 'line', a: [rec.L, H + 0.18], b: [rec.L, H + 0.32], w: 0.006 });
  out.push({ t: 'text', p: [rec.L / 2, H + 0.42], s: `${r1(rec.L)} mm`, h: 0.13, anchor: 'middle' });
  out.push({ t: 'text', p: [rec.L + 0.12, H / 2], s: `${r1(H)} mm`, h: 0.13, anchor: 'middle', rot: -90 });
  return out;
}
function barDiagram(bars, scaleW) { // rows of stock bars with their cuts
  const out = [], rowH = 0.32; bars.forEach((b, i) => { const y = i * (rowH + 0.18);
    out.push({ t: 'poly', pts: [[0, y], [b.stock * scaleW, y], [b.stock * scaleW, y + rowH], [0, y + rowH]], fill: '#f6efe1', stroke: '#1d2429', w: 0.006 });
    let x = 0; b.cuts.forEach(c => { out.push({ t: 'poly', pts: [[x * scaleW, y], [(x + c.len) * scaleW, y], [(x + c.len) * scaleW, y + rowH], [x * scaleW, y + rowH]], fill: '#e3c48c', stroke: '#1d2429', w: 0.006 });
      if (c.len * scaleW > 0.35) out.push({ t: 'text', p: [(x + c.len / 2) * scaleW, y + rowH * 0.66], s: `${c.code} ${r1(c.len)}`, h: 0.11, anchor: 'middle' }); x += c.len + 0.003; });
    out.push({ t: 'text', p: [b.stock * scaleW + 0.08, y + rowH * 0.66], s: `${b.stock.toFixed(2)} m · offcut ${r1(b.waste)} mm`, h: 0.11 }); });
  return out;
}
function sheetDiagram(sheet, mat) {
  const W = mat.w / 1000, H = mat.h / 1000, out = [{ t: 'poly', pts: [[0, 0], [W, 0], [W, H], [0, H]], fill: '#f1f1ee', stroke: '#1d2429', w: 0.01 }];
  sheet.placed.forEach(p => { out.push({ t: 'poly', pts: [[p.x, p.y], [p.x + p.w, p.y], [p.x + p.w, p.y + p.h], [p.x, p.y + p.h]], fill: '#dfe8ef', stroke: '#1d2429', w: 0.008 });
    out.push({ t: 'text', p: [p.x + p.w / 2, p.y + p.h / 2], s: p.code, h: Math.min(0.16, p.w / 4, p.h / 3), anchor: 'middle', bold: true });
    if (p.w > 0.3 && p.h > 0.3) out.push({ t: 'text', p: [p.x + p.w / 2, p.y + p.h / 2 + 0.14], s: `${r1(p.w)}×${r1(p.h)}${p.rot ? ' ↻' : ''}`, h: 0.08, anchor: 'middle' }); });
  return out;
}

// ---------- CSV ----------
function csv(P, out) {
  const q = s => { s = String(s == null ? '' : s); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }, rows = [];
  rows.push(['Bill of materials'], ['Item', 'Quantity', 'Unit', 'Note', 'Cost']); out.bom.forEach(b => rows.push([b.name, b.qty, b.unit, b.note, b.cost ? b.cost.toFixed(2) : '']));
  rows.push([], ['Timber cut list'], ['Code', 'Material', 'Part', 'Length mm', 'Quantity', 'Walls']);
  Object.values(out.linear).forEach(x => x.pieces.forEach(p => rows.push([p.code, x.mat.name, p.role, r1(p.len), p.qty, p.walls])));
  rows.push([], ['Timber cutting plan'], ['Material', 'Bar', 'Stock m', 'Cuts (code length mm)', 'Offcut mm']);
  Object.values(out.linear).forEach(x => x.bars.forEach((b, i) => rows.push([x.mat.name, i + 1, b.stock, b.cuts.map(c => `${c.code} ${r1(c.len)}`).join(' | '), r1(b.waste)])));
  rows.push([], ['Sheet cut list'], ['Code', 'Material', 'Wall face', 'Width mm', 'Height mm', 'Cut-outs (w×h at x,z mm)']);
  Object.values(out.sheets).forEach(x => x.pieces.forEach(p => rows.push([p.code, x.mat.name, `${p.wall} ${p.side}`, r1(p.w), r1(p.h), p.cut.map(c => `${r1(c.w)}×${r1(c.h)} at ${r1(c.x)},${r1(c.z)}`).join(' | ')])));
  rows.push([], ['Sheet cutting plan'], ['Material', 'Sheet', 'Pieces (code w×h at x,y mm)']);
  Object.values(out.sheets).forEach(x => x.sheets.forEach((s, i) => rows.push([x.mat.name, i + 1, s.placed.map(p => `${p.code} ${r1(p.w)}×${r1(p.h)} at ${r1(p.x)},${r1(p.y)}${p.rot ? ' rotated' : ''}`).join(' | ')])));
  Object.values(out.blocks).forEach(x => { rows.push([], [`Blocks: ${x.mat.name}`], ['Whole blocks', x.full], ['Blocks for cut pieces', x.cutBlocks], ['Cut piece mm', 'Quantity']); Object.entries(x.cuts).sort((a, b) => b[0] - a[0]).forEach(([k, n]) => rows.push([k, n])); });
  return '﻿' + rows.map(r => r.map(q).join(',')).join('\r\n');
}
return { defaults, compute, elevation, barDiagram, sheetDiagram, csv, packBars, packSheets, matById, stockList, r1 };
})();
if (typeof module !== 'undefined') module.exports = Build;
