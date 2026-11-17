// Jednoduché úložiště v JSON souborech. Na Railway patří DATA_DIR na připojený volume (/data),
// jinak se data při každém nasazení smažou.
const fs = require('fs');
const path = require('path');
// výchozí nastavení a jeho doplnění sdílí server se statickým buildem (lib/config.js)
const { DEFAULT_CONFIG, mergeConfig } = require('./lib/config');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

function file(name) { return path.join(DATA_DIR, name); }

function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); }
  catch (e) { return fallback; }
}

function writeJson(name, data) {
  const tmp = file(name + '.tmp');
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file(name));
}

function getConfig() { return mergeConfig(readJson('config.json', {})); }

function saveConfig(cfg) {
  const out = { ...cfg, updatedAt: new Date().toISOString() };
  writeJson('config.json', out);
  return out;
}

function getLeads() { return readJson('leads.json', []); }
function saveLeads(list) { writeJson('leads.json', list); }

const MEDIA_DIR = path.join(DATA_DIR, 'media');
fs.mkdirSync(MEDIA_DIR, { recursive: true });

module.exports = { DATA_DIR, MEDIA_DIR, DEFAULT_CONFIG, getConfig, saveConfig, getLeads, saveLeads };
