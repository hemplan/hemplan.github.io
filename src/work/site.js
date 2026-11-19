/* ============================== work version: site plan, contours and terrain ==============================
   A site plan PDF is read with pdf.js: lines per layer (or per line style when the PDF has no layers) and text.
   Everything from the drawing is stored in drawing coordinates (cm, y down, origin at the page's top-left)
   and placed in the plan with S.site.tx/ty/rot/k, so the whole drawing can be aligned with the house at once. */
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
const ROLES = [['ignore', 'Ignorera'], ['contour', 'Höjdkurvor'], ['building', 'Byggnader'], ['boundary', 'Fastighetsgräns'], ['road', 'Väg, hårdgjort'], ['water', 'Vatten'], ['other', 'Övrigt (visa)']];
const ROLE_COL = { contour:'#8a6d3b', building:'#4f565d', boundary:'#d32f2f', road:'#8d8d8d', water:'#3d8bd6', other:'#9aa0a6' };
const SITE_SHOW = { image:true, lines:true, terrain:true, drape:true };

IMG_SLOTS.push(st => st.site && st.site.img ? [['site', st.site.img]] : []);
HOOKS.normalize.push(o => {
  if (!o.site) { o.site = null; return; }
  o.site = Object.assign({ tx:0, ty:0, rot:0, k:1, ref:0, interval:0.5, start:0, lines:[], spots:[], buildings:[] }, o.site);
  o.site.show = Object.assign({}, SITE_SHOW, o.site.show || {});
});

/* ---------- drawing <-> plan coordinates ---------- */
function d2p(x, y){ const s = S.site, a = rad(s.rot), c = Math.cos(a)*s.k, n = Math.sin(a)*s.k; return { x:s.tx + x*c - y*n, y:s.ty + x*n + y*c }; }
function p2d(x, y){ const s = S.site, a = rad(s.rot), c = Math.cos(a), n = Math.sin(a), dx = (x - s.tx)/s.k, dy = (y - s.ty)/s.k; return { x:dx*c + dy*n, y:-dx*n + dy*c }; }

/* ---------- reading the PDF ---------- */
function loadScript(src){ return new Promise((res, rej) => { const el = document.createElement('script'); el.src = src; el.onload = res; el.onerror = () => rej(new Error('Kunde inte ladda ' + src)); document.head.appendChild(el); }); }
async function loadPdfJs(){
  if (window.pdfjsLib && window.pdfjsWorker) return;
  if (!window.pdfjsLib) await loadScript(PDFJS + 'pdf.min.js');
  // loading the worker as an ordinary script makes pdf.js run in the page (no separate worker file needed)
  if (!window.pdfjsWorker) await loadScript(PDFJS + 'pdf.worker.min.js');
}
async function readPdf(pdf, pageNo, onStep){
  const page = await pdf.getPage(pageNo), view = page.view;
  onStep('Läser lager…');
  const groups = {}; try { const oc = await pdf.getOptionalContentConfig(); for (const [id, g] of Object.entries(oc?.getGroups() || {})) groups[id] = g.name || id; } catch {}
  const ol = await page.getOperatorList(), O = pdfjsLib.OPS;
  onStep('Läser linjer…');
  let ctm = [1, 0, 0, 1, 0, 0], lw = 1, sc = '0', pending = null;
  const stack = [], ocStack = [], layers = {};
  const mul = (m, n) => [m[0]*n[0]+m[2]*n[1], m[1]*n[0]+m[3]*n[1], m[0]*n[2]+m[2]*n[3], m[1]*n[2]+m[3]*n[3], m[0]*n[4]+m[2]*n[5]+m[4], m[1]*n[4]+m[3]*n[5]+m[5]];
  const tp = (x, y) => [ctm[0]*x + ctm[2]*y + ctm[4], ctm[1]*x + ctm[3]*y + ctm[5]];
  const curLayer = () => { for (let i = ocStack.length - 1; i >= 0; i--) if (ocStack[i]) return ocStack[i]; return null; };
  const add = (polys, stroke) => {
    const w = Math.round(lw*Math.hypot(ctm[0], ctm[1])*100)/100, name = curLayer() || ('Linjer ' + sc + ' · ' + w);
    const L = layers[name] || (layers[name] = { polys:[], col:sc, named:!!curLayer() });
    polys.forEach(p => { if (p.pts.length >= 4) L.polys.push({ pts:p.pts, closed:p.closed, fill:!stroke }); });
  };
  for (let i = 0; i < ol.fnArray.length; i++){
    const f = ol.fnArray[i], a = ol.argsArray[i];
    if (f === O.save) stack.push([ctm, lw, sc]);
    else if (f === O.restore){ const s2 = stack.pop(); if (s2) [ctm, lw, sc] = s2; }
    else if (f === O.transform) ctm = mul(ctm, a);
    else if (f === O.setLineWidth) lw = a[0];
    else if (f === O.setStrokeRGBColor) sc = typeof a[0] === 'string' ? a[0] : '#' + Array.from(a).slice(0, 3).map(v => Math.round(+v).toString(16).padStart(2, '0')).join(''); // pdf.js gives 0–255
    else if (f === O.setStrokeGray) sc = '#' + Math.round(+a[0]*255).toString(16).padStart(2, '0').repeat(3);
    else if (f === O.beginMarkedContentProps) ocStack.push(a[0] === 'OC' && a[1]?.id && groups[a[1].id] ? groups[a[1].id] : null); // layers without a name are grouped by line style
    else if (f === O.beginMarkedContent) ocStack.push(null);
    else if (f === O.endMarkedContent) ocStack.pop();
    else if (f === O.constructPath){
      const ops = a[0], c = a[1]; let k = 0, cur = null; const polys = [];
      for (const op of ops){
        if (op === O.moveTo){ cur = { pts:tp(c[k], c[k+1]), closed:false }; polys.push(cur); k += 2; }
        else if (op === O.lineTo){ if (cur) cur.pts.push(...tp(c[k], c[k+1])); k += 2; }
        else if (op === O.curveTo){ if (cur) cur.pts.push(...tp(c[k+2], c[k+3]), ...tp(c[k+4], c[k+5])); k += 6; }
        else if (op === O.curveTo2 || op === O.curveTo3){ if (cur) cur.pts.push(...tp(c[k+2], c[k+3])); k += 4; }
        else if (op === O.closePath){ if (cur) cur.closed = true; }
        else if (op === O.rectangle){ const [x, y, w, h] = [c[k], c[k+1], c[k+2], c[k+3]]; polys.push({ pts:[...tp(x, y), ...tp(x+w, y), ...tp(x+w, y+h), ...tp(x, y+h)], closed:true }); k += 4; cur = null; }
      }
      pending = polys;
    }
    else if (f === O.stroke || f === O.closeStroke){ if (pending) add(pending, true); pending = null; }
    else if (f === O.fill || f === O.eoFill){ if (pending) add(pending, false); pending = null; }
    else if (f === O.fillStroke || f === O.eoFillStroke || f === O.closeFillStroke || f === O.closeEOFillStroke){ if (pending) add(pending, true); pending = null; }
    else if (f === O.endPath) pending = null;
  }
  const tc = await page.getTextContent();
  const texts = tc.items.filter(t => t.str && t.str.trim()).map(t => ({ s:t.str, x:t.transform[4], y:t.transform[5], h:Math.hypot(t.transform[2], t.transform[3]), a:Math.atan2(t.transform[1], t.transform[0]) }));
  // a picture of the page, used as background and draped on the terrain
  onStep('Ritar sidan…');
  const pw = view[2] - view[0], ph = view[3] - view[1], scale = Math.min(4, 4096/Math.max(pw, ph));
  const vp = page.getViewport({ scale }), cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
  const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
  await page.render({ canvasContext:cx, viewport:vp }).promise;
  const img = cv.toDataURL('image/jpeg', 0.82);
  return { view, layers, texts, img, named:Object.values(layers).some(L => L.named) };
}

