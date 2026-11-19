/* DetailDesk browser app. Shared helpers and data (esc, inr, totals, PANELS, ...) come from /shared.js. */

/* ================= state & api ================= */
const S = {me:null, biz:{}, perms:{}, catalog:[], bays:[], staff:[], view:'home', q:'', jobTab:'work', jobId:null, invNo:null, invTab:'all', custId:null, setTab:'business',
  data:null, nav:0, payMode:'UPI', after:null, wa:null, find:null, uploading:{}};
const isAdmin = () => !!S.me && S.me.role === 'admin';
const canSales = () => isAdmin() || !!S.perms.sales;
const discLimit = () => isAdmin() ? 100 : Math.max(0, Math.min(100, +S.perms.disc || 0));
const svc = id => svcIn(S.catalog, id);
const hasCat = (svcs, c) => hasCatIn(S.catalog, svcs, c);
const enc = encodeURIComponent;
const upUrl = id => `/api/uploads/${enc(id)}`;

async function api(path, method = 'GET', body){
  let r;
  try { r = await fetch(path, {method, headers:body !== undefined ? {'Content-Type':'application/json'} : {}, body:body !== undefined ? JSON.stringify(body) : undefined, credentials:'same-origin'}); }
  catch (_) { throw new Error('No connection to the server. Check the internet and try again.'); }
  let data = null; try { data = await r.json(); } catch (_) {}
  if (r.status === 401 && !path.startsWith('/api/login') && !path.startsWith('/api/me/')){ S.me = null; showAuth(); throw new Error((data && data.error) || 'Please log in again.'); }
  if (!r.ok) throw new Error((data && data.error) || 'Something went wrong. Please try again.');
  return data;
}
const post = (p, b = {}) => api(p, 'POST', b);
const put = (p, b = {}) => api(p, 'PUT', b);
let busyAct = false;
async function act(fn, okMsg){
  if (busyAct) return null;
  busyAct = true; document.body.classList.add('busy');
  try { const r = await fn(); if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg); return r; }
  catch (e){ toast(e.message || 'Something went wrong'); return null; }
  finally { busyAct = false; document.body.classList.remove('busy'); }
}

/* ================= auth screens ================= */
function brandHTML(sub){ return `<div class="brand"><svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="var(--accent)"/><path d="M16 5.5c4.2 5.6 7.2 9.3 7.2 12.9a7.2 7.2 0 0 1-14.4 0c0-3.6 3-7.3 7.2-12.9z" fill="var(--accent-ink)"/></svg><div><b>DetailDesk</b><span>${esc(sub || '')}</span></div></div>`; }
function showAuth(sess){
  closeModal();
  document.body.classList.add('auth-on');
  const el = $('#auth'); el.hidden = false;
  if (sess && sess.setupNeeded){
    el.innerHTML = `<form class="auth-card" id="setup-form" autocomplete="on">${brandHTML('First-time setup')}<h1>Set up your studio</h1><p class="small muted">This creates the owner (Admin) login. You can add a Manager login later in Settings.</p>
      <div class="field"><label for="s-biz">Business name</label><input class="inp" id="s-biz" required maxlength="80"></div>
      <div class="field"><label for="s-name">Your name</label><input class="inp" id="s-name" required maxlength="60" autocomplete="name"></div>
      <div class="field"><label for="s-login">Your mobile number</label><input class="inp" id="s-login" required inputmode="tel" autocomplete="username"><span class="hint">You log in with this number.</span></div>
      <div class="field"><label for="s-pw">Password (at least 6 characters)</label><input class="inp" id="s-pw" type="password" required minlength="6" autocomplete="new-password"></div>
      <div class="field"><label for="s-pw2">Password again</label><input class="inp" id="s-pw2" type="password" required minlength="6" autocomplete="new-password"></div>
      <p class="err" id="auth-err" role="alert"></p><button class="btn pri block" type="submit">Create owner login</button></form>`;
  } else {
    el.innerHTML = `<form class="auth-card" id="login-form" autocomplete="on">${brandHTML(sess && sess.biz && sess.biz.name || '')}<h1>Log in</h1>
      <div class="field"><label for="l-login">Mobile number or username</label><input class="inp" id="l-login" required autocomplete="username"></div>
      <div class="field"><label for="l-pw">Password</label><input class="inp" id="l-pw" type="password" required autocomplete="current-password"></div>
      <p class="err" id="auth-err" role="alert"></p><button class="btn pri block" type="submit">Log in</button>
      <p class="small muted">Forgot the password? The owner can reset a Manager's password in Settings → Logins.</p></form>`;
  }
  const first = el.querySelector('input'); if (first) first.focus();
}
async function enterApp(){
  const b = await api('/api/boot');
  Object.assign(S, {me:b.me, biz:b.biz, perms:b.perms, catalog:b.catalog, bays:b.bays, staff:b.staff});
  draftCache = null;
  document.body.classList.remove('auth-on'); $('#auth').hidden = true; $('#auth').innerHTML = '';
  fromHash(); await load(true);
}
async function boot(){
  try {
    const s = await api('/api/session');
    if (s.setupNeeded || !s.user) return showAuth(s);
    await enterApp();
  } catch (e){ document.body.classList.add('auth-on'); $('#auth').hidden = false; $('#auth').innerHTML = `<div class="auth-card"><h1>Can't reach the server</h1><p>${esc(e.message)}</p><button class="btn pri" onclick="location.reload()">Try again</button></div>`; }
}

/* ================= wizard draft (kept on this device until the job card is created) ================= */
const freshDraft = () => ({step:1, max:1, find:'', f:{name:'', mob:'', email:'', reg:'', model:'', color:'', odo:'', req:''}, seg:1, fuel:'½', dmg:{}, tool:'scratch', photos:{}, bel:[], cat:'All', svcs:[], panels:[],
  ppf:{finish:'Gloss', film:'', warr:5, notes:''}, coat:{product:'', layers:2, warr:3}, disc:0, adv:0, mode:'UPI', terms:[], sig:null, bay:'', team:[], due:'', dueSet:false, prio:'Normal', waJob:true, printJob:true});
const DKEY = () => `dd-draft-${S.me ? S.me.id : 0}`;
let draftCache = null, draftT = null;
function W(){
  if (!draftCache){ try { draftCache = JSON.parse(localStorage.getItem(DKEY()) || 'null'); } catch (_) { draftCache = null; } if (!draftCache || typeof draftCache !== 'object') draftCache = freshDraft(); }
  return draftCache;
}
function saveDraft(now){ clearTimeout(draftT); const run = () => { try { localStorage.setItem(DKEY(), JSON.stringify(W())); } catch (_) {} }; if (now) run(); else draftT = setTimeout(run, 300); }
function resetDraft(){ draftCache = freshDraft(); saveDraft(true); }
const draftDirty = () => { const w = W(); return w.step > 1 || w.svcs.length > 0 || Object.values(w.f).some(v => String(v).trim()); };
function cleanDraft(w){
  const base = freshDraft();
  for (const k of Object.keys(base)) if (w[k] === undefined) w[k] = base[k];
  w.svcs = w.svcs.filter(id => svc(id));
  if (w.bay && !S.bays.find(b => b.id === w.bay)) w.bay = '';
  w.team = w.team.filter(n => S.staff.find(s => s.n === n));
  if (!(w.seg >= 0 && w.seg <= 4)) w.seg = 1;
  if (w.step < 1 || w.step > 5) w.step = 1;
  if (w.disc > discLimit()) w.disc = discLimit();
  Object.keys(w.photos).forEach(k => { if (!/^[a-f0-9]{24}$/.test(w.photos[k])) delete w.photos[k]; });
}
const wLines = () => { const w = W(); return linesFor(w.svcs, w.panels, w.seg, S.catalog); };
const wTot = () => { const w = W(); return totals(wLines(), w.disc, !!S.biz.gst); };

/* ================= car diagram ================= */
function carSVG({mode, dmg = {}, covered = [], act = false, custom = false}){
  const cov = new Set(covered);
  const wheels = [[8, 78], [222, 78], [8, 350], [222, 350]].map(([x, y]) => `<rect x="${x}" y="${y}" width="10" height="48" rx="4" class="wheel"/>`).join('');
  const panels = PANELS.map(p => {
    let cls = 'pnl' + (p.glass ? ' glass' : ''), style = '', mark = '', clickable = false;
    if (mode === 'damage'){
      const d = dmg[p.id];
      if (d && DMG[d]){ style = `fill:${DMG[d].c};fill-opacity:.25;stroke:${DMG[d].c};stroke-width:2`; mark = `<text x="${p.x + p.w / 2}" y="${p.y + p.h / 2 + 4}" class="pmark" style="fill:${DMG[d].c}">${DMG[d].short}</text>`; }
      clickable = act;
    } else { if (cov.has(p.id)) cls += ' on'; clickable = act && custom && !p.glass; }
    const a = clickable ? ` data-act="panel" data-id="${p.id}" data-mode="${mode}" tabindex="0" role="button" aria-label="${p.label}"` : '';
    return `<g class="${cls}"${a}><title>${p.label}</title><rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="${p.rx}" style="${style}"/>${mark}</g>`;
  }).join('');
  return `<svg class="car" viewBox="0 -20 240 492" role="group" aria-label="Car panels, top view"><text x="120" y="-6" class="car-lbl">FRONT</text>${wheels}${panels}<text x="120" y="468" class="car-lbl">REAR</text></svg>`;
}

/* ================= views ================= */
const stChip = s => s === 'work' ? chip('In progress', 'info') : s === 'ready' ? chip('Ready', 'ok') : chip('Delivered', 'mute');
const isLate = j => j.status === 'work' && validDT(j.due) && parseDT(j.due) < new Date();
const invChip = x => x.cancelled ? chip('Cancelled', 'bad') : x.bal <= 0 ? chip('Paid', 'ok') : x.paid > 0 ? chip('Part paid', 'warn') : chip('Unpaid', 'bad');

function vHome(d){
  const now = new Date(), act = d.work.length + d.ready.length;
  const sv = j => j.lines.map(l => shortName(l.name)).join(', ');
  return ph(`${WD[now.getDay()]}, ${now.getDate()} ${MON[now.getMonth()]}`, 'Today', '', `<button class="btn pri" data-act="go" data-view="new">${ico('plus')} New job card</button>`) + `
  <div class="kpis">
    <div class="kpi"><div class="l">Cars in workshop</div><div class="v">${act}</div><div class="s">${d.work.length} in progress · ${d.ready.length} ready</div></div>
    <div class="kpi"><div class="l">Collected today</div><div class="v">${inr(d.coll)}</div><div class="s">UPI, cash, card and bank</div></div>
    <div class="kpi"><div class="l">Payment pending</div><div class="v">${inr(d.pending)}</div><div class="s">${d.dueCount} invoice${d.dueCount === 1 ? '' : 's'}</div></div>
    ${d.sales ? `<div class="kpi"><div class="l">${MON[now.getMonth()]} sales</div><div class="v">${inr(d.sales.month)}</div><div class="s">${d.sales.count} invoice${d.sales.count === 1 ? '' : 's'}</div></div>` : ''}
  </div>
  <div class="g-7-5">
    <div class="stack16">
      <section class="card"><div class="card-h"><h3>Cars in the workshop</h3><button class="link" data-act="go" data-view="jobs" data-tab="all">All job cards ${ico('arrow')}</button></div>
        ${act ? `<ul class="list">${[...d.ready, ...d.work].map(j => `<li data-act="go" data-view="job" data-id="${esc(j.id)}">
          <div class="grow"><div class="row">${plate(j.reg)}<span class="t">${esc(j.car)}</span>${j.prio === 'Urgent' ? chip('Urgent', 'bad') : ''}</div><div class="s">${esc(j.cust)} · ${esc(sv(j))}${j.status === 'work' && j.bay ? ' · ' + esc(j.bay) : ''}</div></div>
          <div class="r">${j.status === 'ready' ? `${chip('Ready', 'ok')}<button class="btn sm wa" data-act="wa" data-k="ready" data-id="${esc(j.id)}">${ico('chat')} Tell customer</button>` : `${isLate(j) ? chip('Late', 'bad') : chip('In progress', 'info')}<span class="s">Due ${esc(fDT(j.due))}</span>`}</div></li>`).join('')}</ul>` : `<div class="empty">No cars in the workshop right now. <button class="link" data-act="go" data-view="new">Make a job card</button></div>`}
      </section>
      <section class="card"><div class="card-h"><h3>Bays right now</h3><span class="small muted">${d.bays.filter(b => !b.jobs.length).length} free</span></div><div class="card-b"><div class="bays">
        ${d.bays.map(b => { const j = b.jobs[0]; return j ? `<button class="bay" data-act="go" data-view="job" data-id="${esc(j.id)}"><div class="bay-h"><b>${esc(b.id)}</b><span class="small muted">${esc(b.type)}</span></div><span class="small">${esc(j.car)}</span><span class="small muted">Till ${esc(fDT(j.due))}${b.jobs.length > 1 ? ` · +${b.jobs.length - 1} waiting` : ''}</span></button>` : `<div class="bay free"><div class="bay-h"><b>${esc(b.id)}</b><span class="small muted">${esc(b.type)}</span></div><span class="small okt">Free now</span></div>`; }).join('') || `<p class="small muted">No bays yet.${isAdmin() ? ' Add them in Settings → Bays & team.' : ''}</p>`}
      </div></div></section>
    </div>
    <div class="stack16">
      <section class="card"><div class="card-h"><h3>Payments pending</h3><button class="link" data-act="go" data-view="invoices" data-tab="unpaid">Invoices ${ico('arrow')}</button></div>
        ${d.due.length ? `<ul class="list">${d.due.map(v => `<li data-act="go" data-view="invoices" data-no="${esc(v.no)}">
          <div class="grow"><div class="t">${esc(v.cust)}</div><div class="s">${esc(v.car)} · ${esc(v.no.slice(-4))} · ${esc(fD(v.date))}</div></div>
          <div class="r"><b class="num">${inr(v.bal)}</b><button class="btn sm" data-act="wa" data-k="due" data-no="${esc(v.no)}">${ico('chat')} Remind</button></div></li>`).join('')}</ul>` : `<div class="empty">Nothing pending.</div>`}
      </section>
      ${d.sales ? `<section class="card"><div class="card-h"><h3>Top services · ${MON[now.getMonth()]}</h3></div><div class="card-b">${d.sales.tops.length ? `<div class="hbars">${d.sales.tops.map(([n, v]) => `<div class="hb"><span class="hb-l">${esc(n)}</span><span class="hb-t"><i style="width:${Math.max(4, v / d.sales.tops[0][1] * 100)}%"></i></span><span class="hb-v">${inr(v)}</span></div>`).join('')}</div>` : '<p class="small muted">No invoices this month yet.</p>'}</div></section>` : ''}
    </div>
  </div>`;
}

