// Hlavičky a přesměrování z firebase.json, jak je pošle Firebase Hosting (lokálně přes superstatic,
// stejný server jako emulátor). Hlídá CSP, HSTS, noindex a cache, aby je nikdo omylem neodebral.
//   npm test   (nejdřív se spustí build do dočasné složky)
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build } = require('../scripts/build-static');

let superstatic = null;
try {
  // Na Windows superstatic (přes glob-slash) skládá cesty se zpětnými lomítky a žádné pravidlo pro
  // hlavičky pak nesedí. Firebase Hosting ani CI na Linuxu to nemají; pro test vnutíme POSIX cesty.
  if (process.platform === 'win32') require('glob-slash').normalize = v => path.posix.normalize(path.posix.join('/', v));
  superstatic = require('superstatic');
} catch (e) { /* superstatic přichází s firebase-tools (devDependency); bez něj test přeskočíme */ }

const ROOT = path.join(__dirname, '..');
let srv, base, dir;

before(async () => {
  if (!superstatic) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-hosting-'));
  build({ dist: path.join(dir, 'dist'), version: 'test', log: () => {} });
  const hosting = { ...JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase.json'), 'utf8')).hosting, public: 'dist' };
  await new Promise(resolve => {
    srv = superstatic.server({ port: 0, hostname: '127.0.0.1', cwd: dir, config: hosting, stack: 'strict' }).listen(resolve);
  });
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => { if (srv) srv.close(); if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

const opts = { skip: !superstatic && 'superstatic není nainstalovaný (npm ci)' };
const get = p => fetch(base + p);

test('každá odpověď má bezpečnostní hlavičky a noindex', opts, async () => {
  for (const p of ['/', '/api/config', '/assets/public.js', '/neexistuje']) {
    const r = await get(p);
    const csp = r.headers.get('content-security-policy') || '';
    assert.match(csp, /default-src 'self'/, p);
    assert.match(csp, /script-src 'self';/, p);
    assert.match(csp, /frame-ancestors 'none'/, p);
    assert.match(r.headers.get('strict-transport-security') || '', /max-age=\d+/, p);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff', p);
    assert.equal(r.headers.get('x-robots-tag'), 'noindex', p);
  }
});

test('stránka a nastavení se necachují, verzované soubory ano', opts, async () => {
  assert.equal((await get('/')).headers.get('cache-control'), 'no-cache');
  assert.equal((await get('/api/config')).headers.get('cache-control'), 'no-cache');
  assert.match((await get('/assets/core.js?v=test')).headers.get('cache-control'), /immutable/);
});

test('/api/config vrací veřejné nastavení jako JSON bez formuláře', opts, async () => {
  const r = await get('/api/config');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^application\/json/);
  const cfg = await r.json();
  assert.equal(cfg.features.leadForm, false);
  assert.equal(cfg.markets, undefined);
});

test('interní adresy neexistují', opts, async () => {
  for (const p of ['/admin', '/admin/admin.js', '/admin/leads.csv', '/login', '/READ_ME', '/api/leads', '/api/admin/config', '/api/admin/leads']) {
    assert.equal((await get(p)).status, 404, p);
  }
});