/* ---------- line helpers ---------- */
// Join short pieces (dashed lines) into continuous lines; tol = largest gap to bridge
function chainLines(polys, tol){
  const n = polys.length, used = new Uint8Array(n), cell = Math.max(tol, 1e-6), grid = new Map();
  const key = (x, y) => Math.floor(x/cell) + ',' + Math.floor(y/cell);
  polys.forEach((p, i) => { const L = p.pts.length; [[p.pts[0], p.pts[1], 0], [p.pts[L-2], p.pts[L-1], 1]].forEach(([x, y, e]) => { const k = key(x, y); (grid.get(k) || grid.set(k, []).get(k)).push([i, e]); }); });
  const dirAt = (p, atEnd) => { const L = p.length; const dx = atEnd ? p[L-2] - p[L-4] : p[0] - p[2], dy = atEnd ? p[L-1] - p[L-3] : p[1] - p[3], d = Math.hypot(dx, dy) || 1; return [dx/d, dy/d]; };
  const findNext = (x, y, dir) => {
    let best = null, bs = Infinity; const cx = Math.floor(x/cell), cy = Math.floor(y/cell);
    for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) for (const [j, e] of grid.get(gx + ',' + gy) || []){
      if (used[j]) continue;
      const p = polys[j].pts, L = p.length, px = e ? p[L-2] : p[0], py = e ? p[L-1] : p[1], d = Math.hypot(px - x, py - y);
      if (d > tol) continue;
      const qx = e ? p[L-4] - px : p[2] - px, qy = e ? p[L-3] - py : p[3] - py, ql = Math.hypot(qx, qy) || 1, dot = (qx*dir[0] + qy*dir[1])/ql;
      if (dot < 0.5) continue;
      const sc2 = d - dot*tol*0.5; if (sc2 < bs){ bs = sc2; best = [j, e]; }
    }
    return best;
  };
  const out = [];
  for (let i = 0; i < n; i++){
    if (used[i]) continue; used[i] = 1;
    let pts = polys[i].pts.slice();
    if (!polys[i].closed) for (const atEnd of [true, false]){
      for (let g = 0; g < 200000; g++){
        if (pts.length < 4) break;
        const L = pts.length, nx = findNext(atEnd ? pts[L-2] : pts[0], atEnd ? pts[L-1] : pts[1], dirAt(pts, atEnd)); if (!nx) break;
        const [j, e] = nx; used[j] = 1; let q = polys[j].pts.slice();
        if (atEnd){ if (e) q = revPts(q); pts = pts.concat(q); } else { if (!e) q = revPts(q); pts = q.concat(pts); }
      }
    }
    const L = pts.length;
    out.push({ pts, closed:polys[i].closed || (L > 6 && Math.hypot(pts[0] - pts[L-2], pts[1] - pts[L-1]) <= tol) });
  }
  return out;
}
function revPts(p){ const r = []; for (let i = p.length - 2; i >= 0; i -= 2) r.push(p[i], p[i+1]); return r; }
function polyLen(p){ let l = 0; for (let i = 2; i < p.length; i += 2) l += Math.hypot(p[i] - p[i-2], p[i+1] - p[i-1]); return l; }
function segD(px, py, ax, ay, bx, by){ const dx = bx - ax, dy = by - ay, L2 = dx*dx + dy*dy || 1e-9; let t = ((px - ax)*dx + (py - ay)*dy)/L2; t = Math.max(0, Math.min(1, t)); return Math.hypot(px - ax - dx*t, py - ay - dy*t); }
function lineDist(l, x, y){ let d = Infinity; const p = l.pts; for (let k = 2; k < p.length; k += 2) d = Math.min(d, segD(x, y, p[k-2], p[k-1], p[k], p[k+1])); return d; }
// Douglas-Peucker
function simplify(p, eps){
  const n = p.length/2; if (n < 3) return p.slice();
  const keep = new Uint8Array(n); keep[0] = keep[n-1] = 1; const st = [[0, n - 1]];
  while (st.length){ const [a, b] = st.pop(); let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++){ const d = segD(p[i*2], p[i*2+1], p[a*2], p[a*2+1], p[b*2], p[b*2+1]); if (d > md){ md = d; mi = i; } }
    if (md > eps && mi > 0){ keep[mi] = 1; st.push([a, mi], [mi, b]); } }
  const r = []; for (let i = 0; i < n; i++) if (keep[i]) r.push(Math.round(p[i*2]*10)/10, Math.round(p[i*2+1]*10)/10); return r;
}

/* ---------- import dialog ---------- */
function guessRole(name, named, count, nStyles){
  const n = name.toLowerCase();
  // without layers: show the line styles, except huge ones (usually hatching), unless there is only one
  if (!named) return nStyles === 1 || count < 20000 ? 'other' : 'ignore';
  if (/höjdkurv|hojdkurv|contour/.test(n) && !/höjd$|text|hojd$/.test(n.replace(/\s+$/, ''))) return 'contour';
  if (/fastighetsgr|tomtgr|property/.test(n)) return 'boundary';
  if (/bef.*byggn|byggnad|building/.test(n)) return 'building';
  if (/väg(?!g)|vag(?!g)|gata|hårdg|road|parker/.test(n)) return 'road';
  if (/vatten|sjö|hav|water/.test(n)) return 'water';
  return 'ignore';
}
function detectScale(texts){
  const c = {}; texts.forEach(t => { const m = t.s.match(/(?:^|[^\d])1\s*:\s*(\d{2,4})\b/); if (m && +m[1] >= 50) c[m[1]] = (c[m[1]] || 0) + 1; });
  const best = Object.entries(c).sort((a, b) => b[1] - a[1])[0]; return best ? +best[0] : null;
}
function parseNums(texts){ return texts.map(t => { const m = t.s.replace(/\s/g, '').match(/^(\+)?(-?\d{1,4}[.,]\d{1,3})$/); return m ? { v:parseFloat(m[2].replace(',', '.')), plus:!!m[1], x:t.x, y:t.y, h:t.h, a:t.a } : null; }).filter(Boolean); }

