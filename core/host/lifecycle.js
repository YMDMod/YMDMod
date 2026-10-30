'use strict';
const fs = require('fs');
const path = require('path');
const { state } = require('./state');
const { log, errorText } = require('./storage');
const { broadcast, emitFromMain } = require('./bus');
const { isSystem, isEnabled, storeEnabled } = require('./settings');
const { publicAddon, dependencyView } = require('./addon-view');
const { dependencyProblem, orderByDependencies } = require('../dependencies');
const { entryPath } = require('./manifest');

function activateMain(addon) {
  const mainPath = entryPath(addon.dir, 'main');
  if (!mainPath || addon.main) return;
  try {
    fs.mkdirSync(path.join(state.dataDir, 'addons', addon.id), { recursive: true });
    const entry = require(mainPath);
    addon.main = entry;
    addon.mainPath = mainPath;
    if (typeof entry.activate === 'function') entry.activate(require('./main-api').makeMainApi(addon));
    log('addon main activated', addon.id);
  } catch (error) {
    failAddon(addon, 'main', error);
  }
}

function runQuietly(addon, what, fn) {
  try {
    fn();
  } catch (error) {
    log(`addon ${what} failed`, addon.id, errorText(error));
  }
}

function forgetMainModule(addon) {
  if (!addon.mainPath) return;
  delete require.cache[addon.mainPath];
  addon.mainPath = null;
}

function deactivateMain(addon) {
  const entry = addon.main;
  addon.main = null;
  if (entry && typeof entry.deactivate === 'function') runQuietly(addon, 'deactivate', () => entry.deactivate());
  for (const dispose of addon.disposers.splice(0)) runQuietly(addon, 'dispose', dispose);
  forgetMainModule(addon);
}

function failAddon(addon, where, error) {
  if (addon.status === 'failed') return;
  addon.status = 'failed';
  addon.error = `${where}: ${(error && error.message) || error}`;
  log('addon failed', addon.id, where, errorText(error));
  deactivateMain(addon);
  broadcast('ymd:addon:state', publicAddon(addon));
  setImmediate(applyAll);
  if (state.appWebContents.size) emitFromMain('notify', { type: 'error', text: `Аддон «${addon.manifest.name}» отключён из-за ошибки`, source: 'core' });
}

function refreshStatus(addon) {
  if (addon.status === 'invalid' || addon.status === 'failed') return;
  if (!(state.support && state.support.active && isEnabled(addon))) {
    addon.status = 'disabled';
    addon.error = null;
    return;
  }
  const problem = dependencyProblem(addon.manifest, dependencyView);
  addon.status = problem ? 'dependency' : 'active';
  addon.error = problem;
}

function applyAddon(addon) {
  refreshStatus(addon);
  if (addon.status === 'active') activateMain(addon);
  else deactivateMain(addon);
}

function orderedAddons() {
  return orderByDependencies([...state.addons.values()].sort((a, b) => a.id.localeCompare(b.id)));
}

function applyAll() {
  for (const addon of orderedAddons()) {
    const before = addon.status;
    applyAddon(addon);
    if (addon.status !== before) broadcast('ymd:addon:state', publicAddon(addon));
  }
}

function setEnabled(id, enabled) {
  const addon = state.addons.get(id);
  if (!addon || addon.status === 'invalid') return null;
  if (isSystem(addon) && !enabled) return publicAddon(addon);
  storeEnabled(id, enabled);
  if (addon.status === 'failed' && enabled) {
    addon.status = 'disabled';
    addon.error = null;
  }
  applyAll();
  broadcast('ymd:addon:state', publicAddon(addon));
  return publicAddon(addon);
}

module.exports = { deactivateMain, failAddon, applyAddon, applyAll, orderedAddons, setEnabled };
