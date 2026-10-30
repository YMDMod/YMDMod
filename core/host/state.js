'use strict';
const path = require('path');

const CORE_DIR = path.join(__dirname, '..');
const ROOT = path.join(CORE_DIR, '..');

const state = {
  started: false,
  ready: false,
  modVersion: '0.0.0',
  addonsDir: path.join(ROOT, 'addons'),
  dataDir: null,
  logPath: null,
  settingsPath: null,
  settings: { addons: {} },
  support: null,
  addons: new Map(),
  playerState: { isPlaying: false, canMoveBackward: false, canMoveForward: false },
  mainBus: new Map(),
  exposed: new Map(),
  appWebContents: new Set(),
};

module.exports = {
  state,
  CORE_DIR,
  ROOT,
  API_VERSION: 1,
  ID_PATTERN: /^[a-z0-9][a-z0-9-]{0,63}$/,
  SYSTEM_ADDONS: require('../system-addons.json'),
};
