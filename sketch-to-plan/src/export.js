// =====================================================================
// Exporters: SVG sheet, PDF, DXF (2D), and 3D (COLLADA .dae, OBJ, STL, glTF, SketchUp Ruby).
// =====================================================================
const Exporters = (() => {
'use strict';
const H = Plan.hyp;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n4 = v => (Math.round(v * 10000) / 10000).toString();
const FONT = "'IBM Plex Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif";

function primBounds(pr) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  pr.forEach(p => { if (p.t === 'poly') p.pts.forEach(q => add(q[0], q[1])); else if (p.t === 'line') { add(...p.a); add(...p.b); }
    else if (p.t === 'arc') { add(p.c[0] - p.r, p.c[1] - p.r); add(p.c[0] + p.r, p.c[1] + p.r); } else if (p.t === 'text') { const w = p.s.length * p.h * 0.32; add(p.p[0] - w, p.p[1] - p.h); add(p.p[0] + w, p.p[1] + p.h * 0.4); } });
  return isFinite(x0) ? { x0, y0, x1, y1 } : { x0: 0, y0: 0, x1: 10, y1: 8 };
}
function arcPts(p, n) { let a0 = p.a0, a1 = p.a1, d = a1 - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  const out = []; for (let i = 0; i <= n; i++) { const a = a0 + d * i / n; out.push([p.c[0] + Math.cos(a) * p.r, p.c[1] + Math.sin(a) * p.r]); } return out; }

// ---------- SVG sheet ----------
function sheetInfo(P, S, R) {
  const net = R ? Object.values(R.rooms).filter(r => r.ok).reduce((a, r) => a + r.area, 0) : 0;
  return { title: P.name, date: new Date().toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }), gross: R ? R.gross : 0, net,
    units: Plan.unitLabel(P.settings.dimStyle), author: P.settings.author || '' };
}
function svgPrims(pr, k) { // k = drawing units per metre (1 for metre viewBox)
  return pr.map(p => {
    if (p.t === 'poly') return `<polygon points="${p.pts.map(q => n4(q[0] * k) + ',' + n4(q[1] * k)).join(' ')}" fill="${p.fill || 'none'}" ${p.stroke ? `stroke="${p.stroke}" stroke-width="${n4(p.w * k)}" stroke-linejoin="miter"` : ''}/>`;
    if (p.t === 'line') return `<line x1="${n4(p.a[0] * k)}" y1="${n4(p.a[1] * k)}" x2="${n4(p.b[0] * k)}" y2="${n4(p.b[1] * k)}" stroke="#1d2429" stroke-width="${n4(p.w * k)}"${p.dash ? ` stroke-dasharray="${n4(0.06 * k)} ${n4(0.04 * k)}"` : ''} stroke-linecap="butt"/>`;
    if (p.t === 'arc') { const pts = arcPts(p, 24); return `<polyline points="${pts.map(q => n4(q[0] * k) + ',' + n4(q[1] * k)).join(' ')}" fill="none" stroke="#1d2429" stroke-width="${n4(p.w * k)}"${p.dash ? ` stroke-dasharray="${n4(0.05 * k)} ${n4(0.04 * k)}"` : ''}/>`; }
    if (p.t === 'text') return `<text x="${n4(p.p[0] * k)}" y="${n4(p.p[1] * k)}" font-size="${n4(p.h * k)}" text-anchor="${p.anchor || 'start'}"${p.bold ? ' font-weight="600"' : ''}${p.rot ? ` transform="rotate(${n4(p.rot)} ${n4(p.p[0] * k)} ${n4(p.p[1] * k)})"` : ''} fill="#1d2429">${esc(p.s)}</text>`;
    return '';
  }).join('');
}
function northArrow(x, y, s, deg) {
  return `<g transform="translate(${n4(x)} ${n4(y)}) rotate(${n4(deg || 0)})"><circle r="${n4(s)}" fill="none" stroke="#1d2429" stroke-width="${n4(s * 0.04)}"/>
  <polygon points="0,${n4(-s * 0.85)} ${n4(s * 0.32)},${n4(s * 0.55)} 0,${n4(s * 0.28)} ${n4(-s * 0.32)},${n4(s * 0.55)}" fill="#1d2429"/>
  <text y="${n4(-s * 1.15)}" font-size="${n4(s * 0.55)}" text-anchor="middle" font-weight="600" fill="#1d2429">N</text></g>`;
}
function scaleBar(x, y, len, h) {
  const seg = len / 5; let s = '';
  for (let i = 0; i < 5; i++) s += `<rect x="${n4(x + i * seg)}" y="${n4(y)}" width="${n4(seg)}" height="${n4(h)}" fill="${i % 2 ? '#ffffff' : '#1d2429'}" stroke="#1d2429" stroke-width="${n4(h * 0.08)}"/>`;
  s += `<text x="${n4(x)}" y="${n4(y + h * 2.6)}" font-size="${n4(h * 1.5)}" fill="#1d2429">0</text><text x="${n4(x + len)}" y="${n4(y + h * 2.6)}" font-size="${n4(h * 1.5)}" text-anchor="middle" fill="#1d2429">${len} m</text>`;
  return s;
}
function svgSheet(P, S, R, opts = {}) {
  const pr = Plan.prims(P, S, R), B = primBounds(pr), I = sheetInfo(P, S, R);
  const m = 0.8, W = Math.max(8, B.x1 - B.x0 + m * 2), tb = Math.max(1.6, W * 0.11), Hd = B.y1 - B.y0 + m * 2, Ht = Hd + tb;
  const x0 = B.x0 - m, y0 = B.y0 - m;
  const fs = tb * 0.2, pad = tb * 0.18, ty = y0 + Hd;
  const barLen = W > 30 ? 10 : W > 14 ? 5 : 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n4(x0)} ${n4(y0)} ${n4(W)} ${n4(Ht)}" ${opts.px ? `width="${Math.round(W * opts.px)}" height="${Math.round(Ht * opts.px)}"` : ''} font-family="${FONT}">
