'use strict';
const { state, SYSTEM_ADDONS } = require('./state');
const { readJson, writeJson } = require('./storage');
const { deliverMain, broadcast } = require('./bus');

const isSystem = (addon) => SYSTEM_ADDONS.includes(addon.id);

function loadSettings(file) {
  state.settingsPath = file;
  state.settings = readJson(file, { addons: {} });
  if (!state.settings.addons) state.settings.addons = {};
}

function addonSettings(id) {
  const all = state.settings.addons;
  if (!all[id]) all[id] = {};
  if (!all[id].values) all[id].values = {};
  return all[id];
}

function saveSettings() {
  if (state.settingsPath) writeJson(state.settingsPath, state.settings);
}

function isEnabled(addon) {
  if (isSystem(addon)) return true;
  const stored = addonSettings(addon.id).enabled;
  return typeof stored === 'boolean' ? stored : addon.manifest.defaultEnabled === true;
}

function storeEnabled(id, enabled) {
  addonSettings(id).enabled = Boolean(enabled);
  saveSettings();
}

function settingValue(addon, key) {
  const values = addonSettings(addon.id).values;
  if (key in values) return values[key];
  const field = (addon.manifest.settings || []).find((item) => item.key === key);
  return field ? field.default : undefined;
}

function settingValues(addon) {
  const defaults = {};
  for (const field of addon.manifest.settings || []) defaults[field.key] = settingValue(addon, field.key);
  return { ...defaults, ...addonSettings(addon.id).values };
}

function setSetting(id, key, value) {
  if (!state.addons.has(id) || typeof key !== 'string') return false;
  addonSettings(id).values[key] = value;
  saveSettings();
  const change = { id, key, value };
  deliverMain(`settings:${id}`, change);
  broadcast('ymd:settings:changed', change);
  return true;
}

module.exports = { isSystem, loadSettings, isEnabled, storeEnabled, settingValue, settingValues, setSetting };
