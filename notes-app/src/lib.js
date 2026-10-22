// =====================================================================
// Margin Notes library: search, encryption, merging, zip, PDF (Unicode), DOCX, CSV.
// No DOM; runs in browsers, Android WebView and Node.
// =====================================================================
const NotesLib = (() => {
'use strict';
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s.replace(/\s+/g, '')), c => c.charCodeAt(0));
const concat = parts => { const n = parts.reduce((a, p) => a + p.length, 0), o = new Uint8Array(n); let k = 0; parts.forEach(p => { o.set(p, k); k += p.length; }); return o; };

// ---------- text ----------
const fold = s => String(s).toLowerCase().replace(/ł/g, 'l').replace(/ß/g, 'ss').replace(/ø/g, 'o').replace(/æ/g, 'ae').normalize('NFD').replace(/[̀-ͯ]/g, '');
function titleOf(text) { const line = String(text || '').split('\n').find(l => l.trim()) || ''; return line.trim().replace(/^#+\s*/, '').slice(0, 80) || 'Untitled note'; }
const words = text => (String(text || '').match(/\S+/g) || []).length;

// ---------- search: words (all must appear), "exact phrases", -excluded ----------
function parseQuery(q) {
  const out = { phrases: [], words: [], not: [], empty: true }; q = String(q || '');
  q = q.replace(/(-?)"([^"]+)"/g, (m, neg, p) => { (neg ? out.not : out.phrases).push(fold(p.trim())); return ' '; });
  q.split(/\s+/).filter(Boolean).forEach(w => { if (w.startsWith('-') && w.length > 1) out.not.push(fold(w.slice(1))); else out.words.push(fold(w)); });
  out.empty = !out.phrases.length && !out.words.length && !out.not.length; return out;
}
// map positions in folded text back to the original (folding can change lengths)
function foldMap(text) { let f = '', map = []; for (let i = 0; i < text.length; i++) { const c = fold(text[i]); for (let k = 0; k < c.length; k++) { f += c[k]; map.push(i); } } map.push(text.length); return { f, map }; }
function search(text, Q) {
  if (Q.empty) return { ok: true, ranges: [] };
  const { f, map } = foldMap(String(text)); const ranges = [];
  for (const n of Q.not) if (n && f.includes(n)) return { ok: false };
  for (const t of [...Q.phrases, ...Q.words]) { if (!t) continue; let i = f.indexOf(t); if (i < 0) return { ok: false };
    while (i >= 0) { ranges.push([map[i], map[i + t.length - 1] + 1]); i = f.indexOf(t, i + t.length); } }
  ranges.sort((a, b) => a[0] - b[0]); return { ok: true, ranges };
}
function snippet(text, ranges, len) {
  len = len || 140; text = String(text || ''); const r0 = ranges && ranges[0];
  let start = r0 ? Math.max(0, r0[0] - 50) : 0; if (start > 0) { const sp = text.lastIndexOf(' ', start); if (sp > start - 20 && sp >= 0) start = sp + 1; }
  const end = Math.min(text.length, start + len); const parts = []; let at = start;
  (ranges || []).filter(r => r[1] > start && r[0] < end).forEach(([a, b]) => { a = Math.max(a, at); if (a > at) parts.push([text.slice(at, a), false]); if (b > a) parts.push([text.slice(a, Math.min(b, end)), true]); at = Math.max(at, Math.min(b, end)); });
  if (at < end) parts.push([text.slice(at, end), false]);
  return { parts, before: start > 0, after: end < text.length };
}

// ---------- encryption: AES-256-GCM, key from password with PBKDF2-SHA-256 ----------
const ITER = 600000, HEAD = '-----BEGIN MARGIN NOTES ENCRYPTED-----', FOOT = '-----END MARGIN NOTES ENCRYPTED-----';
const subtle = () => { if (!(globalThis.crypto && crypto.subtle)) throw new Error('Encryption is not available in this browser.'); return crypto.subtle; };
const keyCache = new Map();
async function deriveKey(password, salt, iter) {
  const id = b64(salt) + ':' + (iter || ITER) + ':' + password; if (keyCache.has(id)) return keyCache.get(id);
  const base = await subtle().importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter || ITER }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  keyCache.set(id, key); return key;
}
const randomBytes = n => { const b = new Uint8Array(n); crypto.getRandomValues(b); return b; };
const isArmored = t => typeof t === 'string' && t.trimStart().startsWith(HEAD);
async function encryptText(text, password, salt) {
  salt = salt || randomBytes(16); const iv = randomBytes(12), key = await deriveKey(password, salt, ITER);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text)));
  const body = b64(ct).replace(/(.{64})/g, '$1\n').trim();
  return `${HEAD}\nFormat: AES-256-GCM, key from PBKDF2-SHA-256 with ${ITER} iterations\nSalt: ${b64(salt)}\nIV: ${b64(iv)}\n\n${body}\n${FOOT}\n`;
}
function parseArmor(t) { const lines = String(t).trim().split(/\r?\n/); const h = {}; let i = 1;
  for (; i < lines.length && lines[i].trim(); i++) { const m = lines[i].match(/^([A-Za-z]+):\s*(.*)$/); if (m) h[m[1].toLowerCase()] = m[2]; }
  const body = lines.slice(i + 1).filter(l => l !== FOOT).join(''); const iter = +((h.format || '').match(/(\d{4,})\s*iterations/) || [])[1] || ITER;
  if (!h.salt || !h.iv || !body) throw new Error('This encrypted text is damaged.'); return { salt: unb64(h.salt), iv: unb64(h.iv), ct: unb64(body), iter }; }
