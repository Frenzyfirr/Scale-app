(() => {
'use strict';
// =====================================================================
// Margin Notes — app
// =====================================================================
const L = NotesLib, $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const NATIVE = window.AndroidNotes || null;
const ICON = { pin: '<svg viewBox="0 0 24 24"><path d="M9 3h6l-1 6 4 4H6l4-4z"/><path d="M12 13v8"/></svg>', lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>' };

// ---------- storage: one .txt file per note, plus index.json ----------
const FS = NATIVE ? {
  list: () => JSON.parse(NATIVE.list() || '[]'), read: n => { const t = NATIVE.read(n); return t === null || t === undefined || t === '\u0000' ? null : t; },
  write: (n, t) => NATIVE.write(n, t), remove: n => NATIVE.remove(n)
} : {
  list: () => { const out = []; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('mn:')) out.push(k.slice(3)); } } catch (e) {} return out; },
  read: n => { try { return localStorage.getItem('mn:' + n); } catch (e) { return null; } },
  write: (n, t) => { try { localStorage.setItem('mn:' + n, t); } catch (e) { toast('Storage is full. Download a backup and delete old notes.'); throw e; } },
  remove: n => { try { localStorage.removeItem('mn:' + n); } catch (e) {} }
};
let vault = null, vaultPw = null; // app lock
async function writeFile(name, text) { if (vault && vaultPw) text = await L.encryptText(text, vaultPw, L.unb64(vault.salt)); FS.write(name, text); }
async function readFile(name) { let t = FS.read(name); if (t == null) return null;
  if (vault && vaultPw && L.isArmored(t) && L.saltOf(t) === vault.salt) t = await L.decryptText(t, vaultPw); return t; }

// ---------- state ----------
let notes = [], settings = { sort: 'edited', font: 'sans', theme: 'system', pageBreaks: true, autoLock: 5, secure: true };
let cur = null, view = 'notes', selecting = false, sel = [], query = '', findOpen = false, findQ = '', findIdx = 0, saveTimer = null, dirtyIds = new Set();
const opened = new Map(); // per-note passwords for notes unlocked in this session
const byId = id => notes.find(n => n.id === id);
const titleFor = n => n.locked && !opened.has(n.id) && !n.showTitle ? 'Locked note' : (n.text != null ? L.titleOf(n.text) : (n.title || 'Locked note'));

// ---------- load / save ----------
async function loadAll() {
  const idx = await readFile('index.json'); let metas = [];
  try { metas = idx ? JSON.parse(idx) : null; } catch (e) { metas = null; }
  if (!metas) { // first run, or index lost: rebuild from the .txt files
    const files = FS.list().filter(f => /\.txt$/.test(f)); metas = files.map(f => ({ id: f.replace(/\.txt$/, ''), created: Date.now(), modified: Date.now() }));
    if (!metas.length && !idx) { await seedWelcome(); return; } }
  notes = [];
  for (const m of metas) { const raw = await readFile(m.id + '.txt'); if (raw == null) continue;
    const n = Object.assign({ pinned: false, locked: false, trashed: null, showTitle: false }, m);
    if (L.isArmored(raw)) { n.locked = true; n.cipher = raw; n.text = null; } else { n.text = raw; n.locked = false; }
    notes.push(n); }
  const month = 30 * 864e5; const old = notes.filter(n => n.trashed && Date.now() - n.trashed > month); for (const n of old) await removeNote(n, true);
}
async function saveIndex() {
  const metas = notes.map(n => ({ id: n.id, created: n.created, modified: n.modified, pinned: n.pinned, trashed: n.trashed, showTitle: n.showTitle, locked: n.locked, title: n.locked && !n.showTitle ? undefined : (n.text != null ? L.titleOf(n.text) : n.title) }));
  await writeFile('index.json', JSON.stringify(metas));
}
async function saveNote(n) {
  if (n.locked) { const pw = opened.get(n.id); if (!pw) return; n.cipher = await L.encryptText(n.text, pw, n.cipher ? L.parseArmor(n.cipher).salt : undefined); n.title = L.titleOf(n.text); await writeFile(n.id + '.txt', n.cipher); }
  else await writeFile(n.id + '.txt', n.text);
}
function scheduleSave(n) { dirtyIds.add(n.id); setMeta('Saving…'); clearTimeout(saveTimer); saveTimer = setTimeout(flush, 600); }
async function flush() { clearTimeout(saveTimer); const ids = [...dirtyIds]; dirtyIds.clear(); for (const id of ids) { const n = byId(id); if (n) await saveNote(n); } if (ids.length) await saveIndex(); setMeta(); }
async function removeNote(n, silent) { FS.remove(n.id + '.txt'); notes = notes.filter(x => x !== n); opened.delete(n.id); if (!silent) await saveIndex(); }
async function seedWelcome() {
  const now = Date.now(), mk = (text, ago, pinned) => ({ id: uid(), text, created: now - ago, modified: now - ago, pinned: !!pinned, locked: false, trashed: null });
  notes = [mk(`Welcome to Margin Notes\n\nEvery note is plain text and is saved on this device as a .txt file. Nothing is sent anywhere.\n\nSearch\n- Type words to find notes that contain all of them: garden tomatoes\n- Put a phrase in quotes to find it exactly: "call the plumber"\n- Put a minus in front of a word to leave it out: plan -work\n- Accents and capitals don't matter: zolw finds żółw\n\nSelect and merge\nTap Select, choose notes in the order you want, then Merge to make one new note, or Export to make one PDF, Word or text document.\n\nPrivacy\n- Lock one note with its own password from the lock button above it.\n- Lock the whole app in Settings. Notes are then encrypted with AES-256 on the device.\nThere is no password recovery: a forgotten password means the notes cannot be opened.\n\nDelete these example notes whenever you like.`, 0, true),
    mk(`Shopping list\n\n- bread\n- 2 l milk\n- tomatoes\n- coffee beans\n- batteries (AA)`, 3600e3),
    mk(`Garden plans for spring\n\nTomatoes: plant out after the last frost, around mid-May.\nCall the plumber about the outside tap before watering season.\nBuy compost and two bags of bark mulch.\nIdea: raised bed along the south fence, 3 m × 1.2 m.`, 2 * 864e5)];
  for (const n of notes) await saveNote(n); await saveIndex();
}
async function saveSettings() { FS.write('settings.json', JSON.stringify(settings)); applySettings(); }
function applySettings() { if (settings.theme === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', settings.theme);
  if (NATIVE && NATIVE.setSecure) try { NATIVE.setSecure(!!(vault && settings.secure)); } catch (e) {} }

// ---------- helpers ----------
function toast(t) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 2800); }
const armed = new Map();
function confirmTap(el, label) { const k = el.dataset.act + (el.dataset.id || ''); if (armed.has(k) && Date.now() - armed.get(k) < 4000) { armed.delete(k); return true; }
  armed.set(k, Date.now()); const old = el.innerHTML; el.textContent = label || 'Tap again'; el.classList.add('armed');
  setTimeout(() => { if (el.isConnected && armed.has(k)) { el.innerHTML = old; el.classList.remove('armed'); armed.delete(k); } }, 4000); return false; }
