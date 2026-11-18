// Statický build veřejné kalkulačky pro Firebase Hosting (fáze 1): bez serveru, adminu a formuláře.
// Do dist/ jde jen to, co je výslovně vyjmenované níže. Nic dalšího z repozitáře se nenasadí.
//
//   npm run build:static
//
// Proměnné prostředí (nepovinné):
//   SITE_CONFIG          cesta k nastavení (výchozí config/site.json)
//   MEDIA_DIR            složka s ukázkami, na které odkazuje nastavení jako /media/<soubor> (výchozí media/)
//   ALLOW_MISSING_MEDIA  1 = chybějící ukázku jen ohlásit (CI bez přístupu k bucketu); při nasazení musí být vše
//   DIST_DIR             kam build zapsat (výchozí dist/)
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { mergeConfig, normalizeConfig, publicConfig, PUBLIC_KEYS, PUBLIC_PRICE_KEYS } = require('../lib/config');

const ROOT = path.join(__dirname, '..');

// Jediný seznam souborů, které se z repozitáře kopírují (zdroj v public/assets → dist/assets).
const ASSETS = [
  'core.js', 'public.js', 'styles.css',
  'fonts/archivo-latin.woff2', 'fonts/archivo-latin-ext.woff2', 'fonts/Archivo-OFL.txt'
];
// Placené písmo MAIRA, jen pokud ho tým dodá. Pozor: repozitář je veřejný, soubory písma do gitu nepatří.
const OPTIONAL_ASSETS = ['fonts/PPNeueCorp-CompactMedium.woff2', 'fonts/PPNeueCorp-CompactUltrabold.woff2'];

class BuildError extends Error {}

function assetVersion() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 10);
  try { return execSync('git rev-parse HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().slice(0, 10); }
  catch (e) { return String(Date.now()); }
}

// Nastavení pro statickou stránku. Soubor je v (veřejném) gitu, proto smí obsahovat jen veřejné klíče.
function readSiteConfig(file) {
  let site;
  try { site = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { throw new BuildError(`Nastavení ${path.relative(ROOT, file)} nejde načíst: ${e.message}`); }
  if (!site || typeof site !== 'object' || Array.isArray(site)) throw new BuildError('Nastavení musí být objekt JSON.');
  const extra = Object.keys(site).filter(k => !PUBLIC_KEYS.includes(k));
  const extraPrices = Object.keys(site.prices || {}).filter(k => !PUBLIC_PRICE_KEYS.includes(k));
  if (extra.length || extraPrices.length) {
    throw new BuildError('Nastavení obsahuje klíče, které do veřejné části nepatří: ' +
      [...extra, ...extraPrices.map(k => 'prices.' + k)].join(', ') +
      '. Soubor je veřejný (repozitář i web). Interní údaje patří do exportu v privátním bucketu.');
  }
  const { config, errors } = normalizeConfig(site, mergeConfig({}));
  if (errors.length) throw new BuildError('Neplatné hodnoty v nastavení: ' + errors.join(', '));
  // normalizeConfig ukázky s neplatnou adresou tiše vyřadí; v buildu chceme chybu
  const given = Array.isArray(site.examples) ? site.examples.length : 0;
  if (config.examples.length !== given) throw new BuildError('Některá ukázka nemá platnou adresu (src musí být https://… nebo /media/<soubor>).');
  return publicConfig(config, { leadForm: false });
}

function mediaRefs(cfg) {
  const refs = new Set();
  for (const x of cfg.examples) for (const u of [x.src, x.poster]) if (u && u.startsWith('/media/')) refs.add(u.slice('/media/'.length));
  return [...refs];
}

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function build({
  dist = process.env.DIST_DIR || path.join(ROOT, 'dist'),
  siteConfig = process.env.SITE_CONFIG || path.join(ROOT, 'config', 'site.json'),
  mediaDir = process.env.MEDIA_DIR || path.join(ROOT, 'media'),
  allowMissingMedia = process.env.ALLOW_MISSING_MEDIA === '1',
  version = assetVersion(),
  log = console.log
} = {}) {
  const cfg = readSiteConfig(siteConfig);

  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });

  // stránka: verze souborů (?v=…) jako sendView na serveru, aby prohlížeč po nasazení nenačetl starý kód
  const html = fs.readFileSync(path.join(ROOT, 'views', 'public.html'), 'utf8')
    .replace(/(\/assets\/[\w.-]+\.(?:js|css))"/g, `$1?v=${version}"`);
  fs.writeFileSync(path.join(dist, 'index.html'), html);

  for (const a of ASSETS) copy(path.join(ROOT, 'public', 'assets', a), path.join(dist, 'assets', a));
  for (const a of OPTIONAL_ASSETS) {
    const src = path.join(ROOT, 'public', 'assets', a);
    if (fs.existsSync(src)) copy(src, path.join(dist, 'assets', a));
  }

  fs.writeFileSync(path.join(dist, 'config.json'), JSON.stringify(cfg, null, 2) + '\n');

  // ukázky: jen soubory, na které nastavení odkazuje; cesty /media/<soubor> zůstanou stejné jako na Railway
  const missing = [];
  for (const name of mediaRefs(cfg)) {
    if (!/^[a-f0-9-]+\.[a-z0-9]+$/.test(name)) throw new BuildError('Neplatný název ukázky: ' + name);
    const src = path.join(mediaDir, name);
    if (fs.existsSync(src)) copy(src, path.join(dist, 'media', name)); else missing.push(name);
  }
  if (missing.length) {
    const msg = `Chybí ${missing.length} ukázek v ${path.relative(ROOT, mediaDir) || mediaDir}: ${missing.join(', ')}`;
    if (!allowMissingMedia) throw new BuildError(msg + '. Stáhněte je z bucketu (viz README) nebo nastavte ALLOW_MISSING_MEDIA=1 jen pro kontrolu.');
    log('Varování: ' + msg);
  }

  log(`Build hotový: ${path.relative(ROOT, dist) || dist} (verze ${version}, ukázek ${cfg.examples.length}, formulář vypnutý)`);
  return { dist, cfg };
}

module.exports = { build, BuildError, ASSETS };

if (require.main === module) {
  try { build(); }
  catch (e) {
    if (e instanceof BuildError) { console.error('Build selhal: ' + e.message); process.exit(1); }
    throw e;
  }
}
