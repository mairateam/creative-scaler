// Creative Scaler – server
// Veřejná část (/) je pro klienty, admin (/admin) pro tým. Obojí může být pod heslem.
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const store = require('./store');
const { normalizeConfig, publicConfig, clip } = require('./lib/config');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const PUBLIC_PASSWORD = process.env.PUBLIC_PASSWORD || '';
// Veřejná část je bez hesla otevřená jen tehdy, když to někdo výslovně zapne (PUBLIC_OPEN=true).
// Bez hesla i bez PUBLIC_OPEN je zavřená a pustí jen admina – nic se tak neotevře omylem.
const PUBLIC_OPEN = String(process.env.PUBLIC_OPEN || '').toLowerCase() === 'true'; // má přednost před PUBLIC_PASSWORD
// Admin bez hesla jen po výslovném zapnutí (ADMIN_OPEN=true) – vhodné pro demo.
const ADMIN_OPEN = String(process.env.ADMIN_OPEN || '').toLowerCase() === 'true';
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || '';
let SESSION_SECRET = process.env.SESSION_SECRET || '';
const SESSION_DAYS = 14;

if (ADMIN_OPEN) console.warn('[creative-scaler] Admin je otevřený bez hesla (ADMIN_OPEN=true).');
else if (!ADMIN_PASSWORD) console.warn('[creative-scaler] ADMIN_PASSWORD není nastavené – admin je nedostupný.');
if (!SESSION_SECRET) {
  // Bez SESSION_SECRET si server jednou vygeneruje náhodný klíč a uloží ho vedle dat,
  // takže přihlášení vydrží i restart a nikdo nemusí nic vymýšlet.
  const keyFile = require('path').join(store.DATA_DIR, 'session.key');
  try { SESSION_SECRET = require('fs').readFileSync(keyFile, 'utf8').trim(); } catch (e) {}
  if (!SESSION_SECRET) {
    SESSION_SECRET = crypto.randomBytes(32).toString('hex');
    try { require('fs').writeFileSync(keyFile, SESSION_SECRET, { mode: 0o600 }); }
    catch (e) { console.warn('[creative-scaler] Klíč přihlášení nejde uložit – po restartu se všichni odhlásí.'); }
  }
}
console.log(`[creative-scaler] Data: ${store.DATA_DIR} · veřejná část ${PUBLIC_OPEN ? 'otevřená' : (PUBLIC_PASSWORD ? 'pod heslem' : 'zavřená (jen admin)')}`);

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  next();
});

/* ---------- přihlášení ---------- */
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const pwTag = role => sha(role === 'admin' ? ADMIN_PASSWORD : PUBLIC_PASSWORD).slice(0, 12);
const sign = s => crypto.createHmac('sha256', SESSION_SECRET).update(s).digest('hex');

function safeEqual(a, b) {
  const x = Buffer.from(sha(a)), y = Buffer.from(sha(b));
  return crypto.timingSafeEqual(x, y);
}

function makeToken(role) {
  const exp = Date.now() + SESSION_DAYS * 864e5;
  const body = `${role}.${exp}.${pwTag(role)}`;
  return `${body}.${sign(body)}`;
}

function readRole(req) {
  const raw = (req.headers.cookie || '').split(';').map(c => c.trim()).find(c => c.startsWith('cs_auth='));
  if (!raw) return null;
  const token = decodeURIComponent(raw.slice(8));
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [role, exp, tag, sig] = parts;
  const body = `${role}.${exp}.${tag}`;
  if (!safeEqual(sig, sign(body))) return null;
  if (Number(exp) < Date.now()) return null;
  if (role !== 'admin' && role !== 'public') return null;
  if (tag !== pwTag(role)) return null; // změna hesla odhlásí staré relace
  return role;
}

function setAuthCookie(req, res, role) {
  res.cookie('cs_auth', makeToken(role), {
    httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: SESSION_DAYS * 864e5, path: '/'
  });
}

// jednoduchá ochrana proti zkoušení hesel: 10 pokusů za 15 minut z jedné IP
const attempts = new Map();
function tooMany(ip) {
  const now = Date.now(), win = 15 * 60e3;
  const list = (attempts.get(ip) || []).filter(t => now - t < win);
  attempts.set(ip, list);
  return list.length >= 10;
}
function noteFail(ip) { (attempts.get(ip) || attempts.set(ip, []).get(ip)).push(Date.now()); }

const safeNext = n => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//')) ? n : '/';

