/* DetailDesk shared code: loaded by the browser (public/shared.js) and by the server (require). Keep it free of DOM calls at load time. */
/* ================= helpers ================= */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const inr = n => '₹' + Math.round(n).toLocaleString('en-IN');
const f2 = n => (+n).toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2});
const digits = s => String(s ?? '').replace(/\D/g, '');
const fmtPh = s => { const d = digits(s).slice(-10); return d.length === 10 ? d.slice(0, 5) + ' ' + d.slice(5) : String(s || ''); };
const norm = s => String(s ?? '').toLowerCase().replace(/\s+/g, '');
const hit = (q, ...xs) => !q || xs.some(x => norm(x).includes(norm(q)));
const initials = n => String(n || '?').trim().split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase();
const chip = (t, tone = '') => `<span class="chip ${tone}">${t}</span>`;
const plate = r => `<span class="plate"><b>IND</b><span>${esc(r)}</span></span>`;
const av = n => `<span class="av" title="${esc(n)}">${esc(initials(n))}</span>`;
const pad = n => String(n).padStart(2, '0');
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const WD = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const isoD = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoDT = d => `${isoD(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const parseDT = s => { const [a = '', b = '00:00'] = String(s || '').split('T'); const [y, m, d] = a.split('-').map(Number); const [h, mi] = b.split(':').map(Number); return new Date(y, (m || 1) - 1, d || 1, h || 0, mi || 0); };
const validDT = s => /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(String(s || '')) && !isNaN(parseDT(s));
const todayS = () => isoD(new Date());
const isToday = s => String(s || '').slice(0, 10) === todayS();
const dayAt = (n, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, m, 0, 0); return d; };
const fTime = d => { let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${h}:${pad(d.getMinutes())} ${ap}`; };
const relDay = d => { const t = new Date(); t.setHours(0, 0, 0, 0); const x = new Date(d); x.setHours(0, 0, 0, 0); const diff = Math.round((x - t) / 864e5); return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : `${x.getDate()} ${MON[x.getMonth()]}`; };
const fD = s => validDT(s) ? (d => `${d.getDate()} ${MON[d.getMonth()]}`)(parseDT(s)) : '—';
const fDY = s => validDT(s) ? (d => `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`)(parseDT(s)) : '—';
const fDT = s => validDT(s) ? (d => `${relDay(d)}, ${fTime(d)}`)(parseDT(s)) : '—';
const fyOf = s => { const d = parseDT(s), y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${String(y).slice(2)}-${String(y + 1).slice(2)}`; };
const IC = {
  home:'<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>',
  job:'<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9zM8.5 12h7M8.5 16h5"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  bill:'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  users:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20c-.5-2.6-2-4.3-4-5"/>',
  gear:'<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  lock:'<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  chat:'<path d="M4 20l1.3-3.9A8 8 0 1 1 8 19z"/><path d="M9.2 9.3c.2 2.8 2.7 5.3 5.5 5.5l1-1.4-1.9-1-1 .9c-.9-.4-1.6-1.1-2-2l.9-1-1-1.9z"/>',
  print:'<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
  check:'<path d="M5 12.5l4.5 4.5L19 7"/>',
  arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>',
  back:'<path d="M19 12H5M11 6l-6 6 6 6"/>',
  camera:'<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  rupee:'<path d="M7 4h10M7 8.5h10M7 4c5 0 6.5 2 6.5 4.5S11.5 13 7 13l7.5 7"/>',
  shield:'<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  alert:'<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4.5M12 17.5v.01"/>',
  clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  search:'<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  bay:'<path d="M3 20V9l9-5 9 5v11"/><path d="M7 20v-7h10v7"/>'
};
const ico = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${IC[n] || ''}</svg>`;
const ph = (eyebrow, title, lede, actions = '') => `<header class="ph"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1>${lede ? `<p class="lede">${lede}</p>` : ''}</div>${actions ? `<div class="ph-act">${actions}</div>` : ''}</header>`;
/* ================= fixed data ================= */
const SEGS = ['Hatchback', 'Sedan', 'Compact SUV', 'SUV', 'Luxury'];
const SEGF = [.72, .85, .9, 1, 1.08];
const CATS = ['All', 'PPF', 'Coating', 'Paint correction', 'Wash & interior', 'Film & accessories', 'Mechanical'];
const CATALOG0 = [
  {id:'ppf-full', cat:'PPF', name:'Full body PPF', note:'All painted panels, edge-wrapped', dur:'3 days + 24 h cure', hrs:24, cure:24, p:[85000, 105000, 115000, 135000, 165000]},
  {id:'ppf-front', cat:'PPF', name:'Front kit PPF', note:'Bumper, bonnet, fenders, ORVMs', dur:'1 day', hrs:8, cure:12, p:[28000, 32000, 36000, 42000, 55000]},
  {id:'ppf-custom', cat:'PPF', name:'PPF · selected panels', note:'Priced per sq ft', dur:'per panel', hrs:6, cure:12, perSq:[600, 620, 650, 700, 800]},
  {id:'ppf-lamp', cat:'PPF', name:'Headlamp & tail lamp PPF', dur:'2 h', hrs:2, p:[3500, 4000, 4000, 4500, 6000]},
  {id:'ppf-edge', cat:'PPF', name:'Door edge & handle cup guards', dur:'1 h', hrs:1, p:[2500, 2500, 2500, 3000, 3500]},
  {id:'cer-9h', cat:'Coating', name:'Ceramic coating 9H · 2 layer', dur:'2 days', hrs:12, cure:12, p:[18000, 22000, 24000, 28000, 35000]},
  {id:'gra-3', cat:'Coating', name:'Graphene coating · 3 layer', dur:'2 days', hrs:14, cure:12, p:[28000, 34000, 38000, 45000, 60000]},
  {id:'cer-ppf', cat:'Coating', name:'Ceramic over PPF', dur:'4 h', hrs:4, p:[10000, 12000, 12000, 14000, 15000]},
  {id:'pc-1', cat:'Paint correction', name:'Clay bar + 1-step polish', dur:'4 h', hrs:4, p:[4000, 5000, 5500, 6000, 8000]},
  {id:'pc-2', cat:'Paint correction', name:'2-step paint correction', dur:'1 day', hrs:8, p:[9000, 11000, 12000, 14000, 18000]},
  {id:'hl', cat:'Paint correction', name:'Headlight restoration', dur:'1 h', hrs:1, p:[1500, 1500, 1800, 2000, 2500]},
  {id:'wash', cat:'Wash & interior', name:'Foam wash + wax', dur:'45 min', hrs:1, p:[699, 799, 899, 999, 1499]},
  {id:'int', cat:'Wash & interior', name:'Interior deep cleaning', dur:'5 h', hrs:5, p:[3000, 3500, 4000, 4500, 6000]},
  {id:'eng', cat:'Wash & interior', name:'Engine bay detailing', dur:'1 h', hrs:1, p:[1200, 1500, 1500, 1800, 2500]},
  {id:'sun', cat:'Film & accessories', name:'Sun control film', dur:'3 h', hrs:3, p:[4000, 5000, 5000, 6000, 9000]},
  {id:'mats', cat:'Film & accessories', name:'7D floor mats', dur:'30 min', hrs:.5, p:[4500, 5000, 5500, 6500, 9000]},
  {id:'rust', cat:'Film & accessories', name:'Anti-rust underbody coating', dur:'3 h', hrs:3, p:[3500, 4000, 4500, 5000, 7000]},
  {id:'svc', cat:'Mechanical', name:'Periodic service (labour)', note:'Parts billed separately', dur:'4 h', hrs:4, p:[2000, 2500, 2500, 3000, 5000]},
  {id:'ac', cat:'Mechanical', name:'AC service & gas top-up', dur:'2 h', hrs:2, p:[2500, 2500, 3000, 3500, 4500]},
  {id:'align', cat:'Mechanical', name:'Wheel alignment & balancing', dur:'1 h', hrs:1, p:[1000, 1200, 1200, 1500, 2500]}
];
const COVER = ['ppf-full', 'ppf-front', 'ppf-custom'];
const PANELS = [
  {id:'fbump', label:'Front bumper', x:50, y:18, w:140, h:38, rx:18, sq:18},
  {id:'bonnet', label:'Bonnet', x:56, y:60, w:128, h:88, rx:10, sq:22},
  {id:'wind', label:'Windshield', x:62, y:152, w:116, h:40, rx:8, glass:true},
  {id:'roof', label:'Roof', x:64, y:196, w:112, h:116, rx:8, sq:20},
  {id:'rglass', label:'Rear glass', x:64, y:316, w:112, h:32, rx:8, glass:true},
  {id:'boot', label:'Boot lid', x:58, y:352, w:124, h:58, rx:10, sq:14},
  {id:'rbump', label:'Rear bumper', x:52, y:414, w:136, h:36, rx:16, sq:16},
  {id:'lff', label:'Left front fender', x:20, y:62, w:32, h:86, rx:10, sq:8},
  {id:'rff', label:'Right front fender', x:188, y:62, w:32, h:86, rx:10, sq:8},
  {id:'lfd', label:'Left front door', x:20, y:152, w:38, h:90, rx:6, sq:14},
  {id:'rfd', label:'Right front door', x:182, y:152, w:38, h:90, rx:6, sq:14},
  {id:'lrd', label:'Left rear door', x:20, y:246, w:38, h:86, rx:6, sq:13},
  {id:'rrd', label:'Right rear door', x:182, y:246, w:38, h:86, rx:6, sq:13},
  {id:'lrq', label:'Left rear quarter', x:20, y:336, w:34, h:76, rx:10, sq:12},
  {id:'rrq', label:'Right rear quarter', x:186, y:336, w:34, h:76, rx:10, sq:12},
  {id:'lorvm', label:'Left ORVM', x:3, y:156, w:16, h:16, rx:5, sq:2},
  {id:'rorvm', label:'Right ORVM', x:221, y:156, w:16, h:16, rx:5, sq:2}
];
const PANEL = Object.fromEntries(PANELS.map(p => [p.id, p]));
const FRONT_KIT = ['fbump', 'bonnet', 'lff', 'rff', 'lorvm', 'rorvm'];
const DMG = {
  scratch:{label:'Scratch', short:'S', c:'var(--warn)'},
  dent:{label:'Dent', short:'D', c:'var(--bad)'},
  chip:{label:'Stone chip', short:'C', c:'var(--info)'},
  swirl:{label:'Swirls / fading', short:'W', c:'var(--violet)'},
  crack:{label:'Crack', short:'X', c:'var(--ink-2)'}
};
const BEL = ['Stepney', 'Jack & tool kit', 'Floor mats', 'Mud flaps', 'Wheel caps', 'Music system / screen', 'Documents (RC, insurance)', 'Valuables removed by customer'];
const SLOTS = ['Front', 'Rear', 'Left side', 'Right side', 'Interior', 'Odometer'];
const TERMS = [['dmg', 'Damage shown in the inspection was there before work'], ['time', 'Delivery time is an estimate; curing can extend it'], ['warr', 'Warranty is registered after delivery, as per brand terms']];
const STEPS = ['Customer & vehicle', 'Inspection', 'Services', 'Estimate & approval', 'Bay & team'];
const PAY_MODES = ['UPI', 'Cash', 'Card', 'Bank'];

/* ================= money & lines (same code runs in the browser and on the server) ================= */
const svcIn = (cat, id) => cat.find(s => s.id === id);
const hasCatIn = (cat, svcs, c) => svcs.some(id => { const s = svcIn(cat, id); return !!s && s.cat === c; });
function ppfPanelsOf(svcs, panels){
  if (svcs.includes('ppf-full')) return PANELS.filter(p => !p.glass).map(p => p.id);
  if (svcs.includes('ppf-front')) return FRONT_KIT.slice();
  if (svcs.includes('ppf-custom')) return (panels || []).filter(id => PANEL[id] && !PANEL[id].glass);
  return [];
}
function sqOf(svcs, panels, seg, waste = true){
  const raw = ppfPanelsOf(svcs, panels).reduce((a, id) => a + (PANEL[id].sq || 0), 0) * SEGF[seg];
  return Math.ceil(raw * (waste ? 1.1 : 1));
}
function coverLabel(svcs, panels){
  if (svcs.includes('ppf-full')) return 'Full body';
  if (svcs.includes('ppf-front')) return 'Front kit';
  if (svcs.includes('ppf-custom')){ const n = ppfPanelsOf(svcs, panels).length; return `${n} panel${n === 1 ? '' : 's'}`; }
  return 'Add-on parts';
}
function linesFor(svcs, panels, seg, cat){
  return svcs.map(id => svcIn(cat, id)).filter(Boolean).map(s => {
    if (s.perSq){ const n = ppfPanelsOf(svcs, panels).length; return {id:s.id, name:`PPF · ${n} selected panel${n === 1 ? '' : 's'}`, sac:'998714', amt:Math.round(sqOf(svcs, panels, seg, false) * (s.perSq[seg] || 0) / 100) * 100}; }
    return {id:s.id, name:s.name, sac:'998714', amt:(s.p && s.p[seg]) || 0};
  });
}
function totals(lines, discPct, gst){
  const sub = lines.reduce((s, l) => s + l.amt, 0);
  const disc = Math.round(sub * (discPct || 0) / 100);
  const taxable = sub - disc;
  const half = gst ? Math.round(taxable * 9) / 100 : 0;
  const raw = taxable + 2 * half, total = Math.round(raw);
  return {sub, disc, taxable, half, total, ro:+(total - raw).toFixed(2)};
}
const jobTot = j => totals(j.lines, j.disc, j.gst);
const invTot = v => totals(v.lines, v.disc, v.gst);
const paidOf = v => (v.pays || []).reduce((s, p) => s + p.amt, 0);
const balOf = v => v.cancelled ? 0 : invTot(v).total - paidOf(v);
const shortName = n => String(n).replace(/ \(.*\)/, '').replace(/ · .*/, '');
function warrOf(j, date){
  const d = parseDT(date), y = d.getFullYear(), m = MON[d.getMonth()], out = [];
  if (j.ppf){ const w = +j.ppf.warr || 0; out.push(`PPF · ${coverLabel(j.svcs, j.panels)}, ${j.ppf.finish}${j.ppf.film ? ', ' + j.ppf.film : ''} · ${w} yr warranty (till ${m} ${y + w})`); }
  if (j.coat){ const w = +j.coat.warr || 0; out.push(`${j.coat.product || 'Coating'} · ${j.coat.layers} layer · ${w} yr warranty (till ${m} ${y + w})`); }
  return out;
}
function words(n){
  n = Math.round(n);
  const a = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const b = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  const two = x => x < 20 ? a[x] : b[Math.floor(x / 10)] + (x % 10 ? ' ' + a[x % 10] : '');
  const three = x => (x >= 100 ? a[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' ' : '') : '') + (x % 100 ? two(x % 100) : '');
  const out = []; const cr = Math.floor(n / 1e7); n %= 1e7; const lk = Math.floor(n / 1e5); n %= 1e5; const th = Math.floor(n / 1000); n %= 1000;
  if (cr) out.push(three(cr) + ' Crore'); if (lk) out.push(two(lk) + ' Lakh'); if (th) out.push(two(th) + ' Thousand'); if (n) out.push(three(n));
  return 'Rupees ' + (out.join(' ') || 'Zero') + ' Only';
}
function suggestDue(svcs, cat){
  let hrs = 0, cure = 0;
  svcs.forEach(id => { const s = svcIn(cat, id); if (s){ hrs += +s.hrs || 1; cure = Math.max(cure, +s.cure || 0); } });
  if (!hrs) hrs = 2;
  const d = new Date(); d.setSeconds(0, 0);
  if (d.getHours() < 9) d.setHours(9, 0); if (d.getHours() >= 19) { d.setDate(d.getDate() + 1); d.setHours(9, 0); }
  let left = hrs, guard = 0;
  while (left > 0 && guard++ < 400){
    const end = new Date(d); end.setHours(19, 0, 0, 0);
    const avail = (end - d) / 36e5;
    if (left <= avail){ d.setTime(d.getTime() + left * 36e5); left = 0; }
    else { left -= avail; d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); }
  }
  if (cure) d.setTime(d.getTime() + cure * 36e5);
  const m = d.getMinutes(); if (m % 30) d.setMinutes(m + (30 - m % 30));
  if (d.getHours() >= 19 && !(d.getHours() === 19 && d.getMinutes() === 0)) { d.setDate(d.getDate() + 1); d.setHours(11, 0, 0, 0); }
  if (d.getHours() < 11) d.setHours(11, 0, 0, 0);
  return {at:isoDT(d), hrs, cure};
}

