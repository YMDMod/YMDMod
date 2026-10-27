'use strict';
const fs = require('fs');
const path = require('path');
const { app, ipcMain } = require('electron');
const { state, CORE_DIR, API_VERSION } = require('./state');
const { log, errorText } = require('./storage');
const { broadcast, deliverMain } = require('./bus');
const { setSetting } = require('./settings');
const { runPlayerAction, listenPlayerState } = require('./player');
const { publicAddon, rendererCode } = require('./addon-view');
const { applyAll, orderedAddons, setEnabled, failAddon } = require('./lifecycle');
const { removeAddon } = require('./registry');
const { pickLocalAddon, installLocalAddon } = require('./local-install');
const { checkAnchors, publicSupport, writeSupportRecord, recordDomAnchors, diagnostics } = require('./support');

const readCore = (name) => fs.readFileSync(path.join(CORE_DIR, name), 'utf8');

function initSupport(url) {
  state.support = checkAnchors(url);
  log('support', state.support);
  if (state.support.active) listenPlayerState(state.support.anchors.ipcPlayerState);
  applyAll();
  writeSupportRecord();
}

function trackPage(contents) {
  if (state.appWebContents.has(contents)) return;
  state.appWebContents.add(contents);
  contents.once('destroyed', () => state.appWebContents.delete(contents));
}

function bootstrap(contents) {
  if (!state.ready) return { active: false, reason: 'Ядро не инициализировано, подробности в логе.' };
  const url = contents.getURL();
  if (!state.support) initSupport(url);
  if (!state.support.active || !url.startsWith(state.support.anchors.appUrl)) return { active: false, reason: state.support.reason };
  trackPage(contents);
  return {
    active: true,
    apiVersion: API_VERSION,
    modVersion: state.modVersion,
    clientVersion: app.getVersion(),
    support: publicSupport(),
    domAnchors: state.support.anchors.dom || {},
    ui: readCore('ui.js'),
    uiCss: readCore('ui.css'),
    versionsCode: readCore('versions.js'),
    playerState: state.playerState,
    addons: orderedAddons().map((addon) => ({ ...publicAddon(addon), code: rendererCode(addon) })),
  };
}

function forwardBus(sender, message) {
  if (!message || typeof message.event !== 'string') return;
  deliverMain(message.event, message.payload);
  broadcast('ymd:bus', message, sender);
}

function registerIpc() {
  ipcMain.on('ymd:bootstrap', (event) => {
    try {
      event.returnValue = bootstrap(event.sender);
    } catch (error) {
      log('bootstrap failed', errorText(error));
      event.returnValue = { active: false, reason: 'Ошибка ядра, подробности в логе.' };
    }
  });

  ipcMain.handle('ymd:addon:set-enabled', (_event, id, enabled) => setEnabled(String(id), enabled));
  ipcMain.handle('ymd:settings:set', (_event, id, key, value) => setSetting(String(id), key, value));
  ipcMain.handle('ymd:addon:remove', (_event, id) => removeAddon(String(id)));
  ipcMain.handle('ymd:addon:pick-local', (event) => pickLocalAddon(event.sender));
  ipcMain.handle('ymd:addon:install-local', (_event, token) => installLocalAddon(token));
  ipcMain.handle('ymd:player:action', (_event, name) => runPlayerAction(name));
  ipcMain.handle('ymd:diagnostics', () => diagnostics());

  ipcMain.on('ymd:addon:failed', (_event, id, message) => {
    const addon = state.addons.get(String(id));
    if (addon) failAddon(addon, 'renderer', String(message));
  });
  ipcMain.on('ymd:bus', (event, message) => forwardBus(event.sender, message));
  ipcMain.on('ymd:dom-anchors', (_event, found) => recordDomAnchors(found));
  ipcMain.on('ymd:log', (_event, ...parts) => log('[renderer]', ...parts));
}

module.exports = { registerIpc };