function wantsHtml(req) { return !req.path.startsWith('/api/'); }

function requirePublic(req, res, next) {
  if (PUBLIC_OPEN) return next();
  const role = readRole(req);
  if (role === 'public' || role === 'admin') return next();
  if (wantsHtml(req)) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  res.status(401).json({ error: 'Přihlaste se.' });
}

function requireAdmin(req, res, next) {
  if (ADMIN_OPEN) return next();
  if (ADMIN_PASSWORD && readRole(req) === 'admin') return next();
  if (wantsHtml(req)) return res.redirect('/login?admin=1&next=' + encodeURIComponent(req.originalUrl));
  res.status(401).json({ error: 'Jen pro admin.' });
}

const VIEWS = path.join(__dirname, 'views');
// verze souborů v HTML (?v=…), aby prohlížeč po nasazení nenačetl starý kód z mezipaměti
const ASSET_V = (process.env.RAILWAY_GIT_COMMIT_SHA || String(Date.now())).slice(0, 10);
const viewCache = new Map();
function sendView(res, name) {
  if (!viewCache.has(name)) viewCache.set(name, require('fs').readFileSync(path.join(VIEWS, name), 'utf8').replace(/(\/(?:assets|admin)\/[\w.-]+\.(?:js|css))"/g, `$1?v=${ASSET_V}"`));
  res.set('Cache-Control', 'no-cache').type('html').send(viewCache.get(name));
}
const PRIVATE = path.join(__dirname, 'private');

app.get('/login', (req, res) => {
  // když není co hlídat, přihlášení přeskočíme
  const next = safeNext(req.query.next);
  if ((next.startsWith('/admin') && ADMIN_OPEN) || (!next.startsWith('/admin') && PUBLIC_OPEN)) return res.redirect(next);
  res.sendFile(path.join(VIEWS, 'login.html'));
});
app.post('/login', (req, res) => {
  const ip = req.ip;
  const next = safeNext(req.body.next);
  const back = err => res.redirect(`/login?e=${err}&next=${encodeURIComponent(next)}${next.startsWith('/admin') ? '&admin=1' : ''}`);
  if (tooMany(ip)) return back('limit');
  const pw = String(req.body.password || '');
  if (ADMIN_PASSWORD && safeEqual(pw, ADMIN_PASSWORD)) { setAuthCookie(req, res, 'admin'); return res.redirect(next); }
  if (PUBLIC_PASSWORD && safeEqual(pw, PUBLIC_PASSWORD) && !next.startsWith('/admin')) { setAuthCookie(req, res, 'public'); return res.redirect(next); }
  noteFail(ip);
  back('bad');
});
app.get('/logout', (req, res) => { res.clearCookie('cs_auth', { path: '/' }); res.redirect(ADMIN_OPEN ? '/' : '/login'); });
app.get('/api/admin/mode', (req, res) => res.json({ open: ADMIN_OPEN }));

/* ---------- stránky a soubory ---------- */
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets'), { maxAge: '1h' }));
app.get('/healthz', (req, res) => res.json({ ok: true }));
app.get('/', requirePublic, (req, res) => sendView(res, 'public.html'));
app.get('/admin', requireAdmin, (req, res) => sendView(res, 'admin.html'));
app.get(['/READ_ME', '/read_me', '/readme', '/READ-ME'], requireAdmin, (req, res) => res.sendFile(path.join(VIEWS, 'readme.html')));
app.get('/admin/admin.js', requireAdmin, (req, res) => res.sendFile(path.join(PRIVATE, 'admin.js')));

/* ---------- nastavení ---------- */
// veřejnosti posíláme jen to, co výpočet potřebuje; výřez sdílí se statickým buildem.
// Server poptávky přijímá (/api/leads), proto tu formulář zůstává zapnutý.
app.get('/api/config', requirePublic, (req, res) => res.json(publicConfig(store.getConfig(), { leadForm: true })));
/* ---------- ukázky: nahrání souboru do DATA_DIR/media ---------- */
const MEDIA_TYPES = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
app.use('/media', requirePublic, express.static(store.MEDIA_DIR, { maxAge: '7d', fallthrough: false }));
app.post('/api/admin/media', requireAdmin, express.raw({ type: Object.keys(MEDIA_TYPES), limit: '80mb' }), (req, res) => {
  const ext = MEDIA_TYPES[String(req.headers['content-type'] || '').split(';')[0].trim()];
  if (!ext || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Nahrajte video (MP4, WEBM, MOV) nebo obrázek (JPG, PNG, WEBP, GIF).' });
  const name = crypto.randomUUID() + '.' + ext;
  require('fs').writeFileSync(path.join(store.MEDIA_DIR, name), req.body);
  res.json({ src: '/media/' + name, kind: ext.match(/mp4|webm|mov/) ? 'video' : 'image' });
});

app.get('/api/admin/config', requireAdmin, (req, res) => res.json(store.getConfig()));

app.put('/api/admin/config', requireAdmin, (req, res) => {
  // kontrola hodnot je v lib/config.js, aby ji mohl použít i statický build
  const { config: next, errors } = normalizeConfig(req.body, store.getConfig());
  if (errors.length) return res.status(400).json({ error: 'Neplatné hodnoty', fields: errors });
  res.json(store.saveConfig(next));
});

/* ---------- poptávky ---------- */
const leadHits = new Map();
app.post('/api/leads', requirePublic, async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true }); // past na roboty
  const now = Date.now();
  const hits = (leadHits.get(req.ip) || []).filter(t => now - t < 60 * 60e3);
  if (hits.length >= 5) return res.status(429).json({ error: 'Příliš mnoho poptávek, zkuste to později.' });
  const lead = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    status: 'new',
    name: clip(b.name, 120), company: clip(b.company, 160), email: clip(b.email, 200),
    lang: ['cs', 'sk', 'en'].includes(b.lang) ? b.lang : 'cs',
    calc: {}
  };
  if (!lead.name || !lead.company || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(lead.email)) return res.status(400).json({ error: 'Vyplňte jméno, firmu a platný e-mail.' });
  const c = b.calc || {};
  for (const k of ['spend', 'cpa', 'roas', 'current', 'liveNow', 'newAds', 'live', 'sets', 'costAi', 'costClassic']) {
    const v = Number(c[k]); if (isFinite(v)) lead.calc[k] = v;
  }
  if (['stable', 'growth', 'launch'].includes(c.sit)) lead.calc.sit = c.sit;
  if (['CZK', 'EUR', 'USD'].includes(c.currency)) lead.calc.currency = c.currency;
  hits.push(now); leadHits.set(req.ip, hits);
  const list = store.getLeads(); list.unshift(lead); store.saveLeads(list);
  res.json({ ok: true });

  if (SLACK_WEBHOOK_URL) {
    const f = n => (n ?? 0).toLocaleString('cs-CZ');
    const text = `:sparkles: *Nová poptávka z Creative Scaleru*\n${lead.name} · ${lead.company} · ${lead.email}\n` +
      `Spend ${f(lead.calc.spend)} Kč/měs. · ${lead.calc.sit || 'stable'} · doporučeno *${f(lead.calc.newAds)} kreativ měsíčně*` +
      (lead.calc.current ? ` (dnes ${f(lead.calc.current)})` : '');
    fetch(SLACK_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
      .catch(e => console.warn('[creative-scaler] Slack se nepodařilo zavolat:', e.message));
  }
});

app.get('/api/admin/leads', requireAdmin, (req, res) => res.json(store.getLeads()));
app.patch('/api/admin/leads/:id', requireAdmin, (req, res) => {
  const list = store.getLeads();
  const lead = list.find(l => l.id === req.params.id);
  if (!lead) return res.status(404).json({ error: 'Poptávka nenalezena.' });
  if (['new', 'done'].includes(req.body.status)) lead.status = req.body.status;
  store.saveLeads(list);
  res.json(lead);
});
app.get('/admin/leads.csv', requireAdmin, (req, res) => {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['datum', 'stav', 'jmeno', 'firma', 'email', 'jazyk', 'situace', 'spend', 'cpa', 'roas', 'dnes_kreativ', 'doporuceno_kreativ', 'zivych_doporuceno', 'naklady_ai', 'naklady_klasika', 'mena_klienta'];
  const rows = store.getLeads().map(l => [l.createdAt, l.status, l.name, l.company, l.email, l.lang, l.calc.sit || l.calc.market, l.calc.spend, l.calc.cpa, l.calc.roas, l.calc.current, l.calc.newAds, l.calc.live, l.calc.costAi, l.calc.costClassic, l.calc.currency].map(q).join(','));
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="creative-scaler-poptavky.csv"');
  res.send('﻿' + [head.join(','), ...rows].join('\n'));
});

app.use((req, res) => res.status(404).send('Stránka neexistuje.'));

app.listen(PORT, () => console.log(`[creative-scaler] běží na portu ${PORT}`));
