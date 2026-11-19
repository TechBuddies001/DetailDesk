// Unit tests for shared helpers (no database needed).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const S = require('../public/shared.js');

const vars = {name:'Rahul', fullname:'Rahul Verma', vehicle:'Tata Harrier (MH 12 VD 9081)', car:'Tata Harrier', reg:'MH 12 VD 9081', business:'Shine Lab',
  jobid:'JC-0012', services:'• Full body PPF\n• Ceramic coating', estimate:'₹1,63,106', advance:'', due:'Tomorrow, 6:00 PM', link:'https://x/j/abc', bay:'', balance:'₹1,13,106'};

test('fillTemplate fills words and skips lines with nothing to fill', () => {
  const out = S.fillTemplate(S.WA_DEFAULTS_HI.jobcard, vars);
  assert.match(out, /^Namaste Rahul ji, aapki Tata Harrier \(MH 12 VD 9081\) Shine Lab pe aa gayi hai\./);
  assert.match(out, /• Full body PPF\n• Ceramic coating/);
  assert.doesNotMatch(out, /Advance/, 'no advance, so the advance line is skipped');
  assert.match(out, /– Team Shine Lab$/);
  assert.doesNotMatch(out, /\n{3,}/);
});
test('fillTemplate keeps unknown words so typos are visible', () => {
  assert.equal(S.fillTemplate('Hi {name}, {nmae}', {name:'A'}), 'Hi A, {nmae}');
  assert.equal(S.fillTemplate('', vars), '');
  assert.equal(S.fillTemplate('a\n\n\n\nb', {}), 'a\n\nb');
});
test('every default message only uses words that exist for it', () => {
  for (const [k, , extra] of S.WA_KINDS){
    const allowed = new Set([...S.WA_COMMON, ...extra]);
    for (const set of [S.WA_DEFAULTS_HI, S.WA_DEFAULTS_EN]){
      const used = [...set[k].matchAll(/\{(\w+)\}/g)].map(m => m[1]);
      used.forEach(u => assert.ok(allowed.has(u), `${k} uses {${u}}`));
    }
  }
});