async function decryptText(armor, password) {
  const a = parseArmor(armor), key = await deriveKey(password, a.salt, a.iter);
  try { return dec.decode(await subtle().decrypt({ name: 'AES-GCM', iv: a.iv }, key, a.ct)); }
  catch (e) { const err = new Error('Wrong password'); err.code = 'bad_password'; throw err; }
}
const saltOf = armor => b64(parseArmor(armor).salt);

// ---------- merging ----------
function merge(notes, opts) {
  const sep = (opts && opts.sep) || 'heading';
  return notes.map((n, i) => { const t = String(n.text || '').replace(/\s+$/, '');
    if (sep === 'heading') { const title = n.title || titleOf(t); const rest = t.split('\n'); if (rest[0] && rest[0].trim() === title) rest.shift(); return `${'='.repeat(Math.min(60, title.length + 8))}\n=== ${title}\n${'='.repeat(Math.min(60, title.length + 8))}\n${rest.join('\n').replace(/^\n+/, '')}`; }
    if (sep === 'line') return (i ? '\n' + '-'.repeat(40) + '\n\n' : '') + t;
    return t; }).join('\n\n') + '\n';
}

// ---------- zip ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zip(files) {
  const parts = [], central = []; let off = 0; const d = new Date();
  const dt = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF, dd = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
  files.forEach(f => { const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30)); [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, dt, 2], [12, dd, 2], [14, crc, 4], [18, data.length, 4], [22, data.length, 4], [26, name.length, 2], [28, 0, 2]].forEach(([o, v, n]) => n === 4 ? h.setUint32(o, v, true) : h.setUint16(o, v, true));
    parts.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46)); [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, dt, 2], [14, dd, 2], [16, crc, 4], [20, data.length, 4], [24, data.length, 4], [28, name.length, 2], [42, off, 4]].forEach(([o, v, n]) => n === 4 ? c.setUint32(o, v, true) : c.setUint16(o, v, true));
    central.push(new Uint8Array(c.buffer), name); off += 30 + name.length + data.length; });
  const cs = central.reduce((a, b) => a + b.length, 0), e = new DataView(new ArrayBuffer(22)); e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cs, true); e.setUint32(16, off, true);
  return concat([...parts, ...central, new Uint8Array(e.buffer)]);
}
async function unzip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let e = bytes.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--; if (e < 0) throw new Error('Not a zip file');
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const out = [];
  for (let i = 0; i < n; i++) { const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
    const ds = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true), raw = bytes.subarray(ds, ds + csize); let data;
    if (method === 0) data = raw; else if (method === 8) { if (typeof DecompressionStream === 'undefined') throw new Error('This zip is compressed and this browser cannot unpack it.'); data = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()); }
    else continue; if (!name.endsWith('/')) out.push({ name, data }); }
  return out;
}

