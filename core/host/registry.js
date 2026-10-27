'use strict';
const fs = require('fs');
const path = require('path');
const { state, ID_PATTERN } = require('./state');
const { log, errorText } = require('./storage');
const { broadcast } = require('./bus');
const { isSystem } = require('./settings');
const { readManifest, compatibility } = require('./manifest');
const { publicAddon, rendererCode } = require('./addon-view');
const { deactivateMain, applyAddon, applyAll } = require('./lifecycle');

function invalidAddon(name, dir, error) {
  log('addon invalid', name, error);
  return { id: name, dir, manifest: { name, version: '?', settings: [] }, status: 'invalid', error, warning: '', main: null, disposers: [] };
}

function loadAddon(name) {
  const dir = path.join(state.addonsDir, name);
  const { manifest, error } = readManifest(dir);
  if (error) return invalidAddon(name, dir, error);
  const { warning } = compatibility(manifest);
  if (warning) log('addon warning', name, warning);
  return { id: manifest.id, dir, manifest, status: 'disabled', error: null, warning, main: null, disposers: [] };
}

function addonFolderNames() {
  try {
    return fs.readdirSync(state.addonsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    log('addons dir not readable', state.addonsDir, errorText(error));
    return [];
  }
}

function scanAddons() {
  for (const name of addonFolderNames()) {
    const addon = loadAddon(name);
    state.addons.set(addon.id, addon);
  }
}

function forgetAddon(id) {
  state.addons.delete(id);
  broadcast('ymd:addon:removed', { id });
  log('addon removed', id);
  if (state.support) applyAll();
  return null;
}

function reloadAddon(id) {
  const addon = loadAddon(id);
  state.addons.set(id, addon);
  if (state.support) applyAddon(addon);
  broadcast('ymd:addon:replace', { ...publicAddon(addon), code: rendererCode(addon) });
  if (state.support) applyAll();
  log('addon loaded', id, addon.manifest.version, addon.status);
  return publicAddon(addon);
}

function rescanAddon(id) {
  id = String(id);
  if (!ID_PATTERN.test(id)) return null;
  const old = state.addons.get(id);
  if (old) deactivateMain(old);
  const exists = fs.existsSync(path.join(state.addonsDir, id, 'manifest.json'));
  return exists ? reloadAddon(id) : forgetAddon(id);
}

function removeAddon(id) {
  id = String(id);
  const addon = state.addons.get(id);
  if (!addon || !ID_PATTERN.test(id)) return false;
  if (isSystem(addon)) {
    log('addon remove refused: system addon', id);
    return false;
  }
  deactivateMain(addon);
  try {
    fs.rmSync(path.join(state.addonsDir, id), { recursive: true, force: true });
  } catch (error) {
    log('addon remove failed', id, errorText(error));
    return false;
  }
  rescanAddon(id);
  return true;
}

module.exports = { scanAddons, rescanAddon, removeAddon };
