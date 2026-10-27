'use strict';
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { state, ROOT } = require('./host/state');
const { log, openLog, errorText, readJson } = require('./host/storage');
const { loadSettings } = require('./host/settings');
const { scanAddons } = require('./host/registry');
const { registerIpc } = require('./host/ipc');

const PRELOAD_PATH = path.join(__dirname, 'preload.js');

function registerPreload() {
  app.on('session-created', (session) => {
    try {
      session.registerPreloadScript({ type: 'frame', id: 'ymdmod', filePath: PRELOAD_PATH });
    } catch (error) {
      log('preload register failed', errorText(error));
    }
  });
}

function startWhenReady() {
  state.dataDir = path.join(app.getPath('userData'), 'YMDMod');
  fs.mkdirSync(state.dataDir, { recursive: true });
  openLog(path.join(state.dataDir, 'ymdmod.log'));
  loadSettings(path.join(state.dataDir, 'settings.json'));
  log(`YMDMod ${state.modVersion}, client ${app.getVersion()}, addons ${state.addonsDir}`);
  scanAddons();
  state.ready = true;
}

function start(options = {}) {
  if (state.started) return 'already started';
  state.started = true;
  if (options.addonsDir) state.addonsDir = options.addonsDir;
  state.modVersion = readJson(path.join(ROOT, 'package.json'), {}).version || '0.0.0';
  registerIpc();
  registerPreload();
  app.whenReady().then(() => {
    try {
      startWhenReady();
    } catch (error) {
      log('host start failed', errorText(error));
    }
  });
  return `YMDMod host ${state.modVersion} registered`;
}

module.exports = { start };
