'use strict';
const path = require('path');
const { app, ipcMain } = require('electron');
const { state, CORE_DIR, API_VERSION } = require('./state');
const { readJson, writeJson } = require('./storage');
const { publicAddon } = require('./addon-view');
const { pickAnchors } = require('../versions');

function emptySupport(clientVersion) {
  return { clientVersion, tableVersion: null, exact: false, active: false, reason: '', checks: {}, dom: {} };
}

function checkAnchors(senderUrl) {
  const clientVersion = app.getVersion();
  const support = emptySupport(clientVersion);
  const picked = pickAnchors(readJson(path.join(CORE_DIR, 'versions.json'), {}), clientVersion);
  if (!picked) {
    support.reason = 'Версии клиента нет в таблице поддержки, и младшей известной версии тоже нет.';
    return support;
  }
  const { anchors } = picked;
  Object.assign(support, { tableVersion: picked.tableVersion, exact: picked.exact, anchors });
  support.checks.appUrl = typeof senderUrl === 'string' && senderUrl.startsWith(anchors.appUrl);
  support.checks.ipcPlayerState = ipcMain.listenerCount(anchors.ipcPlayerState) > 0;
  const missing = Object.keys(support.checks).filter((key) => !support.checks[key]);
  if (missing.length) {
    support.reason = `Не найдены якоря: ${missing.join(', ')}. Мод не включается.`;
    return support;
  }
  support.active = true;
  support.reason = picked.exact
    ? 'Версия клиента проверена.'
    : `Версия клиента не проверена, используются якоря ${picked.tableVersion}. Якоря main-части найдены.`;
  return support;
}

function publicSupport() {
  const s = state.support;
  if (!s) return null;
  return { clientVersion: s.clientVersion, tableVersion: s.tableVersion, exact: s.exact, active: s.active, reason: s.reason, checks: s.checks, dom: s.dom };
}

function addonStatuses() {
  return Object.fromEntries([...state.addons.values()].map((a) => [a.id, { version: a.manifest.version, status: a.status, error: a.error || null }]));
}

function writeSupportRecord() {
  if (!state.dataDir || !state.support) return;
  const file = path.join(state.dataDir, 'support.json');
  const record = readJson(file, {});
  record[state.support.clientVersion] = { checkedAt: new Date().toISOString(), modVersion: state.modVersion, ...publicSupport(), addons: addonStatuses() };
  writeJson(file, record);
}

function recordDomAnchors(found) {
  if (!state.support || !found || typeof found !== 'object') return;
  state.support.dom = { ...state.support.dom, ...found };
  writeSupportRecord();
}

function diagnostics() {
  return {
    modVersion: state.modVersion,
    apiVersion: API_VERSION,
    support: publicSupport(),
    domAnchors: (state.support && state.support.anchors && state.support.anchors.dom) || {},
    dataDir: state.dataDir,
    logPath: state.logPath,
    addonsDir: state.addonsDir,
    addons: [...state.addons.values()].map(publicAddon),
  };
}

module.exports = { checkAnchors, publicSupport, writeSupportRecord, recordDomAnchors, diagnostics };