// ---------- TrueType parsing (for PDF fonts) ----------
function parseTTF(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), T = {};
  for (let i = 0, n = dv.getUint16(4); i < n; i++) { const o = 12 + 16 * i; T[String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3])] = { off: dv.getUint32(o + 8), len: dv.getUint32(o + 12) }; }
  const upm = dv.getUint16(T.head.off + 18), bbox = [0, 2, 4, 6].map(k => dv.getInt16(T.head.off + 36 + k));
  const asc = dv.getInt16(T.hhea.off + 4), desc = dv.getInt16(T.hhea.off + 6), nhm = dv.getUint16(T.hhea.off + 34), ng = dv.getUint16(T.maxp.off + 4);
  const adv = new Uint16Array(ng); for (let g = 0; g < ng; g++) adv[g] = dv.getUint16(T.hmtx.off + 4 * Math.min(g, nhm - 1));
  const cmap = new Map(), co = T.cmap.off, nt = dv.getUint16(co + 2); let best = null;
  for (let i = 0; i < nt; i++) { const pid = dv.getUint16(co + 4 + 8 * i), eid = dv.getUint16(co + 6 + 8 * i), off = co + dv.getUint32(co + 8 + 8 * i), fmt = dv.getUint16(off);
    const rank = fmt === 12 ? 3 : fmt === 4 && (pid === 3 || pid === 0) ? 2 : 0; if (rank && (!best || rank > best.rank)) best = { off, fmt, rank }; }
  if (best.fmt === 12) { const ng2 = dv.getUint32(best.off + 12); for (let i = 0; i < ng2; i++) { const o = best.off + 16 + 12 * i, s = dv.getUint32(o), e = dv.getUint32(o + 4), g = dv.getUint32(o + 8); for (let c = s; c <= e; c++) cmap.set(c, g + c - s); } }
  else { const o = best.off, seg = dv.getUint16(o + 6) / 2, ends = o + 14, starts = ends + 2 * seg + 2, deltas = starts + 2 * seg, ros = deltas + 2 * seg;
    for (let i = 0; i < seg; i++) { const e = dv.getUint16(ends + 2 * i), s = dv.getUint16(starts + 2 * i), d = dv.getInt16(deltas + 2 * i), ro = dv.getUint16(ros + 2 * i);
      for (let c = s; c <= e && c !== 0xFFFF; c++) { let g; if (!ro) g = (c + d) & 0xFFFF; else { g = dv.getUint16(ros + 2 * i + ro + 2 * (c - s)); if (g) g = (g + d) & 0xFFFF; } if (g) cmap.set(c, g); } } }
  return { bytes, upm, bbox, asc, desc, adv, cmap };
}

