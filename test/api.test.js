// End-to-end API tests: `npm test`. Needs a MySQL/MariaDB server; each run uses a fresh throwaway database.
// Point it at a test server with TEST_DB_HOST / TEST_DB_PORT / TEST_DB_USER / TEST_DB_PASSWORD (default 127.0.0.1:3306 root).
const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');
const S = require('../public/shared.js');

const T = {host:process.env.TEST_DB_HOST || '127.0.0.1', port:+(process.env.TEST_DB_PORT || 3306), user:process.env.TEST_DB_USER || 'root', password:process.env.TEST_DB_PASSWORD || ''};
const DB_NAME = `dd_test_${Date.now()}_${process.pid}`;
Object.assign(process.env, {DB_HOST:T.host, DB_PORT:String(T.port), DB_USER:T.user, DB_PASSWORD:T.password, DB_NAME, DD_NO_RETRY:'1'});
let app, D, admin;
let server, base;
before(async () => {
  admin = await mysql.createConnection(T);
  await admin.query(`CREATE DATABASE \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  ({app} = require('../server/index.js')); D = require('../server/db');
  await require('../server/index.js').ready;
  await new Promise(r => { server = app.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); });
});
after(async () => {
  if (server) server.close();
  if (D) await D.pool.end();
  if (admin){ await admin.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``); await admin.end(); }
});

function client(){
  let cookie = '';
  const call = async (method, url, body) => {
    const r = await fetch(base + url, {method, headers:{...(body ? {'Content-Type':'application/json'} : {}), ...(cookie ? {Cookie:cookie} : {})}, body:body ? JSON.stringify(body) : undefined, redirect:'manual'});
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const text = await r.text(); let data; try { data = JSON.parse(text); } catch (_) { data = text; }
    return {status:r.status, data};
  };
  return {get:u => call('GET', u), post:(u, b = {}) => call('POST', u, b), put:(u, b = {}) => call('PUT', u, b)};
}
const owner = client(), mgr = client(), anon = client();
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const wizard = (over = {}) => ({f:{name:'Rahul Verma', mob:'98220 41763', email:'', reg:'mh 12 vd 9081', model:'Tata Harrier', color:'Red', odo:'6,240', req:'Full PPF'},
  seg:3, fuel:'½', dmg:{bonnet:'scratch', lfd:'dent', nope:'scratch'}, photos:{}, bel:['Stepney', 'Not a thing'], svcs:['ppf-full', 'pc-1', 'ppf-lamp'], panels:[],
  ppf:{finish:'Gloss', film:'8.5 mil', warr:7, notes:''}, coat:{}, disc:5, adv:50000, mode:'UPI', terms:['dmg', 'time'], sig:PNG, bay:'Bay 2', team:[], due:'2030-01-05T18:00', prio:'Normal', ...over});

test('first run: setup creates the owner and logs in', async () => {
  let r = await anon.get('/api/session'); assert.equal(r.data.setupNeeded, true); assert.equal(r.data.user, null);
  r = await anon.get('/api/home'); assert.equal(r.status, 401);
  r = await owner.post('/api/setup', {bizName:'Shine Lab', name:'Akash', login:'98765 00000', password:'short'}); assert.equal(r.status, 400);
  r = await owner.post('/api/setup', {bizName:'Shine Lab', name:'Akash', login:'98765 00000', password:'secret123'}); assert.equal(r.status, 200);
  r = await owner.get('/api/session'); assert.equal(r.data.user.role, 'superadmin', 'the first login is the Super Admin'); assert.equal(r.data.setupNeeded, false);
  r = await anon.post('/api/setup', {bizName:'X', name:'Y', login:'99999 99999', password:'secret123'}); assert.equal(r.status, 409);
});

test('owner sets business details, team and a manager login', async () => {
  let r = await owner.put('/api/settings/biz', {name:'Shine Lab Car Care', addr:'Baner, Pune', ph:'98765 00000', gstin:'27AAAAA0000A1Z5', gst:true, upi:'shinelab@upi'}); assert.equal(r.status, 200);
  r = await owner.put('/api/settings/biz', {name:'Shine Lab', upi:'not a upi'}); assert.equal(r.status, 400);
  r = await owner.put('/api/settings/staff', {staff:[{n:'Ajay More', r:'PPF installer'}, {n:'Vishal Pawar', r:'Coating'}]}); assert.equal(r.status, 200);
  r = await owner.post('/api/users', {name:'Nikhil', login:'98901 22476', password:'nikhil123'}); assert.equal(r.status, 200);
  r = await owner.post('/api/users', {name:'Dup', login:'9890122476', password:'nikhil123'}); assert.equal(r.status, 400);
  r = await mgr.post('/api/login', {login:'98901 22476', password:'wrong'}); assert.equal(r.status, 401);
  r = await mgr.post('/api/login', {login:'+91 98901 22476', password:'nikhil123'}); assert.equal(r.status, 200);
  r = await mgr.get('/api/boot'); assert.equal(r.data.me.role, 'manager');
  r = await mgr.put('/api/settings/perms', {sales:true, cancel:true, disc:50}); assert.equal(r.status, 403);
  r = await mgr.get('/api/users'); assert.equal(r.status, 403);
});

let jobId;
test('manager creates a job card: server checks and prices everything', async () => {
  let r = await mgr.post('/api/jobs', wizard({svcs:[]})); assert.equal(r.status, 400);
  r = await mgr.post('/api/jobs', wizard({f:{...wizard().f, mob:'12345'}})); assert.equal(r.status, 400);
  r = await mgr.post('/api/jobs', wizard({disc:15})); assert.equal(r.status, 403, 'manager above 10% is refused');
  r = await mgr.post('/api/jobs', wizard({adv:999999})); assert.equal(r.status, 400, 'advance above estimate is refused');
  r = await mgr.post('/api/jobs', wizard({svcs:['ppf-custom'], panels:[]})); assert.equal(r.status, 400, 'custom PPF needs panels');
  r = await mgr.post('/api/jobs', wizard({team:['Ajay More', 'Ghost Person']})); assert.equal(r.status, 200, JSON.stringify(r.data));
  jobId = r.data.id; assert.equal(jobId, 'JC-0001');
  r = await mgr.get('/api/jobs/' + jobId); const j = r.data.job;
  assert.equal(j.total, 163106); assert.equal(j.paid, 50000); assert.equal(j.bal, 113106);
  assert.deepEqual(j.dmg, {bonnet:'scratch', lfd:'dent'}); assert.deepEqual(j.bel, ['Stepney']); assert.deepEqual(j.team, ['Ajay More']);
  assert.equal(j.reg, 'MH 12 VD 9081'); assert.equal(j.ph, '98220 41763'); assert.match(j.sig, /^[a-f0-9]{24}$/); assert.ok(j.ppf); assert.equal(j.coat, undefined);
  assert.match(r.data.qr, /<svg/); assert.match(r.data.link, /\/j\/[a-f0-9]{24}$/);
  r = await mgr.get('/api/uploads/' + j.sig); assert.equal(r.status, 200);
  r = await anon.get('/api/uploads/' + j.sig); assert.equal(r.status, 401);
  r = await mgr.get('/api/workload'); assert.deepEqual(r.data.bays['Bay 2'].map(x => x.id), [jobId]); assert.equal(r.data.team['Ajay More'], 1); assert.equal(r.data.nextId, 'JC-0002');
  r = await mgr.get('/api/find?q=MH12VD9081'); assert.equal(r.data.match.name, 'Rahul Verma'); assert.equal(r.data.match.cars[0].seg, 3);
  r = await anon.get(new URL(r.data.match ? (await mgr.get('/api/jobs/' + jobId)).data.link : '').pathname); assert.equal(r.status, 200); assert.match(r.data, /JOB CARD/);
});

test('photo uploads are checked', async () => {
  let r = await mgr.post('/api/uploads', {dataUrl:'data:text/html;base64,PGgxPg=='}); assert.equal(r.status, 400);
  r = await mgr.post('/api/uploads', {dataUrl:'data:image/png;base64,' + Buffer.from('not really a png').toString('base64')}); assert.equal(r.status, 400);
  r = await mgr.post('/api/uploads', {dataUrl:PNG}); assert.equal(r.status, 200); assert.match(r.data.id, /^[a-f0-9]{24}$/);
  const id = r.data.id;
  r = await mgr.post('/api/jobs', wizard({f:{...wizard().f, mob:'90110 52847', name:'Neha Joshi', reg:'MH12LU1188', model:'Kia Seltos'}, svcs:['wash'], disc:0, adv:0, photos:{Front:id, Rear:'deadbeef'}, sig:null, bay:'Bay 1'}));
  assert.equal(r.status, 200); const j = (await mgr.get('/api/jobs/' + r.data.id)).data.job;
  assert.deepEqual(Object.keys(j.photos), ['Front']); assert.equal(j.ppf, undefined); assert.equal(j.total, Math.round(999 * 1.18));
});

test('ready → invoice → payment → cancel rules', async () => {
  let r = await mgr.post(`/api/jobs/${jobId}/invoice`); assert.equal(r.status, 400, 'needs ready first');
  r = await mgr.post(`/api/jobs/${jobId}/ready`); assert.equal(r.status, 200);
  r = await mgr.post(`/api/jobs/${jobId}/ready`); assert.equal(r.status, 400);
  r = await mgr.post(`/api/jobs/${jobId}/invoice`); assert.equal(r.status, 200);
  const no = r.data.no, fy = S.fyOf(S.isoDT(new Date())); assert.equal(no, `INV/${fy}/0001`);
  r = await mgr.post(`/api/jobs/${jobId}/invoice`); assert.equal(r.status, 400, 'no second invoice');
  r = await mgr.get('/api/invoice?no=' + encodeURIComponent(no)); let v = r.data.inv;
  assert.equal(S.invTot(v).total, 163106); assert.equal(S.paidOf(v), 50000); assert.equal(v.pays[0].note, 'Advance'); assert.equal(v.warr.length, 1); assert.match(r.data.qr, /<svg/);
  r = await mgr.post('/api/invoice/pay', {no, amt:200000, mode:'Card'}); assert.equal(r.data.paid, 113106); assert.equal(r.data.extra, 86894);
  r = await mgr.post('/api/invoice/pay', {no, amt:10, mode:'UPI'}); assert.equal(r.status, 400, 'already paid');
  r = await anon.get(new URL((await mgr.get('/api/invoice?no=' + encodeURIComponent(no))).data.link).pathname); assert.equal(r.status, 200); assert.match(r.data, /TAX INVOICE/); assert.match(r.data, /PAID/);
  r = await mgr.post('/api/invoice/cancel', {no}); assert.equal(r.status, 403, 'manager cannot cancel by default');
  r = await owner.put('/api/settings/perms', {sales:true, cancel:true, disc:20}); assert.equal(r.status, 200);
  r = await mgr.post('/api/invoice/cancel', {no}); assert.equal(r.status, 200);
  r = await mgr.post('/api/invoice/cancel', {no}); assert.equal(r.status, 400);
  r = await mgr.get('/api/invoices?tab=unpaid'); assert.equal(r.data.list.length, 0);
});

test('home, lists, customers and sales visibility', async () => {
  let r = await mgr.get('/api/home'); assert.ok(r.data.sales, 'sales shown after owner allowed it'); assert.equal(r.data.work.length, 1);
  assert.equal(r.data.coll, 163106, 'money received today counts even if the invoice was later cancelled');
  await owner.put('/api/settings/perms', {sales:false, cancel:false, disc:10});
  r = await mgr.get('/api/home'); assert.equal(r.data.sales, undefined);
  r = await mgr.get('/api/customers'); assert.equal(r.data.list.length, 2); assert.equal(r.data.list[0].spent, undefined);
  r = await owner.get('/api/customers?q=harrier'); assert.equal(r.data.list.length, 1); assert.equal(r.data.list[0].spent, 0, 'cancelled invoice not counted');
  r = await owner.get('/api/customers/' + r.data.list[0].id); assert.equal(r.data.invs.length, 1); assert.equal(r.data.warr.length, 1);
  r = await mgr.get('/api/jobs?tab=all&q=lu1188'); assert.equal(r.data.list.length, 1);
  r = await mgr.get('/api/jobs?tab=done'); assert.equal(r.data.counts.done, 1);
});

test('settings guard rails', async () => {
  let r = await owner.put('/api/settings/bays', {bays:[{id:'Bay 2', type:'PPF'}]}); assert.equal(r.status, 400, 'Bay 1 has a car in it');
  r = await owner.put('/api/settings/bays', {bays:[{id:'Bay 1', type:'PPF'}, {id:'bay 1', type:'x'}]}); assert.equal(r.status, 400);
  r = await owner.get('/api/boot'); const cat = r.data.catalog; cat.find(s => s.id === 'wash').p[3] = 1200;
  r = await owner.put('/api/settings/catalog', {catalog:cat}); assert.equal(r.status, 200);
  r = await owner.get('/api/boot'); assert.equal(r.data.catalog.find(s => s.id === 'wash').p[3], 1200);
  r = await owner.post('/api/users/1/active', {active:false}); assert.equal(r.status, 400);
  r = await owner.post('/api/users/2/active', {active:false}); assert.equal(r.status, 200);
  r = await mgr.get('/api/home'); assert.equal(r.status, 401, 'turned-off login is logged out');
  r = await fetch(base + '/api/logout', {method:'POST', headers:{'Content-Type':'application/json', Origin:'https://evil.example'}, body:'{}'}); assert.equal(r.status, 403);
});

test('several people saving at once: unique numbers, no overpayment', async () => {
  const mk = i => owner.post('/api/jobs', wizard({f:{...wizard().f, mob:`900000000${i}`, name:`Parallel ${i}`, reg:`MH 01 PX 000${i}`}, svcs:['wash'], disc:0, adv:0, sig:null, bay:'', team:[]}));
  const made = await Promise.all([1, 2, 3, 4, 5].map(mk));
  made.forEach(r => assert.equal(r.status, 200, JSON.stringify(r.data)));
  const ids = made.map(r => r.data.id);
  assert.equal(new Set(ids).size, 5);
  await Promise.all(ids.map(id => owner.post(`/api/jobs/${id}/ready`)));
  const invs = await Promise.all(ids.map(id => owner.post(`/api/jobs/${id}/invoice`)));
  const nos = invs.map(r => r.data.no); assert.equal(new Set(nos).size, 5, nos.join());
  const no = nos[0], total = Math.round(1200 * 1.18); // SUV wash price was set to 1200 in the settings test
  const pays = await Promise.all([owner.post('/api/invoice/pay', {no, amt:total, mode:'UPI'}), owner.post('/api/invoice/pay', {no, amt:total, mode:'Cash'})]);
  const r = await owner.get('/api/invoice?no=' + encodeURIComponent(no));
  assert.equal(S.invTot(r.data.inv).total, total);
  assert.equal(S.paidOf(r.data.inv), total, 'never collects more than the invoice total: ' + pays.map(p => p.status).join());
  assert.deepEqual(pays.map(p => p.status).sort(), [200, 400], 'second payer is told it is already paid');
  assert.equal(r.data.inv.lines[0].name, 'Foam wash + wax'); assert.equal(r.data.inv.ph, '90000 00001'.replace('0 00001', `0 0000${ids.indexOf(r.data.inv.jobId) + 1}`));
});

test('Super Admin: owner logins, job and customer edits, invoice settings, categories', async () => {
  const fy = S.fyOf(S.isoDT(new Date()));
  let r = await owner.post('/api/users', {name:'Client Owner', login:'9811100000', password:'client123', role:'admin'}); assert.equal(r.status, 200);
  const cl = client(); r = await cl.post('/api/login', {login:'9811100000', password:'client123'}); assert.equal(r.status, 200);
  r = await cl.get('/api/boot'); assert.equal(r.data.me.role, 'admin'); assert.ok(Array.isArray(r.data.cats)); assert.equal(r.data.invoice.prefix, 'INV');
  // the Owner manages Managers only
  r = await cl.post('/api/users', {name:'X', login:'9811100001', password:'xxxxxx1', role:'admin'}); assert.equal(r.status, 403);
  r = await cl.post('/api/users/1/password', {password:'hacked123'}); assert.equal(r.status, 403);
  r = await cl.post('/api/users/1/active', {active:false}); assert.equal(r.status, 400);
  r = await cl.post('/api/users', {name:'Mgr Two', login:'9811100002', password:'mgr12345'}); assert.equal(r.status, 200);
  r = await cl.get('/api/users'); assert.equal(r.data.users.find(u => u.role === 'superadmin').canEdit, false); assert.equal(r.data.users.find(u => u.login === '9811100002').canEdit, true);
  for (const [m, u, b] of [['put', '/api/settings/invoice', {prefix:'X'}], ['put', '/api/settings/cats', {cats:[]}], ['put', '/api/jobs/JC-0001', {}], ['put', '/api/customers/1', {}]]){
    r = await cl[m](u, b); assert.equal(r.status, 403, `owner blocked from ${u}`);
  }
  r = await cl.get('/api/home'); assert.equal(r.status, 200, 'owner still runs the studio');
  // the Super Admin resets the Owner's password; the Owner is logged out
  const clientRow = (await owner.get('/api/users')).data.users.find(u => u.login === '9811100000'); assert.equal(clientRow.canEdit, true);
  r = await owner.post(`/api/users/${clientRow.id}/password`, {password:'client456'}); assert.equal(r.status, 200);
  r = await cl.get('/api/home'); assert.equal(r.status, 401);

  // edit a job card before its invoice
  const mk = await owner.post('/api/jobs', wizard({f:{...wizard().f, mob:'9822200001', name:'Edit Me', reg:'MH 02 ED 0001'}, svcs:['wash', 'cer-9h'], disc:0, adv:1000, sig:null, bay:'', team:[]}));
  assert.equal(mk.status, 200, JSON.stringify(mk.data)); const id = mk.data.id;
  assert.ok((await owner.get('/api/jobs/' + id)).data.job.coat, 'coating details were saved');
  const edit = {f:{name:'Edited Name', mob:'9822200001', email:'e@x.in', reg:'MH 02 ED 0001', model:'Kia Seltos', color:'Grey', odo:'100', req:'note'}, seg:3, fuel:'¾',
    lines:[{id:'wash', name:'Foam wash + wax', amt:800}, {id:'custom', name:'Seat stain removal', amt:1200}], disc:0, bay:'Bay 2', team:['Ajay More'], due:'2030-02-01T12:00', prio:'Urgent', coat:null};
  r = await owner.put('/api/jobs/' + id, {...edit, lines:[{id:'wash', name:'Foam', amt:100}]}); assert.equal(r.status, 400, 'total below the advance is refused');
  r = await owner.put('/api/jobs/' + id, {...edit, lines:[]}); assert.equal(r.status, 400);
  r = await owner.put('/api/jobs/' + id, edit); assert.equal(r.status, 200, JSON.stringify(r.data));
  const j1 = (await owner.get('/api/jobs/' + id)).data.job;
  assert.equal(j1.cust, 'Edited Name'); assert.equal(j1.total, Math.round(2000 * 1.18)); assert.equal(j1.coat, undefined); assert.equal(j1.bay, 'Bay 2');
  assert.equal(j1.prio, 'Urgent'); assert.deepEqual(j1.svcs, ['wash']); assert.deepEqual(j1.team, ['Ajay More']); assert.equal(j1.lines[1].name, 'Seat stain removal'); assert.match(j1.log[0].text, /edited by/);
  await owner.post(`/api/jobs/${id}/ready`); const inv = (await owner.post(`/api/jobs/${id}/invoice`)).data.no;
  r = await owner.put('/api/jobs/' + id, edit); assert.equal(r.status, 400, 'no edits after the invoice');

  // edit the customer and the car; invoices keep what they printed
  const cid = (await owner.get('/api/customers?q=Edited')).data.list[0].id, prof = (await owner.get('/api/customers/' + cid)).data;
  r = await owner.put('/api/customers/' + cid, {name:'Final Name', ph:'98220 41763', email:'', cars:prof.cars}); assert.equal(r.status, 400, 'phone of another customer');
  r = await owner.put('/api/customers/' + cid, {name:'Final Name', ph:'9822200009', email:'', cars:prof.cars.map(c => ({...c, model:'Kia Seltos HTX'}))}); assert.equal(r.status, 200, JSON.stringify(r.data));
  const prof2 = (await owner.get('/api/customers/' + cid)).data;
  assert.equal(prof2.name, 'Final Name'); assert.equal(prof2.ph, '98222 00009'); assert.equal(prof2.cars[0].model, 'Kia Seltos HTX');
  assert.equal((await owner.get('/api/invoice?no=' + encodeURIComponent(inv))).data.inv.cust, 'Edited Name');

  // invoice prefix and terms
  r = await owner.put('/api/settings/invoice', {prefix:'bad prefix', terms:[]}); assert.equal(r.status, 400);
  r = await owner.put('/api/settings/invoice', {prefix:'sl', terms:['Thank you for choosing us!', '  ', 'Second line']}); assert.equal(r.status, 200);
  assert.equal(r.data.invoice.prefix, 'SL'); assert.deepEqual(r.data.invoice.terms, ['Thank you for choosing us!', 'Second line']);
  const mk2 = await owner.post('/api/jobs', wizard({f:{...wizard().f, mob:'9822200003', name:'Prefix Test', reg:'MH 02 PF 0003'}, svcs:['wash'], disc:0, adv:0, sig:null, bay:'', team:[]}));
  await owner.post(`/api/jobs/${mk2.data.id}/ready`); const no2 = (await owner.post(`/api/jobs/${mk2.data.id}/invoice`)).data.no;
  assert.ok(no2.startsWith(`SL/${fy}/`), no2); assert.ok(+no2.slice(-4) > +inv.slice(-4), 'numbering continues after a prefix change');
  const pub = (await owner.get('/api/invoice?no=' + encodeURIComponent(no2))).data.link;
  assert.match((await anon.get(new URL(pub).pathname)).data, /Thank you for choosing us!/);

  // service categories
  const cats0 = (await owner.get('/api/boot')).data.cats.map(c => ({from:c, to:c}));
  r = await owner.put('/api/settings/cats', {cats:cats0.filter(c => c.from !== 'PPF')}); assert.equal(r.status, 400, 'PPF is fixed');
  r = await owner.put('/api/settings/cats', {cats:[...cats0, {from:'', to:'All'}]}); assert.equal(r.status, 400);
  r = await owner.put('/api/settings/cats', {cats:[...cats0.map(c => c.from === 'Mechanical' ? {from:c.from, to:'Mechanical & AC'} : c), {from:'', to:'Bike care'}]}); assert.equal(r.status, 200, JSON.stringify(r.data));
  const b2 = (await owner.get('/api/boot')).data; assert.ok(b2.cats.includes('Bike care')); assert.equal(b2.catalog.find(s => s.id === 'ac').cat, 'Mechanical & AC');
  r = await owner.put('/api/settings/cats', {cats:b2.cats.filter(c => c !== 'Mechanical & AC').map(c => ({from:c, to:c}))}); assert.equal(r.status, 400, 'category with services cannot go');
  r = await owner.put('/api/settings/cats', {cats:b2.cats.filter(c => c !== 'Bike care').map(c => ({from:c, to:c}))}); assert.equal(r.status, 200, 'empty category can go');
});

test('upgrade: an older owner login becomes the Super Admin on start', async () => {
  await D.run("UPDATE users SET role = 'admin' WHERE id = 1"); await D.init();
  assert.equal((await D.one('SELECT role FROM users WHERE id = 1')).role, 'superadmin');
  assert.equal(Number((await D.one("SELECT COUNT(*) AS n FROM users WHERE role = 'superadmin'")).n), 1);
});
