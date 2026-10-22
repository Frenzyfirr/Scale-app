// =====================================================================
// More exporters: IFC4, GLB, 3MF, PLY, KMZ, CSV schedule, and a multi-page PDF writer for the build manual.
// =====================================================================
const Exporters2 = (() => {
'use strict';
const n6 = v => { const s = (Math.round(v * 1e6) / 1e6).toString(); return s; };
const MATS = { Walls: [0.93, 0.92, 0.89, 1], Glass: [0.62, 0.78, 0.88, 0.45], Floor: [0.72, 0.66, 0.58, 1], Doors: [0.55, 0.4, 0.28, 1] };
const groups = M => Object.entries(M.groups).filter(([, t]) => t.length);

// ---------- IFC4 (STEP physical file) ----------
const B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
function guid() { // 22-character IFC GlobalId from 128 random bits
  const b = new Uint8Array(16); (typeof crypto !== 'undefined' && crypto.getRandomValues) ? crypto.getRandomValues(b) : b.forEach((_, i) => b[i] = Math.random() * 256 | 0);
  let n = 0n; b.forEach(x => { n = (n << 8n) | BigInt(x); }); let s = ''; for (let i = 0; i < 22; i++) { s = B64[Number(n % 64n)] + s; n /= 64n; } return s; }
const R = v => { if (!isFinite(v)) v = 0; let s = (Math.round(v * 1e6) / 1e6).toString(); if (!/[.eE]/.test(s)) s += '.'; return s; };
const S = s => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "''").replace(/[^\x20-\x7e]/g, c => '\\X2\\' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0') + '\\X0\\') + "'";
function ifc(P, Sol, Rr) {
  const L = []; let id = 0; const E = s => { L.push(`#${++id}=${s};`); return '#' + id; };
  const st = P.settings, H = st.wallHeight;
  const pt3 = (x, y, z) => E(`IFCCARTESIANPOINT((${R(x)},${R(y)},${R(z)}))`), pt2 = (x, y) => E(`IFCCARTESIANPOINT((${R(x)},${R(y)}))`), dir = (x, y, z) => E(`IFCDIRECTION((${R(x)},${R(y)},${R(z)}))`);
  const origin = pt3(0, 0, 0), zUp = dir(0, 0, 1), xAx = dir(1, 0, 0);
  const ax3 = (p, ref) => E(`IFCAXIS2PLACEMENT3D(${p},${zUp},${ref || xAx})`);
  const worldAx = ax3(origin);
  const units = [E(`IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)`), E(`IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)`), E(`IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)`), E(`IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)`)];
  const ua = E(`IFCUNITASSIGNMENT((${units.join(',')}))`);
  const ctx = E(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${worldAx},$)`);
  const body = E(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${ctx},$,.MODEL_VIEW.,$)`);
  const project = E(`IFCPROJECT('${guid()}',$,${S(P.name)},$,$,$,$,(${ctx}),${ua})`);
  const sitePl = E(`IFCLOCALPLACEMENT($,${ax3(origin)})`), site = E(`IFCSITE('${guid()}',$,'Site',$,$,${sitePl},$,$,.ELEMENT.,$,$,$,$,$)`);
  const bldPl = E(`IFCLOCALPLACEMENT(${sitePl},${ax3(origin)})`), bld = E(`IFCBUILDING('${guid()}',$,${S(P.name)},$,$,${bldPl},$,$,.ELEMENT.,$,$,$)`);
  const stPl = E(`IFCLOCALPLACEMENT(${bldPl},${ax3(origin)})`), storey = E(`IFCBUILDINGSTOREY('${guid()}',$,'Ground floor',$,$,${stPl},$,$,.ELEMENT.,0.)`);
  E(`IFCRELAGGREGATES('${guid()}',$,$,$,${project},(${site}))`); E(`IFCRELAGGREGATES('${guid()}',$,$,$,${site},(${bld}))`); E(`IFCRELAGGREGATES('${guid()}',$,$,$,${bld},(${storey}))`);
  const extrude = (x, y, w, d, z0, h, placeAx) => { const prof = E(`IFCRECTANGLEPROFILEDEF(.AREA.,$,${E(`IFCAXIS2PLACEMENT2D(${pt2(x, y)},$)`)},${R(w)},${R(d)})`);
    return E(`IFCEXTRUDEDAREASOLID(${prof},${placeAx || E(`IFCAXIS2PLACEMENT3D(${pt3(0, 0, z0)},$,$)`)},${zUp},${R(h)})`); };
  const shape = items => E(`IFCPRODUCTDEFINITIONSHAPE($,$,(${E(`IFCSHAPEREPRESENTATION(${body},'Body','SweptSolid',(${items.join(',')}))`)}))`);
  const contained = [];
  P.walls.forEach((w, i) => {
    const g = Plan.wallGeom(P, Sol, w), a = g.a; // plan y down → IFC y = -y
    const pl = E(`IFCLOCALPLACEMENT(${stPl},${ax3(pt3(a.x, -a.y, 0), dir(g.ux, -g.uy, 0))})`);
    const solid = extrude(g.L / 2, 0, g.L + g.t, g.t, 0, H);
    const wall = E(`IFCWALL('${guid()}',$,${S('W' + (i + 1))},${S(w.ext ? 'Outside wall' : 'Inside wall')},$,${pl},${shape([solid])},$,.STANDARD.)`); contained.push(wall);
    P.openings.filter(o => o.wall === w.id).forEach(o => { const O = Plan.openingGeom(P, Sol, o);
      const isWin = o.type === 'window', sill = isWin ? (o.sill != null ? o.sill : st.winSill) : 0, head = Math.min(H, isWin ? sill + (o.height || st.winH) : (o.height || st.doorH));
      const opl = E(`IFCLOCALPLACEMENT(${pl},${ax3(pt3(O.s0, 0, sill))})`);
      const op = E(`IFCOPENINGELEMENT('${guid()}',$,'Opening',$,$,${opl},${shape([extrude(O.width / 2, 0, O.width, g.t + 0.2, 0, head - sill)])},$,.OPENING.)`);
      E(`IFCRELVOIDSELEMENT('${guid()}',$,$,$,${wall},${op})`);
      if (o.type === 'opening') return;
      const fpl = E(`IFCLOCALPLACEMENT(${opl},${ax3(origin)})`);
      const fill = isWin ? E(`IFCWINDOW('${guid()}',$,'Window',$,$,${fpl},$,$,${R(head - sill)},${R(O.width)},.WINDOW.,$,$)`)
        : E(`IFCDOOR('${guid()}',$,'Door',$,$,${fpl},$,$,${R(head)},${R(O.width)},.DOOR.,.SINGLE_SWING_${o.hinge === 'b' ? 'RIGHT' : 'LEFT'}.,$)`);
      E(`IFCRELFILLSELEMENT('${guid()}',$,$,$,${op},${fill})`); contained.push(fill); });
  });
  if (Rr) { const rects = Plan.insideRects(Rr); if (rects.length) { const items = rects.map(([x0, y0, x1, y1]) => extrude((x0 + x1) / 2, -(y0 + y1) / 2, x1 - x0, y1 - y0, -st.slab, st.slab));
    contained.push(E(`IFCSLAB('${guid()}',$,'Floor slab',$,$,${E(`IFCLOCALPLACEMENT(${stPl},${ax3(origin)})`)},${shape(items)},$,.FLOOR.)`)); } }
  E(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid()}',$,$,$,(${contained.join(',')}),${storey})`);
  const spaces = [];
  P.rooms.forEach(rm => { const info = Rr && Rr.rooms[rm.id]; const sp = E(`IFCSPACE('${guid()}',$,${S(rm.name)},$,$,${E(`IFCLOCALPLACEMENT(${stPl},${ax3(origin)})`)},$,${S(rm.name)},.ELEMENT.,.INTERNAL.,$)`); spaces.push(sp);
    if (info && info.ok) { const q = E(`IFCQUANTITYAREA('NetFloorArea',$,$,${R(info.area)},$)`); const qs = E(`IFCELEMENTQUANTITY('${guid()}',$,'Qto_SpaceBaseQuantities',$,$,(${q}))`); E(`IFCRELDEFINESBYPROPERTIES('${guid()}',$,$,$,(${sp}),${qs})`); } });
  if (spaces.length) E(`IFCRELAGGREGATES('${guid()}',$,$,$,${storey},(${spaces.join(',')}))`);
  const now = new Date().toISOString().slice(0, 19);
  return `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');\nFILE_NAME(${S((P.name || 'plan') + '.ifc')},'${now}',(''),(''),'Sketch to Plan','Sketch to Plan','');\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n${L.join('\n')}\nENDSEC;\nEND-ISO-10303-21;\n`;
}

// ---------- glTF binary (GLB) ----------
function glb(P, M) {
  const json = JSON.parse(Exporters.gltf(P, M)), uri = json.buffers[0].uri, b64 = uri.split(',')[1];
  const bin = typeof atob === 'function' ? Uint8Array.from(atob(b64), c => c.charCodeAt(0)) : new Uint8Array(Buffer.from(b64, 'base64'));
  delete json.buffers[0].uri;
  const pad4 = n => (4 - (n % 4)) % 4;
  let js = new TextEncoder().encode(JSON.stringify(json)); const jsPad = pad4(js.length), binPad = pad4(bin.length);
  const total = 12 + 8 + js.length + jsPad + 8 + bin.length + binPad, out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, js.length + jsPad, true); dv.setUint32(16, 0x4E4F534A, true); out.set(js, 20); out.fill(0x20, 20 + js.length, 20 + js.length + jsPad);
  const o = 20 + js.length + jsPad; dv.setUint32(o, bin.length + binPad, true); dv.setUint32(o + 4, 0x004E4942, true); out.set(bin, o + 8);
  return out;
}

