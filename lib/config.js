// Nastavení kalkulačky: výchozí hodnoty, kontrola vstupů a veřejný výřez.
// Sdílí ho server (store.js, server.js) i statický build (scripts/build-static.js),
// takže veřejná stránka na Railway i na Firebase Hosting dostane stejná data.
// Soubor nesmí sahat na disk ani na proměnné prostředí.

const DEFAULT_CONFIG = {
  testPct: 30,
  testDays: 6,
  videosPerSet: 3,
  staticsPerSet: 2,
  winnersPerSet: 1,
  winnerLifeWeeks: 4,
  maxSetsPerMonth: 20, // starý výpočet (do v0.4), dnes se nepoužívá
  fatigueWeeklyPct: 7,
  fatigueStartWeek: 3,
  refreshEffPct: 70,   // o kolik % doporučená obměna kreativ tlumí únavu
  // počet nových kreativ podle rozpočtu: přímka mezi dvěma kotvami, zaokrouhleno na schůdky
  rules: { lowSpend: 100000, lowN: 10, highSpend: 1000000, highN: 50, step: 5, smallSpend: 100000, tinySpend: 50000, minLive: 6, under20: 20000, costWarnPct: 35, lowConv: 10 },
  situations: { growth: 1.5, launch: 2 },
  // ukázky AI kreativ ve veřejné části: { title, client, result, src, poster, kind: 'video'|'image', ratio: '1:1'|'9:16'|'4:5'|'16:9' }
  examples: [],
  rates: { EUR: 24.35, USD: 21.36 },
  markets: {
    cz: { daily: 5000, verified: true },
    sk: { daily: 3500, verified: false },
    pl: { daily: 4000, verified: false },
    hu: { daily: 3500, verified: false },
    de: { daily: 9000, verified: false },
    at: { daily: 8000, verified: false }
  },
  prices: { aiVideo: 3500, classicVideo: 18000, aiStatic: 900, classicStatic: 3500 },
  pricesAreDemo: true,
  updatedAt: null
};

// Uložené nastavení doplní o výchozí hodnoty (i uvnitř vnořených objektů).
function mergeConfig(saved = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...saved,
    markets: { ...DEFAULT_CONFIG.markets, ...(saved.markets || {}) },
    prices: { ...DEFAULT_CONFIG.prices, ...(saved.prices || {}) },
    rates: { ...DEFAULT_CONFIG.rates, ...(saved.rates || {}) },
    rules: { ...DEFAULT_CONFIG.rules, ...(saved.rules || {}) },
    situations: { ...DEFAULT_CONFIG.situations, ...(saved.situations || {}) },
    examples: Array.isArray(saved.examples) ? saved.examples : []
  };
}

const clip = (s, n) => String(s || '').trim().slice(0, n);
const inRange = (v, lo, hi) => typeof v === 'number' && isFinite(v) && v >= lo && v <= hi;

const RULES = { lowSpend: [0, 1e9], lowN: [1, 1000], highSpend: [1, 1e9], highN: [1, 5000], step: [1, 50], smallSpend: [0, 1e9], tinySpend: [0, 1e9], minLive: [0, 500], under20: [0, 1e9], costWarnPct: [1, 1000], lowConv: [0, 1000] };

