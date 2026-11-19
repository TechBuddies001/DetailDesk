// Fills an EMPTY database with sample data for showing the app to a client. Uses the same DB_* settings as the app.
// Usage: npm run seed   (refuses to run if any login already exists)
process.env.TZ = process.env.TZ || 'Asia/Kolkata';
process.env.DD_NO_RETRY = '1';
const S = require('../public/shared.js');
const D = require('../server/db');
const A = require('../server/auth');
const {ready, createJob, markReady, makeInvoice, addPayment} = require('../server/index.js');

(async () => {
  await ready;
  if (Number((await D.one('SELECT COUNT(*) AS n FROM users')).n) > 0){
    console.error('This database already has logins. Seeding only works on an empty database.');
    process.exitCode = 1; return;
  }
  const at = (days, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(h, m, 0, 0); return S.isoDT(d); };
  const now = S.isoDT(new Date());
  const ownerPw = process.env.SEED_OWNER_PASSWORD || 'owner123', mgrPw = process.env.SEED_MANAGER_PASSWORD || 'manager123';
  const addUser = async (name, login, pw, role) => (await D.run('INSERT INTO users (name, login, pass, role, active, created) VALUES (?, ?, ?, ?, 1, ?)', [name, login, A.hashPassword(pw), role, now])).insertId;
  const owner = {id:await addUser('Owner', '9876500000', ownerPw, 'admin'), name:'Owner', role:'admin'};
  const mgr = {id:await addUser('Nikhil Jadhav', '9890122476', mgrPw, 'manager'), name:'Nikhil Jadhav', role:'manager'};
  await D.setKV('biz', {name:'Shine Lab Car Care', addr:'Baner Road, Pune 411045', ph:'98765 00000', gstin:'27AAAAA0000A1Z5', gst:true, upi:'shinelab@upi'});
  await D.setKV('staff', [{n:'Sameer Khan', r:'PPF installer · lead'}, {n:'Ajay More', r:'PPF installer'}, {n:'Rahul Deshpande', r:'Prep & polish'}, {n:'Vishal Pawar', r:'Coating specialist'}, {n:'Anil Sonawane', r:'Polisher'}, {n:'Mahesh Thorat', r:'Wash & interior'}, {n:'Irfan Sayyed', r:'Mechanic'}]);

  const base = {email:'', color:'', odo:'', req:''}, terms = ['dmg', 'time', 'warr'], bel = ['Stepney', 'Jack & tool kit', 'Floor mats', 'Documents (RC, insurance)'];
  const J = (who, when, f, o) => createJob(who, {f:{...base, ...f}, fuel:'½', dmg:{}, photos:{}, bel, panels:[], ppf:{}, coat:{}, disc:0, adv:0, mode:'UPI', terms, sig:null, bay:'', team:[], prio:'Normal', ...o}, {at:when});
  const deliver = async (who, id, readyAt, doneAt, payMode) => { await markReady(who, id, {at:readyAt}); const no = await makeInvoice(who, id, {at:doneAt}); if (payMode) await addPayment(who, no, 99999999, payMode, {at:doneAt}); };

  await deliver(mgr, await J(mgr, at(-130, 11), {name:'Rahul Verma', mob:'9822041763', reg:'MH 12 VD 9081', model:'Tata Harrier Fearless+', color:'Coral Red', odo:'2950'}, {seg:3, svcs:['int', 'wash'], due:at(-130, 18)}), at(-130, 16), at(-130, 17), 'UPI');
  await deliver(mgr, await J(mgr, at(-6, 10), {name:'Pooja Desai', mob:'9960027318', reg:'MH 12 RK 1180', model:'Hyundai Verna SX', color:'Typhoon Silver', odo:'40115'}, {seg:1, svcs:['pc-1', 'wash'], bay:'Bay 4', team:['Anil Sonawane'], due:at(-6, 18)}), at(-6, 16, 50), at(-6, 17, 30), 'UPI');
  await deliver(mgr, await J(owner, at(-5, 10), {name:'Imran Shaikh', mob:'9765033508', reg:'MH 12 AZ 5521', model:'BMW 330Li M Sport', color:'Mineral White', odo:'12906'}, {seg:4, svcs:['ppf-full', 'cer-ppf', 'ppf-lamp'], adv:100000, ppf:{finish:'Matte', film:'8 mil matte TPU', warr:10}, coat:{product:'Ceramic over PPF', layers:1, warr:2}, bay:'Bay 2', team:['Ajay More', 'Vishal Pawar'], due:at(-1, 12)}), at(-1, 10, 30), at(-1, 12, 15), 'Card');
  await deliver(mgr, await J(mgr, at(-3, 9, 50), {name:'Aditya Patil', mob:'9096070781', reg:'MH 12 PQ 6604', model:'Mahindra XUV700 AX7', color:'Midnight Black', odo:'2310'}, {seg:3, svcs:['ppf-front', 'sun'], adv:15000, ppf:{finish:'Gloss', film:'8 mil gloss TPU', warr:7}, bay:'Bay 2', team:['Ajay More'], due:at(-1, 19)}), at(-1, 17), at(-1, 18, 30), null);
  const creta = await J(mgr, at(-2, 10, 5), {name:'Arjun Mehta', mob:'9881064420', reg:'MH 12 KT 4821', model:'Hyundai Creta SX(O)', color:'Abyss Black', odo:'8412', req:'Full body gloss PPF before a road trip.'}, {seg:3, svcs:['ppf-full', 'pc-1', 'ppf-lamp'], disc:5, adv:50000, dmg:{rbump:'scratch', lfd:'chip'}, ppf:{finish:'Gloss', film:'7.5 mil gloss TPU', warr:5, notes:'Edges wrapped on doors and bonnet'}, bay:'Bay 1', team:['Sameer Khan', 'Rahul Deshpande'], due:at(1, 18)});
  await J(mgr, at(-1, 16, 15), {name:'Sneha Kulkarni', mob:'9923411870', reg:'MH 14 GH 0937', model:'Maruti Swift ZXi', color:'Solid Fire Red', odo:'14602'}, {seg:0, svcs:['cer-9h'], adv:5000, mode:'Cash', dmg:{bonnet:'swirl'}, coat:{product:'9H ceramic', layers:2, warr:3}, bay:'Bay 3', team:['Vishal Pawar'], due:at(0, 19)});
  await J(mgr, at(0, 9, 20), {name:'Vikram Rao', mob:'9730018945', reg:'MH 12 RS 7710', model:'Toyota Fortuner Legender', color:'Pearl White', odo:'38115'}, {seg:3, svcs:['pc-2', 'gra-3'], adv:20000, dmg:{bonnet:'swirl', roof:'swirl'}, coat:{product:'Graphene', layers:3, warr:5}, bay:'Bay 4', team:['Anil Sonawane'], due:at(2, 13)});
  const nexon = await J(mgr, at(0, 9), {name:'Karan Gill', mob:'9987021318', reg:'MH 14 DX 2209', model:'Tata Nexon XZ+', color:'Daytona Grey', odo:'20184'}, {seg:2, svcs:['svc', 'wash'], bay:'Service bay', team:['Irfan Sayyed'], due:at(0, 18)});
  await markReady(mgr, nexon, {at:at(0, 9, 30)});
  await J(mgr, at(0, 9, 10), {name:'Priya Nair', mob:'9819045590', reg:'MH 12 NB 3355', model:'Honda City ZX', color:'Radiant Red', odo:'52330', req:'Coffee stain on the rear seat.'}, {seg:1, fuel:'¼', svcs:['int', 'wash'], bay:'Wash bay', team:['Mahesh Thorat'], due:at(0, 17)});

  console.log(`Sample data added (${creta} is the Creta full PPF job).
Owner login:   98765 00000 / ${ownerPw}
Manager login: 98901 22476 / ${mgrPw}
Change these passwords after the demo (Settings → Logins).`);
})().catch(e => { console.error('Seed failed:', e.message); process.exitCode = 1; }).finally(() => D.pool.end());