// ---------- 3MF (3D printing; millimetres) ----------
function threeMF(P, M) {
  let objs = '', items = '', idn = 2; const mats = groups(M).map(([g]) => g);
  const base = `<basematerials id="1">${mats.map(g => { const c = MATS[g]; const hx = v => Math.round(v * 255).toString(16).padStart(2, '0').toUpperCase(); return `<base name="${g}" displaycolor="#${hx(c[0])}${hx(c[1])}${hx(c[2])}${c[3] < 1 ? hx(c[3]) : ''}"/>`; }).join('')}</basematerials>`;
  groups(M).forEach(([g, tris], gi) => { const vmap = new Map(), verts = [], tri = [];
    const vi = p => { const k = p.map(v => Math.round(v * 1e5)).join(','); if (!vmap.has(k)) { vmap.set(k, verts.length); verts.push(p); } return vmap.get(k); };
    tris.forEach(t => tri.push([vi(t[0]), vi(t[1]), vi(t[2])]));
    objs += `<object id="${idn}" name="${g}" type="model" pid="1" pindex="${gi}"><mesh><vertices>${verts.map(v => `<vertex x="${n6(v[0] * 1000)}" y="${n6(v[1] * 1000)}" z="${n6(v[2] * 1000)}"/>`).join('')}</vertices><triangles>${tri.filter(t => t[0] !== t[1] && t[1] !== t[2] && t[0] !== t[2]).map(t => `<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}"/>`).join('')}</triangles></mesh></object>`;
    items += `<item objectid="${idn}"/>`; idn++; });
  const model = `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Title">${String(P.name).replace(/[<&>"]/g, '')}</metadata><resources>${base}${objs}</resources><build>${items}</build></model>`;
  return Exporters.zip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>' },
    { name: '3D/3dmodel.model', data: model }]);
}

