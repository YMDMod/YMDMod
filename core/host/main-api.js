'use strict';
const path = require('path');
const electron = require('electron');
const { state, API_VERSION } = require('./state');
const { log } = require('./storage');
const { emitFromMain, subscribeMain } = require('./bus');
const { settingValue, settingValues, setSetting } = require('./settings');
const { player, appWindow } = require('./player');
const { publicAddon } = require('./addon-view');
const { compatibility } = require('./manifest');
const { failAddon } = require('./lifecycle');
const { rescanAddon, removeAddon } = require('./registry');
const { diagnostics } = require('./support');
const catalogInstaller = require('../addon-installer');
const { dependenciesOf, satisfies } = require('../dependencies');

async function fetchBytes(url, limit) {
  if (url.startsWith('file:')) return catalogInstaller.nodeFetchBytes(url, limit);
  const response = await electron.net.fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length > limit) throw new Error(`${url}: файл больше ${limit} байт`);
  return data;
}

function makeGuard(addon) {
  return (fn) => (...args) => {
    try {
      return fn(...args);
    } catch (error) {
      failAddon(addon, 'main', error);
      return undefined;
    }
  };
}

function makeSubscribe(addon, guard) {
  const subscriptions = new Set();
  addon.disposers.push(() => {
    for (const unsubscribe of subscriptions) unsubscribe();
    subscriptions.clear();
  });
  return (event, handler) => {
    const unsubscribe = subscribeMain(event, guard(handler));
    subscriptions.add(unsubscribe);
    return () => {
      unsubscribe();
      subscriptions.delete(unsubscribe);
    };
  };
}

function addonsApi() {
  return Object.freeze({
    dir: state.addonsDir,
    list: () => [...state.addons.values()].map(publicAddon),
    check: compatibility,
    rescan: rescanAddon,
    satisfies,
    remove: removeAddon,
    loadCatalog: (url) => catalogInstaller.loadCatalog(String(url || catalogInstaller.CATALOG_URL), fetchBytes),
    install: async (entry, rawBase) => {
      await catalogInstaller.installEntry(entry, { rawBase, addonsDir: state.addonsDir, fetchBytes });
      return rescanAddon(entry.id);
    },
  });
}

function exposeApi(addon, exported, guard) {
  const api = {};
  for (const [key, value] of Object.entries(exported || {})) api[key] = typeof value === 'function' ? guard(value) : value;
  state.exposed.set(addon.id, Object.freeze(api));
  addon.disposers.push(() => state.exposed.delete(addon.id));
}

function useApi(consumer, id, range) {
  const api = state.exposed.get(id);
  const provider = state.addons.get(id);
  if (!api || !provider) return null;
  return satisfies(provider.manifest.version, range || dependenciesOf(consumer.manifest)[id]) ? api : null;
}

function makeMainApi(addon) {
  const guard = makeGuard(addon);
  const subscribe = makeSubscribe(addon, guard);
  const permissions = addon.manifest.permissions || [];
  return Object.freeze({
    addons: permissions.includes('addons') ? addonsApi() : undefined,
    id: addon.id,
    apiVersion: API_VERSION,
    modVersion: state.modVersion,
    clientVersion: electron.app.getVersion(),
    electron,
    dataDir: path.join(state.dataDir, 'addons', addon.id),
    log: (...parts) => log(`[${addon.id}]`, ...parts),
    settings: Object.freeze({
      get: (key) => settingValue(addon, key),
      all: () => settingValues(addon),
      set: (key, value) => setSetting(addon.id, key, value),
      onChange: (handler) => subscribe(`settings:${addon.id}`, handler),
    }),
    on: subscribe,
    emit: (event, payload) => emitFromMain(String(event), payload),
    notify: (text, options) => emitFromMain('notify', { text: String(text), ...(options || {}), source: addon.id }),
    diagnostics,
    player: Object.freeze({ ...player, onChange: (handler) => subscribe('player:state', handler) }),
    mainWindow: appWindow,
    onDispose: (fn) => addon.disposers.push(fn),
    expose: (exported) => exposeApi(addon, exported, guard),
    use: (id, range) => useApi(addon, String(id), range),
  });
}

module.exports = { makeMainApi };