function openModal(html, focusSel) { $('modalCard').innerHTML = html; $('modal').hidden = false; setTimeout(() => { const f = $('modalCard').querySelector(focusSel || 'input,button.primary'); if (f) f.focus(); }, 30); }
function closeModal() { $('modal').hidden = true; $('modalCard').innerHTML = ''; }
const fmtWhen = t => { const d = new Date(t), now = new Date(); return d.toDateString() === now.toDateString() ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' }); };
function askPassword(title, opts) { // resolves with {pw, extra} or null
  opts = opts || {};
  return new Promise(res => {
    openModal(`<h2>${esc(title)}</h2>${opts.note ? `<p class="small muted">${esc(opts.note)}</p>` : ''}
      <form id="pwForm" style="display:flex;flex-direction:column;gap:10px"><label class="f">Password<input type="password" id="pw1" autocomplete="${opts.confirm ? 'new-password' : 'current-password'}" required minlength="${opts.confirm ? 4 : 1}"></label>
      ${opts.confirm ? '<label class="f">Repeat the password<input type="password" id="pw2" autocomplete="new-password" required></label>' : ''}
      ${opts.extraHtml || ''}<p class="small" id="pwErr" style="color:var(--danger)" hidden></p>
      <div class="row" style="justify-content:flex-end"><button type="button" class="b" id="pwCancel">Cancel</button><button class="b primary" type="submit">${esc(opts.ok || 'OK')}</button></div></form>`, '#pw1');
    $('pwCancel').onclick = () => { closeModal(); res(null); };
    $('pwForm').onsubmit = e => { e.preventDefault(); const p1 = $('pw1').value, p2 = opts.confirm ? $('pw2').value : p1;
      if (opts.confirm && p1.length < 4) { $('pwErr').textContent = 'Use at least 4 characters.'; $('pwErr').hidden = false; return; }
      if (p1 !== p2) { $('pwErr').textContent = 'The passwords are different.'; $('pwErr').hidden = false; return; }
      const extra = {}; $('modalCard').querySelectorAll('[data-extra]').forEach(x => { extra[x.dataset.extra] = x.type === 'checkbox' ? x.checked : x.value; });
      closeModal(); res({ pw: p1, extra }); };
  });
}

// =====================================================================
// Rendering
// =====================================================================
function visibleNotes() {
  const Q = L.parseQuery(query); let list = notes.filter(n => view === 'trash' ? n.trashed : !n.trashed); let skipped = 0;
  const res = [];
  list.forEach(n => { if (n.text == null) { if (Q.empty) res.push({ n, r: null }); else skipped++; return; } const r = L.search(n.text, Q); if (r.ok) res.push({ n, r }); });
  const key = { edited: n => -n.modified, created: n => -n.created, title: n => L.fold(titleFor(n)) }[settings.sort] || (n => -n.modified);
  res.sort((a, b) => (view !== 'trash' && (b.n.pinned - a.n.pinned)) || (key(a.n) < key(b.n) ? -1 : key(a.n) > key(b.n) ? 1 : 0));
  return { res, skipped, Q };
}
function renderList() {
  const { res, skipped, Q } = visibleNotes(), trashN = notes.filter(n => n.trashed).length;
  $('listbar').innerHTML = `<button class="b sm" data-act="view" data-v="notes" aria-pressed="${view === 'notes'}">Notes</button><button class="b sm" data-act="view" data-v="trash" aria-pressed="${view === 'trash'}">Trash${trashN ? ' ' + trashN : ''}</button>
    <select id="sort" aria-label="Sort"><option value="edited"${settings.sort === 'edited' ? ' selected' : ''}>Last edited</option><option value="created"${settings.sort === 'created' ? ' selected' : ''}>Created</option><option value="title"${settings.sort === 'title' ? ' selected' : ''}>Title</option></select>
    <button class="b sm" data-act="select" aria-pressed="${selecting}" style="margin-left:auto">${selecting ? 'Done' : 'Select'}</button>`;
  let h = '';
  if (!Q.empty) h += `<p class="small muted" style="padding:8px 12px">${res.length} note${res.length === 1 ? '' : 's'} found${skipped ? ` · ${skipped} locked note${skipped > 1 ? 's' : ''} not searched` : ''}</p>`;
  res.forEach(({ n, r }) => {
    let snip = '';
    if (n.text != null) { const t = n.text, title = L.titleOf(t); const bodyStart = t.indexOf(title) + title.length; const s = L.snippet(t, r && r.ranges.length ? r.ranges : [[bodyStart, bodyStart]], 160);
      if (!(r && r.ranges.length)) { const rest = t.slice(Math.max(0, bodyStart)).trim().replace(/\s+/g, ' ').slice(0, 160); snip = esc(rest) || '<span class="muted">No more text</span>'; }
      else snip = (s.before ? '… ' : '') + s.parts.map(([x, m]) => m ? `<mark>${esc(x)}</mark>` : esc(x.replace(/\s+/g, ' '))).join('') + (s.after ? ' …' : ''); }
    else snip = 'Encrypted. Open it with its password.';
    const isSel = sel.includes(n.id);
    h += `<div class="item" role="button" tabindex="0" data-open="${n.id}" aria-current="${cur === n.id && !selecting}">
      ${selecting ? `<input type="checkbox" data-sel="${n.id}" ${isSel ? 'checked' : ''} aria-label="Select">` : '<span></span>'}
      <span style="min-width:0"><span class="t">${n.pinned && view !== 'trash' ? ICON.pin : ''}${n.locked ? ICON.lock : ''}<span>${esc(titleFor(n))}</span>${selecting && isSel ? `<span class="small muted" style="margin-left:auto">#${sel.indexOf(n.id) + 1}</span>` : ''}</span>
      <span class="s">${snip}</span><span class="d">${view === 'trash' ? 'Deleted ' + fmtWhen(n.trashed) : fmtWhen(n.modified)}</span></span></div>`; });
  if (!res.length) h += `<div class="empty">${view === 'trash' ? '<p>The trash is empty.</p>' : Q.empty ? '<p>No notes yet.</p><button class="b primary" data-act="new">Write a note</button>' : '<p>No notes match.</p><p class="small">Check the spelling, or use fewer words.</p>'}</div>`;
  $('list').innerHTML = h;
  const sb = $('selbar'); sb.hidden = !selecting;
  if (selecting) sb.innerHTML = `<span class="small"><b>${sel.length}</b> selected</span><button class="b sm" data-act="selAll">${sel.length === res.length && res.length ? 'None' : 'All'}</button>` +
    (view === 'trash' ? `<button class="b sm" data-act="restoreSel" ${sel.length ? '' : 'disabled'}>Restore</button><button class="b sm danger" data-act="purgeSel" ${sel.length ? '' : 'disabled'}>Delete forever</button>`
      : `<button class="b sm primary" data-act="mergeSel" ${sel.length > 1 ? '' : 'disabled'}>Merge</button><button class="b sm" data-act="exportSel" ${sel.length ? '' : 'disabled'}>Export</button><button class="b sm" data-act="lockSel" ${sel.length ? '' : 'disabled'}>Lock</button><button class="b sm danger" data-act="trashSel" ${sel.length ? '' : 'disabled'}>Delete</button>`);
  $('fab').hidden = selecting || view === 'trash' || document.body.classList.contains('editing') && window.innerWidth <= 760;
  $('lockBtn').hidden = !vault;
}
function renderEditor() {
  const ed = $('editor'), n = cur && byId(cur);
  document.body.classList.toggle('editing', !!n);
  if (!n) { ed.innerHTML = `<div class="empty" style="margin:auto"><p>Choose a note, or write a new one.</p><button class="b primary" data-act="new">New note</button></div>`; return; }
  const back = `<button class="b icon ghost backbtn" data-act="back" aria-label="Back to notes"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>`;
  if (n.trashed) { ed.innerHTML = `<div class="etools">${back}<span class="small muted">In the trash</span></div><div class="locked"><div class="card"><p>This note is in the trash.</p><div class="row" style="justify-content:center"><button class="b primary" data-act="restore" data-id="${n.id}">Restore</button><button class="b danger" data-act="purge" data-id="${n.id}">Delete forever</button></div></div></div>`; return; }
  if (n.text == null) { ed.innerHTML = `<div class="etools">${back}<span class="small muted">Locked note</span></div><div class="locked"><form class="card" id="unlockNote"><div>${ICON.lock.replace('<svg', '<svg style="width:40px;height:40px;stroke:var(--accent);fill:none;stroke-width:1.6"')}</div><h2>${esc(titleFor(n))}</h2><p class="small muted">This note is encrypted with its own password.</p>
      <input type="password" id="notePw" placeholder="Password" autocomplete="current-password"><p class="small" id="notePwErr" style="color:var(--danger)" hidden>Wrong password.</p><button class="b primary" type="submit">Open</button></form></div>`;
    setTimeout(() => { const i = $('notePw'); if (i && window.innerWidth > 760) i.focus(); }, 30); return; }
  ed.innerHTML = `<div class="etools">${back}
    <button class="b icon ghost" data-act="pin" aria-pressed="${n.pinned}" title="${n.pinned ? 'Unpin' : 'Pin to top'}" aria-label="Pin">${ICON.pin.replace('<svg', '<svg style="width:19px;height:19px"')}</button>
    <button class="b icon ghost" data-act="find" aria-pressed="${findOpen}" title="Find in note" aria-label="Find in note"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg></button>
    <button class="b icon ghost" data-act="${n.locked ? 'noteLockMenu' : 'lockNote'}" aria-pressed="${n.locked}" title="${n.locked ? 'Locked with a password' : 'Lock with a password'}" aria-label="Lock">${ICON.lock.replace('<svg', '<svg style="width:19px;height:19px"')}</button>
    <button class="b icon ghost" data-act="exportCur" title="Export" aria-label="Export"><svg viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg></button>
    <button class="b icon ghost" data-act="trashCur" title="Move to trash" aria-label="Delete"><svg viewBox="0 0 24 24"><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/></svg></button>
    <span class="meta" id="meta"></span></div>
    <div class="findbar" id="findbar" ${findOpen ? '' : 'hidden'}><input id="findQ" type="search" placeholder="Find in this note" value="${esc(findQ)}" autocomplete="off"><span class="small muted" id="findCount"></span>
      <button class="b sm" data-act="findPrev" aria-label="Previous match">▲</button><button class="b sm" data-act="findNext" aria-label="Next match">▼</button><button class="b sm ghost" data-act="find" aria-label="Close find">✕</button></div>
    <textarea class="note ${settings.font}" id="ta" spellcheck="true" aria-label="Note text" placeholder="Start writing. The first line is the title."></textarea>`;
  $('ta').value = n.text; setMeta(); if (findOpen) runFind(false);
}
function setMeta(state) { const m = $('meta'), n = cur && byId(cur); if (!m || !n || n.text == null) return; m.textContent = `${L.words(n.text)} words · ${n.text.length} characters · ${state || (dirtyIds.size ? 'Saving…' : 'Saved')}`; }
function render() { document.body.classList.toggle('editing', !!(cur && byId(cur))); renderList(); renderEditor(); }

// ---------- find in note ----------
function runFind(jump) {
  const n = byId(cur), ta = $('ta'); if (!n || !ta) return; const Q = L.parseQuery(findQ); const r = Q.empty ? { ok: false, ranges: [] } : L.search(ta.value, { phrases: Q.phrases, words: Q.words, not: [], empty: false });
  const ranges = r.ok ? r.ranges : (() => { const out = []; [...Q.phrases, ...Q.words].forEach(t => { const x = L.search(ta.value, L.parseQuery(t.includes(' ') ? `"${t}"` : t)); if (x.ok) out.push(...x.ranges); }); return out.sort((a, b) => a[0] - b[0]); })();
  const c = $('findCount'); if (!ranges.length) { if (c) c.textContent = Q.empty ? '' : 'No matches'; return; }
  findIdx = ((findIdx % ranges.length) + ranges.length) % ranges.length; if (c) c.textContent = `${findIdx + 1} of ${ranges.length}`;
  if (jump) { const [a, b] = ranges[findIdx]; ta.focus(); ta.setSelectionRange(a, b);
    const before = ta.value.slice(0, a).split('\n').length; const lh = parseFloat(getComputedStyle(ta).lineHeight) || 24; ta.scrollTop = Math.max(0, before * lh - ta.clientHeight / 3); }
}

// =====================================================================
// Actions
// =====================================================================
async function newNote(text) { await flush(); const n = { id: uid(), text: text || '', created: Date.now(), modified: Date.now(), pinned: false, locked: false, trashed: null };
  notes.push(n); await saveNote(n); await saveIndex(); cur = n.id; selecting = false; sel = []; render(); const ta = $('ta'); if (ta) ta.focus(); return n; }
function open(id) { flush(); cur = id; findOpen = !!query.trim(); findQ = query; findIdx = 0; render(); if (findOpen) runFind(true); }
async function lockNote(n) {
  const r = await askPassword('Lock this note', { confirm: true, ok: 'Lock', note: 'The note is encrypted with this password. There is no way to recover it if you forget the password.', extraHtml: '<label class="chk"><input type="checkbox" data-extra="showTitle"> Show the title in the list</label>' });
  if (!r) return; await flush(); n.locked = true; n.showTitle = !!r.extra.showTitle; n.cipher = await L.encryptText(n.text, r.pw); n.title = L.titleOf(n.text);
  await writeFile(n.id + '.txt', n.cipher); n.text = null; opened.delete(n.id); await saveIndex(); render(); toast('Note locked');
}
function noteLockMenu(n) {
  openModal(`<h2>Locked note</h2><p class="small muted">This note is encrypted with its own password.</p>
    <div class="row"><button class="b" data-act="relock">Close and lock again</button><button class="b" data-act="unlockForGood">Remove the password</button><button class="b ghost" data-act="closeModal">Cancel</button></div>`);
}
function selectedNotes(order) {
  let list = sel.map(byId).filter(Boolean);
  if (order === 'oldest') list.sort((a, b) => a.created - b.created); if (order === 'newest') list.sort((a, b) => b.created - a.created); if (order === 'title') list.sort((a, b) => L.fold(titleFor(a)).localeCompare(L.fold(titleFor(b))));
  return list;
}
function needOpen(list) { const closed = list.filter(n => n.text == null); if (closed.length) { toast(`Open ${closed.length === 1 ? 'the locked note' : closed.length + ' locked notes'} with ${closed.length === 1 ? 'its password' : 'their passwords'} first.`); return false; } return true; }
function mergeDialog() {
  const list = selectedNotes(); if (!needOpen(list)) return;
  openModal(`<h2>Merge ${list.length} notes</h2><p class="small muted">Makes one new note. The originals stay unless you choose to move them to the trash.</p>
    <label class="f">Title of the new note<input id="mTitle" value="Merged notes"></label>
    <label class="f">Order<select id="mOrder"><option value="sel">In the order I selected them</option><option value="oldest">Oldest first</option><option value="newest">Newest first</option><option value="title">By title (A–Z)</option></select></label>
    <label class="f">Between notes<select id="mSep"><option value="heading">Each note's title as a heading</option><option value="line">A dividing line</option><option value="none">Nothing, just a blank line</option></select></label>
    <label class="chk"><input type="checkbox" id="mTrash"> Move the original notes to the trash</label>
    <div class="row" style="justify-content:flex-end"><button class="b" data-act="closeModal">Cancel</button><button class="b primary" data-act="doMerge">Merge</button></div>`, '#mTitle');
}
async function doMerge() {
  const title = $('mTitle').value.trim() || 'Merged notes', order = $('mOrder').value, sep = $('mSep').value, trash = $('mTrash').checked, list = selectedNotes(order);
  closeModal(); const text = title + '\n\n' + L.merge(list.map(n => ({ text: n.text, title: L.titleOf(n.text) })), { sep });
  if (trash) list.forEach(n => { n.trashed = Date.now(); });
  selecting = false; sel = []; await newNote(text); await saveIndex(); render(); toast(`Merged ${list.length} notes`);
}
function exportDialog(list, single) {
  if (!needOpen(list)) return;
  const many = list.length > 1;
  openModal(`<h2>Export ${many ? list.length + ' notes' : '“' + esc(L.titleOf(list[0].text)) + '”'}</h2>
    ${many ? `<label class="f">Title for the combined document<input id="xTitle" value="Notes"></label>
      <label class="f">Order<select id="xOrder"><option value="sel">In the order I selected them</option><option value="oldest">Oldest first</option><option value="newest">Newest first</option><option value="title">By title (A–Z)</option></select></label>
      <label class="chk"><input type="checkbox" id="xSeparate"> Separate files (one per note, in a .zip)</label>` : ''}
    <label class="chk"><input type="checkbox" id="xBreaks" ${settings.pageBreaks ? 'checked' : ''}> Start each note on a new page (PDF and Word)</label>
    <div class="opts"><button class="b" data-act="doExport" data-f="txt">Text<small>.txt</small></button><button class="b" data-act="doExport" data-f="pdf">PDF<small>.pdf</small></button>
      <button class="b" data-act="doExport" data-f="docx">Word<small>.docx</small></button><button class="b" data-act="doExport" data-f="csv">Spreadsheet<small>.csv, one row per note</small></button>
      <button class="b" data-act="doExport" data-f="enc" style="grid-column:1/-1">Encrypted text<small>.txt locked with a password; open it again here with Import</small></button></div>
    <div class="row" style="justify-content:flex-end"><button class="b" data-act="closeModal">Cancel</button></div>`);
  exportDialog.list = list;
}
let FONTS = null; const fonts = () => FONTS || (FONTS = [L.unb64(window.MARGIN_FONT_R), L.unb64(window.MARGIN_FONT_B)]);
async function doExport(f) {
  let list = exportDialog.list; const many = list.length > 1, title = many ? ($('xTitle').value.trim() || 'Notes') : L.titleOf(list[0].text);
  if (many) { const o = $('xOrder').value; list = o === 'sel' ? list : selectedNotes(o); }
  const sepFiles = many && $('xSeparate') && $('xSeparate').checked && f !== 'csv' && f !== 'enc', pageBreaks = $('xBreaks').checked; closeModal();
  const base = L.safeName(title), docs = list.map(n => ({ text: n.text, created: n.created, modified: n.modified, title: L.titleOf(n.text) }));
  const make = (fmt, ds, t) => fmt === 'txt' ? (ds.length > 1 ? t + '\n\n' + L.merge(ds, { sep: 'heading' }) : ds[0].text) : fmt === 'pdf' ? L.pdf(ds, fonts(), { title: t, pageBreaks }) : fmt === 'docx' ? L.docx(ds, { title: t, pageBreaks }) : L.csv(ds);
  const mime = { txt: 'text/plain', pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', csv: 'text/csv' };
  try {
    if (f === 'enc') { const r = await askPassword('Password for the encrypted file', { confirm: true, ok: 'Encrypt and save', note: 'Anyone who opens the file needs this password. Keep it safe: it cannot be recovered.' }); if (!r) return;
      const text = docs.length > 1 ? title + '\n\n' + L.merge(docs, { sep: 'heading' }) : docs[0].text; return saveFile(base + ' (encrypted).txt', await L.encryptText(text, r.pw), 'text/plain'); }
    if (sepFiles) { const used = new Set(); const files = docs.map(d => { let nm = L.safeName(d.title), k = 2; while (used.has(nm)) nm = L.safeName(d.title) + ' ' + k++; used.add(nm); const data = make(f, [d], d.title); return { name: `${nm}.${f}`, data }; });
      return saveFile(base + '.zip', L.zip(files), 'application/zip'); }
    return saveFile(`${base}.${f}`, make(f, docs, title), mime[f]);
  } catch (e) { toast('Export failed: ' + (e.message || e)); }
}
async function toB64(data) { const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : typeof data === 'string' ? new TextEncoder().encode(data) : data; return L.b64(bytes); }
async function saveFile(name, data, mime) {
  if (NATIVE && NATIVE.saveFile) { try { NATIVE.saveFile(name, await toB64(data), mime || 'application/octet-stream'); } catch (e) { toast('Could not save the file.'); } return; }
  try { if (window.claude && window.claude.use) { const dl = await window.claude.use('downloads'); if (dl) { try { await dl.save({ filename: name, data }); toast('Saved ' + name); } catch (e) { if (!e || e.code !== 'declined') toast('Could not save here.'); } return; } } } catch (e) {}
  try { const blob = data instanceof Blob ? data : new Blob([data], { type: mime }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); toast('Saved ' + name); }
  catch (e) { toast('Downloads are blocked here.'); }
}

// ---------- import and backup ----------
async function importFiles(files) {
  let added = 0, pw = null;
  const addText = async (text, when, meta) => { if (L.isArmored(text)) { for (let tries = 0; tries < 3; tries++) {
        if (!pw) { const r = await askPassword('This file is encrypted', { ok: 'Open', note: 'Type the password it was exported with.' }); if (!r) return; pw = r.pw; }
        try { text = await L.decryptText(text, pw); break; } catch (e) { pw = null; toast('Wrong password'); if (tries === 2) return; } } }
    const n = Object.assign({ id: uid(), text, created: when || Date.now(), modified: when || Date.now(), pinned: false, locked: false, trashed: null }, meta || {}); n.text = text; notes.push(n); await saveNote(n); added++; };
  for (const f of files) {
    try {
      if (/\.zip$/i.test(f.name)) { const entries = await L.unzip(new Uint8Array(await f.arrayBuffer())); const metaE = entries.find(e => e.name === 'notes.json'); let metas = [];
        try { metas = metaE ? JSON.parse(new TextDecoder().decode(metaE.data)) : []; } catch (e) {}
        for (const e of entries.filter(x => /\.txt$/i.test(x.name))) { const m = metas.find(x => x.file === e.name) || {}; await addText(new TextDecoder().decode(e.data), m.modified, m.created ? { created: m.created, modified: m.modified, pinned: !!m.pinned } : null); } }
      else if (/\.(txt|md|text|csv)$/i.test(f.name) || /^text\//.test(f.type)) await addText(await f.text(), f.lastModified);
      else toast(`${f.name} is not a text file.`);
    } catch (e) { toast(`Could not read ${f.name}: ${e.message || e}`); }
  }
  await saveIndex(); render(); if (added) toast(`Imported ${added} note${added > 1 ? 's' : ''}`);
}
async function backup(encrypted) {
  let pw = null; if (encrypted) { const r = await askPassword('Password for the backup', { confirm: true, ok: 'Make backup', note: 'Each note in the backup is encrypted with this password.' }); if (!r) return; pw = r.pw; }
  const salt = L.randomBytes(16), used = new Set(), files = [], metas = [];
  for (const n of notes.filter(x => !x.trashed)) { let nm = L.safeName(titleFor(n)), k = 2; while (used.has(nm)) nm = L.safeName(titleFor(n)) + ' ' + k++; used.add(nm);
    const file = nm + '.txt'; const body = n.text == null ? n.cipher : (pw ? await L.encryptText(n.text, pw, salt) : n.text); files.push({ name: file, data: body }); metas.push({ file, created: n.created, modified: n.modified, pinned: n.pinned }); }
  files.push({ name: 'notes.json', data: JSON.stringify(metas, null, 1) });
  saveFile(`Margin Notes backup ${new Date().toISOString().slice(0, 10)}${pw ? ' (encrypted)' : ''}.zip`, L.zip(files), 'application/zip');
}

// ---------- app lock ----------
async function enableAppLock() {
  const r = await askPassword('Lock the app with a password', { confirm: true, ok: 'Lock the app', note: 'All notes will be encrypted on this device with AES-256. You will need this password every time you open the app. If you forget it, the notes cannot be recovered.' }); if (!r) return;
  await flush(); toast('Encrypting notes…');
  const salt = L.randomBytes(16); vault = { v: 1, salt: L.b64(salt), check: await L.encryptText('margin-notes-ok', r.pw, salt) }; vaultPw = r.pw;
  await rewriteAll(); FS.write('vault.json', JSON.stringify(vault)); applySettings(); renderList(); settingsModal(); toast('The app is locked with your password');
}
async function rewriteAll() { for (const n of notes) await writeFile(n.id + '.txt', n.locked ? n.cipher || await L.encryptText(n.text, opened.get(n.id)) : n.text); await saveIndex(); }
async function changeAppPassword() {
  const r = await askPassword('New app password', { confirm: true, ok: 'Change password' }); if (!r) return; await flush(); toast('Re-encrypting notes…');
  const salt = L.randomBytes(16); vault = { v: 1, salt: L.b64(salt), check: await L.encryptText('margin-notes-ok', r.pw, salt) }; vaultPw = r.pw; await rewriteAll(); FS.write('vault.json', JSON.stringify(vault)); toast('Password changed');
}
async function disableAppLock() {
  const r = await askPassword('Turn off the app lock', { ok: 'Turn off', note: 'Type the current password. Notes will be stored without encryption, except notes with their own password.' }); if (!r) return;
  if (r.pw !== vaultPw) { toast('Wrong password'); return; } await flush(); vault = null; vaultPw = null; await rewriteAll(); FS.remove('vault.json'); applySettings(); renderList(); settingsModal(); toast('App lock turned off');
}
function lockApp() { if (!vault) return; flush().then(() => { notes = []; opened.clear(); vaultPw = null; cur = null; render(); showLockScreen(); }); }
function showLockScreen() {
  const ls = $('lockscreen'); ls.hidden = false; closeModal();
  ls.innerHTML = `<form class="card" id="unlockApp">${ICON.lock}<h1>Margin Notes is locked</h1><input type="password" id="appPw" placeholder="Password" autocomplete="current-password" aria-label="Password">
    <p class="small" id="appPwErr" style="color:var(--danger)" hidden>Wrong password.</p><button class="b primary" type="submit">Unlock</button><p class="small muted">There is no password recovery.</p></form>`;
  setTimeout(() => { const i = $('appPw'); if (i) i.focus(); }, 50);
}
let lastActive = Date.now();
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => { lastActive = Date.now(); }, true));
setInterval(() => { if (vault && vaultPw && settings.autoLock > 0 && Date.now() - lastActive > settings.autoLock * 60000) lockApp(); }, 15000);
document.addEventListener('visibilitychange', () => { if (document.hidden) { flush(); lastActive = Math.min(lastActive, Date.now()); } else if (vault && vaultPw && settings.autoLock > 0 && Date.now() - lastActive > settings.autoLock * 60000) lockApp(); });

// ---------- settings ----------
function settingsModal() {
  const trashN = notes.filter(n => n.trashed).length;
  openModal(`<div class="row" style="justify-content:space-between"><h2>Settings</h2><button class="b sm" data-act="closeModal">Close</button></div>
    <h3>Privacy</h3>
    ${vault ? `<p class="small">The app is locked with a password and every note is encrypted on this device.</p>
      <div class="row"><button class="b sm" data-act="changePw">Change password</button><button class="b sm danger" data-act="disableLock">Turn off app lock</button></div>
      <label class="f">Lock automatically after<select id="autoLock"><option value="1"${settings.autoLock == 1 ? ' selected' : ''}>1 minute without use</option><option value="5"${settings.autoLock == 5 ? ' selected' : ''}>5 minutes</option><option value="15"${settings.autoLock == 15 ? ' selected' : ''}>15 minutes</option><option value="60"${settings.autoLock == 60 ? ' selected' : ''}>1 hour</option><option value="0"${settings.autoLock == 0 ? ' selected' : ''}>Never</option></select></label>
      ${NATIVE ? `<label class="chk"><input type="checkbox" id="secure" ${settings.secure ? 'checked' : ''}> Hide notes in the app switcher and block screenshots</label>` : ''}`
      : `<p class="small muted">Lock the whole app with a password, or lock single notes from the lock button above a note.</p><button class="b sm primary" data-act="enableLock">Lock the app with a password</button>`}
    <h3>Writing</h3>
    <label class="f">Note font<select id="font"><option value="sans"${settings.font === 'sans' ? ' selected' : ''}>Sans serif</option><option value="serif"${settings.font === 'serif' ? ' selected' : ''}>Serif</option><option value="mono"${settings.font === 'mono' ? ' selected' : ''}>Monospaced</option></select></label>
    <label class="f">Theme<select id="theme"><option value="system"${settings.theme === 'system' ? ' selected' : ''}>Follow the device</option><option value="light"${settings.theme === 'light' ? ' selected' : ''}>Light</option><option value="dark"${settings.theme === 'dark' ? ' selected' : ''}>Dark</option></select></label>
    <h3>Import and backup</h3>
    <div class="row"><label class="b sm">Import .txt or backup .zip<input type="file" id="importIn" accept=".txt,.md,.text,.zip,text/plain,application/zip" multiple hidden></label></div>
    <div class="row"><button class="b sm" data-act="backup">Download backup (.zip)</button><button class="b sm" data-act="backupEnc">Encrypted backup</button></div>
    <p class="small muted">A backup is a .zip of .txt files, one per note. Import it here on any device to restore.</p>
    <h3>Trash</h3><div class="row"><span class="small muted">${trashN} note${trashN === 1 ? '' : 's'} in the trash; they are deleted after 30 days.</span><button class="b sm danger" data-act="emptyTrash" ${trashN ? '' : 'disabled'}>Empty trash</button></div>
    <p class="small muted">Margin Notes keeps everything on this device. ${NATIVE ? 'Notes are .txt files in the app\'s private storage.' : 'Notes are stored in this browser.'}</p>`);
}

// =====================================================================
// Events
// =====================================================================
const ACT = {
  new: () => newNote(''), back: () => { flush(); cur = null; render(); },
  view: a => { view = a.dataset.v; sel = []; render(); },
  select: () => { selecting = !selecting; sel = []; renderList(); },
  selAll: () => { const ids = visibleNotes().res.map(x => x.n.id); sel = sel.length === ids.length ? [] : ids; renderList(); },
  mergeSel: () => mergeDialog(), doMerge: () => doMerge(),
  exportSel: () => exportDialog(selectedNotes()), exportCur: () => { const n = byId(cur); if (n) { flush(); exportDialog([n], true); } },
  doExport: a => doExport(a.dataset.f),
  lockSel: async () => { const list = selectedNotes().filter(n => !n.locked); if (!list.length) { toast('Those notes are already locked.'); return; }
    const r = await askPassword(`Lock ${list.length} note${list.length > 1 ? 's' : ''}`, { confirm: true, ok: 'Lock', note: 'Each note is encrypted with this password. It cannot be recovered if you forget it.' }); if (!r) return;
    const salt = L.randomBytes(16); for (const n of list) { n.cipher = await L.encryptText(n.text, r.pw, salt); n.locked = true; n.title = L.titleOf(n.text); n.text = null; await writeFile(n.id + '.txt', n.cipher); }
    await saveIndex(); selecting = false; sel = []; render(); toast('Notes locked'); },
  trashSel: async a => { if (!confirmTap(a, `Delete ${sel.length}?`)) return; sel.forEach(id => { const n = byId(id); if (n) n.trashed = Date.now(); }); if (sel.includes(cur)) cur = null; sel = []; selecting = false; await saveIndex(); render(); toast('Moved to the trash'); },
  restoreSel: async () => { sel.forEach(id => { const n = byId(id); if (n) n.trashed = null; }); sel = []; selecting = false; await saveIndex(); render(); toast('Restored'); },
  purgeSel: async a => { if (!confirmTap(a, 'Delete forever?')) return; for (const id of sel) { const n = byId(id); if (n) await removeNote(n, true); } sel = []; selecting = false; await saveIndex(); render(); },
  trashCur: async a => { if (!confirmTap(a, 'Delete?')) return; const n = byId(cur); await flush(); n.trashed = Date.now(); cur = null; await saveIndex(); render(); toast('Moved to the trash. Restore it from Trash.'); },
  restore: async a => { const n = byId(a.dataset.id); n.trashed = null; await saveIndex(); render(); },
  purge: async a => { if (!confirmTap(a, 'Delete forever?')) return; await removeNote(byId(a.dataset.id)); cur = null; render(); },
  emptyTrash: async a => { if (!confirmTap(a, 'Delete them all?')) return; for (const n of notes.filter(x => x.trashed)) await removeNote(n, true); await saveIndex(); render(); settingsModal(); },
  pin: async () => { const n = byId(cur); n.pinned = !n.pinned; await saveIndex(); render(); },
  find: () => { findOpen = !findOpen; if (!findOpen) findQ = ''; renderEditor(); if (findOpen) setTimeout(() => { const i = $('findQ'); if (i) i.focus(); }, 20); },
  findNext: () => { findIdx++; runFind(true); }, findPrev: () => { findIdx--; runFind(true); },
  lockNote: () => lockNote(byId(cur)), noteLockMenu: () => noteLockMenu(byId(cur)),
  relock: async () => { closeModal(); const n = byId(cur); await flush(); n.text = null; opened.delete(n.id); render(); toast('Locked again'); },
  unlockForGood: async () => { closeModal(); const n = byId(cur); await flush(); n.locked = false; n.cipher = null; n.showTitle = false; opened.delete(n.id); await saveNote(n); await saveIndex(); render(); toast('Password removed'); },
  settings: () => settingsModal(), closeModal: () => closeModal(),
  enableLock: () => enableAppLock(), changePw: () => changeAppPassword(), disableLock: () => disableAppLock(), lockApp: () => lockApp(),
  backup: () => backup(false), backupEnc: () => backup(true)
};
document.addEventListener('click', e => {
  const a = e.target.closest('[data-act]'); if (a && ACT[a.dataset.act]) { e.preventDefault(); ACT[a.dataset.act](a); return; }
  const box = e.target.closest('[data-sel]'); if (box) return;
  const it = e.target.closest('[data-open]'); if (it) { const id = it.dataset.open;
    if (selecting) { const i = sel.indexOf(id); if (i >= 0) sel.splice(i, 1); else sel.push(id); renderList(); } else open(id); return; }
  if (e.target.id === 'modal') closeModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.closest && e.target.closest('[data-open]') && e.target.matches('[data-open]')) { e.target.click(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && cur && byId(cur) && byId(cur).text != null) { e.preventDefault(); if (!findOpen) ACT.find(); else { const i = $('findQ'); if (i) i.focus(); } return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('q').focus(); return; }
  if (e.key === 'Escape') { if (!$('modal').hidden) closeModal(); else if (findOpen) ACT.find(); }
  if (e.key === 'Enter' && e.target.id === 'findQ') { e.preventDefault(); findIdx += e.shiftKey ? -1 : 1; runFind(true); }
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.sel) { const id = el.dataset.sel, i = sel.indexOf(id); if (el.checked && i < 0) sel.push(id); if (!el.checked && i >= 0) sel.splice(i, 1); renderList(); return; }
  if (el.id === 'sort') { settings.sort = el.value; saveSettings(); renderList(); return; }
  if (el.id === 'font' || el.id === 'theme') { settings[el.id] = el.value; saveSettings(); renderEditor(); return; }
  if (el.id === 'autoLock') { settings.autoLock = +el.value; saveSettings(); return; }
  if (el.id === 'secure') { settings.secure = el.checked; saveSettings(); return; }
  if (el.id === 'importIn') { importFiles([...el.files]); el.value = ''; closeModal(); return; }
});
document.addEventListener('input', e => {
  if (e.target.id === 'ta') { const n = byId(cur); if (!n) return; n.text = e.target.value; n.modified = Date.now(); scheduleSave(n); clearTimeout(window.__lt); window.__lt = setTimeout(renderList, 400); return; }
  if (e.target.id === 'q') { query = e.target.value; clearTimeout(window.__qt); window.__qt = setTimeout(() => { renderList(); if (cur && findOpen) { findQ = query; const i = $('findQ'); if (i) i.value = query; runFind(false); } }, 120); return; }
  if (e.target.id === 'findQ') { findQ = e.target.value; findIdx = 0; runFind(true); e.target.focus(); }
});
document.addEventListener('submit', async e => {
  if (e.target.id === 'unlockNote') { e.preventDefault(); const n = byId(cur), pw = $('notePw').value; try { n.text = await L.decryptText(n.cipher, pw); opened.set(n.id, pw); render(); } catch (err) { $('notePwErr').hidden = false; } return; }
  if (e.target.id === 'unlockApp') { e.preventDefault(); const pw = $('appPw').value; const btn = e.target.querySelector('button'); btn.disabled = true; btn.textContent = 'Unlocking…';
    try { await L.decryptText(vault.check, pw); vaultPw = pw; await loadAll(); $('lockscreen').hidden = true; lastActive = Date.now(); render(); }
    catch (err) { $('appPwErr').hidden = false; btn.disabled = false; btn.textContent = 'Unlock'; } }
});
window.addEventListener('beforeunload', () => { flush(); });
window.__back = () => { if (!$('modal').hidden) { closeModal(); return 'handled'; } if (findOpen) { ACT.find(); return 'handled'; } if (selecting) { selecting = false; sel = []; renderList(); return 'handled'; } if (cur && window.innerWidth <= 760) { ACT.back(); return 'handled'; } return ''; };

// ---------- start ----------
(async function start() {
  try { const s = FS.read('settings.json'); if (s) Object.assign(settings, JSON.parse(s)); } catch (e) {}
  try { const v = FS.read('vault.json'); vault = v ? JSON.parse(v) : null; } catch (e) { vault = null; }
  applySettings();
  if (vault) { render(); showLockScreen(); return; }
  await loadAll(); if (window.innerWidth > 760) { const first = visibleNotes().res[0]; if (first) cur = first.n.id; } render();
})();
window.__notes = { all: () => notes, L };
})();