// Změny z adminu (nebo ze souboru pro statický build) zkontroluje a přiloží k aktuálnímu nastavení.
// Co v `b` chybí, zůstane z `cur`. Vrací { config, errors }; s chybami se nic neukládá.
function normalizeConfig(b, cur) {
  b = b || {};
  const errors = [];
  const pick = (key, lo, hi) => { if (b[key] === undefined) return cur[key]; if (!inRange(b[key], lo, hi)) errors.push(key); return b[key]; };
  const next = {
    testPct: pick('testPct', 1, 100),
    testDays: pick('testDays', 1, 60),
    videosPerSet: pick('videosPerSet', 0, 20),
    staticsPerSet: pick('staticsPerSet', 0, 20),
    winnersPerSet: pick('winnersPerSet', 0, 20),
    winnerLifeWeeks: pick('winnerLifeWeeks', 0, 52),
    maxSetsPerMonth: pick('maxSetsPerMonth', 1, 200),
    fatigueWeeklyPct: pick('fatigueWeeklyPct', 0, 50),
    fatigueStartWeek: pick('fatigueStartWeek', 1, 12),
    refreshEffPct: pick('refreshEffPct', 0, 100),
    rules: { ...cur.rules },
    situations: { ...cur.situations },
    examples: cur.examples,
    rates: { ...cur.rates },
    markets: { ...cur.markets },
    prices: { ...cur.prices },
    pricesAreDemo: typeof b.pricesAreDemo === 'boolean' ? b.pricesAreDemo : cur.pricesAreDemo
  };
  if (b.markets) for (const [k, v] of Object.entries(b.markets)) {
    if (!/^[a-z]{2}$/.test(k) || !v || !inRange(v.daily, 100, 1e7)) { errors.push('markets.' + k); continue; }
    next.markets[k] = { daily: v.daily, verified: !!v.verified };
  }
  if (b.prices) for (const k of ['aiVideo', 'classicVideo', 'aiStatic', 'classicStatic']) {
    if (b.prices[k] === undefined) continue;
    if (!inRange(b.prices[k], 0, 1e7)) errors.push('prices.' + k); else next.prices[k] = b.prices[k];
  }
  if (b.rates) for (const k of ['EUR', 'USD']) {
    if (b.rates[k] === undefined) continue;
    if (!inRange(b.rates[k], 0.01, 1000)) errors.push('rates.' + k); else next.rates[k] = b.rates[k];
  }
  if (b.rules) for (const [k, [lo, hi]] of Object.entries(RULES)) {
    if (b.rules[k] === undefined) continue;
    if (!inRange(b.rules[k], lo, hi)) errors.push('rules.' + k); else next.rules[k] = b.rules[k];
  }
  if (next.rules.highSpend <= next.rules.lowSpend) errors.push('rules.highSpend');
  if (next.rules.highN < next.rules.lowN) errors.push('rules.highN');
  if (b.situations) for (const k of ['growth', 'launch']) {
    if (b.situations[k] === undefined) continue;
    if (!inRange(b.situations[k], 0.1, 10)) errors.push('situations.' + k); else next.situations[k] = b.situations[k];
  }
  if (b.examples !== undefined) {
    if (!Array.isArray(b.examples) || b.examples.length > 30) errors.push('examples');
    else {
      const okUrl = u => typeof u === 'string' && (/^https:\/\/[^\s"'<>]+$/.test(u) || /^\/media\/[a-f0-9-]+\.[a-z0-9]+$/.test(u));
      next.examples = b.examples.map(x => ({
        title: clip(x && x.title, 80), client: clip(x && x.client, 80), result: clip(x && x.result, 120),
        src: okUrl(x && x.src) ? x.src : '', poster: okUrl(x && x.poster) ? x.poster : '',
        kind: x && (x.kind === 'image' || (x.kind !== 'video' && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(x.src || ''))) ? 'image' : 'video', ratio: ['1:1', '9:16', '4:5', '16:9'].includes(x && x.ratio) ? x.ratio : '9:16'
      })).filter(x => x.src);
    }
  }
  if (next.videosPerSet + next.staticsPerSet < 1) errors.push('perSet');
  return { config: next, errors };
}

// Klíče, které smí do veřejné části. Klasická produkce, trhy a další interní údaje sem nepatří.
const PUBLIC_KEYS = ['testPct', 'testDays', 'videosPerSet', 'staticsPerSet', 'winnersPerSet', 'winnerLifeWeeks',
  'fatigueWeeklyPct', 'fatigueStartWeek', 'refreshEffPct', 'rates', 'rules', 'situations', 'examples', 'prices', 'pricesAreDemo'];
const PUBLIC_PRICE_KEYS = ['aiVideo', 'aiStatic'];

// Veřejnosti posíláme jen to, co výpočet potřebuje (GET /api/config i config.json ve statickém buildu).
// features.leadForm: jestli stránka ukáže poptávkový formulář. Bez serveru (Firebase Hosting, fáze 1) je vypnutý.
function publicConfig(c, { leadForm = false } = {}) {
  const out = {};
  for (const k of PUBLIC_KEYS) out[k] = c[k];
  // klasickou produkci veřejnosti neposíláme, srovnání se ve veřejné části neukazuje
  out.prices = {};
  for (const k of PUBLIC_PRICE_KEYS) out.prices[k] = c.prices[k];
  out.features = { leadForm: !!leadForm };
  return out;
}

module.exports = { DEFAULT_CONFIG, PUBLIC_KEYS, PUBLIC_PRICE_KEYS, mergeConfig, normalizeConfig, publicConfig, clip, inRange };
