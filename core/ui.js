(() => {
  const STATUS = {
    active: { text: 'Работает', tone: 'ok' },
    disabled: { text: 'Выключен', tone: 'off' },
    failed: { text: 'Ошибка', tone: 'bad' },
    dependency: { text: 'Нет зависимости', tone: 'warn' },
    invalid: { text: 'Повреждён', tone: 'bad' },
  };

  const GEAR_SVG = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6a.5.5 0 0 0 .1-.6l-1.9-3.3a.5.5 0 0 0-.6-.2l-2.4 1a7.4 7.4 0 0 0-1.7-1l-.4-2.6a.5.5 0 0 0-.5-.4h-3.8a.5.5 0 0 0-.5.4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.4-1a.5.5 0 0 0-.6.2L2.5 8.4a.5.5 0 0 0 .1.6l2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6a.5.5 0 0 0-.1.6l1.9 3.3a.5.5 0 0 0 .6.2l2.4-1a7.4 7.4 0 0 0 1.7 1l.4 2.6a.5.5 0 0 0 .5.4h3.8a.5.5 0 0 0 .5-.4l.4-2.6a7.4 7.4 0 0 0 1.7-1l2.4 1a.5.5 0 0 0 .6-.2l1.9-3.3a.5.5 0 0 0-.1-.6zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"/></svg>';

  const CHEVRON_SVG = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m9 6 6 6-6 6"/></svg>';

  const ADDONS_TAB = 'core:addons';
  const REMOVE_ARM_MS = 4000;

  const el = (tag, props = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    }
    for (const child of [].concat(children)) if (child) node.append(child);
    return node;
  };

  const notify = (type, text) => core.emit('notify', { type, text, source: 'core' });

  const onDomChange = (handler) => {
    let scheduled = false;
    new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        handler();
      });
    }).observe(document.documentElement, { childList: true, subtree: true });
  };

  const injectStyles = () => {
    document.head.appendChild(el('style', { 'data-ymd': 'core', text: core.css }));
  };

  const isLightTheme = () => {
    const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(document.body).backgroundColor);
    if (!match) return false;
    const [r, g, b] = match.slice(1).map(Number);
    return 0.299 * r + 0.587 * g + 0.114 * b > 140;
  };

  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  const checkbox = (checked, disabled, onChange) => {
    const input = el('input', { type: 'checkbox' });
    input.checked = checked;
    input.disabled = disabled;
    input.addEventListener('change', () => onChange(input.checked));
    return input;
  };

  const switchControl = (input, attrs) => el('span', { class: 'ymd-switch', ...attrs }, [
    input,
    el('span', { onclick: () => !input.disabled && input.click() }),
  ]);

  const booleanField = (field, value, disabled, save) => switchControl(checkbox(Boolean(value), disabled, save), { 'data-key': field.key });

  const selectField = (field, value, disabled, save) => {
    const options = field.options || [];
    const select = el('select', { 'data-key': field.key }, options.map((o) => el('option', { value: String(o.value), text: o.label })));
    select.value = String(value ?? '');
    select.disabled = disabled;
    select.addEventListener('change', () => {
      const option = options.find((o) => String(o.value) === select.value);
      save(option ? option.value : select.value);
    });
    return select;
  };

  const inputField = (field, value, disabled, save) => {
    const numeric = field.type === 'number';
    const input = el('input', { type: numeric ? 'number' : 'text', 'data-key': field.key });
    input.value = value ?? '';
    input.disabled = disabled;
    input.addEventListener('change', () => save(numeric ? Number(input.value) : input.value));
    return input;
  };

  const fieldBuilder = (type) => {
    if (type === 'boolean') return booleanField;
    if (type === 'select') return selectField;
    return inputField;
  };

  const fieldControl = (addon, field) => fieldBuilder(field.type)(
    field,
    addon.values[field.key],
    addon.status !== 'active',
    (next) => core.setSetting(addon.id, field.key, next),
  );

  const setControlValue = (control, value) => {
    const input = control.matches('input, select') ? control : control.querySelector('input');
    if (!input || input === document.activeElement) return;
    if (input.type === 'checkbox') input.checked = Boolean(value);
    else input.value = String(value ?? '');
  };

  const settingsFields = (addon) => el('div', { class: 'ymd-fields' }, addon.settings.map((field) => el('div', { class: 'ymd-field' }, [
    el('label', { text: field.label || field.key }),
    fieldControl(addon, field),
  ])));

  const enableSwitch = (addon) => switchControl(
    checkbox(addon.status === 'active' || addon.status === 'dependency', addon.status === 'invalid', (enabled) => core.setEnabled(addon.id, enabled)),
    { title: 'Включить или выключить' },
  );

  const systemControl = (addon) => (addon.status === 'failed'
    ? el('button', { class: 'ymd-btn ymd-btn-accent', type: 'button', text: 'Перезапустить', onclick: () => core.setEnabled(addon.id, true) })
    : el('span', { class: 'ymd-chip ymd-off', text: 'Системный', title: 'Нужен для работы мода: не выключается и не удаляется' }));

  const removeButton = (addon) => {
    const button = el('button', { class: 'ymd-btn', type: 'button', text: 'Удалить' });
    let armed = null;
    const showArmed = (on) => {
      button.textContent = on ? 'Точно удалить?' : 'Удалить';
      button.classList.toggle('ymd-btn-danger', on);
    };
    const arm = () => {
      showArmed(true);
      armed = setTimeout(() => {
        armed = null;
        showArmed(false);
      }, REMOVE_ARM_MS);
    };
    const remove = async () => {
      clearTimeout(armed);
      button.disabled = true;
      button.textContent = 'Удаляю…';
      const ok = await core.removeAddon(addon.id);
      if (ok) notify('success', `Аддон «${addon.name}» удалён`);
      else notify('error', `Не удалось удалить «${addon.name}», подробности в логе`);
    };
    button.addEventListener('click', () => (armed ? remove() : arm()));
    return button;
  };

  const dependentsOf = (id) => core.addons().filter((a) => a.dependencies && id in a.dependencies).map((a) => a.name);

  const cardShape = (addon) => JSON.stringify([addon.status, addon.error, addon.warning, addon.version, addon.name, addon.description, addon.system, dependentsOf(addon.id)]);

  const cardHeader = (addon) => {
    const status = STATUS[addon.status] || STATUS.disabled;
    return el('div', { class: 'ymd-row' }, [
      el('div', { class: 'ymd-name' }, [addon.name, el('span', { class: 'ymd-ver', text: addon.version })]),
      el('span', { class: `ymd-chip ymd-${status.tone}`, text: status.text }),
      addon.system ? systemControl(addon) : enableSwitch(addon),
    ]);
  };

  const dependentsNote = (addon) => {
    const dependents = dependentsOf(addon.id);
    if (!dependents.length) return null;
    return el('div', { class: 'ymd-desc', text: `Нужен аддонам: ${dependents.map((name) => `«${name}»`).join(', ')}. Без него они не работают.` });
  };

  const addonCard = (addon) => el('div', { class: 'ymd-card', 'data-addon': addon.id, 'data-shape': cardShape(addon) }, [
    cardHeader(addon),
    addon.description && el('div', { class: 'ymd-desc', text: addon.description }),
    addon.warning && el('div', { class: 'ymd-warning', text: addon.warning }),
    dependentsNote(addon),
    addon.error && el('div', { class: 'ymd-error', text: addon.error }),
    addon.settings.length > 0 && addon.status !== 'invalid' && settingsFields(addon),
    !addon.system && el('div', { class: 'ymd-actions' }, removeButton(addon)),
  ]);

  const byListOrder = (a, b) => Number(b.system) - Number(a.system) || a.name.localeCompare(b.name, 'ru');

  const renderAddons = (list) => {
    list.replaceChildren();
    const addons = core.addons().sort(byListOrder);
    if (!addons.length) list.append(el('div', { class: 'ymd-empty', text: 'Аддонов нет. Установите их из каталога или положите в папку addons и перезапустите клиент.' }));
    for (const addon of addons) list.append(addonCard(addon));
  };

  const updateAddon = (list, info) => {
    const addon = core.addons().find((a) => a.id === info.id);
    const card = [...list.children].find((node) => node.dataset.addon === info.id);
    if (!addon || !card) {
      renderAddons(list);
      return;
    }
    if (card.dataset.shape !== cardShape(addon)) {
      card.replaceWith(addonCard(addon));
      return;
    }
    for (const control of card.querySelectorAll('[data-key]')) setControlValue(control, addon.values[control.dataset.key]);
  };

  const accessWarning = (picked) => {
    const reach = picked.hasMain
      ? 'У него есть main-часть: она получает полный доступ к компьютеру — файлам, сети, другим программам.'
      : 'Он работает на странице клиента и видит всё, что на ней: аккаунт, плейлисты, историю.';
    return el('div', { class: 'ymd-error', text: `Этот аддон не из каталога: его код никто не проверял. ${reach} Ставьте только аддоны, автору которых доверяете.` });
  };

  const missingDependencyWarning = (dep) => el('div', { class: 'ymd-warning', text: dep.installed
    ? `Нужен «${dep.name}» ${dep.range}, установлен ${dep.installed}: аддон не запустится, пока его не обновить.`
    : `Нужен аддон «${dep.id}» ${dep.range}: он не установлен, аддон не запустится, пока его не поставить.` });

  const pickedSummary = (picked) => el('div', { class: 'ymd-confirm-info' }, [
    el('div', {}, [el('b', { text: picked.name }), el('span', { class: 'ymd-ver', text: `${picked.version} · ${picked.id}` })]),
    picked.description && el('div', { class: 'ymd-desc', text: picked.description }),
    el('div', { class: 'ymd-desc', text: picked.dir }),
  ]);

  const localInstallConfirm = (picked, confirmSlot) => {
    const close = () => confirmSlot.replaceChildren();
    const install = async (event) => {
      event.currentTarget.disabled = true;
      const result = await core.installLocalAddon(picked.token);
      close();
      if (result.error) notify('error', result.error);
      else notify('success', `Аддон «${picked.name}» ${picked.installedVersion ? 'обновлён' : 'установлен'} из папки`);
    };
    return el('div', { class: 'ymd-card ymd-confirm' }, [
      el('div', { class: 'ymd-name', text: 'Установить аддон из папки?' }),
      pickedSummary(picked),
      accessWarning(picked),
      picked.installedVersion && el('div', { class: 'ymd-warning', text: `Заменит установленную версию ${picked.installedVersion}.` }),
      picked.warning && el('div', { class: 'ymd-warning', text: picked.warning }),
      ...picked.dependencies.filter((dep) => !dep.ok).map(missingDependencyWarning),
      el('div', { class: 'ymd-actions' }, [
        el('button', { class: 'ymd-btn', type: 'button', text: 'Отмена', onclick: close }),
        el('button', { class: 'ymd-btn ymd-btn-danger', type: 'button', text: 'Установить', onclick: install }),
      ]),
    ]);
  };

  const localInstallButton = (confirmSlot) => el('button', {
    class: 'ymd-btn',
    type: 'button',
    text: 'Установить из папки…',
    onclick: async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const picked = await core.pickLocalAddon();
        if (picked && picked.error) notify('error', picked.error);
        else if (picked) confirmSlot.replaceChildren(localInstallConfirm(picked, confirmSlot));
      } finally {
        button.disabled = false;
      }
    },
  });

  let overlay = null;
  let closing = null;
  let currentTab = ADDONS_TAB;
  let pageCleanup = null;

  const tabsSlot = () => overlay.querySelector('.ymd-tabs-slot');
  const bodySlot = () => overlay.querySelector('.ymd-body');

  const activeTab = () => (core.pages().some((p) => p.key === currentTab) ? currentTab : ADDONS_TAB);

  const leavePage = () => {
    const cleanup = pageCleanup;
    pageCleanup = null;
    try {
      if (typeof cleanup === 'function') cleanup();
    } catch (error) {
      core.log('page cleanup failed', error);
    }
  };

  const tabButton = (page) => el('button', {
    class: `ymd-tab${page.key === activeTab() ? ' ymd-on' : ''}`,
    type: 'button',
    text: page.title,
    onclick: () => showTab(page.key),
  });

  const renderTabs = (tabs) => {
    const pages = core.pages();
    tabs.classList.toggle('ymd-tabs', pages.length > 0);
    if (!pages.length) {
      tabs.replaceChildren(el('h3', { text: 'Аддоны' }));
      return;
    }
    tabs.replaceChildren(...[{ key: ADDONS_TAB, title: 'Аддоны' }, ...pages].map(tabButton));
  };

  const renderAddonsTab = (body) => {
    const list = el('div', { class: 'ymd-list' });
    const confirmSlot = el('div');
    body.append(el('div', { class: 'ymd-toolbar' }, localInstallButton(confirmSlot)), confirmSlot, list);
    renderAddons(list);
  };

  const renderPage = (body, page) => {
    const container = el('div', { class: 'ymd-page', 'data-page': page.key });
    body.append(container);
    pageCleanup = page.render(container);
  };

  const renderBody = (body) => {
    leavePage();
    body.replaceChildren();
    const page = core.pages().find((p) => p.key === activeTab());
    if (page) renderPage(body, page);
    else renderAddonsTab(body);
  };

  const showTab = (key) => {
    if (!overlay) return;
    currentTab = key;
    renderTabs(tabsSlot());
    renderBody(bodySlot());
  };

  const animateClose = (node) => {
    closing = node;
    node.classList.remove('ymd-opening');
    node.classList.add('ymd-closing');
    const done = () => {
      node.remove();
      if (closing === node) closing = null;
    };
    node.querySelector('.ymd-panel').addEventListener('animationend', done, { once: true });
    setTimeout(done, 400);
  };

  const closeOverlay = () => {
    if (!overlay) return;
    const node = overlay;
    overlay = null;
    const instant = reducedMotion();
    leavePage();
    if (instant) node.remove();
    else animateClose(node);
  };

  const discardClosing = () => {
    closing?.remove();
    closing = null;
  };

  const overlayPanel = (tabs, body) => el('div', { class: 'ymd-panel', role: 'dialog', 'aria-label': 'Настройки YMDMod' }, [
    el('div', { class: 'ymd-head' }, [
      el('h2', { text: 'YMDMod' }),
      el('button', { class: 'ymd-close', type: 'button', 'aria-label': 'Закрыть', text: '×', onclick: closeOverlay }),
    ]),
    el('div', { class: 'ymd-sub', text: `Мод ${core.modVersion} · Яндекс Музыка ${core.clientVersion} · сторонний проект, не связан с Яндексом` }),
    tabs,
    body,
  ]);

  const staggerEntrance = (panel) => {
    [...panel.querySelectorAll('.ymd-head, .ymd-sub, .ymd-tabs-slot, .ymd-card')].forEach((node, i) => node.style.setProperty('--ymd-i', i));
  };

  const openOverlay = () => {
    if (overlay) return;
    discardClosing();
    const tabs = el('div', { class: 'ymd-tabs-slot' });
    const body = el('div', { class: 'ymd-body' });
    const panel = overlayPanel(tabs, body);
    overlay = el('div', { id: 'ymd-overlay', class: `ymd-opening${isLightTheme() ? ' ymd-light' : ''}` }, panel);
    overlay.addEventListener('mousedown', (event) => event.target === overlay && closeOverlay());
    renderTabs(tabs);
    renderBody(body);
    staggerEntrance(panel);
    document.body.append(overlay);
    const opened = overlay;
    setTimeout(() => opened.classList.remove('ymd-opening'), 1200);
  };

  const listenForChanges = () => {
    core.onAddonsChange((info) => {
      const list = overlay?.querySelector('.ymd-list');
      if (list) updateAddon(list, info);
    });
    core.onPagesChange(() => {
      if (!overlay) return;
      renderTabs(tabsSlot());
      if (currentTab !== ADDONS_TAB) renderBody(bodySlot());
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && overlay) closeOverlay();
    });
    core.on('ymd:open-settings', (payload) => {
      if (payload && typeof payload.tab === 'string') currentTab = payload.tab;
      if (overlay) showTab(currentTab);
      else openOverlay();
    });
  };

  const gearButton = () => el('button', {
    class: 'ymd-gear', type: 'button', title: 'Настройки YMDMod', 'aria-label': 'Настройки YMDMod',
    html: `${GEAR_SVG}<span>YMDMod</span>`,
    onclick: (event) => {
      const gear = event.currentTarget;
      gear.classList.add('ymd-spin');
      setTimeout(() => gear.classList.remove('ymd-spin'), 600);
      openOverlay();
    },
  });

  const nativeTitle = (root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!node.textContent.trim() || parent.closest('.ymd-settings-item')) continue;
      if (Number(getComputedStyle(parent).fontWeight) >= 600) return parent;
    }
    return null;
  };

  const settingsItem = (settingsList) => {
    const title = el('b', { text: 'YMDMod' });
    const item = el('button', { class: 'ymd-settings-item', type: 'button', onclick: openOverlay }, [
      el('span', {}, [title, el('small', { text: 'Аддоны и настройки мода' })]),
    ]);
    item.insertAdjacentHTML('beforeend', CHEVRON_SVG);
    const native = nativeTitle(settingsList);
    if (native) title.style.color = getComputedStyle(native).color;
    return item;
  };

  const findAnchor = (name, root = document) => core.domAnchors[name] && root.querySelector(core.domAnchors[name]);

  const ensureNavbarGear = () => {
    const navbar = findAnchor('navbar');
    if (!navbar || navbar.querySelector('.ymd-gear')) return;
    const item = findAnchor('navItem', navbar);
    const list = item && item.closest('ol, ul');
    if (list) list.append(el('li', { class: 'ymd-gear-item' }, gearButton()));
    else navbar.append(gearButton());
  };

  const ensureSettingsItem = () => {
    const settingsList = findAnchor('settingsList');
    if (!settingsList || settingsList.querySelector('.ymd-settings-item')) return;
    settingsList.append(settingsItem(settingsList));
  };

  const ensureEntryPoints = () => {
    ensureNavbarGear();
    ensureSettingsItem();
  };

  injectStyles();
  listenForChanges();
  onDomChange(ensureEntryPoints);
  ensureEntryPoints();
})();
