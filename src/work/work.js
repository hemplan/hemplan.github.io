/* ============================== work version: cameras and alarm devices ==============================
   Uses the core through HOOKS (see the top of app.js). Everything here only exists in the work build. */
const DEV_TYPES = {
  camera:  { label:'Kamera',           short:'K',  color:'#d4402b', z:260, kind:'camera' },
  pir:     { label:'IR-detektor',      short:'IR', color:'#2b7bd4', z:220, kind:'wedge',  range:12, angle:90 },
  glass:   { label:'Glaskross',        short:'GK', color:'#7a4fd0', z:220, kind:'circle', range:9 },
  smoke:   { label:'Brandvarnare',     short:'BV', color:'#e08a1e', z:248, kind:'circle', range:5, ceiling:true },
  contact: { label:'Magnetkontakt',    short:'MK', color:'#3a8f5a', z:200, kind:null },
  panel:   { label:'Manöverpanel',     short:'MP', color:'#4a5560', z:150, kind:null },
  central: { label:'Centralapparat',   short:'CA', color:'#4a5560', z:170, kind:null },
  siren:   { label:'Siren',            short:'S',  color:'#c2185b', z:240, kind:null },
  reader:  { label:'Kortläsare',       short:'KL', color:'#5b5f63', z:110, kind:null },
};
// Approximate active sensor sizes (width × height, mm). A datasheet's field of view is more exact.
const SENSORS = { '1/3" (4:3)':[4.8, 3.6], '1/2.9"':[5.1, 2.9], '1/2.8"':[5.6, 3.2], '1/2.7"':[5.9, 3.3], '1/2"':[7.0, 3.9], '1/1.8"':[7.8, 4.4], '1/1.2"':[11.1, 6.2] };
const RESOLUTIONS = [['2 MP', 1920, 1080], ['4 MP', 2560, 1440], ['5 MP', 2592, 1944], ['6 MP', 3072, 2048], ['8 MP (4K)', 3840, 2160], ['12 MP', 4000, 3000]];
// Pixels per metre on the target, EN 62676-4: detect, observe, recognise, identify
const DORI = [['D', 'Detektera', 25, '#7cb342'], ['O', 'Observera', 62.5, '#f9a825'], ['R', 'Känna igen', 125, '#ef6c00'], ['I', 'Identifiera', 250, '#c62828']];
let devType = 'camera';

HOOKS.normalize.push(o => {
  o.devices = Array.isArray(o.devices) ? o.devices : [];
  o.work = Object.assign({ target:100, show:true }, o.work || {});
});
const devById = id => S.devices.find(d => d.id === id);
const DT = d => DEV_TYPES[d.type] || DEV_TYPES.panel;

function camFov(d){
  let h, v;
  if (d.fovMode === 'fov'){ h = clamp(d.hfov || 90, 5, 179); v = deg(2*Math.atan(Math.tan(rad(h)/2) * d.resH/d.resW)); }
  else { const [sw, sh] = SENSORS[d.sensor] || SENSORS['1/2.8"'], f = Math.max(0.5, d.focal || 2.8); h = deg(2*Math.atan(sw/(2*f))); v = deg(2*Math.atan(sh/(2*f))); }
  return { h, v };
}
// distance (cm) where the camera still gives p pixels per metre across the image width
const doriDist = (d, p) => d.resW / (2*p*Math.tan(rad(camFov(d).h)/2)) * 100;

function newDevice(type, x, y, a){
  const t = DEV_TYPES[type], n = S.devices.filter(d => d.type === type).length + 1;
  const d = { id:uid(), type, name:t.short + n, x:r1(x), y:r1(y), z:t.z, a:Math.round(a || 0), note:'' };
  if (type === 'camera') Object.assign(d, { tilt:25, fovMode:'lens', focal:2.8, sensor:'1/2.8"', hfov:100, resW:2560, resH:1440 });
  if (t.range) d.range = t.range;
  if (t.angle) d.angle = t.angle;
  return d;
}