<rect x="${n4(x0)}" y="${n4(y0)}" width="${n4(W)}" height="${n4(Ht)}" fill="#ffffff"/>
${opts.image ? opts.image : ''}
<g>${svgPrims(pr, 1)}</g>
<g>
<line x1="${n4(x0)}" y1="${n4(ty)}" x2="${n4(x0 + W)}" y2="${n4(ty)}" stroke="#1d2429" stroke-width="${n4(tb * 0.02)}"/>
<text x="${n4(x0 + pad)}" y="${n4(ty + pad + fs)}" font-size="${n4(fs * 1.25)}" font-weight="600" fill="#1d2429">${esc(I.title)}</text>
<text x="${n4(x0 + pad)}" y="${n4(ty + pad + fs * 2.45)}" font-size="${n4(fs * 0.8)}" fill="#4a545b">Floor plan · ${esc(I.date)}${I.author ? ' · ' + esc(I.author) : ''} · dimensions in ${esc(I.units)}</text>
<text x="${n4(x0 + pad)}" y="${n4(ty + pad + fs * 3.6)}" font-size="${n4(fs * 0.8)}" fill="#4a545b">Gross area ${esc(Plan.fmtArea(I.gross, P.settings.dimStyle))} · net room area ${esc(Plan.fmtArea(I.net, P.settings.dimStyle))}</text>
${scaleBar(x0 + W * 0.56, ty + tb * 0.34, barLen, tb * 0.1)}
${northArrow(x0 + W - tb * 0.5, ty + tb * 0.52, tb * 0.26, P.settings.north)}
</g></svg>`;
  return { svg, W, H: Ht, x0, y0 };
}

// ---------- PDF (own minimal writer: vector paths + Helvetica, no library) ----------
const HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
function pdfText(s) { // to WinAnsi: keep Latin-1, strip other accents
  return String(s).replace(/[łŁ]/g, c => c === 'ł' ? 'l' : 'L').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e -ÿ]/g, '?'); }
function textW(s, size, bold) { let w = 0; for (const ch of s) { const c = ch.charCodeAt(0); w += (c >= 32 && c < 127 ? HELV[c - 32] : 556) * (bold ? 1.05 : 1); } return w / 1000 * size; }
function pdf(P, S, R) {
  const pr = Plan.prims(P, S, R), B = primBounds(pr), I = sheetInfo(P, S, R);
  const papers = { A4: [297, 210], A3: [420, 297], A2: [594, 420], Letter: [279.4, 215.9] };
  const dw = B.x1 - B.x0, dh = B.y1 - B.y0;
  let [pw, ph] = papers[P.settings.paper] || papers.A4; if (dh > dw * 1.1) [pw, ph] = [ph, pw];
  const margin = 12, tb = 24, availW = pw - margin * 2, availH = ph - margin * 2 - tb;
  const scales = [20, 25, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 1000];
  let sc = +P.settings.scale; if (!sc) sc = scales.find(s => dw * 1000 / s <= availW && dh * 1000 / s <= availH) || 1000;
  const k = 1000 / sc, MM = 72 / 25.4; // mm per metre on paper; points per mm
  const ox = margin + (availW - dw * k) / 2 - B.x0 * k, oy = margin + (availH - dh * k) / 2 - B.y0 * k;
  const X = x => ((ox + x * k) * MM), Y = y => ((ph - (oy + y * k)) * MM); // PDF origin bottom-left
  const XP = x => x * MM, YP = y => (ph - y) * MM;
  const f = v => (Math.round(v * 100) / 100).toString(), out = [];
  const col = (h, stroke) => { const [r, g, b] = hexRgb(h).map(v => (v / 255).toFixed(3)); return `${r} ${g} ${b} ${stroke ? 'RG' : 'rg'}`; };
  const lw = w => f(Math.max(0.08, w * 10) * MM);
  const text = (s, x, y, size, opt = {}) => { s = pdfText(s); const w = textW(s, size, opt.bold), dx = opt.align === 'center' ? -w / 2 : opt.align === 'right' ? -w : 0;
    const a = (opt.angle || 0) * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
    const tx = x + dx * c, ty = y + dx * sn; const e = s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    out.push(`BT /${opt.bold ? 'F2' : 'F1'} ${f(size)} Tf ${f(c)} ${f(sn)} ${f(-sn)} ${f(c)} ${f(tx)} ${f(ty)} Tm (${e}) Tj ET`); };
  out.push('0.114 0.141 0.161 RG 0.114 0.141 0.161 rg 0 J 0 j');
  pr.forEach(p => {
    if (p.t === 'poly') { out.push(lw(p.w || 0.01) + ' w'); if (p.fill) out.push(col(p.fill)); if (p.stroke) out.push(col(p.stroke, true));
      out.push(p.pts.map((q, i) => `${f(X(q[0]))} ${f(Y(q[1]))} ${i ? 'l' : 'm'}`).join(' ') + ' h ' + (p.fill ? (p.stroke ? 'B' : 'f') : 'S')); }
    else if (p.t === 'line' || p.t === 'arc') { out.push(lw(p.w) + ' w', '0.114 0.141 0.161 RG', p.dash ? `[${f(0.8 * MM)} ${f(0.6 * MM)}] 0 d` : '[] 0 d');
      const pts = p.t === 'arc' ? arcPts(p, 24) : [p.a, p.b]; out.push(pts.map((q, i) => `${f(X(q[0]))} ${f(Y(q[1]))} ${i ? 'l' : 'm'}`).join(' ') + ' S', '[] 0 d'); }
    else if (p.t === 'text') { out.push('0.114 0.141 0.161 rg'); const mm = Math.max(1.6, Math.min(4.5, p.h * 10)); text(p.s, X(p.p[0]), Y(p.p[1]), mm * MM * 1.15, { bold: p.bold, align: p.anchor === 'middle' ? 'center' : 'left', angle: p.rot ? -p.rot : 0 }); }
  });
  // title block
  const ty = ph - margin - tb + 4; out.push('0.3 w'.replace('0.3', f(0.3 * MM)), '0.114 0.141 0.161 RG', `${f(XP(margin))} ${f(YP(ty))} m ${f(XP(pw - margin))} ${f(YP(ty))} l S`, '0.114 0.141 0.161 rg');
  text(I.title, XP(margin), YP(ty + 7), 13, { bold: true });
  text(`Floor plan  |  scale 1:${sc} on ${P.settings.paper}  |  ${I.date}${I.author ? '  |  ' + I.author : ''}  |  dimensions in ${I.units}`, XP(margin), YP(ty + 12.5), 8.5);
  text(`Gross area ${Plan.fmtArea(I.gross, P.settings.dimStyle)}  |  net room area ${Plan.fmtArea(I.net, P.settings.dimStyle)}`, XP(margin), YP(ty + 16.5), 8.5);
  const barM = sc <= 50 ? 2 : sc <= 100 ? 5 : sc <= 250 ? 10 : 20, seg = barM * k / 5, bx = pw - margin - 30 - barM * k, by = ty + 6;
  out.push(f(0.15 * MM) + ' w');
  for (let i = 0; i < 5; i++) out.push(i % 2 ? '1 1 1 rg' : '0.114 0.141 0.161 rg', `${f(XP(bx + i * seg))} ${f(YP(by + 1.6))} ${f(seg * MM)} ${f(1.6 * MM)} re B`);
  out.push('0.114 0.141 0.161 rg'); text('0', XP(bx), YP(by + 5), 7); text(`${barM} m`, XP(bx + barM * k), YP(by + 5), 7, { align: 'center' });
  const nx = pw - margin - 10, ny = ty + 9, r = 5.5, rot = (P.settings.north || 0) * Math.PI / 180;
  const rp = (x, y) => [XP(nx + x * Math.cos(rot) - y * Math.sin(rot)), YP(ny + x * Math.sin(rot) + y * Math.cos(rot))];
  const circ = []; for (let i = 0; i <= 36; i++) { const a = i / 36 * 2 * Math.PI; circ.push(`${f(XP(nx + Math.cos(a) * r))} ${f(YP(ny + Math.sin(a) * r))} ${i ? 'l' : 'm'}`); }
  out.push(f(0.25 * MM) + ' w', circ.join(' ') + ' S');
  const A = rp(0, -r * 0.85), Bq = rp(r * 0.32, r * 0.55), C = rp(0, r * 0.28), D = rp(-r * 0.32, r * 0.55);
  out.push(`${f(A[0])} ${f(A[1])} m ${f(Bq[0])} ${f(Bq[1])} l ${f(C[0])} ${f(C[1])} l ${f(D[0])} ${f(D[1])} l h f`);
  const T = rp(0, -r * 1.3); text('N', T[0], T[1], 8, { bold: true, align: 'center' });
  // assemble the file
  const content = out.join('\n'), objs = [];
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(pw * MM)} ${f(ph * MM)}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>`);
  objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  objs.push(`<< /Title (${pdfText(I.title).replace(/[()\\]/g, '')}) /Creator (Sketch to Plan) >>`);
  let pdfs = '%PDF-1.4\n%âãÏÓ\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(pdfs.length); pdfs += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdfs.length;
  pdfs += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  pdfs += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${objs.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(pdfs.length); for (let i = 0; i < pdfs.length; i++) bytes[i] = pdfs.charCodeAt(i) & 0xff;
  return { bytes, scale: sc };
}
function hexRgb(h) { const m = h.replace('#', ''); return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)]; }