// ---------- PLY (coloured mesh) ----------
function ply(P, M) {
  const vs = [], fs = []; groups(M).forEach(([g, tris]) => { const c = MATS[g].slice(0, 3).map(v => Math.round(v * 255)); tris.forEach(t => { const k = vs.length; t.forEach(p => vs.push(`${n6(p[0])} ${n6(p[1])} ${n6(p[2])} ${c.join(' ')}`)); fs.push(`3 ${k} ${k + 1} ${k + 2}`); }); });
  return `ply\nformat ascii 1.0\ncomment ${String(P.name).replace(/\n/g, ' ')} — metres, Z up\nelement vertex ${vs.length}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nelement face ${fs.length}\nproperty list uchar int vertex_indices\nend_header\n${vs.join('\n')}\n${fs.join('\n')}\n`;
}

// ---------- KMZ (Google Earth) ----------
function kmz(P, M) {
  const st = P.settings, lat = +st.lat, lon = +st.lon;
  const kml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${String(P.name).replace(/[<&>]/g, '')}</name><Placemark><name>${String(P.name).replace(/[<&>]/g, '')}</name>
<Model><altitudeMode>clampToGround</altitudeMode><Location><longitude>${lon}</longitude><latitude>${lat}</latitude><altitude>0</altitude></Location>
<Orientation><heading>${+(st.north || 0)}</heading><tilt>0</tilt><roll>0</roll></Orientation><Scale><x>1</x><y>1</y><z>1</z></Scale><Link><href>models/model.dae</href></Link></Model></Placemark></Document></kml>`;
  return Exporters.zip([{ name: 'doc.kml', data: kml }, { name: 'models/model.dae', data: Exporters.dae(P, M) }]);
}

// ---------- CSV schedule ----------
function schedule(P, Sol, Rr) {
  const q = s => { s = String(s == null ? '' : s); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }, rows = [];
  rows.push(['Rooms'], ['Room', 'Net area m2']); P.rooms.forEach(r => { const i = Rr && Rr.rooms[r.id]; rows.push([r.name, i && i.ok ? i.area.toFixed(2) : '']); });
  rows.push(['Gross floor area', Rr ? Rr.gross.toFixed(2) : '']);
  rows.push([], ['Walls'], ['Wall', 'Type', 'Length m', 'Thickness m', 'Height m', 'Area m2 (minus openings)', 'Typed length m']);
  P.walls.forEach((w, i) => { const g = Plan.wallGeom(P, Sol, w), ops = P.openings.filter(o => o.wall === w.id);
    const opA = ops.reduce((a, o) => { const isWin = o.type === 'window', sill = isWin ? (o.sill != null ? o.sill : P.settings.winSill) : 0, head = isWin ? sill + (o.height || P.settings.winH) : (o.height || P.settings.doorH); return a + o.width * (Math.min(P.settings.wallHeight, head) - sill); }, 0);
    rows.push(['W' + (i + 1), w.ext ? 'outside' : 'inside', g.L.toFixed(3), g.t.toFixed(3), P.settings.wallHeight.toFixed(2), (g.L * P.settings.wallHeight - opA).toFixed(2), w.len > 0 ? w.len : '']); });
  rows.push([], ['Doors and windows'], ['Type', 'Wall', 'Width m', 'Height m', 'Sill m', 'Centre from wall start m']);
  P.openings.forEach(o => { const w = Plan.wallById(P, o.wall), O = Plan.openingGeom(P, Sol, o), isWin = o.type === 'window';
    rows.push([o.type, 'W' + (P.walls.indexOf(w) + 1), O.width.toFixed(2), (isWin ? (o.height || P.settings.winH) : (o.height || P.settings.doorH)).toFixed(2), isWin ? (o.sill != null ? o.sill : P.settings.winSill).toFixed(2) : '0', ((O.s0 + O.s1) / 2).toFixed(2)]); });
  return '﻿' + rows.map(r => r.map(q).join(',')).join('\r\n');
}

// ---------- multi-page PDF writer (mm, origin top-left) ----------
const HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const pdfText = s => String(s).replace(/[łŁ]/g, c => c === 'ł' ? 'l' : 'L').replace(/[×]/g, 'x').replace(/[–—]/g, '-').replace(/[↻]/g, '(r)').replace(/[·]/g, '·').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e -ÿ]/g, '?');
const textW = (s, size, bold) => { let w = 0; for (const ch of s) { const c = ch.charCodeAt(0); w += (c >= 32 && c < 127 ? HELV[c - 32] : 556) * (bold ? 1.06 : 1); } return w / 1000 * size; };
class PdfDoc {
  constructor(w, h) { this.W = w || 210; this.H = h || 297; this.pages = []; this.newPage(); }
  newPage() { this.ops = []; this.pages.push(this.ops); this.y = 16; return this; }
  get MM() { return 72 / 25.4; }
  X(x) { return (x * this.MM).toFixed(2); } Y(y) { return ((this.H - y) * this.MM).toFixed(2); }
  color(hex, stroke) { const m = hex.replace('#', ''); const c = [0, 2, 4].map(i => (parseInt(m.slice(i, i + 2), 16) / 255).toFixed(3)).join(' '); this.ops.push(`${c} ${stroke ? 'RG' : 'rg'}`); }
  lw(w) { this.ops.push(`${(w * this.MM).toFixed(2)} w`); }
  line(x1, y1, x2, y2, w, dash) { this.lw(w || 0.2); this.ops.push(dash ? `[${(0.8 * this.MM).toFixed(2)} ${(0.6 * this.MM).toFixed(2)}] 0 d` : '[] 0 d', `${this.X(x1)} ${this.Y(y1)} m ${this.X(x2)} ${this.Y(y2)} l S`, '[] 0 d'); }
  poly(pts, fill, stroke, w) { this.lw(w || 0.2); if (fill) this.color(fill); if (stroke) this.color(stroke, true);
    this.ops.push(pts.map((p, i) => `${this.X(p[0])} ${this.Y(p[1])} ${i ? 'l' : 'm'}`).join(' ') + ' h ' + (fill ? (stroke ? 'B' : 'f') : 'S')); this.color('#1d2429'); this.color('#1d2429', true); }
  text(s, x, y, size, o = {}) { s = pdfText(s); const w = textW(s, size, o.bold), dx = o.align === 'center' ? -w / 2 : o.align === 'right' ? -w : 0;
    const a = (o.angle || 0) * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a); const px = x * this.MM + dx * c, py = (this.H - y) * this.MM + dx * sn;
    if (o.color) this.color(o.color); this.ops.push(`BT /${o.bold ? 'F2' : 'F1'} ${size.toFixed(2)} Tf ${c.toFixed(4)} ${sn.toFixed(4)} ${(-sn).toFixed(4)} ${c.toFixed(4)} ${px.toFixed(2)} ${py.toFixed(2)} Tm (${s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')}) Tj ET`); if (o.color) this.color('#1d2429'); }
  wrap(s, x, width, size, o = {}) { // writes a paragraph at this.y, page-breaking as needed
    const words = pdfText(s).split(/\s+/); let line = ''; const lh = size * 0.3528 * 1.35;
    const flush = () => { this.need(lh); this.text(line, x, this.y + size * 0.3528, size, o); this.y += lh; line = ''; };
    words.forEach(wd => { const t = line ? line + ' ' + wd : wd; if (textW(t, size, o.bold) / this.MM > width && line) { flush(); line = wd; } else line = t; }); if (line) flush(); }
  need(h) { if (this.y + h > this.H - 14) this.newPage(); }
  prims(pr, ox, oy, k) { pr.forEach(p => {
    if (p.t === 'poly') this.poly(p.pts.map(q => [ox + q[0] * k, oy + q[1] * k]), p.fill, p.stroke, Math.max(0.08, (p.w || 0.01) * 10));
    else if (p.t === 'line') this.line(ox + p.a[0] * k, oy + p.a[1] * k, ox + p.b[0] * k, oy + p.b[1] * k, Math.max(0.08, p.w * 10), p.dash);
    else if (p.t === 'text') this.text(p.s, ox + p.p[0] * k, oy + p.p[1] * k, Math.max(4, Math.min(11, p.h * k / 0.3528 * 1.1)), { bold: p.bold, align: p.anchor === 'middle' ? 'center' : 'left', angle: p.rot ? -p.rot : 0 }); }); }
  bytes(title) {
    const objs = ['<< /Type /Catalog /Pages 2 0 R >>', null]; const kids = [];
    const fontA = 3, fontB = 4; objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    this.pages.forEach((ops, i) => { const content = '0.114 0.141 0.161 RG 0.114 0.141 0.161 rg\n' + ops.join('\n') + `\nBT /F1 7 Tf 1 0 0 1 ${(this.W / 2 * this.MM - 10).toFixed(2)} ${(8 * this.MM).toFixed(2)} Tm (${i + 1} / ${this.pages.length}) Tj ET`;
      objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`); const cId = objs.length;
      objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${(this.W * this.MM).toFixed(2)} ${(this.H * this.MM).toFixed(2)}] /Contents ${cId} 0 R /Resources << /Font << /F1 ${fontA} 0 R /F2 ${fontB} 0 R >> >> >>`); kids.push(objs.length); });
    objs[1] = `<< /Type /Pages /Kids [${kids.map(k => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
    objs.push(`<< /Title (${pdfText(title || '').replace(/[()\\]/g, '')}) /Creator (Sketch to Plan) >>`);
    let out = '%PDF-1.4\n%âãÏÓ\n'; const offs = [];
    objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = out.length; out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${objs.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const b = new Uint8Array(out.length); for (let i = 0; i < out.length; i++) b[i] = out.charCodeAt(i) & 0xff; return b;
  }
}

// ---------- build manual (PDF) ----------
function manual(P, Sol, Rr, out) {
  const d = new PdfDoc(210, 297), M = 15, CW = 210 - 2 * M, mm = v => Math.round(v * 1000);
  const head = (t, size) => { d.need(14); d.text(t, M, d.y + 6, size || 15, { bold: true }); d.y += (size || 15) * 0.3528 + 6; };
  const rule = () => { d.line(M, d.y, 210 - M, d.y, 0.2); d.y += 3; };
  const table = (cols, rows, widths) => { const lh = 5; const drawRow = (r, bold) => { d.need(lh + 1); let x = M; r.forEach((c, i) => { const w = widths[i] * CW; let s = pdfText(c); while (s.length > 3 && textW(s, 8.5, bold) / d.MM > w - 2) s = s.slice(0, -2); d.text(s, x + (cols[i].r ? w - 3 : (i ? 1.5 : 0)), d.y + 3.6, 8.5, { bold, align: cols[i].r ? 'right' : 'left' }); x += w; }); d.y += lh; };
    drawRow(cols.map(c => c.t), true); d.line(M, d.y, 210 - M, d.y, 0.15); d.y += 1; rows.forEach(r => drawRow(r)); d.y += 3; };
  const drawing = (pr, maxH) => { const bb = Exporters.primBounds(pr); const k = Math.min(CW / (bb.x1 - bb.x0), maxH / (bb.y1 - bb.y0)) * 1000 / 1000; d.need((bb.y1 - bb.y0) * k + 4);
    d.prims(pr, M - bb.x0 * k + (CW - (bb.x1 - bb.x0) * k) / 2, d.y - bb.y0 * k, k); d.y += (bb.y1 - bb.y0) * k + 5; };
  const B = P.build;
  // cover
  d.text('Build manual', M, 28, 24, { bold: true }); d.text(P.name, M, 37, 13); d.text(new Date().toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' }) + '   |   Sketch to Plan', M, 44, 9, { color: '#5b6872' });
  d.y = 52; rule();
  d.wrap(`All sizes are in millimetres and are worked out from the dimensioned plan. Walls are measured along their centre line from the start corner marked S on each drawing; outside walls overlap at the corners, so check each corner on site before cutting. Spare material: ${B.waste}% added. Saw cut allowance: ${B.kerf} mm.`, M, CW, 9.5);
  d.y += 2; head('Bill of materials', 13);
  table([{ t: 'Item' }, { t: 'Quantity', r: 1 }, { t: 'Note' }, { t: 'Cost', r: 1 }], out.bom.map(b => [b.name, `${b.qty} ${b.unit}`, b.note, b.cost ? b.cost.toFixed(2) : '']), [0.38, 0.13, 0.37, 0.12]);
  if (out.total) { d.text(`Estimated total: ${out.total.toFixed(2)} ${B.currency || ''}`, 210 - M, d.y + 2, 10, { bold: true, align: 'right' }); d.y += 8; }
  if (out.warnings.length) { head('Notes', 11); out.warnings.forEach(w => d.wrap('• ' + w, M, CW, 9)); }
  // timber
  Object.values(out.linear).forEach(x => { d.newPage(); head(`Cut list: ${x.mat.name}`, 13);
    table([{ t: 'Code' }, { t: 'Part' }, { t: 'Length mm', r: 1 }, { t: 'Qty', r: 1 }, { t: 'Walls' }], x.pieces.map(p => [p.code, p.role, mm(p.len), p.qty, p.walls]), [0.1, 0.22, 0.14, 0.08, 0.46]);
    head('Cutting plan: which pieces to cut from each length', 11);
    const longest = Math.max(...x.bars.map(b => b.stock)), k = (CW - 48) / longest;
    x.bars.forEach((b, i) => { d.need(9); const y = d.y; d.text(String(i + 1), M, y + 4.2, 8, { bold: true }); const x0 = M + 7;
      d.poly([[x0, y], [x0 + b.stock * k, y], [x0 + b.stock * k, y + 6], [x0, y + 6]], '#f6efe1', '#1d2429', 0.15);
      let xx = 0; b.cuts.forEach(c => { d.poly([[x0 + xx * k, y], [x0 + (xx + c.len) * k, y], [x0 + (xx + c.len) * k, y + 6], [x0 + xx * k, y + 6]], '#e3c48c', '#1d2429', 0.15);
        if (c.len * k > 12) d.text(`${c.code} ${mm(c.len)}`, x0 + (xx + c.len / 2) * k, y + 4.1, 6.5, { align: 'center' }); xx += c.len + B.kerf / 1000; });
      d.text(`${b.stock.toFixed(2)} m  offcut ${mm(b.waste)}`, x0 + longest * k + 2, y + 4.1, 7); d.y += 8.5; }); });
  // sheets
  Object.values(out.sheets).forEach(x => { d.newPage(); head(`Cut list: ${x.mat.name} (${x.mat.w}×${x.mat.h} mm)`, 13);
    table([{ t: 'Code' }, { t: 'Wall face' }, { t: 'Width', r: 1 }, { t: 'Height', r: 1 }, { t: 'Cut-outs (w x h at x, z from bottom left)' }], x.pieces.map(p => [p.code, `${p.wall} ${p.side}`, mm(p.w), mm(p.h), p.cut.map(c => `${mm(c.w)}x${mm(c.h)} at ${mm(c.x)}, ${mm(c.z)}`).join('; ')]), [0.09, 0.2, 0.1, 0.1, 0.51]);
    head('Cutting plan for each sheet', 11);
    const per = 3, cw = CW / per, k = (cw - 6) / (x.mat.w / 1000), shH = (x.mat.h / 1000) * k + 8;
    x.sheets.forEach((s, i) => { if (i % per === 0) { d.need(shH); if (i) d.y += 0; } const col = i % per, x0 = M + col * cw, y0 = d.y;
      d.text(`Sheet ${i + 1}`, x0, y0 + 3, 8, { bold: true }); d.prims(Build.sheetDiagram(s, x.mat), x0, y0 + 5, k);
      if (col === per - 1 || i === x.sheets.length - 1) d.y += shH; }); });
  // blocks
  Object.values(out.blocks).forEach(x => { d.newPage(); head(`Blocks: ${x.mat.name}`, 13);
    d.wrap(`${x.full} whole blocks plus ${x.cutBlocks} blocks cut into these pieces (cut pairs of pieces from one block where they fit):`, M, CW, 9.5); d.y += 2;
    table([{ t: 'Cut piece length mm', r: 1 }, { t: 'Quantity', r: 1 }], Object.entries(x.cuts).sort((a, b) => b[0] - a[0]).map(([k2, n]) => [k2, n]), [0.3, 0.2]);
    if (x.lintels.length) table([{ t: 'Lintel length mm', r: 1 }, { t: 'Wall' }], x.lintels.map(l => [mm(l.len), l.wall]), [0.3, 0.3]); });
  // walls
  out.walls.forEach(rec => { d.newPage(); head(`Wall ${rec.name}: ${rec.ext ? 'outside' : 'inside'} wall, ${mm(rec.L)} × ${mm(rec.H)} mm`, 13);
    drawing(Build.elevation(rec, rec.frame ? 'frame' : 'blocks'), 95);
    rec.steps.forEach((s, i) => { d.y += 1; d.wrap(`${i + 1}. ${s}`, M, CW, 9.5); });
    rec.faces.forEach((f, fi) => { d.y += 3; d.need(70); d.text(`${f.side[0].toUpperCase() + f.side.slice(1)} face: ${f.mat.name}`, M, d.y + 4, 10, { bold: true }); d.y += 7; drawing(Build.elevation(rec, 'face:' + fi), 70); }); });
  if (out.floor) { d.newPage(); head(`Floor: ${out.floor.mat.name}`, 13); d.wrap(`Net room area ${out.floor.area.toFixed(1)} m². ${out.floor.panels} panels including ${B.waste}% spare${out.floor.packs ? `, which is ${out.floor.packs} packs of ${out.floor.mat.pack}` : ''}. Lay the panels along the longest wall of each room and stagger the end joints by at least 300 mm.`, M, CW, 9.5); }
  return d.bytes('Build manual: ' + P.name);
}
return { ifc, glb, threeMF, ply, kmz, schedule, manual, PdfDoc, guid };
})();
if (typeof module !== 'undefined') module.exports = Exporters2;