// ---------- PDF writer with embedded Unicode fonts (A4, mm) ----------
class Pdf {
  constructor(fonts) { this.F = fonts.map(f => ({ ttf: parseTTF(f), used: new Map() })); this.W = 210; this.H = 297; this.M = 20; this.pages = []; this.newPage(); }
  newPage() { this.ops = []; this.pages.push(this.ops); this.y = this.M; }
  glyphs(s, fi) { const F = this.F[fi], out = []; for (const ch of String(s)) { const cp = ch.codePointAt(0); let g = F.ttf.cmap.get(cp); if (g == null) { g = F.ttf.cmap.get(0x3F) || 0; } F.used.set(g, F.used.get(g) || cp); out.push(g); } return out; }
  width(s, size, fi) { const F = this.F[fi]; let w = 0; for (const ch of String(s)) { const g = F.ttf.cmap.get(ch.codePointAt(0)) || F.ttf.cmap.get(0x3F) || 0; w += F.ttf.adv[g]; } return w / F.ttf.upm * size * 25.4 / 72; } // mm
  text(s, x, y, size, o = {}) { const fi = o.bold ? 1 : 0, g = this.glyphs(s, fi), pt = 72 / 25.4;
    const col = o.color ? o.color.match(/\w\w/g).map(h => (parseInt(h, 16) / 255).toFixed(3)).join(' ') + ' rg ' : '0.10 0.12 0.16 rg ';
    this.ops.push(`BT ${col}/F${fi + 1} ${size.toFixed(2)} Tf ${(x * pt).toFixed(2)} ${((this.H - y) * pt).toFixed(2)} Td <${g.map(v => v.toString(16).padStart(4, '0')).join('')}> Tj ET`); }
  line(x1, y1, x2, y2, w, color) { const pt = 72 / 25.4, c = (color || '#c9ced6').match(/\w\w/g).map(h => (parseInt(h, 16) / 255).toFixed(3)).join(' ');
    this.ops.push(`${c} RG ${(w * pt).toFixed(2)} w ${(x1 * pt).toFixed(2)} ${((this.H - y1) * pt).toFixed(2)} m ${(x2 * pt).toFixed(2)} ${((this.H - y2) * pt).toFixed(2)} l S`); }
  need(h) { if (this.y + h > this.H - this.M) this.newPage(); }
  para(s, size, o = {}) { // wrapped paragraph; keeps empty lines
    const lh = size * 25.4 / 72 * (o.lh || 1.45), maxW = this.W - 2 * this.M - (o.indent || 0), fi = o.bold ? 1 : 0;
    String(s).replace(/\t/g, '    ').split('\n').forEach(raw => { if (!raw.trim()) { this.need(lh); this.y += lh * 0.7; return; }
      const tokens = raw.match(/\s+|\S+/g) || []; let line = '';
      const flush = () => { this.need(lh); this.text(line.replace(/\s+$/, ''), this.M + (o.indent || 0), this.y + size * 25.4 / 72 * 0.8, size, o); this.y += lh; line = ''; };
      tokens.forEach(t => { if (this.width(line + t, size, fi) <= maxW) { line += t; return; }
        if (line.trim()) { flush(); if (/^\s+$/.test(t)) return; }
        while (this.width(t, size, fi) > maxW) { let k = t.length; while (k > 1 && this.width(t.slice(0, k), size, fi) > maxW) k--; line = t.slice(0, k); flush(); t = t.slice(k); }
        line = t; });
      if (line.trim()) flush(); }); }
  bytes(meta) {
    const pt = 72 / 25.4, objs = []; const add = o => { objs.push(o); return objs.length; };
    const catalog = add(null), pagesId = add(null);
    const fontIds = this.F.map((F, fi) => { const t = F.ttf, s = 1000 / t.upm, name = fi ? 'MarginSans-Bold' : 'MarginSans-Regular';
      const ff = add({ dict: `/Length1 ${t.bytes.length}`, stream: t.bytes });
      const fd = add(`<< /Type /FontDescriptor /FontName /${name} /Flags 32 /FontBBox [${t.bbox.map(v => Math.round(v * s)).join(' ')}] /ItalicAngle 0 /Ascent ${Math.round(t.asc * s)} /Descent ${Math.round(t.desc * s)} /CapHeight ${Math.round(t.asc * s * 0.72)} /StemV ${fi ? 120 : 80} /FontFile2 ${ff} 0 R >>`);
      const gids = [...F.used.keys()].sort((a, b) => a - b);
      const W = gids.map(g => `${g} [${Math.round(t.adv[g] * s)}]`).join(' ');
      const cid = add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${fd} 0 R /W [${W}] /CIDToGIDMap /Identity >>`);
      const hex = n => n.toString(16).padStart(4, '0'), u16 = cp => cp > 0xFFFF ? (() => { const v = cp - 0x10000; return hex(0xD800 + (v >> 10)) + hex(0xDC00 + (v & 0x3FF)); })() : hex(cp);
      let cm = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n';
      for (let i = 0; i < gids.length; i += 100) { const chunk = gids.slice(i, i + 100); cm += `${chunk.length} beginbfchar\n${chunk.map(g => `<${hex(g)}> <${u16(F.used.get(g))}>`).join('\n')}\nendbfchar\n`; }
      cm += 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
      const tu = add({ dict: '', stream: enc.encode(cm) });
      return add(`<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${tu} 0 R >>`); });
    const kids = this.pages.map((ops, i) => { const foot = this.pages.length > 1 ? (() => { const save = this.ops; this.ops = []; this.text(`${i + 1} / ${this.pages.length}`, this.W / 2 - 4, this.H - 10, 8, { color: '8a93a0' }); const r = this.ops; this.ops = save; return r.join('\n'); })() : '';
      const c = add({ dict: '', stream: enc.encode(ops.join('\n') + '\n' + foot) });
      return add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${(this.W * pt).toFixed(2)} ${(this.H * pt).toFixed(2)}] /Contents ${c} 0 R /Resources << /Font << /F1 ${fontIds[0]} 0 R /F2 ${fontIds[1]} 0 R >> >> >>`); });
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map(k => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
    const utf16 = s => '<FEFF' + [...String(s)].map(ch => { const cp = ch.codePointAt(0); return cp > 0xFFFF ? (() => { const v = cp - 0x10000; return (0xD800 + (v >> 10)).toString(16).padStart(4, '0') + (0xDC00 + (v & 0x3FF)).toString(16).padStart(4, '0'); })() : cp.toString(16).padStart(4, '0'); }).join('') + '>';
    const info = add(`<< /Title ${utf16(meta && meta.title || 'Notes')} /Producer (Margin Notes) >>`);
    const parts = [enc.encode('%PDF-1.7\n%âãÏÓ\n'.replace(/[\u0080-ÿ]/g, 'x'))], offs = []; let pos = parts[0].length;
    objs.forEach((o, i) => { offs.push(pos); let chunk;
      if (typeof o === 'string') chunk = [enc.encode(`${i + 1} 0 obj\n${o}\nendobj\n`)];
      else chunk = [enc.encode(`${i + 1} 0 obj\n<< /Length ${o.stream.length} ${o.dict} >>\nstream\n`), o.stream, enc.encode('\nendstream\nendobj\n')];
      chunk.forEach(c => { parts.push(c); pos += c.length; }); });
    parts.push(enc.encode(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${pos}\n%%EOF\n`));
    return concat(parts);
  }
}
const fmtDate = t => new Date(t).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
function pdf(notes, fonts, opts) {
  opts = opts || {}; const d = new Pdf(fonts);
  if (notes.length > 1 && opts.title) { d.para(opts.title, 20, { bold: true }); d.para(`${notes.length} notes · ${fmtDate(Date.now())}`, 9, { color: '6b7480' }); d.y += 4; }
  notes.forEach((n, i) => {
    if (i && opts.pageBreaks !== false) d.newPage(); else if (i) { d.y += 4; d.need(10); d.line(d.M, d.y, d.W - d.M, d.y, 0.3); d.y += 6; }
    const title = n.title || titleOf(n.text); let body = String(n.text || ''); const lines = body.split('\n'); if (lines[0] && lines[0].trim() === title) body = lines.slice(1).join('\n').replace(/^\n+/, '');
    d.para(title, 16, { bold: true, lh: 1.3 }); if (n.modified) d.para(`Created ${fmtDate(n.created)} · edited ${fmtDate(n.modified)}`, 8.5, { color: '6b7480' }); d.y += 3; d.para(body, 11);
  });
  return d.bytes({ title: opts.title || (notes[0] && (notes[0].title || titleOf(notes[0].text))) });
}

// ---------- DOCX ----------
const xe = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
function docx(notes, opts) {
  opts = opts || {};
  const run = (t, rpr) => `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${xe(t)}</w:t></w:r>`;
  const p = (t, style, rpr) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${t === '' ? '' : run(t, rpr)}</w:p>`;
  let body = '';
  if (notes.length > 1 && opts.title) body += p(opts.title, 'Title') + p(`${notes.length} notes · ${fmtDate(Date.now())}`, null, '<w:color w:val="6B7480"/><w:sz w:val="18"/>');
  notes.forEach((n, i) => { const title = n.title || titleOf(n.text); let text = String(n.text || ''); const ls = text.split('\n'); if (ls[0] && ls[0].trim() === title) text = ls.slice(1).join('\n').replace(/^\n+/, '');
    if (i && opts.pageBreaks !== false) body += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    body += p(title, 'Heading1'); if (n.modified) body += p(`Created ${fmtDate(n.created)} · edited ${fmtDate(n.modified)}`, null, '<w:color w:val="6B7480"/><w:sz w:val="16"/>');
    text.split('\n').forEach(l => { body += p(l.replace(/\t/g, '    ')); }); });
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="pl-PL"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="44"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="60"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style></w:styles>`;
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  return zip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>' },
    { name: 'word/_rels/document.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'word/document.xml', data: doc }, { name: 'word/styles.xml', data: styles },
    { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xe(opts.title || (notes[0] && titleOf(notes[0].text)) || 'Notes')}</dc:title><dc:creator>Margin Notes</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>` }]);
}

// ---------- CSV ----------
function csv(notes) {
  const q = s => { s = String(s == null ? '' : s); return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return '﻿' + [['Title', 'Created', 'Edited', 'Words', 'Text'], ...notes.map(n => [n.title || titleOf(n.text), new Date(n.created).toISOString(), new Date(n.modified).toISOString(), words(n.text), n.text])].map(r => r.map(q).join(',')).join('\r\n');
}
const safeName = s => (String(s || 'note').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'note');

return { fold, titleOf, words, parseQuery, search, snippet, deriveKey, encryptText, decryptText, isArmored, parseArmor, saltOf, randomBytes, b64, unb64, merge, zip, unzip, parseTTF, Pdf, pdf, docx, csv, safeName, ITER };
})();
if (typeof module !== 'undefined') module.exports = NotesLib;
