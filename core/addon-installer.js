'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const FILE_PATTERN = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/;
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const RAW_BASE = 'https://raw.githubusercontent.com';
const MAX_ADDON_BYTES = 5 * 1024 * 1024;
const MAX_CATALOG_BYTES = 1024 * 1024;
const CATALOG_URL = 'https://raw.githubusercontent.com/ymdmod/catalog/main/catalog.json';

function parseVersion(text) {
  const parts = String(text).split('.').map(Number);
  return parts.length === 3 && parts.every(Number.isInteger) ? parts : null;
}

function isNewer(candidate, installed) {
  const a = parseVersion(candidate);
  const b = parseVersion(installed);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

async function nodeFetchBytes(url, limit) {
  let data;
  if (url.startsWith('file:')) {
    data = fs.readFileSync(fileURLToPath(url));
  } else {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    data = Buffer.from(await response.arrayBuffer());
  }
  if (data.length > limit) throw new Error(`${url}: файл больше ${limit} байт`);
  return data;
}

function validEntry(entry) {
  return Boolean(entry) && ID_PATTERN.test(entry.id || '') && typeof entry.name === 'string' && Boolean(parseVersion(entry.version))
    && REPO_PATTERN.test(entry.repo || '') && COMMIT_PATTERN.test(entry.commit || '')
    && Array.isArray(entry.files) && entry.files.some((f) => f.path === 'manifest.json')
    && entry.files.every((f) => f && FILE_PATTERN.test(f.path || '') && Number.isInteger(f.size) && /^[0-9a-f]{64}$/.test(f.sha256 || ''));
}

function rawBaseOf(catalog) {
  const base = typeof catalog.rawBase === 'string' ? catalog.rawBase.replace(/\/+$/, '') : RAW_BASE;
  if (!/^(https:|file:)/.test(base)) throw new Error('rawBase в каталоге должен начинаться с https:// или file://.');
  return base;
}

async function loadCatalog(url, fetchBytes) {
  if (!/^(https:|file:)/.test(url)) throw new Error('Адрес каталога должен начинаться с https:// (или file:// для своего каталога).');
  let catalog;
  try {
    catalog = JSON.parse((await fetchBytes(url, MAX_CATALOG_BYTES)).toString('utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('catalog.json не читается как JSON.');
    throw error;
  }
  if (!catalog || catalog.schema !== 2 || !Array.isArray(catalog.addons)) throw new Error('Неизвестный формат каталога (нужен schema: 2).');
  const entries = catalog.addons.filter(validEntry);
  return { url, entries, rawBase: rawBaseOf(catalog), skipped: catalog.addons.length - entries.length };
}

async function installEntry(entry, { rawBase, addonsDir, fetchBytes }) {
  if (!validEntry(entry)) throw new Error('Запись каталога повреждена.');
  const total = entry.files.reduce((sum, f) => sum + f.size, 0);
  if (total > MAX_ADDON_BYTES) throw new Error(`Аддон больше ${MAX_ADDON_BYTES} байт.`);

  const target = path.join(addonsDir, entry.id);
  const temp = path.join(addonsDir, `.${entry.id}.ymd-new`);
  const old = path.join(addonsDir, `.${entry.id}.ymd-old`);
  fs.mkdirSync(addonsDir, { recursive: true });
  fs.rmSync(temp, { recursive: true, force: true });
  fs.rmSync(old, { recursive: true, force: true });
  try {
    for (const file of entry.files) {
      const data = await fetchBytes(`${rawBase}/${entry.repo}/${entry.commit}/${file.path}`, MAX_ADDON_BYTES);
      const hash = crypto.createHash('sha256').update(data).digest('hex');
      if (data.length !== file.size || hash !== file.sha256) throw new Error(`${file.path}: не совпадает с каталогом (размер или sha256).`);
      const dest = path.join(temp, ...file.path.split('/'));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, data);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(temp, 'manifest.json'), 'utf8'));
    if (manifest.id !== entry.id || manifest.version !== entry.version) throw new Error('manifest.json не совпадает с каталогом (id или версия).');

    if (fs.existsSync(target)) fs.renameSync(target, old);
    try {
      fs.renameSync(temp, target);
    } catch (error) {
      if (fs.existsSync(old)) fs.renameSync(old, target);
      throw error;
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
    fs.rmSync(old, { recursive: true, force: true });
  }
}

function installedVersion(addonsDir, id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(addonsDir, id, 'manifest.json'), 'utf8')).version || null;
  } catch {
    return null;
  }
}

module.exports = { CATALOG_URL, loadCatalog, installEntry, installedVersion, isNewer, nodeFetchBytes };
