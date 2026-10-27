'use strict';
const { state } = require('./state');
const { log, errorText } = require('./storage');

function broadcast(channel, payload, except) {
  for (const contents of state.appWebContents) {
    if (contents === except || contents.isDestroyed()) continue;
    try {
      contents.send(channel, payload);
    } catch (error) {
      log('send failed', channel, errorText(error));
    }
  }
}

function deliverMain(event, payload) {
  const handlers = state.mainBus.get(event);
  if (!handlers) return;
  for (const handler of [...handlers]) handler(payload);
}

function emitFromMain(event, payload) {
  deliverMain(event, payload);
  broadcast('ymd:bus', { event, payload });
}

function subscribeMain(event, handler) {
  if (!state.mainBus.has(event)) state.mainBus.set(event, new Set());
  state.mainBus.get(event).add(handler);
  return () => state.mainBus.get(event)?.delete(handler);
}

module.exports = { broadcast, deliverMain, emitFromMain, subscribeMain };