function vJobs(d){
  const q = S.q, tab = S.jobTab, list = d.list;
  const tabs = [['work', 'In progress'], ['ready', 'Ready'], ['done', 'Delivered'], ['all', 'All']];
  const dueCell = j => j.status === 'done' ? esc(fD(j.doneAt || j.due)) : `${esc(fDT(j.due))}${isLate(j) ? ' ' + chip('Late', 'bad') : ''}`;
  return ph('Job cards', 'Job cards', '', `<button class="btn pri" data-act="go" data-view="new">${ico('plus')} New job card</button>`) + `
  <section class="card">
    ${q ? `<div class="card-h"><span>Results for <b>${esc(q)}</b> in all job cards</span><button class="link" data-act="clearq">Clear search</button></div>` : `<div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button class="tab" role="tab" aria-selected="${tab === k}" data-act="jtab" data-tab="${k}">${l}<span class="c">${d.counts[k] || 0}</span></button>`).join('')}</div>`}
    ${list.length ? `<div class="tw"><table class="tbl"><thead><tr><th>Job card</th><th>Car</th><th>Customer</th><th>Services</th><th>Bay</th><th class="num">Amount</th><th>${tab === 'done' && !q ? 'Delivered' : 'Due'}</th><th>Status</th></tr></thead><tbody>
      ${list.map(j => `<tr data-act="go" data-view="job" data-id="${esc(j.id)}"><td class="mono">${esc(j.id)}</td><td>${plate(j.reg)}<div class="sub">${esc(j.car)}</div></td>
        <td>${esc(j.cust)}<div class="sub">${esc(j.ph)}</div></td><td>${esc(j.lines.map(l => shortName(l.name)).join(', '))}</td><td>${esc(j.bay || '—')}</td><td class="num">${inr(j.total)}</td><td>${dueCell(j)}</td><td>${stChip(j.status)}</td></tr>`).join('')}
    </tbody></table></div>` : `<div class="empty">${q ? 'No job cards match.' : 'No job cards here.'}</div>`}
  </section>`;
}

function vJob(d){
  const j = d.job, t = jobTot(j), inv = j.invInfo;
  const acts = {
    work:`<button class="btn" data-act="printjob">${ico('print')} Print job card</button><button class="btn wa" data-act="wa" data-k="update" data-id="${esc(j.id)}">${ico('chat')} Send update</button><button class="btn pri" data-act="ready" data-id="${esc(j.id)}">${ico('check')} Mark as ready</button>`,
    ready:`<button class="btn" data-act="printjob">${ico('print')} Print job card</button><button class="btn wa" data-act="wa" data-k="ready" data-id="${esc(j.id)}">${ico('chat')} Tell customer</button><button class="btn pri" data-act="mkinv" data-id="${esc(j.id)}">${ico('bill')} Make invoice & deliver</button>`,
    done:`<button class="btn" data-act="printjob">${ico('print')} Print job card</button>${inv ? `<button class="btn pri" data-act="go" data-view="invoices" data-no="${esc(inv.no)}">${ico('bill')} Open invoice</button>` : ''}`
  }[j.status];
  const stIdx = {work:1, ready:2, done:3}[j.status];
  const steps = [['Checked in', fDT(j.in)], ['Work in ' + (j.bay || 'workshop'), j.status === 'work' ? `Due ${fDT(j.due)}` : 'Done'], ['Ready', j.readyAt ? fDT(j.readyAt) : 'Customer is told on WhatsApp'], ['Delivered', j.doneAt ? `${fDT(j.doneAt)}${inv ? ' · invoice ' + inv.no.slice(-4) : ''}` : 'After the invoice']];
  const cls = i => i < stIdx || j.status === 'done' ? 'done' : i === stIdx ? 'now' : 'todo';
  const marks = Object.entries(j.dmg || {}).filter(([id, x]) => PANEL[id] && DMG[x]);
  const photos = SLOTS.filter(s => j.photos && j.photos[s]);
  return `<button class="link" data-act="go" data-view="jobs" style="margin-bottom:10px">${ico('back')} Job cards</button>` +
  ph(`Job card ${esc(j.id)}`, `${esc(j.car)} <span style="vertical-align:4px">${plate(j.reg)}</span>`, `${stChip(j.status)}${j.prio === 'Urgent' ? ' ' + chip('Urgent', 'bad') : ''} &nbsp;${esc(j.cust)} · ${esc(j.ph)} · ${SEGS[j.seg]}${j.color ? ' · ' + esc(j.color) : ''}`, acts) + `
  <div class="g-7-5">
    <div class="stack16">
      <section class="card"><div class="card-h"><h3>Services & amount</h3>${j.status !== 'done' ? '<span class="small muted">Estimate</span>' : ''}</div>
        <div class="tw"><table class="tbl"><tbody>${j.lines.map(l => `<tr><td>${esc(l.name)}</td><td class="num">${inr(l.amt)}</td></tr>`).join('')}</tbody>
        <tfoot>${t.disc ? `<tr><td>Discount ${j.disc}%</td><td class="num">−${inr(t.disc)}</td></tr>` : ''}${t.half ? `<tr><td>GST 18%</td><td class="num">${inr(t.total - t.taxable)}</td></tr>` : ''}
          <tr class="tot"><td>Total</td><td class="num">${inr(t.total)}</td></tr>
          <tr><td>${inv ? 'Paid' : 'Advance paid'}${!inv && j.adv ? ` <span class="sub">(${esc(j.mode)})</span>` : ''}</td><td class="num">${inr(j.paid)}</td></tr>
          <tr><td><b>Balance</b></td><td class="num"><b>${inr(Math.max(0, j.bal))}</b></td></tr></tfoot></table></div>
      </section>
      ${j.ppf || j.coat ? `<section class="card"><div class="card-h"><h3>PPF & coating details</h3>${chip(ico('shield') + ' Warranty starts on delivery', 'acc')}</div><div class="card-b">
        ${j.ppf ? `<div class="insp-mini"><div class="car-wrap sm">${carSVG({mode:'ppf', covered:ppfPanelsOf(j.svcs, j.panels)})}</div><div><h4 class="sub-h">PPF</h4><dl class="spec"><div><dt>Coverage</dt><dd>${esc(coverLabel(j.svcs, j.panels))}</dd></div><div><dt>Finish</dt><dd>${esc(j.ppf.finish)}</dd></div><div><dt>Film</dt><dd>${esc(j.ppf.film || '—')}</dd></div><div><dt>Warranty</dt><dd>${+j.ppf.warr} years</dd></div><div><dt>Film used</dt><dd>≈ ${sqOf(j.svcs, j.panels, j.seg)} sq ft</dd></div>${j.ppf.notes ? `<div><dt>Notes</dt><dd>${esc(j.ppf.notes)}</dd></div>` : ''}</dl></div></div>` : ''}
        ${j.coat ? `<h4 class="sub-h"${j.ppf ? ' style="margin-top:16px"' : ''}>Coating</h4><dl class="spec"><div><dt>Product</dt><dd>${esc(j.coat.product || '—')}</dd></div><div><dt>Layers</dt><dd>${+j.coat.layers}</dd></div><div><dt>Warranty</dt><dd>${+j.coat.warr} years</dd></div><div><dt>Maintenance</dt><dd>Every 6 months</dd></div></dl>` : ''}
      </div></section>` : ''}
      <section class="card"><div class="card-h"><h3>Inspection at check-in</h3>${marks.length ? chip(`${marks.length} mark${marks.length === 1 ? '' : 's'}`, 'warn') : chip('No damage marked', 'ok')}</div><div class="card-b">
        <div class="insp-mini"><div class="car-wrap sm">${carSVG({mode:'damage', dmg:j.dmg || {}})}</div><div>
          ${marks.length ? `<ul class="marks" style="margin:-4px -16px 8px">${marks.map(([id, x]) => `<li><i style="background:${DMG[x].c}"></i><span>${PANEL[id].label}</span><span class="muted">${DMG[x].label}</span></li>`).join('')}</ul>` : ''}
          <div class="kv"><span>Odometer · fuel</span><b>${j.odo ? esc(j.odo) + ' km' : '—'} · ${esc(j.fuel)}</b></div>
          ${j.req ? `<p class="small" style="margin-top:8px"><span class="muted">Customer asked:</span> ${esc(j.req)}</p>` : ''}
          <h4 class="sub-h">Belongings in the car</h4><div class="pills">${(j.bel || []).length ? j.bel.map(b => chip(esc(b), 'mute')).join(' ') : '<span class="small muted">None noted</span>'}</div>
        </div></div>
        <h4 class="sub-h">Walk-around photos</h4>
        ${photos.length ? `<div class="shots">${photos.map(s => `<a class="shot" href="${upUrl(j.photos[s])}" target="_blank" rel="noopener"><img src="${upUrl(j.photos[s])}" alt="${esc(s)} photo" loading="lazy"><span>${esc(s)}</span></a>`).join('')}</div>` : '<p class="small muted">No photos added.</p>'}
      </div></section>
      <section class="card"><div class="card-h"><h3>Customer consent</h3>${j.sig ? chip('Signed', 'ok') : chip('Not signed', 'mute')}</div><div class="card-b stack">
        ${TERMS.map(([k, tx]) => `<div class="row small">${(j.terms || []).includes(k) ? `<span class="okt">${ico('check')}</span>` : `<span class="muted">${ico('alert')}</span>`}<span>${tx}</span></div>`).join('')}
        ${j.sig ? `<img class="sigimg" src="${upUrl(j.sig)}" alt="Customer signature">` : ''}
      </div></section>
    </div>
    <div class="stack16">
      <section class="card"><div class="card-h"><h3>Status</h3></div><div class="card-b"><ol class="steps">${steps.map(([b, s], i) => `<li class="${cls(i)}"><span class="dot">${cls(i) === 'done' ? ico('check') : ''}</span><div><b>${esc(b)}</b><div class="small muted">${esc(s)}</div></div></li>`).join('')}</ol></div></section>
      <section class="card"><div class="card-h"><h3>Bay & team</h3></div><div class="card-b sum-b">
        <div class="kv"><span>Bay</span><b>${esc(j.bay || 'Not set')}</b></div>
        <div class="kv"><span>Promised delivery</span><b>${esc(fDT(j.due))}</b></div>
        <div class="kv"><span>Priority</span><b>${esc(j.prio)}</b></div>
        <div class="kv"><span>Team</span><b>${(j.team || []).length ? j.team.map(esc).join(', ') : 'Not set'}</b></div>
      </div></section>
      <section class="card"><div class="card-h"><h3>Customer</h3><button class="link" data-act="go" data-view="customers" data-cust="${j.customerId}">Profile ${ico('arrow')}</button></div>
        <div class="card-b sum-b"><div class="kv"><span>Name</span><b>${esc(j.cust)}</b></div><div class="kv"><span>Mobile</span><b>${esc(j.ph)}</b></div>${j.email ? `<div class="kv"><span>Email</span><b>${esc(j.email)}</b></div>` : ''}
        <div class="link-row">Customer tracking link: <a href="${esc(d.link)}" target="_blank" rel="noopener">${esc(d.link)}</a></div></div></section>
      <section class="card"><div class="card-h"><h3>Activity</h3></div><div class="card-b"><ul class="log">${(j.log || []).map(l => `<li><b>${esc(l.text)}</b><span class="s">${esc(fDT(l.t))}</span></li>`).join('')}</ul></div></section>
    </div>
  </div>`;
}

/* ---------- new job card wizard ---------- */
function wizSummary(){
  const w = W(), lines = wLines(), t = totals(lines, w.disc, !!S.biz.gst), adv = Math.min(+w.adv || 0, t.total), nd = Object.keys(w.dmg).length;
  return `<section class="card"><div class="card-h"><h3>Job card <span class="mono">${esc((S.data && S.data.nextId) || '')}</span></h3>${chip('Draft', 'mute')}</div>
    <div class="card-b sum-b">
      ${w.f.reg || w.f.model ? `<div class="sum-car">${w.f.reg ? plate(w.f.reg.toUpperCase()) : ''}<div><b>${esc(w.f.model || 'Car')}</b><div class="small muted">${w.f.color ? esc(w.f.color) + ' · ' : ''}${SEGS[w.seg]}</div></div></div>` : `<p class="small muted">Customer and car details show here.</p>`}
      <div class="kv"><span>Customer</span><b>${esc(w.f.name || '—')}</b></div>
      <div class="kv"><span>Odometer · fuel</span><b>${w.f.odo ? esc(w.f.odo) + ' km' : '—'} · ${esc(w.fuel)}</b></div>
      <div class="kv"><span>Damage marked</span><b>${nd} panel${nd === 1 ? '' : 's'}</b></div>
      <div class="kv"><span>Photos</span><b>${Object.keys(w.photos).length} of 6</b></div>
      <hr>
      ${lines.map(l => `<div class="kv"><span>${esc(l.name)}</span><b>${inr(l.amt)}</b></div>`).join('') || '<p class="small muted">No services picked yet.</p>'}
      ${lines.length ? `<hr>
      ${t.disc ? `<div class="kv"><span>Discount ${w.disc}%</span><b>−${inr(t.disc)}</b></div>` : ''}
      ${t.half ? `<div class="kv"><span>GST 18%</span><b>${inr(t.total - t.taxable)}</b></div>` : ''}
      <div class="kv tot"><span>Estimate</span><b>${inr(t.total)}</b></div>
      <div class="kv"><span>Advance${adv ? ' · ' + esc(w.mode) : ''}</span><b>${inr(adv)}</b></div>
      <div class="kv"><span>Balance at delivery</span><b>${inr(Math.max(0, t.total - adv))}</b></div>` : ''}
      ${w.bay || w.team.length ? `<hr><div class="kv"><span>Bay</span><b>${esc(w.bay || '—')}</b></div><div class="kv"><span>Team</span><b>${w.team.length}</b></div>` : ''}
    </div></section>`;
}
function vNew(){
  const w = W(); cleanDraft(w);
  const stepper = `<ol class="stepper">${STEPS.map((s, i) => { const n = i + 1, on = n === w.step, can = n <= w.max, done = !on && n < w.max;
    return `<li><button class="st ${on ? 'on' : ''} ${done ? 'done' : ''}" data-act="wstep" data-step="${n}" ${can ? '' : 'disabled'} aria-current="${on ? 'step' : 'false'}"><span class="st-n">${done ? ico('check') : n}</span><span>${s}</span></button></li>`; }).join('')}</ol>`;
  const body = [null, wStep1, wStep2, wStep3, wStep4, wStep5][w.step]();
  const nav = `<div class="wiz-nav">${w.step > 1 ? `<button class="btn" data-act="wprev">${ico('back')} Back</button>` : '<span></span>'}${w.step < 5 ? `<button class="btn pri" data-act="wnext">Continue ${ico('arrow')}</button>` : `<button class="btn pri" data-act="wcreate">${ico('check')} Create job card</button>`}</div>`;
  return ph(`New job card · step ${w.step} of 5`, 'New job card', 'What you fill in here becomes the job card, then the estimate, then the invoice. Your draft is kept on this device if you leave this page.', draftDirty() ? `<button class="btn ghost" data-act="wreset">Start over</button>` : '')
    + stepper + `<div class="wiz"><div class="wiz-main">${body}${nav}</div><aside class="wiz-side" id="wiz-sum">${wizSummary()}</aside></div>`;
}
function findMatchHTML(){
  const w = W(), q = w.find.trim(), m = S.find;
  if (!q) return '';
  if (!m || m.q !== q) return norm(q).length >= 4 ? `<p class="small muted" style="margin-top:8px">Searching…</p>` : '';
  if (!m.match) return `<p class="small muted" style="margin-top:8px">No saved customer matches. Fill in the details below for a new customer.</p>`;
  const c = m.match, car = c.cars[0];
  return `<div class="match">${ico('check')}<div><b>${esc(c.name)} · ${esc(c.ph)}</b><div class="small muted">${car ? `${esc(car.model)} (${esc(car.reg)}) · ` : ''}${c.visits} visit${c.visits === 1 ? '' : 's'} · last ${esc(fD(c.last))}</div></div><button class="btn sm pri" data-act="wfill">Fill details</button></div>`;
}
function wStep1(){
  const w = W(), f = w.f;
  const fld = (k, l, p = '', mode = '', cls = '', ac = 'off') => `<div class="field"><label for="w-${k}">${l}</label><input class="inp ${cls}" id="w-${k}" data-wf="${k}" value="${esc(f[k])}" placeholder="${esc(p)}" ${mode ? `inputmode="${mode}"` : ''} autocomplete="${ac}"></div>`;
  return `<section class="card"><div class="card-b">
      <div class="field"><label for="w-find">Returning customer? Find by mobile or car number</label><div class="find"><span class="find-ico">${ico('search')}</span><input class="inp" id="w-find" value="${esc(w.find)}" placeholder="10-digit mobile or car number" autocomplete="off"></div></div>
      <div id="find-match">${findMatchHTML()}</div>
    </div></section>
    <section class="card"><div class="card-h"><h3>Customer</h3></div><div class="card-b grid2">
      ${fld('mob', 'Mobile (WhatsApp) *', '10-digit mobile', 'tel')}${fld('name', 'Full name *')}${fld('email', 'Email', 'Optional', 'email')}
    </div></section>
    <section class="card"><div class="card-h"><h3>Vehicle</h3></div><div class="card-b">
      <div class="grid2">${fld('reg', 'Car number *', 'MH 12 AB 1234', '', 'up')}${fld('model', 'Make & model *', 'e.g. Hyundai Creta SX')}${fld('color', 'Colour')}${fld('odo', 'Odometer (km)', '', 'numeric')}</div>
      <div class="field mt"><span class="lbl">Car segment · sets the price list</span><div class="pills">${SEGS.map((s, i) => `<button class="pill ${i === w.seg ? 'on' : ''}" aria-pressed="${i === w.seg}" data-act="wseg" data-v="${i}">${s}</button>`).join('')}</div></div>
      <div class="field mt"><span class="lbl">Fuel level at check-in</span><div><div class="seg">${['E', '¼', '½', '¾', 'F'].map(x => `<button aria-pressed="${x === w.fuel}" data-act="wfuel" data-v="${x}">${x}</button>`).join('')}</div></div></div>
      <div class="field mt"><label for="w-req">What the customer asked for</label><textarea class="inp" id="w-req" data-wf="req" rows="2" placeholder="Optional">${esc(f.req)}</textarea></div>
    </div></section>`;
}
function wStep2(){
  const w = W();
  const tools = Object.entries(DMG).map(([k, d]) => `<button class="tool ${w.tool === k ? 'on' : ''}" aria-pressed="${w.tool === k}" data-act="wtool" data-t="${k}"><i style="background:${d.c}"></i>${d.label}</button>`).join('') + `<button class="tool ${w.tool === 'none' ? 'on' : ''}" aria-pressed="${w.tool === 'none'}" data-act="wtool" data-t="none"><i class="erase"></i>Clear mark</button>`;
  const ms = Object.entries(w.dmg).filter(([id, t]) => PANEL[id] && DMG[t]);
  const marks = ms.map(([id, t]) => `<li><i style="background:${DMG[t].c}"></i><span>${PANEL[id].label}</span><span class="muted">${DMG[t].label}</span><button class="x" data-act="wunmark" data-id="${id}" aria-label="Remove mark on ${PANEL[id].label}">×</button></li>`).join('') || '<li class="muted">No damage marked yet. Pick a type, then tap the panel on the car.</li>';
  const slot = s => { const id = w.photos[s], up = S.uploading[s];
    return `<div class="slotw"><label class="slot ${id ? 'has' : ''}">${id ? `<img src="${upUrl(id)}" alt="${s} photo"><span class="lbl">${s}</span>` : `${ico('camera')}<span>${s}</span>`}${up ? '<span class="busy-t">Uploading…</span>' : ''}<input type="file" accept="image/*" data-photo="${s}" aria-label="Add ${s} photo" ${up ? 'disabled' : ''}></label>${id && !up ? `<button class="slot-rm" data-act="wunphoto" data-s="${s}" aria-label="Remove ${s} photo">×</button>` : ''}</div>`; };
  return `<div class="insp">
    <section class="card"><div class="card-h"><h3>Damage map</h3><span class="small muted">Pick a type, then tap a panel</span></div><div class="card-b"><div class="tools">${tools}</div><div class="car-wrap">${carSVG({mode:'damage', dmg:w.dmg, act:true})}</div></div></section>
    <div class="stack16">
      <section class="card"><div class="card-h"><h3>Marked before work</h3>${chip(ms.length + ' mark' + (ms.length === 1 ? '' : 's'), ms.length ? 'warn' : 'mute')}</div><ul class="marks">${marks}</ul></section>
      <section class="card"><div class="card-h"><h3>Walk-around photos</h3><span class="small muted">${Object.keys(w.photos).length} of 6 · tap to add</span></div><div class="card-b"><div class="ph-grid">${SLOTS.map(slot).join('')}</div></div></section>
      <section class="card"><div class="card-h"><h3>Belongings in the car</h3><span class="small muted">${w.bel.length} ticked</span></div><div class="card-b checks">${BEL.map(b => `<button class="opt ${w.bel.includes(b) ? 'on' : ''}" aria-pressed="${w.bel.includes(b)}" data-act="wbel" data-v="${esc(b)}"><span class="cb">${w.bel.includes(b) ? ico('check') : ''}</span>${b}</button>`).join('')}</div></section>
    </div></div>`;
}
function wStep3(){
  const w = W(), i = w.seg;
  const cats = CATS.filter(c => c === 'All' || S.catalog.some(s => s.cat === c));
  if (!cats.includes(w.cat)) w.cat = 'All';
  const tabs = `<div class="tabs" role="tablist">${cats.map(c => `<button class="tab" role="tab" aria-selected="${c === w.cat}" data-act="wcat" data-v="${c}">${c}</button>`).join('')}</div>`;
  const list = S.catalog.filter(s => w.cat === 'All' || s.cat === w.cat).map(s => {
    const on = w.svcs.includes(s.id), price = s.perSq ? `${inr(s.perSq[i])}<small> /sq ft</small>` : inr(s.p[i]);
    return `<button class="svc ${on ? 'on' : ''}" aria-pressed="${on}" data-act="wsvc" data-id="${esc(s.id)}"><span class="cb">${on ? ico('check') : ''}</span><span class="svc-t"><b>${esc(s.name)}</b><span>${esc(s.cat)}${s.dur ? ' · ' + esc(s.dur) : ''}${s.note ? ' · ' + esc(s.note) : ''}</span></span><span class="svc-p">${price}</span></button>`;
  }).join('');
  return `<section class="card"><div class="card-h"><h3>Services</h3><span class="small muted">Prices for <b>${SEGS[i]}</b> · change segment in step 1</span></div><div class="card-b">${tabs}<div class="svc-list">${list}</div></div></section>${hasCat(w.svcs, 'PPF') ? ppfConfig() : ''}${hasCat(w.svcs, 'Coating') ? coatConfig() : ''}`;
}
const segBtns = (act, k, opts, cur, fmt = x => x) => `<div class="seg">${opts.map(o => `<button aria-pressed="${String(o) === String(cur)}" data-act="${act}" data-k="${k}" data-v="${o}">${fmt(o)}</button>`).join('')}</div>`;
function ppfConfig(){
  const w = W(), p = w.ppf, custom = w.svcs.includes('ppf-custom'), panels = ppfPanelsOf(w.svcs, w.panels), coverSvc = COVER.some(x => w.svcs.includes(x));
  return `<section class="card"><div class="card-h"><h3>PPF details</h3>${chip(esc(coverLabel(w.svcs, w.panels)), 'acc')}</div>
    <div class="card-b ppf">
      <div class="car-wrap sm">${carSVG({mode:'ppf', covered:panels, act:true, custom})}<p class="small muted ctr">${custom ? 'Tap panels to add or remove them' : coverSvc ? 'Coverage comes from the service. Pick “PPF · selected panels” to choose panels.' : 'Add a coverage service (full body, front kit or selected panels) to film panels.'}</p></div>
      <div class="stack">
        ${custom && !panels.length ? `<div class="note warn">${ico('alert')}<span>Tap the panels to be filmed. The price is worked out from their size.</span></div>` : ''}
        <div class="field"><span class="lbl">Finish</span><div>${segBtns('wppf', 'finish', ['Gloss', 'Matte'], p.finish)}</div></div>
        <div class="field"><label for="w-film">Film / brand</label><input class="inp" id="w-film" data-wppf="film" value="${esc(p.film)}" placeholder="e.g. 8.5 mil gloss TPU" autocomplete="off"></div>
        <div class="field"><span class="lbl">Warranty</span><div>${segBtns('wppf', 'warr', [3, 5, 7, 10], p.warr, x => x + ' yr')}</div></div>
        <dl class="spec"><div><dt>Panels</dt><dd>${panels.length}</dd></div><div><dt>Film needed</dt><dd>≈ ${sqOf(w.svcs, w.panels, w.seg)} sq ft</dd></div><div><dt>Check-up</dt><dd>Every year</dd></div></dl>
        <div class="field"><label for="w-ppfnotes">Notes for the installer</label><input class="inp" id="w-ppfnotes" data-wppf="notes" value="${esc(p.notes)}" placeholder="Edges wrapped, extra care on bonnet…" autocomplete="off"></div>
      </div></div></section>`;
}
function coatConfig(){
  const c = W().coat;
  return `<section class="card"><div class="card-h"><h3>Coating details</h3></div><div class="card-b grid2 al">
    <div class="field"><label for="w-coatp">Product / brand</label><input class="inp" id="w-coatp" data-wcoat="product" value="${esc(c.product)}" placeholder="e.g. 9H ceramic" autocomplete="off"></div>
    <div class="field"><span class="lbl">Layers</span><div>${segBtns('wcoat', 'layers', [1, 2, 3], c.layers)}</div></div>
    <div class="field"><span class="lbl">Warranty</span><div>${segBtns('wcoat', 'warr', [1, 2, 3, 5], c.warr, x => x + ' yr')}</div></div>
    <div class="field"><span class="lbl">Maintenance</span><p class="small" style="padding-top:8px">Every 6 months · no wash for 7 days after</p></div>
  </div></section>`;
}
function discTag(over){
  const lim = discLimit();
  if (isAdmin()) return chip('Admin · no limit', 'acc');
  return over ? chip(`Max ${lim}% for Manager · ask the owner for more`, 'warn') : chip(`Manager · up to ${lim}%`, 'mute');
}
function wStep4(){
  const w = W(), t = wTot(), lines = wLines();
  if (w.adv > t.total) w.adv = t.total;
  return `<section class="card"><div class="card-h"><h3>Estimate</h3><button class="btn sm wa" data-act="wa" data-k="estimate">${ico('chat')} Send estimate on WhatsApp</button></div><div class="card-b">
    ${lines.length ? `<div class="tw"><table class="tbl"><thead><tr><th>Service</th><th class="num">Amount</th></tr></thead><tbody>
      ${lines.map(l => `<tr><td>${esc(l.name)}</td><td class="num">${inr(l.amt)}</td></tr>`).join('')}
    </tbody><tfoot>
      <tr><td>Subtotal</td><td class="num">${inr(t.sub)}</td></tr>
      <tr><td><div class="disc"><label for="w-disc">Discount %</label><input id="w-disc" class="inp xs" inputmode="numeric" value="${w.disc}" autocomplete="off"><span id="disc-tag">${discTag(false)}</span></div></td><td class="num" id="disc-amt">−${inr(t.disc)}</td></tr>
      ${S.biz.gst ? `<tr><td>CGST 9%</td><td class="num" id="cg">${f2(t.half)}</td></tr><tr><td>SGST 9%</td><td class="num" id="sg">${f2(t.half)}</td></tr>` : ''}
      <tr class="tot"><td>Estimate total</td><td class="num" id="etot">${inr(t.total)}</td></tr>
    </tfoot></table></div>` : `<div class="note warn">${ico('alert')}<span>No services picked. <button class="link" data-act="wstep" data-step="3">Go to services</button></span></div>`}
  </div></section>
  <div class="grid2 al">
    <section class="card"><div class="card-h"><h3>Advance payment</h3></div><div class="card-b stack">
      <div class="field"><label for="w-adv">Amount (₹)</label><input class="inp" id="w-adv" inputmode="numeric" value="${w.adv || ''}" placeholder="0" autocomplete="off"><span class="hint" id="adv-note">${w.adv ? `Balance at delivery: ${inr(Math.max(0, t.total - w.adv))}` : 'Optional'}</span></div>
      <div class="field"><span class="lbl">Mode</span><div><div class="seg">${PAY_MODES.map(x => `<button aria-pressed="${x === w.mode}" data-act="wmode" data-v="${x}">${x}</button>`).join('')}</div></div></div>
      <p class="small muted">The final invoice adjusts this advance automatically.</p>
    </div></section>
    <section class="card"><div class="card-h"><h3>Customer consent</h3><span id="sig-state">${w.sig ? chip('Signed', 'ok') : chip('Not signed', 'mute')}</span></div><div class="card-b stack">
      ${TERMS.map(([k, tx]) => `<button class="opt ${w.terms.includes(k) ? 'on' : ''}" aria-pressed="${w.terms.includes(k)}" data-act="wterm" data-v="${k}"><span class="cb">${w.terms.includes(k) ? ico('check') : ''}</span>${tx}</button>`).join('')}
      <canvas id="sig" class="sig" aria-label="Signature pad. The customer signs here with a finger or mouse."></canvas>
      <div class="row-between"><span class="small muted">Customer signs here with a finger or mouse</span><button class="btn sm" data-act="wsigclear">Clear</button></div>
    </div></section>
  </div>`;
}
function wStep5(){
  const w = W(), sg = suggestDue(w.svcs, S.catalog), bj = (S.data && S.data.bays) || {}, load = (S.data && S.data.team) || {};
  if (!w.dueSet || !validDT(w.due)) w.due = sg.at;
  const selBusy = w.bay ? (bj[w.bay] || []) : [];
  const bays = S.bays.map(b => { const j = (bj[b.id] || [])[0];
    return `<button class="bay ${j ? '' : 'free'} ${w.bay === b.id ? 'sel' : ''}" aria-pressed="${w.bay === b.id}" data-act="wbay" data-v="${esc(b.id)}"><div class="bay-h"><b>${esc(b.id)}</b><span class="small muted">${esc(b.type)}</span></div>${j ? `<span class="small">${esc(j.id)} · ${esc(j.car)}</span><span class="small muted">Busy till ${esc(fDT(j.due))}</span>` : `<span class="small okt">Free now</span>`}</button>`; }).join('');
  const techs = S.staff.map(s => { const n = load[s.n] || 0, on = w.team.includes(s.n);
    return `<button class="opt ${on ? 'on' : ''}" aria-pressed="${on}" data-act="wtech" data-v="${esc(s.n)}"><span class="cb">${on ? ico('check') : ''}</span>${av(s.n)}<span style="flex:1;min-width:0"><b>${esc(s.n)}</b><br><span class="small muted">${esc(s.r)}</span></span><span class="small ${n ? 'muted' : 'okt'}">${n ? n + ' active job' + (n > 1 ? 's' : '') : 'Free'}</span></button>`; }).join('');
  const sgTxt = `${sg.hrs % 1 ? sg.hrs.toFixed(1) : sg.hrs} h of work${sg.cure ? ` + ${sg.cure} h curing` : ''} → ${fDT(sg.at)}`;
  return `<section class="card"><div class="card-h"><h3>Bay</h3>${!w.bay ? chip('Pick a bay', 'mute') : selBusy.length ? chip(`Waits for ${esc(selBusy[0].id)}`, 'warn') : chip('Starts now', 'ok')}</div><div class="card-b"><div class="bays">${bays || `<p class="small muted">No bays yet.${isAdmin() ? ' Add them in Settings → Bays & team.' : ''}</p>`}</div></div></section>
    <div class="grid2 al">
      <section class="card"><div class="card-h"><h3>Team</h3><span class="small muted">${w.team.length} picked</span></div><div class="card-b stack">${techs || `<p class="small muted">No team members yet.${isAdmin() ? ' Add them in Settings → Bays & team.' : ''}</p>`}</div></section>
      <section class="card"><div class="card-h"><h3>Delivery promise</h3></div><div class="card-b stack">
        <div class="field"><label for="w-due">Promised delivery</label><input type="datetime-local" class="inp" id="w-due" value="${esc(w.due)}"></div>
        <div class="note info">${ico('clock')}<span>Suggested from service times: ${esc(sgTxt)}. ${w.due !== sg.at ? `<button class="link" data-act="wduesg">Use this</button>` : ''}</span></div>
        <div class="field"><span class="lbl">Priority</span><div>${segBtns('wprio', 'prio', ['Normal', 'Urgent'], w.prio)}</div></div>
        <div><div class="swrow"><span>Send job card to the customer on WhatsApp</span><input type="checkbox" class="sw" data-wtog="waJob" ${w.waJob ? 'checked' : ''} aria-label="Send job card on WhatsApp"></div>
        <div class="swrow"><span>Print A5 job card for the bay</span><input type="checkbox" class="sw" data-wtog="printJob" ${w.printJob ? 'checked' : ''} aria-label="Print job card"></div></div>
      </div></section>
    </div>`;
}
function validStep(n, quiet){
  const w = W(), f = w.f, miss = [];
  if (n === 1){
    const bad = [], d = digits(f.mob).replace(/^91(?=\d{10}$)/, '');
    if (!/^[6-9]\d{9}$/.test(d)){ bad.push('mob'); miss.push('a valid 10-digit mobile number'); }
    if (!f.name.trim()){ bad.push('name'); miss.push('the customer name'); }
    if (f.reg.replace(/[^a-z0-9]/gi, '').length < 4){ bad.push('reg'); miss.push('the car number'); }
    if (!f.model.trim()){ bad.push('model'); miss.push('the make & model'); }
    if (!quiet) ['mob', 'name', 'reg', 'model'].forEach(k => { const el = document.getElementById('w-' + k); if (el){ if (bad.includes(k)) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid'); } });
  }
  if (n === 3){
    if (!w.svcs.length) miss.push('at least one service');
    else if (w.svcs.includes('ppf-custom') && !ppfPanelsOf(w.svcs, w.panels).length) miss.push('the panels for “PPF · selected panels”');
  }
  if (miss.length && !quiet) toast('Please add ' + miss.join(', '));
  return !miss.length;
}
function goStep(n){
  const w = W();
  n = Math.max(1, Math.min(5, n));
  if (n > w.step){ for (let s = w.step; s < n; s++) if (!validStep(s)){ if (s !== w.step){ w.step = s; render(); validStep(s); } return; } }
  w.step = n; w.max = Math.max(w.max, n);
  saveDraft(); render(); window.scrollTo(0, 0);
}
async function wCreate(){
  const w = W();
  for (const s of [1, 3]) if (!validStep(s, true)){ w.step = s; render(); validStep(s); return; }
  if (Object.keys(S.uploading).length){ toast('Wait for the photos to finish uploading'); return; }
  const body = {f:w.f, seg:w.seg, fuel:w.fuel, dmg:w.dmg, photos:w.photos, bel:w.bel, svcs:w.svcs, panels:w.panels, ppf:w.ppf, coat:w.coat, disc:w.disc, adv:+w.adv || 0, mode:w.mode, terms:w.terms,
    sig:w.sig, bay:w.bay, team:w.team, due:w.due, prio:w.prio};
  const r = await act(() => post('/api/jobs', body));
  if (!r) return;
  const sendWA = w.waJob, print = w.printJob;
  resetDraft();
  await go('job', {id:r.id});
  toast(`Job card ${r.id} created`);
  if (sendWA){ S.after = print ? 'printjob' : null; openWA('jobcard', {id:r.id}); }
  else if (print) printJob();
}
function fillFromMatch(c, reg){
  const w = W(), car = (reg && c.cars.find(x => x.reg === reg)) || c.cars[0] || {reg:'', model:'', color:'', seg:null};
  Object.assign(w.f, {name:c.name, mob:c.ph, email:c.email || w.f.email, reg:car.reg, model:car.model, color:car.color || ''});
  if (car.seg !== null && car.seg !== undefined && car.seg >= 0 && car.seg <= 4) w.seg = car.seg;
  w.find = ''; S.find = null;
}
function initSig(){
  const c = $('#sig'); if (!c || !c.getContext) return;
  const r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  c.width = Math.max(1, Math.round(r.width * dpr)); c.height = Math.max(1, Math.round(r.height * dpr));
  const ctx = c.getContext('2d'); ctx.scale(dpr, dpr);
  ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
  const w = W();
  if (w.sig){ const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, r.width, r.height); img.src = w.sig; }
  let drawing = false, last = null, moved = false;
  const pos = e => { const b = c.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  c.onpointerdown = e => { e.preventDefault(); drawing = true; moved = false; last = pos(e); try { c.setPointerCapture(e.pointerId); } catch (_) {} };
  c.onpointermove = e => { if (!drawing) return; const p = pos(e); ctx.beginPath(); ctx.moveTo(last[0], last[1]); ctx.lineTo(p[0], p[1]); ctx.stroke(); last = p; moved = true; };
  c.onpointerup = c.onpointercancel = () => {
    if (!drawing) return; drawing = false; if (!moved) return;
    try { W().sig = c.toDataURL('image/png'); } catch (_) {}
    const s = $('#sig-state'); if (s) s.innerHTML = chip('Signed', 'ok');
    saveDraft();
  };
}
function compressPhoto(file){
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('Could not read that photo'));
    r.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not a photo we can read'));
      img.onload = () => {
        const M = 1280, k = Math.min(1, M / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
        try { c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); resolve(c.toDataURL('image/jpeg', .72)); } catch (_) { reject(new Error('Could not process that photo')); }
      };
      img.src = r.result;
    };
    r.readAsDataURL(file);
  });
}

/* ---------- invoices ---------- */
function vInvoices(d){
  const q = S.q, cur = d.cur, v = cur && cur.inv;
  const bal = v ? balOf(v) : 0;
  return ph('Invoices', 'Invoices', 'Each invoice prints on A4 and goes to the customer on WhatsApp with a link they can open, save as PDF and pay by UPI.') + `
  <div class="g-5-7">
    <section class="card">
      <div class="tabs" role="tablist"><button class="tab" role="tab" aria-selected="${S.invTab === 'all'}" data-act="itab" data-tab="all">All<span class="c">${d.counts.all}</span></button><button class="tab" role="tab" aria-selected="${S.invTab === 'unpaid'}" data-act="itab" data-tab="unpaid">Payment pending<span class="c">${d.counts.unpaid}</span></button></div>
      ${d.list.length ? `<ul class="list">${d.list.map(x => `<li data-act="pickinv" data-no="${esc(x.no)}" class="${v && x.no === v.no ? 'on' : ''}">
        <div class="grow"><div class="t">${esc(x.cust)}</div><div class="s"><span class="mono">${esc(x.no.slice(-4))}</span> · ${esc(fD(x.date))} · ${esc(x.reg)}</div></div>
        <div class="r"><b class="num">${inr(x.total)}</b>${invChip(x)}</div></li>`).join('')}</ul>` : `<div class="empty">${q ? `No invoices match “${esc(q)}”.` : S.invTab === 'unpaid' ? 'No pending payments.' : 'No invoices yet. Invoices are made from a job card once the car is ready.'}</div>`}
    </section>
    <div style="min-width:0">${v ? `
      <div class="inv-tools">
        <button class="btn" data-act="printinv">${ico('print')} Print</button>
        <button class="btn wa" data-act="wa" data-k="invoice" data-no="${esc(v.no)}">${ico('chat')} Send on WhatsApp</button>
        ${bal > 0 ? `<button class="btn pri" data-act="pay" data-no="${esc(v.no)}">${ico('rupee')} Record payment</button>` : ''}
        <div class="spacer"></div>
        ${!v.cancelled && cur.canCancel ? `<button class="btn danger sm" data-act="cancelinv" data-no="${esc(v.no)}">Cancel invoice</button>` : ''}
      </div>
      <div class="link-row" style="margin-bottom:10px">Customer link: <a href="${esc(cur.link)}" target="_blank" rel="noopener">${esc(cur.link)}</a> <button class="btn sm" data-act="copy" data-text="${esc(cur.link)}">Copy</button></div>
      <div class="paper-wrap">${invPaper(v, S.biz, cur.qr)}</div>` : ''}</div>
  </div>`;
}

/* ---------- customers ---------- */
function vCustomers(d){
  const q = S.q, c = d.cur;
  return ph('Customers', 'Customers', `${d.total} customer${d.total === 1 ? '' : 's'}. Every job card and invoice is saved against the customer's mobile number.`) + `
  <div class="g-7-5">
    <section class="card">${d.list.length ? `<div class="tw"><table class="tbl"><thead><tr><th>Name</th><th>Car</th><th class="num">Visits</th><th>Last visit</th>${canSales() ? '<th class="num">Total spent</th>' : ''}</tr></thead><tbody>
      ${d.list.map(x => `<tr data-act="pickcust" data-id="${x.id}" class="${c && x.id === c.id ? 'on' : ''}"><td><b>${esc(x.name)}</b><div class="sub">${esc(x.ph)}</div></td><td>${x.cars[0] ? `${esc(x.cars[0].model)}<div class="sub">${esc(x.cars[0].reg)}${x.cars.length > 1 ? ` +${x.cars.length - 1} more` : ''}</div>` : '—'}</td><td class="num">${x.visits}</td><td>${esc(fD(x.last))}</td>${canSales() ? `<td class="num">${inr(x.spent || 0)}</td>` : ''}</tr>`).join('')}
    </tbody></table></div>` : `<div class="empty">${q ? `No customers match “${esc(q)}”.` : 'No customers yet. They are added when you make a job card.'}</div>`}</section>
    ${c ? `<section class="card"><div class="card-h"><div class="row">${av(c.name)}<div><h3>${esc(c.name)}</h3><div class="small muted">Customer since ${esc(fDY(c.since))}</div></div></div></div>
      <div class="card-b sum-b">
        <div class="row"><button class="btn wa sm" data-act="wa" data-k="hello" data-id="${c.id}">${ico('chat')} WhatsApp</button><button class="btn sm" data-act="custjob">${ico('plus')} New job card</button></div>
        <div class="kv"><span>Mobile</span><b>${esc(c.ph)}</b></div>
        ${c.email ? `<div class="kv"><span>Email</span><b>${esc(c.email)}</b></div>` : ''}
        <div class="kv"><span>Visits</span><b>${c.visits}</b></div>
        ${c.spent !== undefined ? `<div class="kv"><span>Total spent</span><b>${inr(c.spent)}</b></div>` : ''}
        <h4 class="sub-h">Cars</h4>${c.cars.map(x => `<div class="row">${plate(x.reg)}<span>${esc(x.model)}</span></div>`).join('')}
        <h4 class="sub-h">Warranties</h4>${c.warr.length ? c.warr.map(w => `<div class="note info">${ico('shield')}<span>${esc(w)}</span></div>`).join('') : '<p class="small muted">No PPF or coating warranty on record.</p>'}
        <h4 class="sub-h">History</h4>
        <ul class="list" style="margin:0 -16px -16px">${[...c.jobs.map(j => `<li data-act="go" data-view="job" data-id="${esc(j.id)}"><div class="grow"><div class="t">${esc(j.names)}</div><div class="s">${esc(j.id)} · ${esc(fD(j.in))}</div></div>${stChip(j.status)}</li>`),
          ...c.invs.map(v => `<li data-act="go" data-view="invoices" data-no="${esc(v.no)}"><div class="grow"><div class="t">${esc(v.names)}</div><div class="s">Invoice ${esc(v.no.slice(-4))} · ${esc(fD(v.date))}</div></div><div class="r"><b class="num">${inr(v.total)}</b>${v.cancelled ? chip('Cancelled', 'bad') : v.bal <= 0 ? chip('Paid', 'ok') : chip('Due ' + inr(v.bal), 'warn')}</div></li>`)].join('') || '<li class="muted">No visits yet</li>'}</ul>
      </div></section>` : ''}
  </div>`;
}

/* ---------- settings ---------- */
function vSettings(d){
  const t = S.setTab, b = S.biz, p = S.perms;
  const tabs = [['business', 'Business & GST'], ['prices', 'Services & prices'], ['team', 'Bays & team'], ['logins', 'Logins & access']];
  let body = '';
  if (t === 'business') body = `<section class="card"><div class="card-b"><div class="grid2">
      <div class="field"><label for="b-name">Business name</label><input class="inp" id="b-name" data-biz="name" value="${esc(b.name)}"></div>
      <div class="field"><label for="b-ph">Phone (shown on invoices)</label><input class="inp" id="b-ph" data-biz="ph" value="${esc(b.ph)}"></div>
      <div class="field" style="grid-column:1/-1"><label for="b-addr">Address</label><input class="inp" id="b-addr" data-biz="addr" value="${esc(b.addr)}"></div>
      <div class="field"><label for="b-gstin">GSTIN</label><input class="inp up" id="b-gstin" data-biz="gstin" value="${esc(b.gstin)}" maxlength="15"></div>
      <div class="field"><label for="b-upi">UPI ID (for the pay QR on invoices)</label><input class="inp" id="b-upi" data-biz="upi" value="${esc(b.upi)}" placeholder="yourname@bank"></div>
    </div>
    <div class="swrow" style="margin-top:8px"><div><div class="t">Add GST on new job cards and invoices</div><div class="s">CGST 9% + SGST 9% with SAC codes. Turn off if you are not GST registered.</div></div><input type="checkbox" class="sw" data-bizsw="gst" ${b.gst ? 'checked' : ''} aria-label="Add GST"></div>
    <p class="small muted" id="biz-state">Changes save automatically.</p>
  </div></section>`;
  if (t === 'prices') body = `<section class="card"><div class="card-h"><h3>Price list</h3><button class="btn sm" data-act="addsvc">${ico('plus')} Add service</button></div>
    <div class="tw"><table class="tbl"><thead><tr><th>Service</th>${SEGS.map(x => `<th class="num">${x}</th>`).join('')}<th></th></tr></thead><tbody>
    ${CATS.slice(1).filter(c => S.catalog.some(s => s.cat === c)).map(c => `<tr class="grp"><td colspan="${SEGS.length + 2}">${c}</td></tr>` + S.catalog.filter(s => s.cat === c).map(s => `<tr><td>${esc(s.name)}${s.perSq ? '<div class="sub">₹ per sq ft</div>' : ''}</td>${(s.perSq || s.p).map((v, i) => `<td class="num"><input class="inp pin" data-price="${esc(s.id)}:${i}" inputmode="numeric" value="${v}" aria-label="${esc(s.name)} ${SEGS[i]} price"></td>`).join('')}<td>${s.id === 'ppf-custom' ? '' : `<button class="x" data-act="delsvc" data-id="${esc(s.id)}" aria-label="Remove ${esc(s.name)}">×</button>`}</td></tr>`).join('')).join('')}
    </tbody></table></div><p class="small muted" style="padding:10px 16px" id="price-state">Price changes save automatically and apply to new job cards. Old job cards and invoices keep their prices.</p></section>`;
  if (t === 'team') body = `<div class="grid2 al">
    <section class="card"><div class="card-h"><h3>Bays</h3><span class="small muted">${S.bays.length}</span></div>
      <ul class="list">${S.bays.map(x => `<li><div class="grow"><div class="t">${esc(x.id)}</div><div class="s">${esc(x.type)}</div></div><button class="x" data-act="delbay" data-id="${esc(x.id)}" aria-label="Remove ${esc(x.id)}">×</button></li>`).join('') || '<li class="muted">No bays yet</li>'}</ul>
      <div class="addrow"><input class="inp" id="nb-id" placeholder="Bay name" aria-label="New bay name" maxlength="30"><input class="inp" id="nb-type" placeholder="Used for (e.g. PPF)" aria-label="What the bay is used for" maxlength="30"><button class="btn" data-act="addbay">${ico('plus')} Add</button></div></section>
    <section class="card"><div class="card-h"><h3>Team</h3><span class="small muted">${S.staff.length}</span></div>
      <ul class="list">${S.staff.map(x => `<li>${av(x.n)}<div class="grow"><div class="t">${esc(x.n)}</div><div class="s">${esc(x.r)}</div></div><button class="x" data-act="delstaff" data-id="${esc(x.n)}" aria-label="Remove ${esc(x.n)}">×</button></li>`).join('') || '<li class="muted">No team members yet</li>'}</ul>
      <div class="addrow"><input class="inp" id="ns-n" placeholder="Name" aria-label="New team member name" maxlength="60"><input class="inp" id="ns-r" placeholder="Role (e.g. Polisher)" aria-label="New team member role" maxlength="60"><button class="btn" data-act="addstaff">${ico('plus')} Add</button></div></section>
  </div>`;
  if (t === 'logins') body = `<section class="card"><div class="card-h"><h3>Logins</h3><button class="btn sm" data-act="adduser">${ico('plus')} Add manager login</button></div>
      <ul class="list">${(d.users || []).map(u => `<li>${av(u.name)}<div class="grow"><div class="t">${esc(u.name)}${u.me ? ' (you)' : ''}</div><div class="s">${u.role === 'admin' ? 'Owner · Admin' : 'Manager'} · login ${esc(/^\d{10}$/.test(u.login) ? fmtPh(u.login) : u.login)}${u.active ? '' : ' · turned off'}</div></div>
        <button class="btn sm" data-act="resetpw" data-id="${u.id}" data-name="${esc(u.name)}">${u.me ? 'Change password' : 'Reset password'}</button>
        ${u.role === 'admin' ? '' : `<input type="checkbox" class="sw" data-useron="${u.id}" ${u.active ? 'checked' : ''} aria-label="Login on for ${esc(u.name)}">`}</li>`).join('')}</ul></section>
    <section class="card mt16"><div class="card-h"><h3>What managers can do</h3></div><div class="card-b">
      <p class="small muted" style="margin-bottom:6px">Managers can always make job cards and invoices and take payments. You decide the rest.</p>
      <div class="swrow"><div><div class="t">See sales figures</div><div class="s">Monthly sales, top services and how much each customer has spent.</div></div><input type="checkbox" class="sw" data-perm="sales" ${p.sales ? 'checked' : ''} aria-label="See sales figures"></div>
      <div class="swrow"><div><div class="t">Cancel invoices</div><div class="s">When off, only you can cancel an invoice.</div></div><input type="checkbox" class="sw" data-perm="cancel" ${p.cancel ? 'checked' : ''} aria-label="Cancel invoices"></div>
      <div class="swrow"><div><div class="t">Maximum discount</div><div class="s">Managers can't give more than this on a job card.</div></div><div class="row"><input class="inp pin" id="perm-disc" inputmode="numeric" value="${+p.disc}" aria-label="Maximum discount percent"> %</div></div>
      <div class="swrow"><div><div class="t">Settings, prices and logins</div><div class="s">Always owner only.</div></div>${chip(ico('lock') + ' Admin only', 'mute')}</div>
    </div></section>`;
  return ph('Settings', 'Settings', 'Only you (Admin) can see this page.') + `<div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button class="tab" role="tab" aria-selected="${t === k}" data-act="stab" data-tab="${k}">${l}</button>`).join('')}</div><div style="max-width:960px">${body}</div>`;
}
const vLock = () => `<div class="lock"><div class="lk-i">${ico('lock')}</div><h2>Settings are for the owner</h2><p>Business details, GST, prices, bays, team and logins are managed from the owner's (Admin) login.</p><button class="btn" data-act="go" data-view="home">${ico('back')} Back to home</button></div>`;
const vError = msg => `<div class="lock"><div class="lk-i">${ico('alert')}</div><h2>Couldn't load this page</h2><p>${esc(msg)}</p><div class="row" style="justify-content:center"><button class="btn pri" data-act="retry">Try again</button><button class="btn" data-act="go" data-view="home">${ico('back')} Home</button></div></div>`;

