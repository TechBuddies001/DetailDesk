// End-to-end API tests: run with `npm test`. Uses a fresh temporary database each run.
const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'detaildesk-test-'));
const {app} = require('../server/index.js');
const S = require('../public/shared.js');

let server, base;
before(() => new Promise(r => { server = app.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); }));
after(() => { server.close(); fs.rmSync(process.env.DATA_DIR, {recursive:true, force:true}); });

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
  r = await owner.get('/api/session'); assert.equal(r.data.user.role, 'admin'); assert.equal(r.data.setupNeeded, false);
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