let siteBusy = false;
async function importSitePdf(file){
  const st = $('#siteStat'); st.className = 'status';
  if (siteBusy) return; siteBusy = true;
  try {
    st.textContent = 'Laddar PDF-läsaren…'; await loadPdfJs();
    const pdf = await pdfjsLib.getDocument({ data:new Uint8Array(await file.arrayBuffer()) }).promise;
    if (pdf.numPages > 1){ await pagesDialog(file.name, pdf, m => { st.textContent = m; }); st.textContent = ''; return; }
    const r = await readPdf(pdf, 1, m => { st.textContent = m; });
    st.textContent = '';
    siteDialog(file.name, r);
  } catch (e) { st.className = 'status err'; st.textContent = 'PDF:en kunde inte läsas: ' + (e?.message || e); }
  finally { siteBusy = false; }
}
/* ---------- multi-page PDFs: one page is the site plan, others are floor plans ---------- */
async function renderPage(pdf, n, maxPx, q = 0.85){
  const page = await pdf.getPage(n), v = page.view, sc = Math.min(4, maxPx/Math.max(v[2] - v[0], v[3] - v[1])), vp = page.getViewport({ scale:sc });
  const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
  const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
  await page.render({ canvasContext:cx, viewport:vp }).promise;
  return { src:cv.toDataURL('image/jpeg', q), w:cv.width, h:cv.height, pxPerPt:sc };
}
const PAGE_SITE = /situationsplan|markplan|tomtplan|nybyggnadskarta|marksektion|terr[äa]ng|jorddjup/i;
const PAGE_FLOOR = /(^|\s)(plan\s*\d|plan\s*[0-9]+\s*tr|entr[ée]plan|bottenv[åa]ning|bottenplan|souterr[äa]ng|k[äa]llare|vindsplan|vind|[öo]vervåning|v[åa]ningsplan|v[åa]ning\s*\d|planritning)/i;
async function pagesDialog(fname, pdf, onStep){
  const pages = [], n = Math.min(pdf.numPages, 40);
  for (let i = 1; i <= n; i++){
    onStep(`Förhandsvisar sida ${i} av ${n}…`);
    const page = await pdf.getPage(i), tc = await page.getTextContent();
    const texts = tc.items.filter(t => t.str && t.str.trim()).map(t => ({ s:t.str, h:Math.hypot(t.transform[2], t.transform[3]) }));
    const all = texts.map(t => t.s).join(' ');
    const big = [...texts].sort((a, b) => b.h - a.h).map(t => t.s.trim()).find(t => PAGE_SITE.test(t) || PAGE_FLOOR.test(t)) || '';
    const role = PAGE_SITE.test(all) ? 'site' : PAGE_FLOOR.test(all) ? 'floor' : 'skip';
    const th = await renderPage(pdf, i, 240, 0.7);
    pages.push({ n:i, scale:detectScale(texts.map(t => ({ s:t.s }))), title:big.slice(0, 40), role, thumb:th.src });
  }
  // only one page can be the site plan
  let seen = false; pages.forEach(p => { if (p.role === 'site'){ if (seen) p.role = 'skip'; seen = true; } });
  // floor pages go to existing floors that have no floor plan image yet, then to new floors
  const free = floorsSorted().filter(f => !f.underlay).map(f => f.id);
  pages.forEach(p => { p.target = p.role === 'floor' ? (free.shift() || 'new') : 'new'; });
  const floorOpts = sel2 => floorsSorted().map(f => `<option value="${f.id}" ${sel2 === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('') + `<option value="new" ${sel2 === 'new' ? 'selected' : ''}>Ny våning</option>`;
  const m = modal(`<b>Importera ${esc(fname)}</b>
    <div class="hint">${pdf.numPages} sidor${pdf.numPages > n ? ` (de första ${n} visas)` : ''}. Välj vilken sida som är situationsplanen med terräng och vilka sidor som är våningsplan. Ett våningsplan läggs som planritning under våningen, i rätt skala.</div>
    <div class="pglist">${pages.map((p, i) => `<div class="pgrow" data-pg="${i}">
      <img src="${p.thumb}" alt="Sida ${p.n}">
      <div class="pginfo"><b>Sida ${p.n}</b>${p.title ? ` · ${esc(p.title)}` : ''}
        <div class="grid2">
          <label class="f">Används som<select data-pr="role"><option value="skip" ${p.role === 'skip' ? 'selected' : ''}>Hoppa över</option><option value="site" ${p.role === 'site' ? 'selected' : ''}>Situationsplan / terräng</option><option value="floor" ${p.role === 'floor' ? 'selected' : ''}>Våningsplan</option></select></label>
          <label class="f">Skala 1:<input type="number" data-pr="scale" value="${p.scale || ''}" placeholder="t.ex. 100" min="10"></label>
        </div>
        <label class="f" ${p.role === 'floor' ? '' : 'hidden'} data-pr-floor>Våning<select data-pr="target">${floorOpts(p.target)}</select></label>
        <label class="f" ${p.role === 'floor' && p.target === 'new' ? '' : 'hidden'} data-pr-name>Namn på ny våning<input type="text" data-pr="name" value="${esc(p.title || '')}" placeholder="t.ex. Plan 2"></label>
      </div></div>`).join('')}</div>
    <div class="row"><button class="btn primary" id="pgOk">Fortsätt</button><button class="btn" data-close>Avbryt</button></div>
    <div class="status" id="pgSt"></div>`);
  m.querySelector('.card').style.width = 'min(760px, 100%)';
  const sync = row => { const role = row.querySelector('[data-pr=role]').value, tgt = row.querySelector('[data-pr=target]').value; row.querySelector('[data-pr-floor]').hidden = role !== 'floor'; row.querySelector('[data-pr-name]').hidden = !(role === 'floor' && tgt === 'new'); };
  // a page switched to "floor plan" gets a floor no other page uses yet, else a new floor with a unique name
  const assign = row => {
    const taken = new Set([...m.querySelectorAll('.pgrow')].filter(r => r !== row && r.querySelector('[data-pr=role]').value === 'floor').map(r => r.querySelector('[data-pr=target]').value));
    const free2 = floorsSorted().find(f => !f.underlay && !taken.has(f.id));
    row.querySelector('[data-pr=target]').value = free2 ? free2.id : 'new';
    const nm = row.querySelector('[data-pr=name]');
    if (!free2 && !nm.value){ const names = new Set([...S.floors.map(f => f.name), ...[...m.querySelectorAll('[data-pr=name]')].filter(x => x !== nm).map(x => x.value)]); let k = S.floors.length + 1; while (names.has('Plan ' + k)) k++; nm.value = 'Plan ' + k; }
  };
  m.querySelector('.pglist').addEventListener('change', e => { const row = e.target.closest('.pgrow'); if (!row) return;
    if (e.target.dataset.pr === 'role' && e.target.value === 'site') m.querySelectorAll('.pgrow [data-pr=role]').forEach(o => { if (o !== e.target && o.value === 'site') { o.value = 'skip'; sync(o.closest('.pgrow')); } });
    if (e.target.dataset.pr === 'role' && e.target.value === 'floor') assign(row);
    if (e.target.dataset.pr === 'target' && e.target.value === 'new') assign2(row);
    sync(row); });
  const assign2 = row => { const nm = row.querySelector('[data-pr=name]'); if (!nm.value){ const names = new Set([...S.floors.map(f => f.name), ...[...m.querySelectorAll('[data-pr=name]')].filter(x => x !== nm).map(x => x.value)]); let k = S.floors.length + 1; while (names.has('Plan ' + k)) k++; nm.value = 'Plan ' + k; } };
  $('#pgOk', m).addEventListener('click', async () => {
    const rows = [...m.querySelectorAll('.pgrow')].map(r => ({ p:pages[+r.dataset.pg], role:r.querySelector('[data-pr=role]').value, scale:num(r.querySelector('[data-pr=scale]').value, 0), target:r.querySelector('[data-pr=target]').value, name:r.querySelector('[data-pr=name]').value.trim() }));
    const bad = rows.find(r => r.role !== 'skip' && !(r.scale > 0));
    if (bad){ $('#pgSt', m).className = 'status err'; $('#pgSt', m).textContent = `Ange skalan för sida ${bad.p.n}. Den står oftast i ritningshuvudet.`; return; }
    const st = $('#pgSt', m); st.className = 'status';
    try {
      const floorRows = rows.filter(r => r.role === 'floor');
      if (floorRows.length) pushUndo();
      for (const r of floorRows){ st.textContent = `Lägger in sida ${r.p.n} som våningsplan…`; await floorFromPage(pdf, r); }
      if (floorRows.length){ rebuildAll(); renderFloorUI(); syncSettingsUI(); renderTools(); changed(); }
      const siteRow = rows.find(r => r.role === 'site');
      if (siteRow){ st.textContent = `Läser situationsplanen på sida ${siteRow.p.n}…`; const r = await readPdf(pdf, siteRow.p.n, t => { st.textContent = t; }); m.remove(); siteDialog(`${fname}, sida ${siteRow.p.n}`, r, siteRow.scale); }
      else { m.remove(); setView('plan'); fitPlan(); }
      if (floorRows.length) toast(`${floorRows.length} ${floorRows.length === 1 ? 'våningsplan är inlagt' : 'våningsplan är inlagda'} som planritning. Passa in dem med Kalibrera och Flytta bild om det behövs, och rita väggarna ovanpå.`);
    } catch (e) { st.className = 'status err'; st.textContent = 'Det gick inte: ' + (e?.message || e); }
  });
}
// A floor plan page becomes the floor plan image of a floor, at the drawing's scale
async function floorFromPage(pdf, r){
  let fl = r.target !== 'new' && S.floors.find(f => f.id === r.target);
  if (!fl){
    const top = floorsSorted().pop(), empty = S.floors.length === 1 && !S.floors[0].walls.length && !S.floors[0].underlay ? S.floors[0] : null;
    if (empty) fl = empty;
    else { fl = { id:'f' + uid(), name:r.name || ('Plan ' + (S.floors.length + 1)), elev:top.elev + (top._maxH || S.settings.defH) + 30 }; FLOOR_KEYS.forEach(k => { fl[k] = k === 'underlay' ? null : []; }); S.floors.push(fl); }
    if (r.name) fl.name = r.name.slice(0, 40);
  }
  const img = await renderPage(pdf, r.p.n, 4096), cmPerPx = 2.54/72*r.scale/img.pxPerPt;
  // centre it on the ground floor's walls, or around the origin
  const g = floorsSorted()[0], b = g.walls.length ? withFloor(g, wallsBBox) : { minx:0, miny:0, maxx:0, maxy:0 };
  fl.underlay = { src:img.src, x:Math.round((b.minx + b.maxx)/2 - img.w*cmPerPx/2), y:Math.round((b.miny + b.maxy)/2 - img.h*cmPerPx/2), cmPerPx:Math.round(cmPerPx*10000)/10000, opacity:0.55, natW:img.w, natH:img.h };
  if (!fl.walls.length) S.curFloor = fl.id;
}
function siteDialog(fname, r, scaleOverride){
  const scale = scaleOverride || detectScale(r.texts), nums = parseNums(r.texts), plus = nums.filter(n => n.plus).map(n => n.v);
  const refGuess = plus.length ? Object.entries(plus.reduce((c, v) => (c[v] = (c[v] || 0) + 1, c), {})).sort((a, b) => b[1] - a[1])[0][0] : '';
  const rows = Object.entries(r.layers).map(([name, L]) => ({ name, n:L.polys.length, col:L.col, role:guessRole(name, r.named, L.polys.length, Object.keys(r.layers).length) })).sort((a, b) => (a.role === 'ignore') - (b.role === 'ignore') || b.n - a.n);
  const m = modal(`<b>Importera situationsplan</b>
    <div class="hint">${esc(fname)} · ${r.named ? `${rows.length} lager` : `inga lager, ${rows.length} linjetyper`} · ${nums.length} höjdtal i texten${scale ? ` · skala 1:${scale} hittad` : ''}</div>
    <div class="grid3">
      <label class="f">Skala 1:<input type="number" id="sdScale" value="${scale || ''}" placeholder="t.ex. 400" min="10"></label>
      <label class="f">Golvet på Plan 1 (+m)<input type="number" id="sdRef" step="0.01" value="${refGuess}" placeholder="t.ex. 14,77"></label>
      <label class="f">Sammanfoga glapp (mm)<input type="number" id="sdGap" step="0.1" value="1" min="0"></label>
    </div>
    <div class="hint">${r.named ? 'Välj vad varje lager innehåller. Lager med höjdkurvor, byggnader och fastighetsgräns är förvalda efter namnen.' : 'PDF:en saknar lager, så linjerna är grupperade efter färg och tjocklek. Välj “Övrigt (visa)” för de grupper som innehåller höjdkurvor. Höjder sätter du sedan med verktyget Höjdlinje.'}</div>
    <div class="sdlist">${rows.map((x, i) => `<div class="sdrow"><span class="sw" style="background:${/^#/.test(x.col) ? x.col : '#888'}"></span><span class="nm" title="${esc(x.name)}">${esc(x.name)}</span><span class="dm">${x.n}</span>
      <select data-sd="${i}">${ROLES.map(([k, n]) => `<option value="${k}" ${k === x.role ? 'selected' : ''}>${n}</option>`).join('')}</select></div>`).join('')}</div>
    <div class="row"><button class="btn primary" id="sdOk">Importera</button><button class="btn" data-close>Avbryt</button></div>
    <div class="status" id="sdSt"></div>`);
  m.querySelector('.card').style.width = 'min(720px, 100%)';
  $('#sdOk', m).addEventListener('click', async () => {
    const sc2 = num($('#sdScale', m).value, 0); if (!(sc2 > 0)){ $('#sdSt', m).className = 'status err'; $('#sdSt', m).textContent = 'Ange ritningens skala, t.ex. 400 för 1:400. Den står oftast i ritningshuvudet.'; return; }
    m.querySelectorAll('[data-sd]').forEach(sel2 => { rows[+sel2.dataset.sd].role = sel2.value; });
    $('#sdSt', m).textContent = 'Bearbetar linjer…'; await new Promise(res => setTimeout(res, 30));
    try { buildSite(fname, r, rows, sc2, $('#sdRef', m).value === '' ? null : num($('#sdRef', m).value, 0), num($('#sdGap', m).value, 1)); m.remove(); }
    catch (e) { $('#sdSt', m).className = 'status err'; $('#sdSt', m).textContent = 'Det gick inte: ' + (e?.message || e); }
  });
}
function buildSite(fname, r, rows, scale, ref, gapMm){
  const cmPt = 2.54/72*scale, [vx0, , , vy1] = r.view, tol = Math.max(0.5, gapMm/10*scale);
  const toD = p => { const o = []; for (let i = 0; i < p.length; i += 2) o.push((p[i] - vx0)*cmPt, (vy1 - p[i+1])*cmPt); return o; };
  const lines = [], buildings = [];
  rows.forEach(row => {
    if (row.role === 'ignore') return;
    const polys = r.layers[row.name].polys.map(p => ({ pts:toD(p.pts), closed:p.closed }));
    let ch = chainLines(polys, tol);
    const minLen = row.role === 'other' ? 300 : row.role === 'contour' ? tol*3 : 20;
    ch = ch.filter(l => polyLen(l.pts) >= minLen);
    ch.forEach(l => {
      const pts = simplify(l.pts, row.role === 'building' ? 2 : 4);
      if (row.role === 'building' && l.closed && pts.length >= 6) buildings.push({ id:uid(), pts, h:600, name:'Byggnad ' + (buildings.length + 1) });
      else lines.push({ id:uid(), role:row.role, pts, z:null, closed:l.closed });
    });
  });
  if (lines.length + buildings.length > 30000) throw new Error('för många linjer. Ignorera fler lager eller linjetyper.');
  const npts = lines.reduce((a, l) => a + l.pts.length, 0);
  if (npts > 400000) throw new Error('för många linjer att spara i webbläsaren. Ignorera lager eller linjetyper med skraffering och text.');
  // heights from the text next to the contour lines
  const nums = parseNums(r.texts).map(n => ({ ...n, x:(n.x - vx0)*cmPt, y:(vy1 - n.y)*cmPt, h:n.h*cmPt, a:-n.a }));
  const cont = lines.filter(l => l.role === 'contour'), maxD = 0.35*scale, spots = [];
  const votes = new Map();
  nums.forEach(lb => {
    const w = lb.h*0.6*String(lb.v).length, cx = lb.x + Math.cos(lb.a)*w/2 + Math.sin(lb.a)*lb.h*0.35, cy = lb.y + Math.sin(lb.a)*w/2 - Math.cos(lb.a)*lb.h*0.35;
    let best = null, bd = Infinity; if (!lb.plus) cont.forEach(l => { const d = lineDist(l, cx, cy); if (d < bd){ bd = d; best = l; } });
    if (best && bd <= maxD){ const v = votes.get(best) || []; v.push(lb.v); votes.set(best, v); }
    else spots.push({ x:Math.round(cx), y:Math.round(cy), z:lb.v, plus:lb.plus });
  });
  votes.forEach((v, l) => { const c = {}; v.forEach(x => c[x] = (c[x] || 0) + 1); l.z = +Object.entries(c).sort((a, b) => b[1] - a[1])[0][0]; });
  const vals = [...new Set(cont.filter(l => l.z != null).map(l => l.z))].sort((a, b) => a - b), diffs = vals.slice(1).map((v, i) => Math.round((v - vals[i])*100)/100).filter(d => d > 0);
  const interval = diffs.length ? Math.min(...diffs) : 0.5;
  pushUndo();
  const pw = (r.view[2] - r.view[0])*cmPt, ph = (r.view[3] - r.view[1])*cmPt;
  const ground = floorsSorted()[0], bb = ground.walls.length ? withFloor(ground, wallsBBox) : { minx:0, miny:0, maxx:0, maxy:0 };
  S.site = { file:fname, scale, w:pw, h:ph, img:{ src:r.img }, tx:(bb.minx + bb.maxx)/2 - pw/2, ty:(bb.miny + bb.maxy)/2 - ph/2, rot:0, k:1,
    ref:ref, interval, start:vals[0] ?? 0, lines, spots, buildings, show:{ ...SITE_SHOW } };
  estimateContours();
  siteChanged(); setView('plan'); fitSite(); renderSitePanel();
  const nz = cont.filter(l => l.z != null && !l.est).length;
  toast(`Situationsplanen är inläst: ${cont.length} höjdkurvor (${nz} med höjd från texten), ${buildings.length} byggnader. Passa in den mot huset med verktyget Passa in.`);
}
// Contours without a label get the height their neighbours suggest, rounded to the contour interval
function estimateContours(){
  const s = S.site, known = [];
  s.lines.forEach(l => { if (l.role === 'contour' && l.z != null && !l.est){ const p = l.pts; for (let i = 0; i < p.length; i += 8) known.push([p[i], p[i+1], l.z]); } });
  if (known.length < 2) return;
  s.lines.forEach(l => {
    if (l.role !== 'contour' || (l.z != null && !l.est)) return;
    const p = l.pts, m = Math.floor(p.length/4)*2, x = p[m], y = p[m+1];
    let n1 = null, d1 = Infinity, n2 = null, d2 = Infinity;
    known.forEach(q => { const d = Math.hypot(q[0] - x, q[1] - y); if (d < d1){ d1 = d; n1 = q; } });
    known.forEach(q => { if (Math.abs(q[2] - n1[2]) < 1e-6) return; const d = Math.hypot(q[0] - x, q[1] - y); if (d < d2){ d2 = d; n2 = q; } });
    let z = n2 ? (n1[2]*d2 + n2[2]*d1)/(d1 + d2) : n1[2];
    z = Math.round(z/s.interval)*s.interval;
    l.z = Math.round(z*100)/100; l.est = true;
  });
}

/* ---------- terrain ---------- */
let terrain = null, siteG = null, siteTex = null, siteTexSrc = null, siteImg = null, siteImgSrc = null;
function terrainSamples(){
  const s = S.site, out = [], step = 20;
  s.lines.forEach(l => {
    if (l.role !== 'contour' || l.z == null) return;
    const p = l.pts;
    for (let i = 2; i < p.length; i += 2){ const L = Math.hypot(p[i] - p[i-2], p[i+1] - p[i-1]), n = Math.max(1, Math.ceil(L/step));
      for (let k = 0; k < n; k++){ const t = k/n, q = d2p(p[i-2] + (p[i] - p[i-2])*t, p[i-1] + (p[i+1] - p[i-1])*t); out.push(q.x, q.y, l.z); } }
  });
  s.spots.forEach(sp => { if (!sp.plus){ const q = d2p(sp.x, sp.y); out.push(q.x, q.y, sp.z); } });
  return out;
}
// Smooth ground through the contour lines: the contours are fixed and the ground between them is the
// evenly stretched surface (Laplace), solved coarse-to-fine. No jumps, also with only a few contours.
function solveLaplace(nx, ny, fixed, val, iters){
  const N = nx*ny, h = new Float32Array(N);
  if (nx > 24 && ny > 24){
    const cx = Math.ceil(nx/2), cy = Math.ceil(ny/2), cf = new Uint8Array(cx*cy), cv = new Float32Array(cx*cy), cc = new Float32Array(cx*cy);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++){ const k = j*nx + i; if (!fixed[k]) continue; const c = (j >> 1)*cx + (i >> 1); cf[c] = 1; cv[c] += val[k]; cc[c]++; }
    for (let c = 0; c < cx*cy; c++) if (cc[c]) cv[c] /= cc[c];
    const ch = solveLaplace(cx, cy, cf, cv, iters);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++){
      const k = j*nx + i; if (fixed[k]){ h[k] = val[k]; continue; }
      const fx = Math.min(cx - 1.001, i/2), fy = Math.min(cy - 1.001, j/2), i0 = Math.floor(fx), j0 = Math.floor(fy), u = fx - i0, v = fy - j0, i1 = Math.min(cx - 1, i0 + 1), j1 = Math.min(cy - 1, j0 + 1);
      h[k] = ch[j0*cx + i0]*(1-u)*(1-v) + ch[j0*cx + i1]*u*(1-v) + ch[j1*cx + i0]*(1-u)*v + ch[j1*cx + i1]*u*v;
    }
  } else {
    let sum = 0, n = 0; for (let k = 0; k < N; k++) if (fixed[k]){ sum += val[k]; n++; }
    const m = n ? sum/n : 0; for (let k = 0; k < N; k++) h[k] = fixed[k] ? val[k] : m;
  }
  const w = 1.85;
  for (let it = 0; it < iters; it++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++){
    const k = j*nx + i; if (fixed[k]) continue;
    let s2 = 0, c = 0;
    if (i > 0){ s2 += h[k-1]; c++; } if (i < nx - 1){ s2 += h[k+1]; c++; } if (j > 0){ s2 += h[k-nx]; c++; } if (j < ny - 1){ s2 += h[k+nx]; c++; }
    h[k] += w*(s2/c - h[k]);
  }
  return h;
}
function buildTerrain(){
  terrain = null;
  const s = S.site; if (!s || !s.show.terrain) return;
  const sm = terrainSamples(), n = sm.length/3; if (n < 3) return;
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (let i = 0; i < sm.length; i += 3){ minx = Math.min(minx, sm[i]); maxx = Math.max(maxx, sm[i]); miny = Math.min(miny, sm[i+1]); maxy = Math.max(maxy, sm[i+1]); }
  // a margin around the contours, and at least the house
  const g0 = floorsSorted()[0], hb = g0 && g0.walls.length ? withFloor(g0, wallsBBox) : null;
  if (hb){ minx = Math.min(minx, hb.minx); miny = Math.min(miny, hb.miny); maxx = Math.max(maxx, hb.maxx); maxy = Math.max(maxy, hb.maxy); }
  const mg = Math.max(maxx - minx, maxy - miny)*0.05; minx -= mg; miny -= mg; maxx += mg; maxy += mg;
  const W = maxx - minx, H = maxy - miny, cell = Math.max(40, Math.ceil(Math.max(W, H)/260)), nx = Math.ceil(W/cell) + 1, ny = Math.ceil(H/cell) + 1, N = nx*ny;
  if (s.ref == null){
    // no floor height given: use the ground height at the house
    const cx0 = hb ? (hb.minx + hb.maxx)/2 : (minx + maxx)/2, cy0 = hb ? (hb.miny + hb.maxy)/2 : (miny + maxy)/2;
    let bz = sm[2], bd = Infinity; for (let i = 0; i < sm.length; i += 3){ const d = Math.hypot(sm[i] - cx0, sm[i+1] - cy0); if (d < bd){ bd = d; bz = sm[i+2]; } }
    s.ref = Math.round(bz*10)/10 + 0.3; setTimeout(() => { renderSitePanel(); toast(`Golvet på Plan 1 är satt till +${fmt(s.ref)} m, strax över marken vid huset. Ändra under Situationsplan och terräng om du vet rätt höjd.`); }, 0);
  }
  const ref = s.ref, fixed = new Uint8Array(N), val = new Float32Array(N), cnt = new Float32Array(N);
  for (let q = 0; q < n; q++){ const i = Math.round((sm[q*3] - minx)/cell), j = Math.round((sm[q*3+1] - miny)/cell), k = j*nx + i; if (k < 0 || k >= N) continue; fixed[k] = 1; val[k] += (sm[q*3+2] - ref)*100; cnt[k]++; }
  for (let k = 0; k < N; k++) if (cnt[k]) val[k] /= cnt[k];
  const h = solveLaplace(nx, ny, fixed, val, 60);
  // keep the ground below the house's floors
  const fls = floorsSorted(), low = fls[0];
  if (low && low.walls.length){
    const r = withFloor(low, getRaster);
    if (r) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++){
      const x = minx + i*cell, y = miny + j*cell, ci = Math.floor((x - r.minx)/r.cell), cj = Math.floor((y - r.miny)/r.cell);
      if (ci >= 0 && cj >= 0 && ci < r.nx && cj < r.ny && r.outMask && !r.outMask[cj*r.nx + ci]) h[j*nx + i] = Math.min(h[j*nx + i], low.elev - 20);
    }
  }
  terrain = { minx, miny, cell, nx, ny, h };
}
function terrainAt(x, y){
  const t = terrain; if (!t) return null;
  const fx = (x - t.minx)/t.cell, fy = (y - t.miny)/t.cell; if (fx < 0 || fy < 0 || fx > t.nx - 1 || fy > t.ny - 1) return null;
  const i = Math.min(t.nx - 2, Math.floor(fx)), j = Math.min(t.ny - 2, Math.floor(fy)), u = fx - i, v = fy - j, H = t.h, n = t.nx;
  return H[j*n + i]*(1-u)*(1-v) + H[j*n + i + 1]*u*(1-v) + H[(j+1)*n + i]*(1-u)*v + H[(j+1)*n + i + 1]*u*v;
}
HOOKS.terrain.push(() => !!terrain);
HOOKS.ground.push((x, y) => terrainAt(x, y));

function disposeGroup(g){ g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material !== siteMatShared) o.material.dispose(); }); while (g.children.length) g.remove(g.children[0]); }
let siteMatShared = null;
function buildSite3D(){
  if (!ok3d || !scene) return;
  if (!siteG){ siteG = new THREE.Group(); scene.add(siteG); }
  disposeGroup(siteG);
  const s = S.site; if (!s) return;
  const t = terrain;
  if (t){
    const pos = new Float32Array(t.nx*t.ny*3), uv = new Float32Array(t.nx*t.ny*2), idx = [];
    for (let j = 0; j < t.ny; j++) for (let i = 0; i < t.nx; i++){
      const k = j*t.nx + i, x = t.minx + i*t.cell, y = t.miny + j*t.cell, d = p2d(x, y);
      pos[k*3] = x; pos[k*3+1] = t.h[k]; pos[k*3+2] = y; uv[k*2] = d.x/s.w; uv[k*2+1] = 1 - d.y/s.h;
      if (i < t.nx - 1 && j < t.ny - 1) idx.push(k, k + t.nx, k + 1, k + 1, k + t.nx, k + t.nx + 1);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    let map = null;
    if (s.show.drape && s.img?.src){ if (siteTexSrc !== s.img.src){ siteTex?.dispose(); siteTex = new THREE.TextureLoader().load(s.img.src); siteTex.encoding = THREE.sRGBEncoding; siteTex.anisotropy = 8; siteTexSrc = s.img.src; } map = siteTex; }
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color:map ? 0xffffff : new THREE.Color('#8fa36d').convertSRGBToLinear(), map, roughness:1 }));
    m.receiveShadow = true; m.userData.terrain = true; siteG.add(m);
  }
  // surrounding buildings as simple masses standing on the terrain
  const bm = new THREE.MeshStandardMaterial({ color:new THREE.Color('#c9c6bf').convertSRGBToLinear(), roughness:0.9 });
  s.buildings.forEach(b => {
    const pp = []; for (let i = 0; i < b.pts.length; i += 2) pp.push(d2p(b.pts[i], b.pts[i+1]));
    if (pp.length < 3) return;
    let base = Infinity; pp.forEach(q => { const z = terrainAt(q.x, q.y); base = Math.min(base, z == null ? 0 : z); }); if (!isFinite(base)) base = 0;
    const sh = new THREE.Shape(pp.map(q => new THREE.Vector2(q.x, q.y)));
    const geo = new THREE.ExtrudeGeometry(sh, { depth:b.h, bevelEnabled:false });
    const mesh = new THREE.Mesh(geo, bm.clone()); mesh.rotation.x = Math.PI/2; mesh.position.y = base + b.h; mesh.castShadow = mesh.receiveShadow = true; siteG.add(mesh);
  });
  bm.dispose();
  // property boundary draped on the ground
  s.lines.filter(l => l.role === 'boundary').forEach(l => {
    const pts = []; for (let i = 0; i < l.pts.length; i += 2){ const q = d2p(l.pts[i], l.pts[i+1]); pts.push(new THREE.Vector3(q.x, (terrainAt(q.x, q.y) ?? 0) + 8, q.y)); }
    const lm = new THREE.LineBasicMaterial({ color:0xd32f2f }); siteG.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lm));
  });
}
let siteTimer = 0;
function siteChanged(quick){
  reqPlan(); renderSitePanel();
  clearTimeout(siteTimer);
  siteTimer = setTimeout(() => { buildTerrain(); buildSite3D(); scheduleFloor(); }, quick ? 250 : 0);
  if (!quick) scheduleSave();
}
HOOKS.build.push(() => { clearTimeout(siteTimer); siteTimer = setTimeout(() => { const had = !!terrain; buildTerrain(); buildSite3D(); if (!!terrain !== had) scheduleFloor(); }, 60); });
HOOKS.afterLoad.push(() => { const had = !!terrain; buildTerrain(); buildSite3D(); renderSitePanel(); if (!!terrain !== had) scheduleFloor(); });
HOOKS.imgLoaded.push(() => { reqPlan(); buildSite3D(); });

/* ---------- plan drawing ---------- */
function contourColor(z, lo, hi){ const t = hi > lo ? (z - lo)/(hi - lo) : 0.5; return `hsl(${Math.round(200 - t*170)}, 55%, ${Math.round(42 + t*6)}%)`; }
HOOKS.planBase.push((ctx, col) => {
  const s = S.site; if (!s) return;
  const z = pv.z;
  if (s.show.image && s.img?.src){
    if (siteImgSrc !== s.img.src){ siteImg = new Image(); siteImg.onload = reqPlan; siteImg.src = s.img.src; siteImgSrc = s.img.src; }
    if (siteImg.complete && siteImg.naturalWidth){ ctx.save(); ctx.translate(sx(s.tx), sy(s.ty)); ctx.rotate(rad(s.rot)); ctx.scale(z*s.k, z*s.k); ctx.globalAlpha = 0.45; ctx.drawImage(siteImg, 0, 0, s.w, s.h); ctx.restore(); }
  }
  if (!s.show.lines) return;
  const zs = s.lines.filter(l => l.role === 'contour' && l.z != null).map(l => l.z), lo = Math.min(...zs), hi = Math.max(...zs);
  ctx.save(); ctx.translate(sx(s.tx), sy(s.ty)); ctx.rotate(rad(s.rot)); ctx.scale(z*s.k, z*s.k);
  const px = 1/(z*s.k);
  s.buildings.forEach(b => { ctx.beginPath(); for (let i = 0; i < b.pts.length; i += 2) i ? ctx.lineTo(b.pts[i], b.pts[i+1]) : ctx.moveTo(b.pts[i], b.pts[i+1]); ctx.closePath();
    const isSel = sel?.kind === 'sbld' && sel.id === b.id; ctx.fillStyle = isSel ? 'rgba(201,80,26,.35)' : 'rgba(79,86,93,.28)'; ctx.fill(); ctx.strokeStyle = isSel ? col.accent : ROLE_COL.building; ctx.lineWidth = 1.5*px; ctx.stroke(); });
  s.lines.forEach(l => {
    const isSel = sel?.kind === 'sline' && sel.id === l.id;
    ctx.beginPath(); const p = l.pts; for (let i = 0; i < p.length; i += 2) i ? ctx.lineTo(p[i], p[i+1]) : ctx.moveTo(p[i], p[i+1]); if (l.closed) ctx.closePath();
    let c = ROLE_COL[l.role] || '#999', w = 1.2;
    if (l.role === 'contour') c = l.z == null ? '#9e9e9e' : contourColor(l.z, lo, hi);
    if (l.role === 'boundary') w = 2;
    if (l.role === 'other') w = 0.8;
    ctx.setLineDash(l.role === 'contour' && (l.z == null || l.est) ? [6*px, 4*px] : l.role === 'boundary' ? [10*px, 4*px, 2*px, 4*px] : []);
    ctx.strokeStyle = isSel ? col.accent : c; ctx.lineWidth = (isSel ? 3 : w)*px; ctx.globalAlpha = l.role === 'other' ? 0.6 : 1; ctx.stroke(); ctx.globalAlpha = 1;
  });
  ctx.setLineDash([]); ctx.restore();
  // contour heights where there is room
  if (z > 0.08){
    ctx.font = `500 10px ${css('--f-mono')}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    s.lines.forEach(l => { if (l.role !== 'contour' || l.z == null || l.pts.length < 4) return; const m = Math.floor(l.pts.length/4)*2, q = d2p(l.pts[m], l.pts[m+1]), X = sx(q.x), Y = sy(q.y);
      const t = (l.est ? '≈' : '') + String(l.z.toFixed(1)).replace('.', ','), w = ctx.measureText(t).width + 4; ctx.fillStyle = col.paper; ctx.globalAlpha = 0.85; ctx.fillRect(X - w/2, Y - 6, w, 12); ctx.globalAlpha = 1; ctx.fillStyle = contourColor(l.z, lo, hi); ctx.fillText(t, X, Y); });
  }
});
HOOKS.planOver.push((ctx, col) => {
  if (slope){ ctx.strokeStyle = col.accent; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(sx(slope.a.x), sy(slope.a.y)); ctx.lineTo(sx(slope.b.x), sy(slope.b.y)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = col.accent; ctx.font = `600 11px ${css('--f-mono')}`; ctx.fillText(`${fmt(S.site.start)} m →`, sx(slope.a.x) + 6, sy(slope.a.y) - 10); }
  if (tool === 'sitebuild' && sbPts.length){ ctx.strokeStyle = col.accent; ctx.lineWidth = 2; ctx.beginPath(); sbPts.forEach((q, i) => i ? ctx.lineTo(sx(q.x), sy(q.y)) : ctx.moveTo(sx(q.x), sy(q.y))); if (cursorW) ctx.lineTo(sx(cursorW.x), sy(cursorW.y)); ctx.stroke(); sbPts.forEach(q => { ctx.beginPath(); ctx.arc(sx(q.x), sy(q.y), 3, 0, 7); ctx.fillStyle = col.accent; ctx.fill(); }); }
  if (tool === 'sitealign' && align.length){ ctx.fillStyle = col.accent; ctx.font = `600 11px ${css('--f-mono')}`; align.forEach((q, i) => { ctx.beginPath(); ctx.arc(sx(q.x), sy(q.y), 5, 0, 7); ctx.fill(); ctx.fillText(['A ritning', 'A plan', 'B ritning', 'B plan'][i], sx(q.x) + 8, sy(q.y) - 8); }); }
});

/* ---------- tools ---------- */
let slope = null, sbPts = [], align = [];
const SITE_TOOLS = [
  ['sitepick', 'Välj linje', 'Klicka på en linje eller byggnad från situationsplanen för att ändra höjd eller typ.', true],
  ['siteslope', 'Höjdlinje', 'Dra tvärs över höjdkurvorna från lägst till högst. De får höjder i tur och ordning från starthöjden med ekvidistansen.', true],
  ['sitebuild', 'Byggnad', 'Klicka hörn för hörn runt en byggnad. Klicka på första hörnet eller tryck Enter för att avsluta.', true],
  ['sitealign', 'Passa in', 'Klicka en punkt i situationsplanen (A), sedan samma punkt i husets planritning. Gör likadant med en andra punkt (B).', true],
  ['sitemove', 'Flytta', 'Dra för att flytta situationsplanen. Vrid den med fältet Vridning.', true],
];
TOOLS.push(...SITE_TOOLS);
HOOKS.tip.push(t => ({ sitealign:() => ['Klicka punkt A i situationsplanen', 'Klicka var punkt A ska ligga i husets plan', 'Klicka punkt B i situationsplanen', 'Klicka var punkt B ska ligga i husets plan'][align.length] || '', siteslope:() => 'Dra tvärs över höjdkurvorna, från lägst till högst', sitebuild:() => sbPts.length ? 'Klicka nästa hörn · Enter avslutar' : 'Klicka första hörnet', sitepick:() => 'Klicka på en linje eller byggnad', sitemove:() => 'Dra för att flytta situationsplanen' }[t]?.() || null));
HOOKS.toolDown.push((tl, p) => {
  if (!S.site) return null;
  if (tl === 'siteslope') return { kind:'custom', move:(q) => { slope = { a:{ x:p.x, y:p.y }, b:{ x:q.x, y:q.y } }; reqPlan(); }, end:(moved) => { if (moved && slope) applySlope(); slope = null; reqPlan(); } };
  if (tl === 'sitemove'){ const ox = S.site.tx, oy = S.site.ty; return { kind:'custom', move:(q, e, once) => { once(); S.site.tx = Math.round(ox + q.x - p.x); S.site.ty = Math.round(oy + q.y - p.y); reqPlan(); }, end:(moved) => { if (moved) siteChanged(); } }; }
  return null;
});
function applySlope(){
  const s = S.site, a = p2d(slope.a.x, slope.a.y), b = p2d(slope.b.x, slope.b.y), hits = [];
  let skipped = 0;
  s.lines.forEach(l => {
    if (!['contour', 'other'].includes(l.role) || polyLen(l.pts) < 300) return;
    // contour lines bend all the time; long straight pieces are site boundaries, road edges and the like
    if (l.role === 'other'){ let mx = 0; for (let i = 2; i < l.pts.length; i += 2) mx = Math.max(mx, Math.hypot(l.pts[i] - l.pts[i-2], l.pts[i+1] - l.pts[i-1])); if (mx > 800 && polyLen(l.pts)/(l.pts.length/2 - 1) > 400){ if (crosses(l, a, b)) skipped++; return; } }
    const p = l.pts; let tmin = Infinity;
    for (let i = 2; i < p.length; i += 2){ const t = segX(a.x, a.y, b.x, b.y, p[i-2], p[i-1], p[i], p[i+1]); if (t !== null) tmin = Math.min(tmin, t); }
    if (tmin < Infinity) hits.push([tmin, l]);
  });
  if (!hits.length){ toast('Linjen korsade inga höjdkurvor.'); return; }
  pushUndo(); hits.sort((x, y) => x[0] - y[0]);
  hits.forEach(([, l], i) => { l.role = 'contour'; l.z = Math.round((s.start + i*s.interval)*100)/100; l.est = false; });
  s.lines.filter(l => l.est).forEach(l => { l.z = null; l.est = false; }); estimateContours();
  toast(`${hits.length} höjdkurvor fick höjder ${fmt(s.start)}–${fmt(s.start + (hits.length - 1)*s.interval)} m.` + (skipped ? ` ${skipped} långa raka linjer hoppades över (troligen tomtgräns eller vägkant).` : ''));
  siteChanged();
}
function crosses(l, a, b){ const p = l.pts; for (let i = 2; i < p.length; i += 2) if (segX(a.x, a.y, b.x, b.y, p[i-2], p[i-1], p[i], p[i+1]) !== null) return true; return false; }
function segX(ax, ay, bx, by, cx, cy, dx, dy){ const r = bx - ax, s2 = by - ay, u = dx - cx, v = dy - cy, den = r*v - s2*u; if (Math.abs(den) < 1e-9) return null; const t = ((cx - ax)*v - (cy - ay)*u)/den, w = ((cx - ax)*s2 - (cy - ay)*r)/den; return t >= 0 && t <= 1 && w >= 0 && w <= 1 ? t : null; }
HOOKS.toolClick.push((tl, p, raw) => {
  if (!tl.startsWith('site')) return false;
  if (!S.site){ toast('Importera en situationsplan först.'); return true; }
  const s = S.site;
  if (tl === 'sitepick'){
    const d = p2d(raw.x, raw.y), tolD = 8/(pv.z*s.k);
    let best = null, bd = tolD; s.lines.forEach(l => { const dd = lineDist(l, d.x, d.y); if (dd < bd){ bd = dd; best = l; } });
    if (best){ select({ kind:'sline', id:best.id }); return true; }
    const b = s.buildings.find(b => inPoly(b.pts, d.x, d.y)); if (b){ select({ kind:'sbld', id:b.id }); return true; }
    select(null); return true;
  }
  if (tl === 'sitebuild'){
    if (sbPts.length > 2 && Math.hypot(sx(sbPts[0].x) - sx(raw.x), sy(sbPts[0].y) - sy(raw.y)) < 10){ finishBuilding(); return true; }
    sbPts.push({ x:raw.x, y:raw.y }); showTip(); reqPlan(); return true;
  }
  if (tl === 'sitealign'){
    align.push({ x:raw.x, y:raw.y }); showTip(); reqPlan();
    if (align.length === 4){
      const A = p2d(align[0].x, align[0].y), B = p2d(align[2].x, align[2].y), At = align[1], Bt = align[3];
      const ang = Math.atan2(Bt.y - At.y, Bt.x - At.x) - Math.atan2((B.y - A.y), (B.x - A.x)), ratio = Math.hypot(Bt.x - At.x, Bt.y - At.y)/(Math.hypot(B.x - A.x, B.y - A.y)*s.k);
      pushUndo(); s.rot = Math.round(deg(ang)*100)/100;
      if ($('#siteScaleToo').checked) s.k = s.k*ratio;
      const q = d2p(A.x, A.y); s.tx += At.x - q.x; s.ty += At.y - q.y;
      align = []; setTool('select'); siteChanged();
      toast(Math.abs(ratio - 1) > 0.02 && !$('#siteScaleToo').checked ? `Inpassad. Avstånden skiljer ${fmt(Math.abs(ratio - 1)*100)} %, kontrollera skalan eller kryssa i “Justera skalan”.` : 'Situationsplanen är inpassad mot huset.');
    }
    return true;
  }
  return true;
});
function inPoly(p, x, y){ let c = false; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2){ if ((p[i+1] > y) !== (p[j+1] > y) && x < (p[j] - p[i])*(y - p[i+1])/(p[j+1] - p[i+1]) + p[i]) c = !c; } return c; }
function finishBuilding(){
  if (sbPts.length >= 3){ pushUndo(); const pts = []; sbPts.forEach(q => { const d = p2d(q.x, q.y); pts.push(Math.round(d.x), Math.round(d.y)); }); const b = { id:uid(), pts, h:600, name:'Byggnad ' + (S.site.buildings.length + 1) }; S.site.buildings.push(b); siteChanged(); select({ kind:'sbld', id:b.id }); }
  sbPts = []; showTip(); reqPlan();
}
HOOKS.key.push(e => { if (tool === 'sitebuild' && e.key === 'Enter'){ finishBuilding(); return true; } return false; });
HOOKS.tools.push(() => { if (tool !== 'sitebuild') sbPts = []; if (tool !== 'sitealign') align = []; });