/* ================= routing & loading ================= */
const VIEWS = {home:vHome, jobs:vJobs, job:vJob, new:vNew, invoices:vInvoices, customers:vCustomers, settings:vSettings};
const LOADERS = {
  home:() => api('/api/home'),
  jobs:() => api(`/api/jobs?tab=${enc(S.jobTab)}&q=${enc(S.q)}`),
  job:() => api(`/api/jobs/${enc(S.jobId || '')}`),
  new:() => api('/api/workload'),
  invoices:async () => {
    const l = await api(`/api/invoices?tab=${enc(S.invTab)}&q=${enc(S.q)}`);
    const no = l.list.some(x => x.no === S.invNo) ? S.invNo : (l.list[0] && l.list[0].no);
    S.invNo = no || null;
    return {...l, cur:no ? await api(`/api/invoice?no=${enc(no)}`) : null};
  },
  customers:async () => {
    const l = await api(`/api/customers?q=${enc(S.q)}`);
    const id = l.list.some(x => x.id === S.custId) ? S.custId : (l.list[0] && l.list[0].id);
    S.custId = id || null;
    return {...l, cur:id ? await api(`/api/customers/${id}`) : null};
  },
  settings:async () => isAdmin() ? {users:(await api('/api/users')).users} : {}
};
const NAV = [['home', 'Home', 'home'], ['jobs', 'Job cards', 'job'], ['new', 'New job card', 'plus'], ['invoices', 'Invoices', 'bill'], ['customers', 'Customers', 'users'], ['settings', 'Settings', 'gear']];
function navHTML(){
  return NAV.map(([v, l, i]) => {
    const on = S.view === v || (v === 'jobs' && S.view === 'job'), lock = v === 'settings' && !isAdmin();
    const extra = lock ? ico('lock', 'lk') : v === 'new' && S.view !== 'new' && S.me && draftDirty() ? '<span class="dot-draft" title="Draft saved"></span>' : '';
    return `<button class="nv ${on ? 'on' : ''} ${lock ? 'dim' : ''}" data-act="go" data-view="${v}" ${on ? 'aria-current="page"' : ''}>${ico(i)}<span>${l}</span>${extra}</button>`;
  }).join('');
}
function render(){
  if (!S.me) return;
  $('#nav').innerHTML = navHTML();
  $('#biz-name').textContent = S.biz.name || '';
  $('#rail-foot').innerHTML = `Logged in as ${esc(S.me.name)} (${isAdmin() ? 'Admin' : 'Manager'}). <button data-act="logout">Log out</button>`;
  $('#who').innerHTML = `<button class="who-btn" data-act="account" aria-label="Account">${av(S.me.name)}<span class="who-t"><b>${esc(S.me.name)}</b><br><span class="muted">${isAdmin() ? 'Admin' : 'Manager'}</span></span></button>`;
  const v = S.view;
  let html;
  try { html = (v === 'settings' && !isAdmin()) ? vLock() : S.data ? VIEWS[v](S.data) : vError('No data'); }
  catch (e){ console.error(e); html = vError('Something went wrong showing this page.'); }
  $('#content').innerHTML = html;
  if (v === 'new' && W().step === 4) initSig();
}
function rerender(){
  const a = document.activeElement, id = a && a.id, s = a && a.selectionStart, y = window.scrollY;
  render();
  if (y) window.scrollTo(0, y);
  if (id){ const n = document.getElementById(id); if (n && n.focus){ n.focus(); try { if (s !== null && s !== undefined) n.setSelectionRange(s, s); } catch (_) {} } }
}
async function load(scrollTop){
  const my = ++S.nav;
  if (S.view === 'settings' && !isAdmin()){ S.data = {}; render(); return; }
  document.body.classList.add('busy');
  try {
    const data = await LOADERS[S.view]();
    if (my !== S.nav) return;
    S.data = data; render(); if (scrollTop) window.scrollTo(0, 0);
  } catch (e){
    if (my !== S.nav || !S.me) return;
    S.data = null; $('#content').innerHTML = vError(e.message); $('#nav').innerHTML = navHTML();
  } finally { if (my === S.nav) document.body.classList.remove('busy'); }
}
function hashFor(){ return S.view === 'job' && S.jobId ? `job/${S.jobId}` : S.view; }
function fromHash(){
  const h = decodeURIComponent(location.hash.slice(1) || 'home'), [v, id] = h.split('/');
  if (v === 'job' && id) S.jobId = id;
  S.view = VIEWS[v] && !(v === 'job' && !S.jobId) ? v : 'home';
}
async function go(view, d = {}){
  if (d.id && view === 'job') S.jobId = d.id;
  if (d.no) S.invNo = d.no;
  if (d.cust) S.custId = +d.cust;
  if (view === 'invoices'){ if (d.tab) S.invTab = d.tab; else if (d.no) S.invTab = 'all'; }
  if (view === 'jobs' && d.tab) S.jobTab = d.tab;
  if (d.no || d.cust || (d.id && view === 'job')){ S.q = ''; $('#q').value = ''; }
  S.view = VIEWS[view] ? view : 'home';
  const h = hashFor();
  if (location.hash.slice(1) !== h){ try { history.pushState(null, '', '#' + h); } catch (_) { location.hash = h; } }
  await load(true);
}
window.addEventListener('popstate', () => { if (!S.me) return; const before = S.view + S.jobId; fromHash(); if (S.view + S.jobId !== before) load(true); });

