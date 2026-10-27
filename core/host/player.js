'use strict';
const { ipcMain, BrowserWindow } = require('electron');
const { state } = require('./state');
const { deliverMain, broadcast } = require('./bus');

const STATE_FLAGS = ['isPlaying', 'canMoveBackward', 'canMoveForward'];

function appWindow() {
  for (const contents of state.appWebContents) {
    if (contents.isDestroyed()) continue;
    const win = BrowserWindow.fromWebContents(contents);
    if (win && !win.isDestroyed()) return win;
  }
  return null;
}

function sendPlayerAction(action) {
  const anchors = state.support && state.support.anchors;
  if (!anchors || !anchors.playerActions.includes(action)) return false;
  const win = appWindow();
  if (!win) return false;
  win.webContents.send(anchors.ipcPlayerAction, action);
  return true;
}

const player = {
  getState: () => ({ ...state.playerState }),
  play: () => sendPlayerAction('PLAY'),
  pause: () => sendPlayerAction('PAUSE'),
  toggle: () => sendPlayerAction(state.playerState.isPlaying ? 'PAUSE' : 'PLAY'),
  next: () => sendPlayerAction('MOVE_FORWARD'),
  prev: () => sendPlayerAction('MOVE_BACKWARD'),
};

function runPlayerAction(name) {
  return typeof player[name] === 'function' && name !== 'getState' ? player[name]() : false;
}

function listenPlayerState(channel) {
  ipcMain.on(channel, (_event, value) => {
    if (!value || typeof value !== 'object') return;
    const next = { ...state.playerState };
    for (const key of STATE_FLAGS) {
      if (typeof value[key] === 'boolean') next[key] = value[key];
    }
    state.playerState = next;
    deliverMain('player:state', { ...next });
    broadcast('ymd:player:state', next);
  });
}

module.exports = { player, appWindow, runPlayerAction, listenPlayerState };
