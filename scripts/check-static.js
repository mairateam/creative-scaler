// Kontrola statického buildu před nasazením: nic interního se nesmí dostat na veřejný web.
//
//   npm run check:static          (kontroluje dist/, nebo složku v DIST_DIR)
//
// Selže, když build obsahuje admin, přihlášení, návod pro tým, soubory z private/, interní adresy API,
// interní údaje z nastavení, odkazy na cizí servery nebo soubory jiného typu, než web potřebuje.
const fs = require('fs');
const path = require('path');
const { PUBLIC_KEYS } = require('../lib/config');

const FORBIDDEN_PATHS = /admin|login|readme|read_me|private|\.env|\.map$|leads/i;
const ALLOWED_EXT = new Set(['.html', '.js', '.css', '.json', '.woff2', '.txt', '.mp4', '.webm', '.mov', '.jpg', '.jpeg', '.png', '.webp', '.gif']);
const TEXT_EXT = new Set(['.html', '.js', '.css', '.json', '.txt']);
// interní adresy a názvy proměnných se serverem
const FORBIDDEN_TEXT = ['/api/admin', '/admin/', '/READ_ME', 'ADMIN_PASSWORD', 'PUBLIC_PASSWORD', 'SESSION_SECRET', 'SLACK_WEBHOOK'];
// jediný cizí web, na který stránka smí odkazovat (tlačítko „Chci kreativy“ ve fázi 1)
const ALLOWED_ORIGINS = ['https://mairateam.com'];
const REQUIRED = ['index.html', 'config.json', 'assets/core.js', 'assets/public.js', 'assets/styles.css'];

function walk(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p, base) : [path.relative(base, p).split(path.sep).join('/')];
  });
}

function checkDist(dist) {
  const problems = [];
  if (!fs.existsSync(dist)) return [`Složka ${dist} neexistuje. Nejdřív spusťte npm run build:static.`];
  const files = walk(dist);

  for (const f of REQUIRED) if (!files.includes(f)) problems.push(`Chybí ${f}`);

  for (const f of files) {
    if (FORBIDDEN_PATHS.test(f)) problems.push(`Soubor, který na web nepatří: ${f}`);
    const ext = path.extname(f).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) problems.push(`Nečekaný typ souboru: ${f}`);
    if (!TEXT_EXT.has(ext)) continue;
    const text = fs.readFileSync(path.join(dist, f), 'utf8');
    for (const s of FORBIDDEN_TEXT) if (text.includes(s)) problems.push(`${f} obsahuje „${s}“`);
    if (ext === '.html' || ext === '.css') {
      // každý odkaz na jiný server znamená požadavek mimo náš web (GDPR, CSP)
      for (const m of text.matchAll(/(?:src|href)\s*=\s*["']?(https?:\/\/[^"'\s>]+)|url\(\s*["']?(https?:\/\/[^"')\s]+)/gi)) {
        const url = m[1] || m[2];
        if (!ALLOWED_ORIGINS.some(o => url === o || url.startsWith(o + '/'))) problems.push(`${f} odkazuje na cizí server: ${url}`);
      }
    }
  }

  if (files.includes('config.json')) {
    let cfg = null;
    try { cfg = JSON.parse(fs.readFileSync(path.join(dist, 'config.json'), 'utf8')); }
    catch (e) { problems.push('config.json není platný JSON'); }
    if (cfg) {
      const extra = Object.keys(cfg).filter(k => !PUBLIC_KEYS.includes(k) && k !== 'features');
      if (extra.length) problems.push('config.json obsahuje interní klíče: ' + extra.join(', '));
      const prices = Object.keys(cfg.prices || {}).filter(k => !['aiVideo', 'aiStatic'].includes(k));
      if (prices.length) problems.push('config.json obsahuje interní ceny: ' + prices.join(', '));
      // fáze 1 nemá server, který by poptávky přijal
      if (!cfg.features || cfg.features.leadForm !== false) problems.push('config.json: features.leadForm musí být false (statická stránka nemá kam poptávku poslat)');
    }
  }

  if (files.includes('index.html')) {
    const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
    // Stránka je zatím noindex (indexování se schválí až po kontrole nasazení). Až se indexování schválí, upravte tuto kontrolu.
    if (!/<meta name="robots" content="noindex">/.test(html)) problems.push('index.html nemá <meta name="robots" content="noindex">');
    if (/<script>|<script\s+(?![^>]*\bsrc=)/i.test(html)) problems.push('index.html obsahuje inline skript (CSP ho zablokuje)');
    if (/\son[a-z]+\s*=/i.test(html)) problems.push('index.html obsahuje inline obsluhu události (onclick= apod.), CSP ji zablokuje');
  }
  return problems;
}

module.exports = { checkDist };

if (require.main === module) {
  const dist = process.env.DIST_DIR || path.join(__dirname, '..', 'dist');
  const problems = checkDist(dist);
  if (problems.length) {
    console.error('Kontrola buildu selhala:\n' + problems.map(p => '  - ' + p).join('\n'));
    process.exit(1);
  }
  console.log(`Kontrola buildu v pořádku (${walk(dist).length} souborů).`);
}