/* ---------- 2D visibility: rays against wall faces (open doors and doorways let the view through) ---------- */
let obstacleCache = null;
function obstacles(){
  const key = S.walls.length + ':' + S.openings.map(o => o.type + ((o.open ?? 1) > 0.5 ? 1 : 0) + o.off + o.w).join(',') + S.walls.map(w => w.a.x + w.a.y + w.b.x + w.b.y + w.t).join(',');
  if (obstacleCache?.key === key) return obstacleCache.segs;
  const segs = [];
  S.walls.forEach(w => {
    const g = wg(w), t2 = w.t/2;
    const gaps = S.openings.filter(o => o.wall === w.id && (o.type === 'opening' || (o.type === 'door' && (o.open ?? 1) > 0.5))).map(o => [o.off - o.w/2, o.off + o.w/2]).sort((a, b) => a[0] - b[0]);
    let cur = -t2; const solid = [];
    gaps.forEach(([s0, s1]) => { if (s0 > cur) solid.push([cur, s0]); cur = Math.max(cur, s1); });
    if (cur < g.len + t2) solid.push([cur, g.len + t2]);
    solid.forEach(([s0, s1]) => {
      const P = (s, k) => ({ x:w.a.x + g.ux*s + g.nx*k, y:w.a.y + g.uy*s + g.ny*k });
      const a = P(s0, -t2), b = P(s1, -t2), c = P(s1, t2), e = P(s0, t2);
      segs.push([a, b], [b, c], [c, e], [e, a]);
    });
  });
  obstacleCache = { key, segs };
  return segs;
}
function rayHit(ox, oy, dx, dy, maxD, segs){
  let best = maxD;
  for (const [p, q] of segs){
    const ex = q.x - p.x, ey = q.y - p.y, den = dx*ey - dy*ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((p.x - ox)*ey - (p.y - oy)*ex)/den, u = ((p.x - ox)*dy - (p.y - oy)*dx)/den;
    if (t > 0.5 && u >= 0 && u <= 1 && t < best) best = t;
  }
  return best;
}
// one ring per zone: [near, far] along each ray, cut by walls
function coverage(d){
  const t = DT(d), segs = obstacles();
  let span, far, near = 0, zones;
  if (t.kind === 'camera'){
    const f = camFov(d), hz = d.z - S.work.target, lo = d.tilt - f.v/2, hi = d.tilt + f.v/2;
    span = f.h;
    if (hz > 0){ near = hi >= 89.5 ? 0 : (hi <= 0 ? Infinity : hz/Math.tan(rad(hi))); far = lo <= 0.2 ? Infinity : hz/Math.tan(rad(lo)); }
    else { near = 0; far = Infinity; }
    zones = DORI.map(([k, , p, col]) => ({ k, col, r:Math.min(far, doriDist(d, p)) }));
  } else if (t.kind === 'wedge'){ span = d.angle || 90; zones = [{ k:'', col:t.color, r:(d.range || 10)*100 }]; }
  else if (t.kind === 'circle'){ span = 360; zones = [{ k:'', col:t.color, r:(d.range || 5)*100 }]; }
  else return null;
  const maxR = Math.max(...zones.map(z => z.r)), n = Math.max(16, Math.round(span/1.5)), rays = [];
  for (let i = 0; i <= n; i++){
    const ang = rad(d.a - span/2 + span*i/n), dx = Math.cos(ang), dy = Math.sin(ang);
    rays.push({ dx, dy, hit:rayHit(d.x, d.y, dx, dy, Math.min(maxR, 1e6), segs) });
  }
  return { rays, zones, near, span };
}