/* ================= WhatsApp, print, modals ================= */
async function waMsg(k, d){
  const b = S.biz.name, first = n => String(n || '').trim().split(/\s+/)[0] || 'there';
  if (k === 'estimate'){
    const w = W(), lines = wLines(), t = totals(lines, w.disc, !!S.biz.gst), adv = Math.min(+w.adv || 0, t.total);
    return {title:'Estimate', to:w.f.name || 'Customer', ph:w.f.mob,
      text:`Hi ${first(w.f.name)}, here is your estimate from ${b}.\n\n${w.f.model || 'Your car'}${w.f.reg ? ` (${w.f.reg.toUpperCase()})` : ''}\n${lines.map(l => `• ${l.name}: ${inr(l.amt)}`).join('\n') || '• Services to be added'}${t.disc ? `\nDiscount ${w.disc}%: −${inr(t.disc)}` : ''}${t.half ? `\nGST 18%: ${inr(t.total - t.taxable)}` : ''}\nTotal: ${inr(t.total)}${adv ? `\nAdvance: ${inr(adv)} (${w.mode})` : ''}\n\n– Team ${b}`};
  }
  if (k === 'invoice' || k === 'due'){
    const cur = S.data && S.data.cur && S.data.cur.inv && S.data.cur.inv.no === d.no ? S.data.cur : await api(`/api/invoice?no=${enc(d.no)}`);
    const v = cur.inv, t = invTot(v), bal = balOf(v);
    if (k === 'due') return {title:'Payment reminder', to:v.cust, ph:v.ph, jobId:v.jobId, text:`Hi ${first(v.cust)}, a gentle reminder that ${inr(bal)} is pending on invoice ${v.no} for your ${v.car} (${v.reg}).\n\nView and pay here: ${cur.link}\n\nThank you!\n– Team ${b}`};
    return {title:'Invoice', to:v.cust, ph:v.ph, jobId:v.jobId, text:`Hi ${first(v.cust)}, thank you for choosing ${b}.\n\nInvoice ${v.no}\n${v.car} (${v.reg})\nTotal: ${inr(t.total)}\nPaid: ${inr(paidOf(v))}${bal > 0 ? `\nBalance: ${inr(bal)}` : ''}${v.warr.length ? `\n\nWarranty:\n${v.warr.map(w => '• ' + w).join('\n')}` : ''}\n\nView, save as PDF${bal > 0 ? ' or pay' : ''}: ${cur.link}\n\n– Team ${b}`};
  }
  if (k === 'hello'){
    const c = S.data && S.data.cur && S.data.cur.id === +d.id ? S.data.cur : await api(`/api/customers/${enc(d.id)}`);
    return {title:'Message', to:c.name, ph:c.ph, text:`Hi ${first(c.name)}, greetings from ${b}! ${c.cars[0] ? `It's been a while since your ${c.cars[0].model} visited us. ` : ''}Reply with a day that suits you and we'll keep a slot ready.\n\n– Team ${b}`};
  }
  const jd = S.data && S.data.job && S.data.job.id === d.id ? S.data : await api(`/api/jobs/${enc(d.id)}`), j = jd.job, t = jobTot(j);
  if (k === 'jobcard') return {title:'Job card', to:j.cust, ph:j.ph, jobId:j.id, text:`Hi ${first(j.cust)}, your ${j.car} (${j.reg}) is checked in at ${b}.\n\nJob card: ${j.id}\n${j.lines.map(l => `• ${l.name}`).join('\n')}\nEstimate: ${inr(t.total)}${t.half ? ' incl. GST' : ''}${j.paid ? `\nAdvance paid: ${inr(j.paid)}` : ''}\nExpected delivery: ${fDT(j.due)}\n\nTrack your car: ${jd.link}\n\n– Team ${b}`};
  if (k === 'ready') return {title:'Car ready', to:j.cust, ph:j.ph, jobId:j.id, text:`Hi ${first(j.cust)}, your ${j.car} (${j.reg}) is ready for pickup!\n\nBalance to pay: ${inr(Math.max(0, j.bal))}\n\n– Team ${b}`};
  return {title:'Work update', to:j.cust, ph:j.ph, jobId:j.id, text:`Hi ${first(j.cust)}, a quick update on your ${j.car} (${j.reg}): work is going on${j.bay ? ' in ' + j.bay : ''} and is on track for ${fDT(j.due)}.\n\nTrack your car: ${jd.link}\n\n– Team ${b}`};
}
async function openWA(k, d){
  let m;
  try { m = await waMsg(k, d || {}); } catch (e){ toast(e.message); return; }
  const num = digits(m.ph).replace(/^91(?=\d{10}$)/, '');
  S.wa = {jobId:m.jobId || null, title:m.title, url:/^\d{10}$/.test(num) ? `https://wa.me/91${num}?text=${enc(m.text)}` : null, text:m.text};
  modal(`<div class="mh"><div><p class="eyebrow">WhatsApp</p><h3>${esc(m.title)}</h3></div><button class="x" data-act="close" aria-label="Close">×</button></div>
    <div class="small">To <b>${esc(m.to)}</b>${num ? ` · +91 ${esc(fmtPh(num))}` : ''}</div>
    <div class="chat"><div class="bubble">${esc(m.text)}</div></div>
    ${S.wa.url ? `<button class="btn wa" data-act="wasend">${ico('chat')} Open WhatsApp</button>` : `<div class="note warn">${ico('alert')}<span>Add a valid 10-digit mobile number first.</span></div>`}
    <button class="btn" data-act="copy" data-text="${esc(m.text)}">Copy message</button>
    <p class="small muted">WhatsApp opens with this message filled in. Check it and tap Send.</p>`);
}
function printHTML(html, size){
  const root = $('#print-root'); root.innerHTML = html;
  $('#page-size').textContent = `@page { size: ${size}; margin: ${size === 'A5' ? '8mm' : '12mm'}; }`;
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); root.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  const imgs = [...root.querySelectorAll('img')].filter(i => !i.complete);
  Promise.all(imgs.map(i => new Promise(r => { i.onload = i.onerror = r; }))).then(() => setTimeout(() => window.print(), 60));
}
function printJob(){
  const d = S.data; if (!d || !d.job) return;
  const j = d.job;
  modal(`<div class="mh"><div><p class="eyebrow">Print preview · A5</p><h3>Job card ${esc(j.id)}</h3></div><button class="x" data-act="close" aria-label="Close">×</button></div>
    <div class="paper-wrap">${jobPaper(j, S.biz, d.qr, j.sig ? upUrl(j.sig) : '')}</div>
    <div class="m-row"><button class="btn" data-act="close">Close</button><button class="btn pri" data-act="doprintjob">${ico('print')} Print</button></div>`, 'wide');
}
function modal(html, cls = ''){ $('#modal-root').innerHTML = `<div class="scrim" data-act="scrim"><div class="modal ${cls}" role="dialog" aria-modal="true">${html}</div></div>`; const b = $('#modal-root input, #modal-root button'); if (b && b.focus) b.focus(); }
function closeModal(){ $('#modal-root').innerHTML = ''; }
let tt;
function toast(t){ const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(tt); tt = setTimeout(() => { el.hidden = true; }, 4000); }
function confirmBox(title, body, okLabel, actName, data = {}){
  modal(`<div class="mh"><h3>${title}</h3><button class="x" data-act="close" aria-label="Close">×</button></div><p>${body}</p>
    <div class="m-row"><button class="btn" data-act="close">Keep</button><button class="btn pri" data-act="${actName}" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}>${okLabel}</button></div>`);
}
function payModal(no){
  const v = S.data && S.data.cur && S.data.cur.inv; if (!v || v.no !== no) return;
  S.payMode = 'UPI';
  modal(`<div class="mh"><div><p class="eyebrow">${esc(v.cust)} · ${esc(v.no.slice(-4))}</p><h3>Record payment</h3></div><button class="x" data-act="close" aria-label="Close">×</button></div>
    <div class="field"><label for="f-pay">Amount (₹) · balance ${inr(balOf(v))}</label><input class="inp" id="f-pay" value="${balOf(v)}" inputmode="numeric" autocomplete="off"></div>
    <div class="field"><span class="lbl">Mode</span><div><div class="seg" id="pay-seg">${PAY_MODES.map(x => `<button aria-pressed="${x === 'UPI'}" data-act="paymode" data-v="${x}">${x}</button>`).join('')}</div></div></div>
    <div class="m-row"><button class="btn" data-act="close">Cancel</button><button class="btn pri" data-act="paysave" data-no="${esc(v.no)}">${ico('check')} Save payment</button></div>`);
}
function accountModal(){
  modal(`<div class="mh"><div><p class="eyebrow">${isAdmin() ? 'Owner · Admin' : 'Manager'}</p><h3>${esc(S.me.name)}</h3></div><button class="x" data-act="close" aria-label="Close">×</button></div>
    <form id="pw-form" class="stack"><div class="field"><label for="pw-cur">Current password</label><input class="inp" id="pw-cur" type="password" autocomplete="current-password" required></div>
    <div class="field"><label for="pw-new">New password (at least 6 characters)</label><input class="inp" id="pw-new" type="password" autocomplete="new-password" minlength="6" required></div>
    <button class="btn" type="submit">Change password</button></form>
    <button class="btn danger" data-act="logout">Log out</button>`);
}
function addSvcModal(){
  modal(`<div class="mh"><h3>Add a service</h3><button class="x" data-act="close" aria-label="Close">×</button></div>
    <div class="field"><label for="ns-name">Service name</label><input class="inp" id="ns-name" autocomplete="off" maxlength="80"></div>
    <div class="grid2"><div class="field"><label for="ns-cat">Category</label><select class="inp" id="ns-cat">${CATS.slice(1).map(c => `<option>${c}</option>`).join('')}</select></div>
    <div class="field"><label for="ns-hrs">Work time (hours)</label><input class="inp" id="ns-hrs" inputmode="decimal" value="2"></div></div>
    <div class="grid2">${SEGS.map((s, i) => `<div class="field"><label for="ns-p${i}">${s} (₹)</label><input class="inp" id="ns-p${i}" inputmode="numeric" placeholder="0"></div>`).join('')}</div>
    <div class="m-row"><button class="btn" data-act="close">Cancel</button><button class="btn pri" data-act="addsvcok">${ico('check')} Add service</button></div>`);
}
function userModal(){
  modal(`<div class="mh"><h3>Add a manager login</h3><button class="x" data-act="close" aria-label="Close">×</button></div>
    <form id="user-form" class="stack"><div class="field"><label for="u-name">Name</label><input class="inp" id="u-name" required maxlength="60"></div>
    <div class="field"><label for="u-login">Mobile number (used to log in)</label><input class="inp" id="u-login" required inputmode="tel" autocomplete="off"></div>
    <div class="field"><label for="u-pw">Password (at least 6 characters)</label><input class="inp" id="u-pw" type="text" required minlength="6" autocomplete="off"><span class="hint">Share it with the manager. They can change it after logging in.</span></div>
    <div class="m-row"><button class="btn" type="button" data-act="close">Cancel</button><button class="btn pri" type="submit">Add login</button></div></form>`);
}
function resetPwModal(id, name){
  modal(`<div class="mh"><h3>${+id === S.me.id ? 'Change your password' : `Reset password for ${esc(name)}`}</h3><button class="x" data-act="close" aria-label="Close">×</button></div>
    <form id="reset-form" class="stack" data-id="${+id}">${+id === S.me.id ? `<div class="field"><label for="pw-cur">Current password</label><input class="inp" id="pw-cur" type="password" required autocomplete="current-password"></div>` : ''}
    <div class="field"><label for="rp-pw">New password (at least 6 characters)</label><input class="inp" id="rp-pw" type="text" required minlength="6" autocomplete="off"></div>
    <div class="m-row"><button class="btn" type="button" data-act="close">Cancel</button><button class="btn pri" type="submit">Save password</button></div></form>`);
}

/* ================= settings saving ================= */
let bizT, priceT, permT;
function saveBiz(){ clearTimeout(bizT); bizT = setTimeout(async () => { const st = $('#biz-state'); try { const r = await put('/api/settings/biz', S.biz); S.biz = r.biz; $('#biz-name').textContent = S.biz.name; if (st) st.textContent = 'Saved.'; } catch (e){ if (st) st.textContent = e.message; else toast(e.message); } }, 700); }
function savePrices(){ clearTimeout(priceT); priceT = setTimeout(async () => { const st = $('#price-state'); try { const r = await put('/api/settings/catalog', {catalog:S.catalog}); S.catalog = r.catalog; if (st) st.textContent = 'Prices saved.'; } catch (e){ toast(e.message); } }, 700); }
function savePerms(){ clearTimeout(permT); permT = setTimeout(async () => { try { const r = await put('/api/settings/perms', S.perms); S.perms = r.perms; toast('Manager access updated'); } catch (e){ toast(e.message); } }, 500); }

/* ================= events ================= */
document.addEventListener('submit', async e => {
  const f = e.target; e.preventDefault();
  const err = $('#auth-err'), val = id => (document.getElementById(id) || {}).value || '';
  if (f.id === 'login-form'){
    try { await post('/api/login', {login:val('l-login'), password:val('l-pw')}); await enterApp(); } catch (x){ if (err) err.textContent = x.message; }
  }
  if (f.id === 'setup-form'){
    if (val('s-pw') !== val('s-pw2')){ if (err) err.textContent = 'The two passwords are different'; return; }
    try { await post('/api/setup', {bizName:val('s-biz'), name:val('s-name'), login:val('s-login'), password:val('s-pw')}); await enterApp(); toast('Welcome! Set your GSTIN and UPI ID in Settings.'); } catch (x){ if (err) err.textContent = x.message; }
  }
  if (f.id === 'pw-form'){ const r = await act(() => post('/api/me/password', {current:val('pw-cur'), next:val('pw-new')}), 'Password changed'); if (r) closeModal(); }
  if (f.id === 'user-form'){ const r = await act(() => post('/api/users', {name:val('u-name'), login:val('u-login'), password:val('u-pw')}), 'Manager login added'); if (r){ closeModal(); load(false); } }
  if (f.id === 'reset-form'){
    const id = +f.dataset.id;
    const r = id === S.me.id ? await act(() => post('/api/me/password', {current:val('pw-cur'), next:val('rp-pw')}), 'Password changed') : await act(() => post(`/api/users/${id}/password`, {password:val('rp-pw')}), 'Password reset. Tell the manager the new one.');
    if (r) closeModal();
  }
});
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const d = el.dataset;
  switch (d.act){
    case 'go': go(d.view, d); break;
    case 'retry': load(true); break;
    case 'jtab': S.jobTab = d.tab; load(false); break;
    case 'itab': S.invTab = d.tab; load(false); break;
    case 'stab': S.setTab = d.tab; render(); break;
    case 'pickinv': S.invNo = d.no; await act(async () => { S.data.cur = await api(`/api/invoice?no=${enc(d.no)}`); render(); }); break;
    case 'pickcust': S.custId = +d.id; await act(async () => { S.data.cur = await api(`/api/customers/${enc(d.id)}`); render(); }); break;
    case 'clearq': S.q = ''; $('#q').value = ''; load(false); break;
    case 'account': accountModal(); break;
    case 'logout': await post('/api/logout').catch(() => {}); S.me = null; draftCache = null; closeModal(); showAuth({}); break;
    case 'copy': try { await navigator.clipboard.writeText(d.text); toast('Copied'); } catch (_) { toast('Could not copy. Select the text and copy it.'); } break;
    /* wizard */
    case 'wstep': goStep(+d.step); break;
    case 'wnext': goStep(W().step + 1); break;
    case 'wprev': goStep(W().step - 1); break;
    case 'wreset': confirmBox('Start over?', 'This clears the job card you are filling in. Saved job cards are not touched.', 'Clear draft', 'wresetok'); break;
    case 'wresetok': resetDraft(); closeModal(); render(); toast('Draft cleared'); break;
    case 'wfill': if (S.find && S.find.match){ fillFromMatch(S.find.match); saveDraft(); rerender(); toast('Customer details filled in'); } break;
    case 'wseg': W().seg = +d.v; saveDraft(); rerender(); break;
    case 'wfuel': W().fuel = d.v; saveDraft(); rerender(); break;
    case 'wtool': W().tool = d.t; rerender(); break;
    case 'panel': {
      const w = W();
      if (d.mode === 'damage'){ if (w.tool === 'none') delete w.dmg[d.id]; else w.dmg[d.id] = w.tool; }
      else if (w.svcs.includes('ppf-custom') && PANEL[d.id] && !PANEL[d.id].glass) w.panels = w.panels.includes(d.id) ? w.panels.filter(x => x !== d.id) : [...w.panels, d.id];
      saveDraft(); rerender(); break;
    }
    case 'wunmark': delete W().dmg[d.id]; saveDraft(); rerender(); break;
    case 'wunphoto': e.preventDefault(); delete W().photos[d.s]; saveDraft(); rerender(); break;
    case 'wbel': { const w = W(); w.bel = w.bel.includes(d.v) ? w.bel.filter(x => x !== d.v) : [...w.bel, d.v]; saveDraft(); rerender(); break; }
    case 'wcat': W().cat = d.v; rerender(); break;
    case 'wsvc': {
      const w = W();
      if (w.svcs.includes(d.id)) w.svcs = w.svcs.filter(x => x !== d.id);
      else { if (COVER.includes(d.id)) w.svcs = w.svcs.filter(x => !COVER.includes(x)); w.svcs.push(d.id); }
      if (!w.dueSet) w.due = '';
      saveDraft(); rerender(); break;
    }
    case 'wppf': W().ppf[d.k] = d.k === 'warr' ? +d.v : d.v; saveDraft(); rerender(); break;
    case 'wcoat': W().coat[d.k] = +d.v; saveDraft(); rerender(); break;
    case 'wmode': W().mode = d.v; saveDraft(); rerender(); break;
    case 'wterm': { const w = W(); w.terms = w.terms.includes(d.v) ? w.terms.filter(x => x !== d.v) : [...w.terms, d.v]; saveDraft(); rerender(); break; }
    case 'wsigclear': W().sig = null; saveDraft(); rerender(); break;
    case 'wbay': { const w = W(); w.bay = w.bay === d.v ? '' : d.v; saveDraft(); rerender(); break; }
    case 'wtech': { const w = W(); w.team = w.team.includes(d.v) ? w.team.filter(x => x !== d.v) : [...w.team, d.v]; saveDraft(); rerender(); break; }
    case 'wprio': W().prio = d.v; saveDraft(); rerender(); break;
    case 'wduesg': { const w = W(); w.due = suggestDue(w.svcs, S.catalog).at; w.dueSet = false; saveDraft(); rerender(); break; }
    case 'wcreate': wCreate(); break;
    /* jobs */
    case 'ready': { const r = await act(() => post(`/api/jobs/${enc(d.id)}/ready`), 'Marked ready'); if (r){ await load(false); openWA('ready', {id:d.id}); } break; }
    case 'mkinv': confirmBox('Make invoice and deliver?', 'The invoice is made from this job card, the advance is adjusted, and the car is marked delivered.', 'Make invoice', 'mkinvok', {id:d.id}); break;
    case 'mkinvok': { closeModal(); const r = await act(() => post(`/api/jobs/${enc(d.id)}/invoice`), x => `Invoice ${x.no.slice(-4)} made. Car marked delivered.`); if (r) go('invoices', {no:r.no}); break; }
    case 'custjob': { const c = S.data && S.data.cur; if (!c) break; resetDraft(); fillFromMatch({name:c.name, ph:c.ph, email:c.email, cars:c.cars.map(x => ({reg:x.reg, model:x.model, color:x.color, seg:x.seg}))}); saveDraft(true); go('new'); toast('Customer details filled in'); break; }
    case 'printjob': printJob(); break;
    case 'doprintjob': { const j = S.data && S.data.job; closeModal(); if (j) printHTML(jobPaper(j, S.biz, S.data.qr, j.sig ? upUrl(j.sig) : ''), 'A5'); break; }
    case 'printinv': { const c = S.data && S.data.cur; if (c) printHTML(invPaper(c.inv, S.biz, c.qr), 'A4'); break; }
    /* whatsapp */
    case 'wa': openWA(d.k, d); break;
    case 'wasend': {
      const ctx = S.wa; closeModal();
      if (ctx && ctx.url){ window.open(ctx.url, '_blank', 'noopener'); if (ctx.jobId) post(`/api/jobs/${enc(ctx.jobId)}/log`, {text:`${ctx.title} sent on WhatsApp`}).then(() => { if (S.view === 'job' && S.jobId === ctx.jobId) load(false); }).catch(() => {}); }
      if (S.after === 'printjob'){ S.after = null; setTimeout(printJob, 300); }
      break;
    }
    /* invoices */
    case 'pay': payModal(d.no); break;
    case 'paymode': S.payMode = d.v; document.querySelectorAll('#pay-seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === d.v))); break;
    case 'paysave': {
      const inp = $('#f-pay'), amt = Math.round(+digits(inp && inp.value));
      if (!amt){ toast('Enter an amount'); if (inp) inp.focus(); break; }
      const r = await act(() => post('/api/invoice/pay', {no:d.no, amt, mode:S.payMode}), x => `${inr(x.paid)} saved by ${S.payMode}${x.extra ? ` (only ${inr(x.paid)} was due)` : ''}`);
      if (r){ closeModal(); load(false); }
      break;
    }
    case 'cancelinv': confirmBox('Cancel this invoice?', `${esc(d.no)} stays in your records marked Cancelled. GST rules don't allow reusing the number.`, 'Cancel invoice', 'cancelok', {no:d.no}); break;
    case 'cancelok': { closeModal(); const r = await act(() => post('/api/invoice/cancel', {no:d.no}), 'Invoice cancelled'); if (r) load(false); break; }
    /* settings */
    case 'addsvc': addSvcModal(); break;
    case 'addsvcok': {
      const name = ($('#ns-name').value || '').trim(), p = SEGS.map((_, i) => +digits($('#ns-p' + i).value) || 0);
      if (!name){ toast('Enter the service name'); $('#ns-name').focus(); break; }
      if (!p.some(Boolean)){ toast('Enter a price for at least one segment'); break; }
      const hrs = Math.max(.5, Math.min(200, parseFloat($('#ns-hrs').value) || 2));
      const next = [...S.catalog, {id:'c' + Date.now().toString(36), cat:$('#ns-cat').value, name, dur:`${hrs} h`, hrs, p:p.map(x => x || Math.max(...p))}];
      const r = await act(() => put('/api/settings/catalog', {catalog:next}), `${name} added to the price list`);
      if (r){ S.catalog = r.catalog; closeModal(); render(); }
      break;
    }
    case 'delsvc': { const s = svc(d.id); if (s) confirmBox('Remove this service?', `“${esc(s.name)}” is removed from the price list. Old job cards and invoices keep it.`, 'Remove', 'delsvcok', {id:d.id}); break; }
    case 'delsvcok': { closeModal(); const r = await act(() => put('/api/settings/catalog', {catalog:S.catalog.filter(s => s.id !== d.id)}), 'Service removed'); if (r){ S.catalog = r.catalog; render(); } break; }
    case 'addbay': {
      const id = ($('#nb-id').value || '').trim(), type = ($('#nb-type').value || '').trim() || 'General';
      if (!id){ toast('Enter a bay name'); $('#nb-id').focus(); break; }
      const r = await act(() => put('/api/settings/bays', {bays:[...S.bays, {id, type}]}), `${id} added`); if (r){ S.bays = r.bays; render(); }
      break;
    }
    case 'delbay': { const r = await act(() => put('/api/settings/bays', {bays:S.bays.filter(b => b.id !== d.id)}), `${d.id} removed`); if (r){ S.bays = r.bays; render(); } break; }
    case 'addstaff': {
      const n = ($('#ns-n').value || '').trim(), role = ($('#ns-r').value || '').trim() || 'Team member';
      if (!n){ toast('Enter a name'); $('#ns-n').focus(); break; }
      const r = await act(() => put('/api/settings/staff', {staff:[...S.staff, {n, r:role}]}), `${n} added to the team`); if (r){ S.staff = r.staff; render(); }
      break;
    }
    case 'delstaff': confirmBox('Remove from team?', `${esc(d.id)} won't show up when assigning new job cards. Old job cards keep the name.`, 'Remove', 'delstaffok', {id:d.id}); break;
    case 'delstaffok': { closeModal(); const r = await act(() => put('/api/settings/staff', {staff:S.staff.filter(s => s.n !== d.id)}), 'Removed from the team'); if (r){ S.staff = r.staff; render(); } break; }
    case 'adduser': userModal(); break;
    case 'resetpw': resetPwModal(d.id, d.name); break;
    case 'close': S.after = null; closeModal(); break;
    case 'scrim': if (e.target === el){ S.after = null; closeModal(); } break;
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('#modal-root').innerHTML){ S.after = null; closeModal(); return; }
  if (e.key === 'Enter' && e.target.id === 'q' && !['jobs', 'invoices', 'customers'].includes(S.view)){ S.jobTab = 'all'; go('jobs'); return; }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.getAttribute && e.target.getAttribute('role') === 'button' && !/^(BUTTON|INPUT|TEXTAREA|SELECT|A)$/.test(e.target.tagName)){
    e.preventDefault(); e.target.dispatchEvent(new MouseEvent('click', {bubbles:true}));
  }
});
let qT, findT;
document.addEventListener('input', e => {
  const t = e.target, ds = t.dataset || {};
  if (t.id === 'q'){ S.q = t.value.trim(); clearTimeout(qT); if (['jobs', 'invoices', 'customers'].includes(S.view)) qT = setTimeout(() => load(false), 250); return; }
  if (t.id === 'w-find'){
    const w = W(); w.find = t.value; saveDraft();
    const qv = t.value.trim(), m = $('#find-match');
    clearTimeout(findT);
    if (norm(qv).length < 4){ S.find = null; if (m) m.innerHTML = findMatchHTML(); return; }
    if (m) m.innerHTML = findMatchHTML();
    findT = setTimeout(async () => { try { const r = await api(`/api/find?q=${enc(qv)}`); if (W().find.trim() === qv){ S.find = {q:qv, match:r.match}; const mm = $('#find-match'); if (mm) mm.innerHTML = findMatchHTML(); } } catch (_) {} }, 300);
    return;
  }
  if (ds.wf){ W().f[ds.wf] = t.value; t.removeAttribute('aria-invalid'); const s = $('#wiz-sum'); if (s) s.innerHTML = wizSummary(); saveDraft(); return; }
  if (ds.wppf){ W().ppf[ds.wppf] = t.value; saveDraft(); return; }
  if (ds.wcoat){ W().coat[ds.wcoat] = t.value; saveDraft(); return; }
  if (t.id === 'w-disc'){
    const w = W(), lim = discLimit(); let v = Math.min(100, +digits(t.value) || 0); const over = v > lim;
    if (over){ v = lim; t.value = String(lim); }
    w.disc = v;
    const tot = wTot();
    if (w.adv > tot.total){ w.adv = tot.total; const a = $('#w-adv'); if (a) a.value = w.adv || ''; }
    const set = (s, h) => { const n = $(s); if (n) n.innerHTML = h; };
    set('#disc-tag', discTag(over)); set('#disc-amt', '−' + inr(tot.disc)); set('#cg', f2(tot.half)); set('#sg', f2(tot.half)); set('#etot', inr(tot.total));
    set('#adv-note', w.adv ? `Balance at delivery: ${inr(Math.max(0, tot.total - w.adv))}` : 'Optional');
    set('#wiz-sum', wizSummary()); saveDraft(); return;
  }
  if (t.id === 'w-adv'){
    const w = W(), tot = wTot(); let v = +digits(t.value) || 0, capped = false;
    if (v > tot.total){ v = tot.total; t.value = String(v); capped = true; }
    w.adv = v;
    const n = $('#adv-note'); if (n) n.textContent = capped ? `Advance can't be more than the estimate (${inr(tot.total)})` : v ? `Balance at delivery: ${inr(Math.max(0, tot.total - v))}` : 'Optional';
    const s = $('#wiz-sum'); if (s) s.innerHTML = wizSummary(); saveDraft(); return;
  }
  if (t.id === 'w-due'){ const w = W(); if (validDT(t.value)){ w.due = t.value.slice(0, 16); w.dueSet = true; saveDraft(); } return; }
  if (ds.biz){ S.biz[ds.biz] = t.value; const st = $('#biz-state'); if (st) st.textContent = 'Saving…'; saveBiz(); return; }
  if (ds.price){ const [id, i] = ds.price.split(':'), s = svc(id); if (s){ (s.perSq || s.p)[+i] = +digits(t.value) || 0; const st = $('#price-state'); if (st) st.textContent = 'Saving…'; savePrices(); } return; }
  if (t.id === 'perm-disc'){ S.perms.disc = Math.min(100, +digits(t.value) || 0); savePerms(); return; }
});
document.addEventListener('change', async e => {
  const t = e.target, ds = t.dataset || {};
  if (ds.perm){ S.perms[ds.perm] = t.checked; savePerms(); return; }
  if (ds.bizsw === 'gst'){ S.biz.gst = t.checked; saveBiz(); toast(t.checked ? 'GST will be added on new job cards' : 'New job cards will be made without GST'); return; }
  if (ds.useron){ const r = await act(() => post(`/api/users/${ds.useron}/active`, {active:t.checked}), t.checked ? 'Login turned on' : 'Login turned off'); if (!r) t.checked = !t.checked; return; }
  if (ds.wtog){ W()[ds.wtog] = t.checked; saveDraft(); return; }
  if (t.id === 'w-due' && !validDT(t.value)){ t.value = W().due; return; }
  if (ds.photo && t.files && t.files[0]){
    const slot = ds.photo, file = t.files[0];
    S.uploading[slot] = true; if (S.view === 'new') rerender();
    try { const dataUrl = await compressPhoto(file); const r = await post('/api/uploads', {dataUrl}); W().photos[slot] = r.id; saveDraft(); }
    catch (x){ toast(x.message); }
    finally { delete S.uploading[slot]; if (S.view === 'new') rerender(); }
  }
});

boot();
