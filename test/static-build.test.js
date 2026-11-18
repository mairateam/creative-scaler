// Testy veřejného výřezu nastavení, statického buildu a kontroly, že na web nejde nic interního.
//   npm test
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DEFAULT_CONFIG, PUBLIC_KEYS, mergeConfig, normalizeConfig, publicConfig } = require('../lib/config');
const { build, BuildError } = require('../scripts/build-static');
const { checkDist } = require('../scripts/check-static');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cs-test-'));
const writeJson = (file, data) => { fs.writeFileSync(file, JSON.stringify(data)); return file; };
const quiet = () => {};

test('veřejný výřez neobsahuje interní údaje', () => {
  const pub = publicConfig(mergeConfig({}));
  assert.deepEqual(Object.keys(pub).sort(), [...PUBLIC_KEYS, 'features'].sort());
  assert.deepEqual(Object.keys(pub.prices).sort(), ['aiStatic', 'aiVideo']);
  for (const k of ['markets', 'maxSetsPerMonth', 'updatedAt']) assert.equal(pub[k], undefined, k);
  assert.equal(JSON.stringify(pub).includes('classic'), false);
});

test('formulář je ve výřezu vypnutý, dokud ho server výslovně nezapne', () => {
  assert.deepEqual(publicConfig(mergeConfig({})).features, { leadForm: false });
  assert.deepEqual(publicConfig(mergeConfig({}), { leadForm: true }).features, { leadForm: true });
});

test('kontrola nastavení odmítne neplatné hodnoty a platné přijme', () => {
  const cur = mergeConfig({});
  assert.deepEqual(normalizeConfig({ testPct: 0 }, cur).errors, ['testPct']);
  assert.deepEqual(normalizeConfig({ rules: { lowSpend: 5, highSpend: 4 } }, cur).errors, ['rules.highSpend']);
  assert.deepEqual(normalizeConfig({ videosPerSet: 0, staticsPerSet: 0 }, cur).errors, ['perSet']);
  const ok = normalizeConfig({ testPct: 40, prices: { aiVideo: 4000 } }, cur);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.config.testPct, 40);
  assert.equal(ok.config.prices.aiVideo, 4000);
  assert.equal(ok.config.prices.classicVideo, DEFAULT_CONFIG.prices.classicVideo);
});

test('build z výchozího nastavení projde kontrolou', () => {
  const dir = tmp();
  const dist = path.join(dir, 'dist');
  build({ dist, version: 'test123', log: quiet });
  assert.deepEqual(checkDist(dist), []);
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  assert.match(html, /\/assets\/public\.js\?v=test123"/);
  assert.equal(html.includes('fonts.googleapis.com'), false);
  const cfg = JSON.parse(fs.readFileSync(path.join(dist, 'config.json'), 'utf8'));
  assert.equal(cfg.features.leadForm, false);
});

test('build odmítne interní klíče v nastavení (soubor je veřejný)', () => {
  const dir = tmp();
  const site = writeJson(path.join(dir, 'site.json'), { markets: { cz: { daily: 5000 } } });
  assert.throws(() => build({ dist: path.join(dir, 'dist'), siteConfig: site, log: quiet }), BuildError);
  const site2 = writeJson(path.join(dir, 'site2.json'), { prices: { aiVideo: 1, classicVideo: 2 } });
  assert.throws(() => build({ dist: path.join(dir, 'dist'), siteConfig: site2, log: quiet }), /prices\.classicVideo/);
});

test('build odmítne neplatné hodnoty i ukázku s neplatnou adresou', () => {
  const dir = tmp();
  const bad = writeJson(path.join(dir, 'bad.json'), { testPct: 500 });
  assert.throws(() => build({ dist: path.join(dir, 'dist'), siteConfig: bad, log: quiet }), /testPct/);
  const badEx = writeJson(path.join(dir, 'ex.json'), { examples: [{ title: 'x', src: 'http://insecure.example/a.mp4' }] });
  assert.throws(() => build({ dist: path.join(dir, 'dist'), siteConfig: badEx, log: quiet }), /adresu/);
});

test('ukázky z /media se zkopírují, chybějící zastaví build', () => {
  const dir = tmp();
  const media = path.join(dir, 'media');
  fs.mkdirSync(media);
  fs.writeFileSync(path.join(media, 'ab12-cd34.mp4'), 'video');
  const site = writeJson(path.join(dir, 'site.json'), { examples: [{ title: 'A', src: '/media/ab12-cd34.mp4', poster: '/media/ff00.jpg' }] });
  const dist = path.join(dir, 'dist');
  assert.throws(() => build({ dist, siteConfig: site, mediaDir: media, log: quiet }), /ff00\.jpg/);
  fs.writeFileSync(path.join(media, 'ff00.jpg'), 'img');
  fs.writeFileSync(path.join(media, 'abcd-nepouzita.png'), 'x');
  build({ dist, siteConfig: site, mediaDir: media, log: quiet });
  assert.deepEqual(fs.readdirSync(path.join(dist, 'media')).sort(), ['ab12-cd34.mp4', 'ff00.jpg']);
  assert.deepEqual(checkDist(dist), []);
});

test('kontrola zachytí interní soubory, adresy a cizí servery', () => {
  const dir = tmp();
  const dist = path.join(dir, 'dist');
  build({ dist, version: 't', log: quiet });
  fs.mkdirSync(path.join(dist, 'admin'));
  fs.writeFileSync(path.join(dist, 'admin', 'admin.js'), '');
  fs.writeFileSync(path.join(dist, 'readme.html'), '');
  fs.appendFileSync(path.join(dist, 'assets', 'core.js'), "\nfetch('/api/admin/leads')");
  const idx = path.join(dist, 'index.html');
  fs.writeFileSync(idx, fs.readFileSync(idx, 'utf8').replace('</head>', '<link rel="stylesheet" href="https://fonts.googleapis.com/css2"></head>'));
  const cfgFile = path.join(dist, 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  cfg.markets = {}; cfg.features.leadForm = true;
  fs.writeFileSync(cfgFile, JSON.stringify(cfg));
  const problems = checkDist(dist).join('\n');
  for (const s of ['admin/admin.js', 'readme.html', '/api/admin', 'fonts.googleapis.com', 'markets', 'leadForm']) {
    assert.ok(problems.includes(s), `chybí hlášení pro ${s}:\n${problems}`);
  }
});