/* ---------- plan drawing ---------- */
HOOKS.planUnder.push((ctx) => {
  if (!S.work.show && sel?.kind !== 'dev') return;
  S.devices.forEach(d => {
    if (!S.work.show && sel?.id !== d.id) return;
    const cv = coverage(d); if (!cv) return;
    const isSel = sel?.kind === 'dev' && sel.id === d.id;
    cv.zones.forEach(z => {
      if (!(z.r > cv.near)) return;
      ctx.beginPath();
      cv.rays.forEach((r, i) => { const L = Math.min(r.hit, z.r); const X = sx(d.x + r.dx*L), Y = sy(d.y + r.dy*L); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
      for (let i = cv.rays.length - 1; i >= 0; i--){ const r = cv.rays[i], L = Math.min(r.hit, cv.near); ctx.lineTo(sx(d.x + r.dx*L), sy(d.y + r.dy*L)); }
      ctx.closePath();
      ctx.globalAlpha = isSel ? 0.26 : 0.14; ctx.fillStyle = z.col; ctx.fill('evenodd'); ctx.globalAlpha = 1;
    });
    if (isSel && cv.near > 0 && isFinite(cv.near)){
      ctx.save(); ctx.setLineDash([4, 4]); ctx.strokeStyle = DT(d).color; ctx.lineWidth = 1; ctx.beginPath();
      ctx.arc(sx(d.x), sy(d.y), cv.near*pv.z, rad(d.a - cv.span/2), rad(d.a + cv.span/2)); ctx.stroke(); ctx.restore();
    }
  });
});
function devHandle(d){ const L = 34; return { x:sx(d.x) + Math.cos(rad(d.a))*L, y:sy(d.y) + Math.sin(rad(d.a))*L }; }
HOOKS.planOver.push((ctx, col) => {
  S.devices.forEach(d => {
    const t = DT(d), X = sx(d.x), Y = sy(d.y), isSel = sel?.kind === 'dev' && sel.id === d.id;
    if (t.kind === 'camera' || t.kind === 'wedge'){ ctx.strokeStyle = t.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X + Math.cos(rad(d.a))*16, Y + Math.sin(rad(d.a))*16); ctx.stroke(); }
    ctx.beginPath(); ctx.arc(X, Y, 9, 0, 7); ctx.fillStyle = t.color; ctx.fill(); ctx.lineWidth = isSel ? 3 : 1.5; ctx.strokeStyle = isSel ? col.accent : col.paper; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = `600 ${t.short.length > 1 ? 8 : 9}px ${css('--f-mono')}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t.short, X, Y + 0.5);
    ctx.font = `500 10.5px ${css('--f-mono')}`; ctx.fillStyle = isSel ? col.accent : col.ink;
    const tw = ctx.measureText(d.name).width + 6; ctx.globalAlpha = .85; ctx.fillStyle = col.paper; ctx.fillRect(X - tw/2, Y + 11, tw, 13); ctx.globalAlpha = 1;
    ctx.fillStyle = isSel ? col.accent : col.ink; ctx.fillText(d.name, X, Y + 18);
    if (isSel && (t.kind === 'camera' || t.kind === 'wedge')){ const h = devHandle(d); ctx.beginPath(); ctx.arc(h.x, h.y, 6, 0, 7); ctx.fillStyle = col.accent; ctx.fill(); }
  });
});

/* ---------- placing, selecting, moving ---------- */
function wallSnap(p, maxPx = 26){
  let best = null, bd = Infinity;
  S.walls.forEach(w => { const r = segDist(p, w.a, w.b); if (r.t >= 0 && r.t <= 1 && r.d < bd){ bd = r.d; best = { w, r }; } });
  if (!best || bd > best.w.t/2 + maxPx/pv.z) return null;
  const g = wg(best.w), side = ((p.x - best.w.a.x)*g.nx + (p.y - best.w.a.y)*g.ny) >= 0 ? 1 : -1, off = best.w.t/2 + 4, s = clamp(best.r.s, 0, g.len);
  return { x:r1(best.w.a.x + g.ux*s + g.nx*side*off), y:r1(best.w.a.y + g.uy*s + g.ny*side*off), a:Math.round(deg(Math.atan2(g.ny*side, g.nx*side))) };
}
HOOKS.toolClick.push((tl, p, raw) => {
  if (tl !== 'device') return false;
  const t = DEV_TYPES[devType], sn = t.ceiling ? null : wallSnap(raw);
  pushUndo();
  const d = newDevice(devType, sn ? sn.x : raw.x, sn ? sn.y : raw.y, sn ? sn.a : 0);
  S.devices.push(d); devChanged(); select({ kind:'dev', id:d.id });
  return true;
});
HOOKS.hit.push(p => {
  if (sel?.kind === 'dev'){ const d = devById(sel.id); if (d && ['camera', 'wedge'].includes(DT(d).kind)){ const h = devHandle(d); if (Math.hypot(h.x - p.px, h.y - p.py) < 10) return dragRotate(d); } }
  for (let i = S.devices.length - 1; i >= 0; i--){ const d = S.devices[i]; if (Math.hypot(sx(d.x) - p.px, sy(d.y) - p.py) < 11) return dragMove(d, p); }
  return null;
});
function dragMove(d, p0){
  const ox = d.x, oy = d.y;
  return { kind:'custom', down:() => select({ kind:'dev', id:d.id }),
    move:(p, e, once) => { once(); const raw = { x:ox + (p.x - p0.x), y:oy + (p.y - p0.y) }, sn = (DT(d).ceiling || e.altKey) ? null : wallSnap(raw, 14);
      if (sn){ d.x = sn.x; d.y = sn.y; d.a = sn.a; } else { d.x = Math.round(raw.x); d.y = Math.round(raw.y); } devChanged(true); },
    end:(moved) => { if (moved){ devChanged(); renderInspector(); } } };
}
function dragRotate(d){
  return { kind:'custom', move:(p, e, once) => { once(); const a = deg(Math.atan2(p.y - d.y, p.x - d.x)), st = e.altKey ? 1 : 5; d.a = ((Math.round(a/st)*st) % 360 + 360) % 360; devChanged(true); },
    end:(moved) => { if (moved){ devChanged(); renderInspector(); } } };
}
HOOKS.del.push(s => { if (s.kind !== 'dev') return false; S.devices = S.devices.filter(d => d.id !== s.id); devChanged(); return true; });
HOOKS.key.push(e => {
  if (sel?.kind !== 'dev') return false;
  const d = devById(sel.id); if (!d) return false;
  if (e.code === 'KeyD' && !e.shiftKey && !e.altKey){ e.preventDefault(); dupDevice(d); return true; }
  if (e.code === 'KeyR'){ pushUndo(); d.a = (((d.a + (e.shiftKey ? -15 : 15)) % 360) + 360) % 360; devChanged(); renderInspector(); return true; }
  if (e.key.startsWith('Arrow')){ e.preventDefault(); if (!e.repeat) pushUndo(); const st = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft') d.x -= st; if (e.key === 'ArrowRight') d.x += st; if (e.key === 'ArrowUp') d.y -= st; if (e.key === 'ArrowDown') d.y += st; devChanged(); return true; }
  return false;
});
function dupDevice(d){ pushUndo(); const n = clone(d); n.id = uid(); n.x += 40; n.y += 40; n.name = DT(d).short + (S.devices.filter(q => q.type === d.type).length + 1); S.devices.push(n); devChanged(); select({ kind:'dev', id:n.id }); }

/* ---------- inspector ---------- */
HOOKS.inspector.push(s => {
  if (s.kind !== 'dev') return null;
  const d = devById(s.id); if (!d){ sel = null; return null; }
  const t = DT(d), cam = t.kind === 'camera', f = cam ? camFov(d) : null;
  const res = RESOLUTIONS.find(r => r[1] === d.resW && r[2] === d.resH);
  let html = `<section class="sec">
    <div class="insp-title"><span class="kind" style="color:${t.color}">${esc(t.label)}</span></div>
    <label class="f">Namn<input type="text" data-k="dev:name" value="${esc(d.name)}"></label>
    <div class="grid3">${nf('X', 'dev:x', d.x)}${nf('Y', 'dev:y', d.y)}${nf('Höjd (cm)', 'dev:z', d.z, 'min="0"')}</div>
    ${t.kind === 'camera' || t.kind === 'wedge' ? `<div class="grid2">${nf('Riktning °', 'dev:a', d.a)}${cam ? nf('Lutning nedåt °', 'dev:tilt', d.tilt, 'min="-30" max="90"') : '<div></div>'}</div>
    <div class="row"><button class="btn small" data-act="dev-rot--15">↺ 15°</button><button class="btn small" data-act="dev-rot-15">↻ 15°</button></div>` : ''}
  </section>`;
  if (cam){
    html += `<section class="sec"><h3>Optik</h3>
      <label class="f">Ange<select data-k="dev:fovMode"><option value="lens" ${d.fovMode !== 'fov' ? 'selected' : ''}>Brännvidd och sensor</option><option value="fov" ${d.fovMode === 'fov' ? 'selected' : ''}>Synfält från datablad</option></select></label>
      ${d.fovMode === 'fov' ? `<div class="grid2">${nf('Horisontellt synfält °', 'dev:hfov', d.hfov, 'min="5" max="179"')}<div></div></div>`
        : `<div class="grid2"><label class="f">Brännvidd (mm)<input type="number" data-k="dev:focal" value="${d.focal}" step="0.1" min="0.5" list="focals"></label>
           <label class="f">Sensor<select data-k="dev:sensor">${Object.keys(SENSORS).map(k => `<option ${k === d.sensor ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></label></div>
           <datalist id="focals">${[2.8, 3.6, 4, 6, 8, 12].map(v => `<option value="${v}">`).join('')}</datalist>`}
      <label class="f">Upplösning<select data-k="dev:res">${RESOLUTIONS.map(([n, w, h]) => `<option value="${w}x${h}" ${res && res[1] === w && res[2] === h ? 'selected' : ''}>${n} · ${w}×${h}</option>`).join('')}${res ? '' : `<option selected>${d.resW}×${d.resH}</option>`}</select></label>
      <div class="hint">Synfält: ${fmt(f.h)}° × ${fmt(f.v)}°${d.fovMode !== 'fov' ? ' (ungefärligt, beräknat från sensorstorlek)' : ''}.</div>
      <div class="dori">${DORI.map(([k, n, p, c]) => `<i style="background:${c}"></i><span>${n} (${p} px/m)</span><b>${fmt(doriDist(d, p)/100)} m</b>`).join('')}</div>
      ${(() => { const cv = coverage(d); return cv.near > 0 && isFinite(cv.near) ? `<div class="hint">Död vinkel under kameran: ${fmt(cv.near/100)} m vid analyshöjd ${S.work.target} cm.</div>` : ''; })()}
      <div class="hint">Avstånden gäller mitt i bilden. Analyshöjden ställer du in under Utrustning.</div>
    </section>`;
  } else if (t.kind){
    html += `<section class="sec"><h3>Täckning</h3><div class="grid2">${nf('Räckvidd (m)', 'dev:range', d.range, 'min="0.5" step="0.5"')}${t.kind === 'wedge' ? nf('Vinkel °', 'dev:angle', d.angle, 'min="10" max="360"') : '<div></div>'}</div>
      <div class="hint">Använd värdena från tillverkarens datablad och gällande regler för installationen.</div></section>`;
  }
  html += `<section class="sec"><label class="f">Anteckning<textarea data-k="dev:note" placeholder="t.ex. modell, kabeldragning, zon">${esc(d.note || '')}</textarea></label>
    <div class="row"><button class="btn small" data-act="dev-dup">Duplicera</button><button class="btn small danger" data-act="del">Ta bort</button></div></section>`;
  return html;
});
HOOKS.field.push((k, v, ev) => {
  if (!k.startsWith('dev:') || sel?.kind !== 'dev') return false;
  const d = devById(sel.id); if (!d) return true;
  if (ev !== 'change') return true;
  const f = k.slice(4); pushUndo();
  if (f === 'name') d.name = v.slice(0, 40) || DT(d).short;
  else if (f === 'note') d.note = v.slice(0, 500);
  else if (f === 'fovMode') d.fovMode = v;
  else if (f === 'sensor') d.sensor = v;
  else if (f === 'res'){ const m = v.match(/(\d+)\D+(\d+)/); if (m){ d.resW = +m[1]; d.resH = +m[2]; } }
  else if (f === 'a') d.a = ((num(v, d.a) % 360) + 360) % 360;
  else if (f === 'tilt') d.tilt = clamp(num(v, d.tilt), -30, 90);
  else if (f === 'focal') d.focal = clamp(num(v, d.focal), 0.5, 300);
  else if (f === 'hfov') d.hfov = clamp(num(v, d.hfov), 5, 179);
  else if (f === 'range') d.range = clamp(num(v, d.range), 0.5, 500);
  else if (f === 'angle') d.angle = clamp(num(v, d.angle), 10, 360);
  else if (['x', 'y', 'z'].includes(f)) d[f] = num(v, d[f]);
  devChanged(); renderInspector();
  return true;
});
HOOKS.act.push(a => {
  if (sel?.kind !== 'dev') return false;
  const d = devById(sel.id); if (!d) return false;
  if (a.startsWith('dev-rot')){ pushUndo(); d.a = (((d.a + num(a.slice(8))) % 360) + 360) % 360; devChanged(); renderInspector(); return true; }
  if (a === 'dev-dup'){ dupDevice(d); return true; }
  return false;
});

/* ---------- left panel ---------- */
function renderDevPanel(){
  $('#devTypes').innerHTML = Object.entries(DEV_TYPES).map(([k, t]) => `<button data-devtype="${k}" aria-pressed="${tool === 'device' && devType === k}" title="${esc(t.label)}"><span class="devdot" style="background:${t.color}">${t.short}</span><span>${esc(t.label)}</span></button>`).join('');
  $('#devList').innerHTML = S.devices.map(d => `<button data-devsel="${d.id}" aria-current="${sel?.kind === 'dev' && sel.id === d.id}"><span class="devdot" style="background:${DT(d).color}">${DT(d).short}</span><span class="dn">${esc(d.name)}</span><span class="dt">${DT(d).kind === 'camera' ? fmt(camFov(d).h) + '°' : d.range ? d.range + ' m' : ''}</span></button>`).join('') || '<div class="hint">Ingen utrustning utplacerad ännu.</div>';
  $('#devCount').textContent = S.devices.length;
  $('#devTarget').value = S.work.target; $('#devShow').checked = S.work.show;
}
$('#devTypes').addEventListener('click', e => { const b = e.target.closest('[data-devtype]'); if (!b) return; devType = b.dataset.devtype; setTool('device'); renderDevPanel(); });
$('#devList').addEventListener('click', e => { const b = e.target.closest('[data-devsel]'); if (!b) return; const d = devById(b.dataset.devsel); if (!d) return; if (view !== 'plan') setView('plan'); pv.cx = d.x; pv.cy = d.y; select({ kind:'dev', id:d.id }); });
$('#devTarget').addEventListener('change', e => { S.work.target = clamp(num(e.target.value, 100), 0, 300); devChanged(); renderInspector(); });
$('#devShow').addEventListener('change', e => { S.work.show = e.target.checked; devChanged(); });
$('#bDevCsv').addEventListener('click', () => {
  if (!S.devices.length){ toast('Det finns ingen utrustning att exportera ännu.'); return; }
  const n = v => String(v ?? '').replace(/\./g, ',');
  const rows = [['Nr', 'Typ', 'Namn', 'X (m)', 'Y (m)', 'Höjd (m)', 'Riktning (°)', 'Lutning (°)', 'Brännvidd (mm)', 'Synfält H (°)', 'Upplösning', 'Identifiera (m)', 'Räckvidd (m)', 'Anteckning']];
  S.devices.forEach((d, i) => { const cam = DT(d).kind === 'camera';
    rows.push([i + 1, DT(d).label, d.name, n(r1(d.x/100)), n(r1(d.y/100)), n(r1(d.z/100)), DT(d).kind === 'camera' || DT(d).kind === 'wedge' ? Math.round(d.a) : '', cam ? d.tilt : '', cam && d.fovMode !== 'fov' ? n(d.focal) : '', cam ? n(r1(camFov(d).h)) : '', cam ? `${d.resW}x${d.resH}` : '', cam ? n(r1(doriDist(d, 250)/100)) : '', d.range ? n(d.range) : '', d.note || '']); });
  const csv = '﻿' + rows.map(r => r.map(c => /[;"\n]/.test(String(c)) ? '"' + String(c).replace(/"/g, '""') + '"' : c).join(';')).join('\r\n');
  saveFile((S.name || 'projekt').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '-utrustning.csv', csv, 'Utrustningslistan är exporterad.');
});
TOOLS.push(['device', 'Utrustning', 'Klicka i planen för att placera vald utrustning. Nära en vägg fästs den på väggen. Alt = ingen väggfästning.']);
IC.device = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="8" width="12" height="8" rx="2"/><path d="M15 11l5-3v8l-5-3"/><circle cx="7" cy="12" r="1.5" fill="currentColor"/></svg>';
HOOKS.afterLoad.push(renderDevPanel);
HOOKS.tools.push(() => { if ($('#devTypes')) renderDevPanel(); });
HOOKS.select.push(() => renderDevPanel());

/* ---------- 3D: device models, coverage on the floor, camera picture-in-picture ---------- */
let devG = null, covG = null;
function ensureGroups(){ if (!ok3d || !scene) return false; if (!devG){ devG = new THREE.Group(); covG = new THREE.Group(); scene.add(devG, covG); } return true; }
function camDir(d){ const a = rad(d.a), t = rad(d.tilt || 0); return new THREE.Vector3(Math.cos(a)*Math.cos(t), -Math.sin(t), Math.sin(a)*Math.cos(t)); }
function buildDevices3D(){
  if (!ensureGroups()) return;
  [devG, covG].forEach(g => { g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.userData?.own) o.material.dispose(); }); while (g.children.length) g.remove(g.children[0]); });
  S.devices.forEach(d => {
    const t = DT(d), g = new THREE.Group(); g.position.set(d.x, d.z, d.y); g.userData.devId = d.id;
    const body = mat(t.color), dark = mat('#222222');
    if (t.kind === 'camera'){
      const housing = new THREE.Mesh(new THREE.BoxGeometry(16, 8, 8), mat('#f2f2f0')); housing.position.x = 4;
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 2, 16).rotateZ(Math.PI/2), dark); lens.position.x = 12.5;
      const head = new THREE.Group(); head.add(housing, lens); head.rotation.set(0, -rad(d.a), -rad(d.tilt || 0), 'YXZ');
      const mount = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 8, 8), body); mount.position.y = 4;
      g.add(head, mount);
      // frustum outline
      const f = camFov(d), L = Math.min(doriDist(d, 25), 3000), hw = Math.tan(rad(f.h)/2)*L, hh = Math.tan(rad(f.v)/2)*L;
      const pts = [[0, 0, 0], [L, hh, hw], [0, 0, 0], [L, hh, -hw], [0, 0, 0], [L, -hh, hw], [0, 0, 0], [L, -hh, -hw], [L, hh, hw], [L, hh, -hw], [L, hh, -hw], [L, -hh, -hw], [L, -hh, -hw], [L, -hh, hw], [L, -hh, hw], [L, hh, hw]];
      const lg = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
      const lm = new THREE.LineBasicMaterial({ color:t.color, transparent:true, opacity:0.55 }); lm.userData.own = true;
      const lines = new THREE.LineSegments(lg, lm); lines.rotation.copy(head.rotation); lines.userData.frustum = true; g.add(lines);
    } else {
      const m = new THREE.Mesh(t.ceiling ? new THREE.CylinderGeometry(6, 6, 4, 18) : new THREE.BoxGeometry(8, 11, 4), body);
      if (!t.ceiling) m.rotation.y = -rad(d.a) + Math.PI/2;
      g.add(m);
    }
    g.traverse(o => { if (o.isMesh) o.castShadow = false; });
    devG.add(g);
  });
  // coverage on the floor
  if (S.work.show) S.devices.forEach(d => {
    const cv = coverage(d); if (!cv) return;
    cv.zones.forEach((z, zi) => {
      if (!(z.r > cv.near)) return;
      const sh = new THREE.Shape();
      cv.rays.forEach((r, i) => { const L = Math.min(r.hit, z.r); const X = d.x + r.dx*L, Y = d.y + r.dy*L; i ? sh.lineTo(X, Y) : sh.moveTo(X, Y); });
      for (let i = cv.rays.length - 1; i >= 0; i--){ const r = cv.rays[i], L = Math.min(r.hit, cv.near); sh.lineTo(d.x + r.dx*L, d.y + r.dy*L); }
      const m = new THREE.MeshBasicMaterial({ color:new THREE.Color(z.col).convertSRGBToLinear(), transparent:true, opacity:0.16, depthWrite:false, side:THREE.DoubleSide }); m.userData.own = true;
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(sh), m);
      mesh.rotation.x = Math.PI/2; mesh.position.y = 0.6 + zi*0.15; mesh.renderOrder = 1; covG.add(mesh);
    });
  });
  covG.visible = view !== 'walk';
}
let devTimer = 0;
function devChanged(quick){
  reqPlan(); renderDevPanel();
  clearTimeout(devTimer); devTimer = setTimeout(buildDevices3D, quick ? 120 : 0);
  if (!quick) scheduleSave();
}
HOOKS.build.push(() => buildDevices3D());
HOOKS.view.push(v => { if (covG) covG.visible = v !== 'walk'; });

