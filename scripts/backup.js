// Safe online backup of the database (works while the app is running).
// Usage: npm run backup   → data/backups/detaildesk-YYYY-MM-DD-HHMM.db
// Also copy data/uploads/ (photos and signatures) to your backup location.
const path = require('path');
const fs = require('fs');
const {db, DATA_DIR} = require('../server/db');
const S = require('../public/shared.js');

const dir = path.join(DATA_DIR, 'backups');
fs.mkdirSync(dir, {recursive:true});
const file = path.join(dir, `detaildesk-${S.isoDT(new Date()).replace('T', '-').replace(':', '')}.db`);
db.backup(file).then(() => { console.log('Backup saved:', file); process.exit(0); }).catch(e => { console.error('Backup failed:', e.message); process.exit(1); });
