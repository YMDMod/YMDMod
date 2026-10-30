'use strict';
const fs = require('fs');
const { state } = require('./state');
const { entryPath } = require('./manifest');
const { log, errorText } = require('./storage');
const { isSystem, isEnabled, settingValues } = require('./settings');
const { dependenciesOf } = require('../dependencies');

function publicAddon(addon) {
  const invalid = addon.status === 'invalid';
  return {
    id: addon.id,
    name: addon.manifest.name,
    version: addon.manifest.version,
    description: addon.manifest.description || '',
    modVersions: addon.manifest.modVersions || [],
    settings: addon.manifest.settings || [],
    values: invalid ? {} : settingValues(addon),
    enabled: invalid ? false : isEnabled(addon),
    status: addon.status,
    error: addon.error || null,
    warning: addon.warning || null,
    system: isSystem(addon),
    dependencies: dependenciesOf(addon.manifest),
  };
}

function rendererCode(addon) {
  const rendererPath = addon.status === 'invalid' ? null : entryPath(addon.dir, 'renderer');
  if (!rendererPath) return null;
  try {
    return fs.readFileSync(rendererPath, 'utf8');
  } catch (error) {
    log('renderer read failed', addon.id, errorText(error));
    return null;
  }
}

function dependencyView(id) {
  const dep = state.addons.get(id);
  return dep && dep.status !== 'invalid' ? { name: dep.manifest.name, version: dep.manifest.version, status: dep.status } : null;
}

module.exports = { publicAddon, rendererCode, dependencyView };
