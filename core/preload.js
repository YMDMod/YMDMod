'use strict';
const { ipcRenderer } = require('electron');

(() => {
  if (window !== window.top) return;
  if (location.protocol !== 'music-application:') return;

  const readBoot = () => {
    try {
      return ipcRenderer.sendSync('ymd:bootstrap');
    } catch {
      return null;
    }
  };

  const boot = readBoot();
  if (!boot || !boot.active) return;

  const loadVersions = () => {
    const module = { exports: {} };
    new Function('module', 'exports', boot.versionsCode)(module, module.exports);
    return module.exports;
  };

  const versions = loadVersions();
  const satisfies = (version, range) => !range || versions.matchesCondition(version, range);

  const log = (...parts) => {
    try {
      ipcRenderer.send('ymd:log', ...parts.map((p) => (p instanceof Error ? p.stack || p.message : p)));
    } catch {
    }
  };

  const listenerSet = () => {
    const listeners = new Set();
    return {
      add: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      notify: (...args) => {
        for (const listener of listeners) listener(...args);
      },
    };
  };

  const observeDocument = (callback) => {
    const observer = new MutationObserver(callback);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    return observer;
  };

  const oncePerFrame = (fn) => {
    let scheduled = false;
    return () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        fn();
      });
    };
  };

  const bus = new Map();

  const deliver = (event, payload) => {
    const handlers = bus.get(event);
    if (!handlers) return;
    for (const handler of [...handlers]) handler(payload);
  };

  const subscribe = (event, handler) => {
    if (!bus.has(event)) bus.set(event, new Set());
    bus.get(event).add(handler);
    return () => bus.get(event)?.delete(handler);
  };

  const emit = (event, payload) => {
    deliver(event, payload);
    ipcRenderer.send('ymd:bus', { event, payload });
  };

  ipcRenderer.on('ymd:bus', (_e, message) => deliver(message.event, message.payload));

  let playerState = { ...boot.playerState };
  let lastTrackKey = '';

  const readMetadata = () => {
    const meta = navigator.mediaSession && navigator.mediaSession.metadata;
    if (!meta) return { title: '', artist: '', album: '', artwork: [] };
    return {
      title: meta.title || '',
      artist: meta.artist || '',
      album: meta.album || '',
      artwork: Array.from(meta.artwork || [], (a) => ({ src: a.src, sizes: a.sizes || '' })),
    };
  };

  const fullPlayerState = () => ({ ...playerState, ...readMetadata() });
  const emitPlayer = () => deliver('player:state', fullPlayerState());
  const playerAction = (name) => ipcRenderer.invoke('ymd:player:action', name);

  const emitOnTrackChange = () => {
    if (!bus.get('player:state')?.size) return;
    const meta = readMetadata();
    const key = `${meta.title}\u0000${meta.artist}\u0000${meta.album}`;
    if (key === lastTrackKey) return;
    lastTrackKey = key;
    emitPlayer();
  };

  ipcRenderer.on('ymd:player:state', (_e, next) => {
    playerState = { ...playerState, ...next };
    emitPlayer();
  });
  setInterval(emitOnTrackChange, 1000);

  const createAddon = (info, code) => ({ info, code, instance: null, running: false, disposers: [] });

  const addons = new Map();
  for (const info of boot.addons) addons.set(info.id, createAddon(info, info.code));

  const addonState = listenerSet();
  const pageRegistry = listenerSet();
  const exposed = new Map();
  const pages = new Map();

  const callStop = (addon) => {
    try {
      addon.instance && typeof addon.instance.stop === 'function' && addon.instance.stop();
    } catch (error) {
      log(`[${addon.info.id}] stop failed`, error);
    }
  };

  const runDisposers = (addon) => {
    for (const dispose of addon.disposers.splice(0)) {
      try {
        dispose();
      } catch (error) {
        log(`[${addon.info.id}] dispose failed`, error);
      }
    }
  };

  const stopAddon = (addon) => {
    if (!addon.running) return;
    addon.running = false;
    callStop(addon);
    runDisposers(addon);
    addon.instance = null;
  };

  const failAddon = (addon, error) => {
    log(`[${addon.info.id}] failed`, error);
    stopAddon(addon);
    addon.info = { ...addon.info, status: 'failed', error: `renderer: ${(error && error.message) || error}` };
    ipcRenderer.send('ymd:addon:failed', addon.info.id, (error && error.message) || String(error));
    addonState.notify(addon.info);
  };

  const addonScope = (addon) => {
    const guard = (fn) => function guarded(...args) {
      if (!addon.running) return undefined;
      try {
        return fn.apply(this, args);
      } catch (error) {
        failAddon(addon, error);
        return undefined;
      }
    };
    const track = (dispose) => {
      addon.disposers.push(dispose);
      return dispose;
    };
    const on = (event, handler) => track(subscribe(String(event), guard(handler)));
    return { addon, id: addon.info.id, guard, track, on };
  };

  const settingsApi = ({ addon, id, on }) => Object.freeze({
    get: (key) => addon.info.values[key],
    all: () => ({ ...addon.info.values }),
    set: (key, value) => ipcRenderer.invoke('ymd:settings:set', id, key, value),
    onChange: (handler) => on(`settings:${id}`, handler),
  });

  const playerApi = ({ on }) => Object.freeze({
    getState: fullPlayerState,
    onChange: (handler) => on('player:state', handler),
    play: () => playerAction('play'),
    pause: () => playerAction('pause'),
    toggle: () => playerAction('toggle'),
    next: () => playerAction('next'),
    prev: () => playerAction('prev'),
  });

  const domApi = ({ guard, track }) => {
    const observe = (handler) => {
      const run = guard(handler);
      const observer = observeDocument(oncePerFrame(run));
      run();
      return track(() => observer.disconnect());
    };
    const each = (selector, handler) => {
      const seen = new WeakSet();
      const run = guard(handler);
      return observe(() => {
        for (const el of document.querySelectorAll(selector)) {
          if (seen.has(el)) continue;
          seen.add(el);
          run(el);
        }
      });
    };
    return Object.freeze({ observe, each });
  };

  const styleApi = ({ id, track }) => ({
    addStyle: (css) => {
      const style = document.createElement('style');
      style.dataset.ymd = id;
      style.textContent = String(css);
      document.head.appendChild(style);
      return track(() => style.remove());
    },
  });

  const timerApi = ({ guard, track }) => ({
    setTimeout: (fn, ms) => {
      const timer = setTimeout(guard(fn), ms);
      track(() => clearTimeout(timer));
      return timer;
    },
    setInterval: (fn, ms) => {
      const timer = setInterval(guard(fn), ms);
      track(() => clearInterval(timer));
      return timer;
    },
    onDispose: (fn) => {
      track(fn);
    },
  });

  const sharingApi = ({ addon, id, guard, track }) => ({
    expose: (exported) => {
      const api = {};
      for (const [key, value] of Object.entries(exported || {})) api[key] = typeof value === 'function' ? guard(value) : value;
      exposed.set(id, Object.freeze(api));
      track(() => exposed.delete(id));
    },
    use: (otherId, range) => {
      const api = exposed.get(String(otherId));
      const provider = addons.get(String(otherId));
      if (!api || !provider) return null;
      const wanted = range || (addon.info.dependencies || {})[otherId];
      return satisfies(provider.info.version, wanted) ? api : null;
    },
  });

  const uiApi = ({ id, guard, track }) => Object.freeze({
    addPage: (page) => {
      const key = `${id}:${(page && page.id) || 'main'}`;
      pages.set(key, { key, addon: id, title: String((page && page.title) || id), render: guard(page.render) });
      pageRegistry.notify();
      return track(() => {
        pages.delete(key);
        pageRegistry.notify();
      });
    },
  });

  const makeApi = (addon) => {
    const scope = addonScope(addon);
    const { id, guard, on } = scope;
    return Object.freeze({
      id,
      apiVersion: boot.apiVersion,
      modVersion: boot.modVersion,
      clientVersion: boot.clientVersion,
      log: (...parts) => log(`[${id}]`, ...parts),
      guard,
      on,
      emit: (event, payload) => emit(String(event), payload),
      notify: (text, options) => emit('notify', { text: String(text), ...(options || {}), source: id }),
      diagnostics: () => ipcRenderer.invoke('ymd:diagnostics'),
      settings: settingsApi(scope),
      player: playerApi(scope),
      dom: domApi(scope),
      ...styleApi(scope),
      ...timerApi(scope),
      ...sharingApi(scope),
      ui: uiApi(scope),
    });
  };

  const startAddon = (addon) => {
    if (addon.running || !addon.code || addon.info.status !== 'active') return;
    addon.running = true;
    try {
      const module = { exports: {} };
      const factory = new Function('module', 'exports', 'ymd', `${addon.code}\n//# sourceURL=ymdmod/${addon.info.id}.js`);
      const api = makeApi(addon);
      factory(module, module.exports, api);
      addon.instance = module.exports;
      if (typeof addon.instance.start === 'function') addon.instance.start(api);
    } catch (error) {
      failAddon(addon, error);
    }
  };

  const onAddonState = (_e, info) => {
    const addon = addons.get(info.id);
    if (!addon) return;
    addon.info = { ...addon.info, ...info };
    if (info.status === 'active') startAddon(addon);
    else stopAddon(addon);
    addonState.notify(addon.info);
  };

  const onAddonReplace = (_e, message) => {
    const { code, ...info } = message;
    const old = addons.get(info.id);
    if (old) stopAddon(old);
    const addon = createAddon(info, code);
    addons.set(info.id, addon);
    startAddon(addon);
    addonState.notify(addon.info);
  };

  const onAddonRemoved = (_e, { id }) => {
    const addon = addons.get(id);
    if (!addon) return;
    stopAddon(addon);
    addons.delete(id);
    addonState.notify({ id, removed: true });
  };

  const onSettingsChanged = (_e, change) => {
    const addon = addons.get(change.id);
    if (!addon) return;
    addon.info = { ...addon.info, values: { ...addon.info.values, [change.key]: change.value } };
    deliver(`settings:${change.id}`, change);
    addonState.notify(addon.info);
  };

  ipcRenderer.on('ymd:addon:state', onAddonState);
  ipcRenderer.on('ymd:addon:replace', onAddonReplace);
  ipcRenderer.on('ymd:addon:removed', onAddonRemoved);
  ipcRenderer.on('ymd:settings:changed', onSettingsChanged);

  const watchDomAnchors = () => {
    const selectors = boot.domAnchors || {};
    const found = {};
    const reportFound = () => {
      const fresh = {};
      for (const [name, selector] of Object.entries(selectors)) {
        if (found[name] || !document.querySelector(selector)) continue;
        found[name] = true;
        fresh[name] = true;
      }
      if (Object.keys(fresh).length) ipcRenderer.send('ymd:dom-anchors', fresh);
    };
    const reportMissing = () => {
      const missing = {};
      for (const name of ['navbar', 'navItem']) if (name in selectors && !found[name]) missing[name] = false;
      if (Object.keys(missing).length) ipcRenderer.send('ymd:dom-anchors', missing);
    };
    observeDocument(reportFound);
    reportFound();
    setTimeout(reportMissing, 20000);
  };

  const core = Object.freeze({
    apiVersion: boot.apiVersion,
    modVersion: boot.modVersion,
    clientVersion: boot.clientVersion,
    support: boot.support,
    domAnchors: boot.domAnchors || {},
    css: boot.uiCss || '',
    addons: () => [...addons.values()].map((a) => ({ ...a.info })),
    onAddonsChange: addonState.add,
    setEnabled: (id, enabled) => ipcRenderer.invoke('ymd:addon:set-enabled', id, enabled),
    setSetting: (id, key, value) => ipcRenderer.invoke('ymd:settings:set', id, key, value),
    removeAddon: (id) => ipcRenderer.invoke('ymd:addon:remove', id),
    pickLocalAddon: () => ipcRenderer.invoke('ymd:addon:pick-local'),
    installLocalAddon: (token) => ipcRenderer.invoke('ymd:addon:install-local', token),
    pages: () => [...pages.values()],
    onPagesChange: pageRegistry.add,
    on: subscribe,
    emit,
    log,
  });

  const runCoreUi = () => {
    try {
      new Function('core', `${boot.ui}\n//# sourceURL=ymdmod/core-ui.js`)(core);
    } catch (error) {
      log('core ui failed', error);
    }
  };

  const reportBootFailures = () => {
    for (const addon of addons.values()) {
      if (addon.info.status === 'failed') emit('notify', { type: 'error', text: `Аддон «${addon.info.name}» отключён из-за ошибки`, source: 'core' });
    }
  };

  const startAll = () => {
    runCoreUi();
    watchDomAnchors();
    for (const addon of addons.values()) startAddon(addon);
    reportBootFailures();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startAll, { once: true });
  else startAll();
})();