let pipCam = null, pipBig = false, pipCtx = null;
const _sz = new THREE.Vector2();
function pipCamera(){
  const d = sel?.kind === 'dev' ? devById(sel.id) : null;
  return d && DT(d).kind === 'camera' ? d : null;
}
// The camera picture is drawn with the main renderer into a corner of its canvas, copied to the small
// canvas, and then the main view is drawn over it as usual (so only one WebGL context is used).
HOOKS.preframe.push(() => {
  const d = pipCamera(), box = $('#pip');
  box.hidden = !d; if (!d) return;
  if (!pipCam){ pipCam = new THREE.PerspectiveCamera(50, 16/9, 3, 30000); pipCtx = $('#pipCanvas').getContext('2d'); }
  const cv = $('#pipCanvas'), pr = renderer.getPixelRatio(); renderer.getSize(_sz);
  const w = Math.max(1, Math.min(cv.clientWidth || 360, _sz.x)), h = Math.max(1, Math.min(Math.round(w*d.resH/d.resW), _sz.y));
  cv.style.aspectRatio = `${d.resW} / ${d.resH}`;
  if (cv.width !== Math.round(w*pr) || cv.height !== Math.round(h*pr)){ cv.width = Math.round(w*pr); cv.height = Math.round(h*pr); }
  const f = camFov(d), dir = camDir(d);
  pipCam.fov = f.v; pipCam.aspect = w/h; pipCam.updateProjectionMatrix();
  pipCam.position.set(d.x, d.z, d.y); pipCam.lookAt(d.x + dir.x*100, d.z + dir.y*100, d.y + dir.z*100);
  const own = devG?.children.find(g => g.userData.devId === d.id), covVis = covG?.visible, viewsVis = viewsG?.visible;
  if (own) own.visible = false; if (covG) covG.visible = false; if (viewsG) viewsG.visible = true;
  devG?.children.forEach(g => g.children.forEach(c => { if (c.userData.frustum) c.visible = false; }));
  renderer.setScissorTest(true); renderer.setViewport(0, 0, w, h); renderer.setScissor(0, 0, w, h);
  renderer.render(scene, pipCam);
  pipCtx.drawImage(renderer.domElement, 0, renderer.domElement.height - cv.height, cv.width, cv.height, 0, 0, cv.width, cv.height);
  renderer.setScissorTest(false); renderer.setViewport(0, 0, _sz.x, _sz.y);
  if (own) own.visible = true; if (covG) covG.visible = covVis; if (viewsG) viewsG.visible = viewsVis;
  devG?.children.forEach(g => g.children.forEach(c => { if (c.userData.frustum) c.visible = true; }));
  $('#pipInfo').textContent = `${d.name} · ${d.fovMode === 'fov' ? '' : fmt(d.focal) + ' mm · '}${fmt(f.h)}° × ${fmt(f.v)}° · ${d.resW}×${d.resH}`;
});
$('#pipSize').addEventListener('click', () => { pipBig = !pipBig; $('#pip').classList.toggle('big', pipBig); });