/* ---------- inspector for site lines and buildings ---------- */
HOOKS.inspector.push(s2 => {
  if (!S.site || !['sline', 'sbld'].includes(s2.kind)) return null;
  if (s2.kind === 'sline'){
    const l = S.site.lines.find(x => x.id === s2.id); if (!l) return null;
    return `<section class="sec"><div class="insp-title"><span class="kind">Linje från situationsplanen</span></div>
      <label class="f">Typ<select data-k="sl:role">${ROLES.filter(r => r[0] !== 'ignore').map(([k, n]) => `<option value="${k}" ${k === l.role ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      ${l.role === 'contour' ? `<label class="f">Höjd (m)<input type="number" step="0.1" data-k="sl:z" value="${l.z ?? ''}" placeholder="okänd"></label>
        <div class="hint">${l.z == null ? 'Höjden är okänd.' : l.est ? 'Höjden är uppskattad från grannkurvorna. Skriv in den rätta höjden om du vet den.' : 'Höjden kommer från ritningen eller är inmatad.'} Längd ${fmt(polyLen(l.pts)/100)} m.</div>` : ''}
      <div class="row"><button class="btn small danger" data-act="del">Ta bort linjen</button></div></section>`;
  }
  const b = S.site.buildings.find(x => x.id === s2.id); if (!b) return null;
  return `<section class="sec"><div class="insp-title"><span class="kind">Byggnad på tomten</span></div>
    <label class="f">Namn<input type="text" data-k="sb:name" value="${esc(b.name)}"></label>
    <div class="grid2">${nf('Höjd (m)', 'sb:h', b.h/100, 'min="1" step="0.5"')}<div></div></div>
    <div class="hint">Byggnaden ställs på den lägsta markpunkten under sig. Rita in husets egna våningar i planen som vanligt.</div>
    <div class="row"><button class="btn small danger" data-act="del">Ta bort byggnaden</button></div></section>`;
});
HOOKS.field.push((k, v, ev) => {
  if (!/^s[lb]:/.test(k) || ev !== 'change' || !S.site) return !!/^s[lb]:/.test(k);
  pushUndo();
  if (k.startsWith('sl:')){ const l = S.site.lines.find(x => x.id === sel?.id); if (!l) return true;
    if (k === 'sl:role') l.role = v;
    if (k === 'sl:z'){ l.z = v === '' ? null : num(v, l.z); l.est = false; S.site.lines.filter(x => x.est).forEach(x => { x.z = null; x.est = false; }); estimateContours(); } }
  else { const b = S.site.buildings.find(x => x.id === sel?.id); if (!b) return true; if (k === 'sb:name') b.name = v.slice(0, 40) || b.name; if (k === 'sb:h') b.h = clamp(num(v, b.h/100), 0.5, 200)*100; }
  siteChanged(); renderInspector(); return true;
});
HOOKS.del.push(s2 => {
  if (!S.site || !['sline', 'sbld'].includes(s2.kind)) return false;
  if (s2.kind === 'sline') S.site.lines = S.site.lines.filter(l => l.id !== s2.id); else S.site.buildings = S.site.buildings.filter(b => b.id !== s2.id);
  siteChanged(); return true;
});

/* ---------- left panel ---------- */
function renderSitePanel(){
  const s = S?.site, has = !!s;
  $('#siteCtl').hidden = !has; $('#bSiteDel').hidden = !has; $('#sitePill').textContent = has ? '1:' + s.scale : 'ingen'; $('#sitePill').classList.toggle('on', has);
  if (!has) return;
  $('#siteRef').value = s.ref ?? ''; $('#siteInt').value = s.interval; $('#siteRot').value = s.rot; $('#siteStart').value = s.start;
  ['image', 'lines', 'terrain', 'drape'].forEach(k => { $('#siteShow_' + k).checked = !!s.show[k]; });
  const c = s.lines.filter(l => l.role === 'contour'), known = c.filter(l => l.z != null && !l.est).length, est = c.filter(l => l.est).length, unk = c.filter(l => l.z == null).length;
  $('#siteStat').textContent = `${c.length} höjdkurvor: ${known} med känd höjd, ${est} uppskattade, ${unk} utan höjd · ${s.buildings.length} byggnader${terrain ? ` · terräng ${fmt((terrain.nx - 1)*terrain.cell/100)} × ${fmt((terrain.ny - 1)*terrain.cell/100)} m` : ''}`;
}
function fitSite(){ const s = S.site; if (!s) return; const c = d2p(s.w/2, s.h/2); pv.cx = c.x; pv.cy = c.y; pv.z = clamp(Math.min((planCv.clientWidth - 60)/(s.w*s.k), (planCv.clientHeight - 60)/(s.h*s.k)), 0.01, 6); reqPlan(); }
$('#bSitePdf').addEventListener('click', () => $('#fSitePdf').click());
$('#fSitePdf').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importSitePdf(f); });
$('#bSiteDel').addEventListener('click', e => confirmBtn(e.currentTarget, 'Ta bort situationsplanen?', () => { pushUndo(); S.site = null; terrain = null; if (siteG) disposeGroup(siteG); scheduleFloor(); changed(); renderSitePanel(); }));
$('#bSiteFit').addEventListener('click', () => { setView('plan'); fitSite(); });
const siteNum = (id, key, f) => $(id).addEventListener('change', e => { if (!S.site) return; pushUndo(); S.site[key] = f(num(e.target.value, S.site[key])); if (key === 'interval'){ S.site.lines.filter(x => x.est).forEach(x => { x.z = null; x.est = false; }); estimateContours(); } siteChanged(); });
siteNum('#siteRef', 'ref', v => Math.round(v*100)/100);
siteNum('#siteInt', 'interval', v => clamp(v, 0.05, 50));
siteNum('#siteRot', 'rot', v => ((v % 360) + 360) % 360);
siteNum('#siteStart', 'start', v => Math.round(v*100)/100);
['image', 'lines', 'terrain', 'drape'].forEach(k => $('#siteShow_' + k).addEventListener('change', e => { if (!S.site) return; S.site.show[k] = e.target.checked; siteChanged(); }));
document.querySelectorAll('#siteTools [data-tool]').forEach(b => b.addEventListener('click', () => { if (!S.site){ toast('Importera en situationsplan först.'); setTool('select'); } }));
$('#siteRotL').addEventListener('click', () => { if (!S.site) return; pushUndo(); S.site.rot = (((S.site.rot - 1) % 360) + 360) % 360; siteChanged(); });
$('#siteRotR').addEventListener('click', () => { if (!S.site) return; pushUndo(); S.site.rot = (S.site.rot + 1) % 360; siteChanged(); });
