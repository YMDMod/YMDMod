'use strict';
const fs = require('fs');
const path = require('path');
const { state } = require('./state');
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
    type: addon.manifest.type || 'addon',
    dependencies: dependenciesOf(addon.manifest),
  };
}

function rendererCode(addon) {
  if (addon.status === 'invalid' || !addon.manifest.renderer) return null;
  try {
    return fs.readFileSync(path.join(addon.dir, addon.manifest.renderer), 'utf8');
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