// ---------- DXF (R12, metres, Y up) ----------
function dxf(P, S, R) {
  const pr = Plan.prims(P, S, R), L = [], f = v => n4(v);
  const layers = { WALLS_EXT: 7, WALLS_INT: 8, OPENINGS: 4, WINDOWS: 5, DOORS: 3, DIMENSIONS: 1, ROOMS: 2 };
  const push = (...a) => a.forEach(x => L.push(String(x)));
  push(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1009', 9, '$INSUNITS', 70, 6, 0, 'ENDSEC');
  push(0, 'SECTION', 2, 'TABLES', 0, 'TABLE', 2, 'LAYER', 70, Object.keys(layers).length);
  Object.entries(layers).forEach(([n, c]) => push(0, 'LAYER', 2, n, 70, 0, 62, c, 6, 'CONTINUOUS'));
  push(0, 'ENDTAB', 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES');
  const line = (a, b, layer) => push(0, 'LINE', 8, layer, 10, f(a[0]), 20, f(-a[1]), 30, 0, 11, f(b[0]), 21, f(-b[1]), 31, 0);
  pr.forEach(p => {
    if (p.t === 'poly') {
      if (p.fill === '#ffffff') return; // knock-outs only matter on paper
      const q = p.pts; if (q.length === 4) push(0, 'SOLID', 8, p.layer, 10, f(q[0][0]), 20, f(-q[0][1]), 30, 0, 11, f(q[1][0]), 21, f(-q[1][1]), 31, 0, 12, f(q[3][0]), 22, f(-q[3][1]), 32, 0, 13, f(q[2][0]), 23, f(-q[2][1]), 33, 0);
      q.forEach((a, i) => line(a, q[(i + 1) % q.length], p.layer));
    } else if (p.t === 'line') line(p.a, p.b, p.layer);
    else if (p.t === 'arc') { let s = -p.a0 / Math.PI * 180, e = -p.a1 / Math.PI * 180; const norm = x => ((x % 360) + 360) % 360; s = norm(s); e = norm(e);
      if (norm(e - s) > 180) [s, e] = [e, s]; push(0, 'ARC', 8, p.layer, 10, f(p.c[0]), 20, f(-p.c[1]), 30, 0, 40, f(p.r), 50, f(s), 51, f(e)); }
    else if (p.t === 'text') push(0, 'TEXT', 8, p.layer, 10, f(p.p[0]), 20, f(-p.p[1]), 30, 0, 40, f(p.h * 0.8), 1, p.s.replace(/²/g, '2'), 50, f(-(p.rot || 0)), 72, p.anchor === 'middle' ? 1 : 0, 11, f(p.p[0]), 21, f(-p.p[1]), 31, 0);
  });
  push(0, 'ENDSEC', 0, 'EOF');
  return L.join('\r\n');
}

// ---------- 3D ----------
const MATS = { Walls: [0.93, 0.92, 0.89, 1], Glass: [0.62, 0.78, 0.88, 0.45], Floor: [0.72, 0.66, 0.58, 1], Doors: [0.55, 0.4, 0.28, 1] };
function triGroups(M) { return Object.entries(M.groups).filter(([, t]) => t.length); }
function obj(P, M) {
  let s = `# ${P.name} — exported floor plan model, metres, Z up\nmtllib plan.mtl\n`, v = 1, vn = 1;
  triGroups(M).forEach(([g, tris]) => { s += `g ${g}\nusemtl ${g}\n`;
    tris.forEach(t => { const n = Plan.norm3(...t); t.forEach(p => { s += `v ${n4(p[0])} ${n4(p[1])} ${n4(p[2])}\n`; }); s += `vn ${n4(n[0])} ${n4(n[1])} ${n4(n[2])}\n`; s += `f ${v}//${vn} ${v + 1}//${vn} ${v + 2}//${vn}\n`; v += 3; vn++; }); });
  return s;
}
function mtl() { return Object.entries(MATS).map(([n, c]) => `newmtl ${n}\nKd ${c[0]} ${c[1]} ${c[2]}\nd ${c[3]}\n`).join('\n'); }
function stl(P, M) {
  let s = `solid plan\n`; triGroups(M).forEach(([, tris]) => tris.forEach(t => { const n = Plan.norm3(...t);
    s += ` facet normal ${n4(n[0])} ${n4(n[1])} ${n4(n[2])}\n  outer loop\n${t.map(p => `   vertex ${n4(p[0])} ${n4(p[1])} ${n4(p[2])}\n`).join('')}  endloop\n endfacet\n`; }));
  return s + 'endsolid plan\n';
}
function dae(P, M) {
  const now = new Date().toISOString(), G = triGroups(M);
  const eff = G.map(([g]) => { const c = MATS[g]; return `<effect id="${g}-fx"><profile_COMMON><technique sid="common"><lambert><diffuse><color>${c.slice(0, 3).join(' ')} 1</color></diffuse>${c[3] < 1 ? `<transparent opaque="A_ONE"><color>0 0 0 ${c[3]}</color></transparent><transparency><float>1</float></transparency>` : ''}</lambert></technique></profile_COMMON></effect>`; }).join('');
  const mat = G.map(([g]) => `<material id="${g}-mat" name="${g}"><instance_effect url="#${g}-fx"/></material>`).join('');
  const geo = G.map(([g, tris]) => { const pos = [], nor = [], idx = [];
    tris.forEach((t, i) => { const n = Plan.norm3(...t); t.forEach(p => pos.push(n4(p[0]), n4(p[1]), n4(p[2]))); nor.push(n4(n[0]), n4(n[1]), n4(n[2])); idx.push(i * 3, i, i * 3 + 1, i, i * 3 + 2, i); });
    return `<geometry id="${g}-geo" name="${g}"><mesh>
<source id="${g}-pos"><float_array id="${g}-pos-a" count="${pos.length}">${pos.join(' ')}</float_array><technique_common><accessor source="#${g}-pos-a" count="${pos.length / 3}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
<source id="${g}-nor"><float_array id="${g}-nor-a" count="${nor.length}">${nor.join(' ')}</float_array><technique_common><accessor source="#${g}-nor-a" count="${nor.length / 3}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
<vertices id="${g}-vtx"><input semantic="POSITION" source="#${g}-pos"/></vertices>
<triangles material="${g}-sym" count="${tris.length}"><input semantic="VERTEX" source="#${g}-vtx" offset="0"/><input semantic="NORMAL" source="#${g}-nor" offset="1"/><p>${idx.join(' ')}</p></triangles>
</mesh></geometry>`; }).join('\n');
  const nodes = G.map(([g]) => `<node id="${g}-node" name="${g}"><instance_geometry url="#${g}-geo"><bind_material><technique_common><instance_material symbol="${g}-sym" target="#${g}-mat"/></technique_common></bind_material></instance_geometry></node>`).join('');
  return `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
<asset><contributor><authoring_tool>Sketch to Plan</authoring_tool></contributor><created>${now}</created><modified>${now}</modified><unit name="meter" meter="1"/><up_axis>Z_UP</up_axis></asset>
<library_effects>${eff}</library_effects><library_materials>${mat}</library_materials>
<library_geometries>${geo}</library_geometries>
<library_visual_scenes><visual_scene id="scene" name="${esc(P.name)}">${nodes}</visual_scene></library_visual_scenes>
<scene><instance_visual_scene url="#scene"/></scene></COLLADA>`;
}
function gltf(P, M) {
  const G = triGroups(M), chunks = [], accessors = [], views = [], prims = [], materials = []; let off = 0;
  G.forEach(([g, tris], gi) => { const n = tris.length * 3, pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    tris.forEach((t, i) => { const nn = Plan.norm3(...t); t.forEach((p, j) => { const q = [p[0], p[2], -p[1]], k = (i * 3 + j) * 3;
      pos.set(q, k); nor.set([nn[0], nn[2], -nn[1]], k); q.forEach((v, d) => { min[d] = Math.min(min[d], v); max[d] = Math.max(max[d], v); }); }); });
    [pos, nor].forEach((arr, ai) => { views.push({ buffer: 0, byteOffset: off, byteLength: arr.byteLength, target: 34962 }); chunks.push(arr); off += arr.byteLength;
      accessors.push(Object.assign({ bufferView: views.length - 1, componentType: 5126, count: n, type: 'VEC3' }, ai === 0 ? { min, max } : {})); });
    const c = MATS[g]; materials.push({ name: g, pbrMetallicRoughness: { baseColorFactor: c, metallicFactor: 0, roughnessFactor: 0.9 }, ...(c[3] < 1 ? { alphaMode: 'BLEND' } : {}), doubleSided: true });
    prims.push({ attributes: { POSITION: accessors.length - 2, NORMAL: accessors.length - 1 }, material: gi }); });
  const buf = new Uint8Array(off); let o = 0; chunks.forEach(c => { buf.set(new Uint8Array(c.buffer), o); o += c.byteLength; });
  let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  const b64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(buf).toString('base64');
  return JSON.stringify({ asset: { version: '2.0', generator: 'Sketch to Plan' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: P.name }],
    meshes: [{ primitives: prims }], materials, accessors, bufferViews: views, buffers: [{ byteLength: off, uri: 'data:application/octet-stream;base64,' + b64 }] });
}
function ruby(P, S, R, M) {
  const lines = [];
  const q = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  lines.push(`# ${P.name} — floor plan model generated by Sketch to Plan.`);
  lines.push(`# In SketchUp desktop: Extensions > Developer > Ruby Console, then type:  load "<path to this file>"`);
  lines.push(`# Then File > Save As to keep it as a .skp file. Units: metres.`);
  lines.push(`model = Sketchup.active_model`, `model.start_operation(${q('Import ' + P.name)}, true)`, `ents = model.active_entities`);
  lines.push(`def plan_mat(model, name, rgb, alpha)\n  m = model.materials[name] || model.materials.add(name)\n  m.color = Sketchup::Color.new(*rgb)\n  m.alpha = alpha\n  m\nend`);
  lines.push(`def plan_tag(model, name)\n  model.respond_to?(:layers) ? model.layers.add(name) : nil\nend`);
  lines.push(`def plan_piece(ents, pts, z0, z1, tag, mat)\n  g = ents.add_group\n  f = g.entities.add_face(pts.map { |x, y| Geom::Point3d.new(x.m, y.m, z0.m) })\n  return g unless f\n  f.reverse! if f.normal.z < 0\n  f.pushpull((z1 - z0).m)\n  g.layer = tag if tag\n  g.material = mat\n  g\nend`);
  Object.entries(MATS).forEach(([n, c]) => lines.push(`mat_${n.toLowerCase()} = plan_mat(model, ${q('Plan ' + n)}, [${c.slice(0, 3).map(v => Math.round(v * 255)).join(', ')}], ${c[3]})`, `tag_${n.toLowerCase()} = plan_tag(model, ${q(n)})`));
  lines.push(`root = ents.add_group`, `root.name = ${q(P.name)}`, `re = root.entities`);
  M.pieces.forEach(p => { if (p.z1 - p.z0 < 1e-4) return; lines.push(`plan_piece(re, [${p.foot.map(v => `[${n4(v[0])}, ${n4(v[1])}]`).join(', ')}], ${n4(p.z0)}, ${n4(p.z1)}, tag_${p.grp.toLowerCase()}, mat_${p.grp.toLowerCase()})`); });
  if (R) P.rooms.forEach(rm => { const r = R.rooms[rm.id]; if (!r) return; lines.push(`re.add_text(${q((rm.name || 'Room') + (r.ok ? ' ' + Plan.fmtArea(r.area, 'm') : ''))}, Geom::Point3d.new(${n4(r.at.x)}.m, ${n4(-r.at.y)}.m, 0.05.m))`); });
  lines.push(`model.commit_operation`, `puts ${q('Imported ' + P.name)}`);
  return lines.join('\n') + '\n';
}
// ---------- ZIP (stored, no compression) ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zip(files) {
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  const d = new Date(), dt = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF, dd = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
  files.forEach(f => {
    const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, dt, true); h.setUint16(12, dd, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, dt, true); c.setUint16(14, dd, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), name); off += 30 + name.length + data.length; });
  const csize = central.reduce((a, b) => a + b.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(e.buffer)], out = new Uint8Array(all.reduce((a, b) => a + b.length, 0)); let o = 0; all.forEach(b => { out.set(b, o); o += b.length; });
  return out;
}
return { zip, svgSheet, pdf, dxf, obj, mtl, stl, dae, gltf, ruby, primBounds, svgPrims };
})();
if (typeof module !== 'undefined') module.exports = Exporters;