/* ================= printable papers (invoice A4, job card A5) ================= */
const DEFAULT_TERMS = ['Please check the car at delivery. Claims after delivery are not accepted.', 'Warranty as shown above. Keep this invoice.'];
const FIXED_CATS = ['PPF', 'Coating']; // PPF and coating details depend on these two names
const LOGO = `<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#1A1A1A"/><path d="M16 5.5c4.2 5.6 7.2 9.3 7.2 12.9a7.2 7.2 0 0 1-14.4 0c0-3.6 3-7.3 7.2-12.9z" fill="#FFFFFF"/></svg>`;
function invPaper(v, biz, qr, terms){
  const tl = Array.isArray(terms) && terms.length ? terms : DEFAULT_TERMS;
  const t = invTot(v), paid = paidOf(v), bal = balOf(v), b = biz;
  return `<div class="paper">
    ${v.cancelled ? '<div class="stamp void">CANCELLED</div>' : bal <= 0 ? '<div class="stamp">PAID</div>' : ''}
    <div class="pv-head"><div class="pv-brand">${LOGO}<div><b>${esc(b.name)}</b><br>${esc(b.addr)}<br>Ph ${esc(b.ph)}${v.gst && b.gstin ? ` · GSTIN ${esc(b.gstin)}` : ''}</div></div>
      <div class="pv-title"><h2>${v.gst ? 'TAX INVOICE' : 'INVOICE'}</h2><div class="mono">${esc(v.no)}</div><div>Date: ${esc(fDY(v.date))}</div></div></div>
    <div class="pv-parties"><div><span class="pv-l">Bill to</span><b>${esc(v.cust)}</b><br>+91 ${esc(v.ph)}</div>
      <div><span class="pv-l">Vehicle</span><b>${esc(v.car)}</b> · ${esc(v.reg)}<br>${v.odo ? esc(v.odo) + ' km' : ''}${v.jobId ? `${v.odo ? ' · ' : ''}Job card ${esc(v.jobId)}` : ''}</div></div>
    <table class="pv-tbl"><thead><tr><th style="width:30px">#</th><th>Service</th>${v.gst ? '<th>SAC</th>' : ''}<th style="text-align:right">Amount (₹)</th></tr></thead>
      <tbody>${v.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.name)}</td>${v.gst ? `<td>${esc(l.sac)}</td>` : ''}<td style="text-align:right">${f2(l.amt)}</td></tr>`).join('')}</tbody></table>
    <div class="pv-foot">
      <div><span class="pv-l">Amount in words</span><b>${words(t.total)}</b>
        ${(v.pays || []).length ? `<div class="pv-box"><h5>Payments</h5><ul>${v.pays.map(p => `<li>${esc(fD(p.d))} · ${esc(p.mode)}${p.note ? ' · ' + esc(p.note) : ''} · <b>${inr(p.amt)}</b></li>`).join('')}</ul></div>` : ''}
        ${(v.warr || []).length ? `<div class="pv-box"><h5>Warranty</h5><ul>${v.warr.map(w => `<li>${esc(w)}</li>`).join('')}</ul><div style="color:var(--paper-mute);margin-top:3px">Free check-ups as advised keep the warranty valid.</div></div>` : ''}
      </div>
      <table class="pv-tot"><tbody>
        <tr><td>Subtotal</td><td>${f2(t.sub)}</td></tr>
        ${t.disc ? `<tr><td>Discount ${v.disc}%</td><td>−${f2(t.disc)}</td></tr>` : ''}
        ${v.gst ? `<tr><td>Taxable value</td><td>${f2(t.taxable)}</td></tr><tr><td>CGST 9%</td><td>${f2(t.half)}</td></tr><tr><td>SGST 9%</td><td>${f2(t.half)}</td></tr>` : ''}
        ${t.ro ? `<tr><td>Round off</td><td>${t.ro > 0 ? '+' : '−'}${f2(Math.abs(t.ro))}</td></tr>` : ''}
        <tr class="g"><td>Total</td><td>₹${f2(t.total)}</td></tr>
        <tr><td>Paid</td><td>${f2(paid)}</td></tr>
        <tr><td><b>Balance</b></td><td><b>${f2(Math.max(0, bal))}</b></td></tr>
      </tbody></table>
    </div>
    <div class="pv-bottom"><ol>${tl.map(x => `<li>${esc(x)}</li>`).join('')}</ol>
      ${bal > 0 && qr && b.upi ? `<div class="qr">${qr}<span>Scan to pay ${inr(bal)} · ${esc(b.upi)}</span></div>` : '<div></div>'}
      <div class="sign"><div>For ${esc(b.name)}</div></div></div>
  </div>`;
}
function jobPaper(j, biz, qr, sigUrl){
  const b = biz, marks = Object.entries(j.dmg || {}).filter(([p, d]) => PANEL[p] && DMG[d]);
  return `<div class="paper a5">
    <div class="pv-head"><div class="pv-brand">${LOGO}<div><b>${esc(b.name)}</b><br>Ph ${esc(b.ph)}</div></div><div class="pv-title"><h2>JOB CARD</h2><div class="mono">${esc(j.id)}</div><div>${esc(fDY(j.in))}</div></div></div>
    <div class="pv-parties"><div><span class="pv-l">Customer</span><b>${esc(j.cust)}</b><br>+91 ${esc(j.ph)}</div><div><span class="pv-l">Vehicle</span><b>${esc(j.car)}</b><br>${esc(j.reg)}${j.color ? ' · ' + esc(j.color) : ''}<br>${j.odo ? esc(j.odo) + ' km · ' : ''}fuel ${esc(j.fuel)}</div></div>
    <div class="pv-2">
      <div><span class="pv-l">Work to do</span>${j.lines.map(l => `<div>☐ ${esc(l.name)}</div>`).join('')}${j.ppf ? `<div style="margin-top:4px">PPF: ${esc(coverLabel(j.svcs, j.panels))}, ${esc(j.ppf.finish)}${j.ppf.film ? ', ' + esc(j.ppf.film) : ''}</div>` : ''}${j.coat ? `<div>Coating: ${j.coat.product ? esc(j.coat.product) + ', ' : ''}${+j.coat.layers} layer</div>` : ''}</div>
      <div><span class="pv-l">Bay & team</span>${esc(j.bay || '—')}<br>${(j.team || []).length ? j.team.map(esc).join(', ') : '—'}<br><span class="pv-l" style="margin-top:6px">Promised</span><b>${esc(fDY(j.due))}, ${esc(fTime(parseDT(j.due)))}</b>${j.prio === 'Urgent' ? ' · URGENT' : ''}</div>
      <div><span class="pv-l">Damage before work</span>${marks.length ? marks.map(([p, d]) => `<div>${PANEL[p].label}: ${DMG[d].label}</div>`).join('') : 'None marked'}</div>
      <div><span class="pv-l">Belongings</span>${(j.bel || []).length ? j.bel.map(esc).join(', ') : 'None noted'}</div>
    </div>
    ${j.req ? `<div class="pv-box"><h5>Customer asked for</h5>${esc(j.req)}</div>` : ''}
    <div class="pv-bottom"><div>Check the car with the customer at delivery.</div>${qr ? `<div class="qr">${qr}<span>Scan to track</span></div>` : '<div></div>'}<div class="sign">${sigUrl ? `<img src="${esc(sigUrl)}" alt="">` : ''}<div>Customer signature</div></div></div>
  </div>`;
}

/* ================= WhatsApp message templates ================= */
// {placeholder} gets filled in; a line whose placeholder has nothing to fill is skipped.
const WA_KINDS = [
  ['jobcard', 'Job card created', ['jobid', 'services', 'estimate', 'advance', 'due', 'link']],
  ['update', 'Work update', ['jobid', 'bay', 'due', 'link']],
  ['ready', 'Car ready for pickup', ['jobid', 'balance', 'link']],
  ['invoice', 'Invoice', ['invoice', 'total', 'paid', 'balance', 'warranty', 'link']],
  ['due', 'Payment reminder', ['invoice', 'balance', 'link']],
  ['estimate', 'Estimate (while making a job card)', ['lines', 'discount', 'gst', 'estimate', 'advance']],
  ['hello', 'Message from the Customers page', []]
];
const WA_COMMON = ['name', 'fullname', 'vehicle', 'car', 'reg', 'business'];
const WA_DEFAULTS_HI = {
  jobcard:'Namaste {name} ji, aapki {vehicle} {business} pe aa gayi hai.\n\nJob card: {jobid}\n{services}\nEstimate: {estimate}\nAdvance mila: {advance}\nDelivery: {due}\n\nGaadi ka status yahan dekhein: {link}\n\n– Team {business}',
  update:'Namaste {name} ji, aapki {vehicle} ka kaam chal raha hai.\nBay: {bay}\nDelivery: {due}\n\nStatus yahan dekhein: {link}\n\n– Team {business}',
  ready:'Namaste {name} ji, aapki {vehicle} ready hai! Aap aakar le ja sakte hain.\n\nBaaki payment: {balance}\n\n– Team {business}',
  invoice:'Namaste {name} ji, {business} chunne ke liye dhanyavaad.\n\nInvoice: {invoice}\n{vehicle}\nTotal: {total}\nPaid: {paid}\nBaaki: {balance}\n\n{warranty}\n\nInvoice dekhein, PDF save karein ya pay karein: {link}\n\n– Team {business}',
  due:'Namaste {name} ji, aapki {vehicle} ke invoice {invoice} ka {balance} baaki hai.\n\nYahan se dekh kar UPI se pay kar sakte hain: {link}\n\nDhanyavaad!\n– Team {business}',
  estimate:'Namaste {name} ji, {business} ki taraf se aapka estimate:\n\n{vehicle}\n{lines}\nDiscount: {discount}\nGST 18%: {gst}\nTotal: {estimate}\nAdvance: {advance}\n\n– Team {business}',
  hello:'Namaste {name} ji, {business} se namaskar! Aapki {car} ko aaye kaafi time ho gaya. Koi din bata dijiye, hum slot ready rakhenge.\n\n– Team {business}'
};
const WA_DEFAULTS_EN = {
  jobcard:'Hi {name}, your {vehicle} is checked in at {business}.\n\nJob card: {jobid}\n{services}\nEstimate: {estimate}\nAdvance paid: {advance}\nExpected delivery: {due}\n\nTrack your car: {link}\n\n– Team {business}',
  update:'Hi {name}, a quick update on your {vehicle}: work is going on and is on track for {due}.\n\nTrack your car: {link}\n\n– Team {business}',
  ready:'Hi {name}, your {vehicle} is ready for pickup!\n\nBalance to pay: {balance}\n\n– Team {business}',
  invoice:'Hi {name}, thank you for choosing {business}.\n\nInvoice {invoice}\n{vehicle}\nTotal: {total}\nPaid: {paid}\nBalance: {balance}\n\n{warranty}\n\nView, save as PDF or pay: {link}\n\n– Team {business}',
  due:'Hi {name}, a gentle reminder that {balance} is pending on invoice {invoice} for your {vehicle}.\n\nView and pay here: {link}\n\nThank you!\n– Team {business}',
  estimate:'Hi {name}, here is your estimate from {business}.\n\n{vehicle}\n{lines}\nDiscount: {discount}\nGST 18%: {gst}\nTotal: {estimate}\nAdvance: {advance}\n\n– Team {business}',
  hello:"Hi {name}, greetings from {business}! It's been a while since your {car} visited us. Reply with a day that suits you and we'll keep a slot ready.\n\n– Team {business}"
};
function fillTemplate(tpl, vars){
  const lines = String(tpl ?? '').replace(/\r/g, '').split('\n').map(line => {
    let drop = false;
    const s = line.replace(/\{(\w+)\}/g, (m, k) => {
      if (!Object.prototype.hasOwnProperty.call(vars, k)) return m; // unknown placeholder: leave it so the mistake is visible
      const v = vars[k];
      if (v === '' || v === null || v === undefined){ drop = true; return ''; }
      return String(v);
    });
    return drop ? null : s;
  }).filter(l => l !== null);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

if (typeof module !== 'undefined' && module.exports){
  module.exports = {esc, inr, f2, digits, fmtPh, norm, hit, pad, MON, isoD, isoDT, parseDT, validDT, todayS, isToday, fD, fDY, fDT, fTime, fyOf,
    SEGS, SEGF, CATS, CATALOG0, COVER, PANELS, PANEL, FRONT_KIT, DMG, BEL, SLOTS, TERMS, PAY_MODES,
    DEFAULT_TERMS, FIXED_CATS, WA_KINDS, WA_COMMON, WA_DEFAULTS_HI, WA_DEFAULTS_EN, fillTemplate, svcIn, hasCatIn, ppfPanelsOf, sqOf, coverLabel, linesFor, totals, jobTot, invTot, paidOf, balOf, shortName, warrOf, words, suggestDue, invPaper, jobPaper};
}
