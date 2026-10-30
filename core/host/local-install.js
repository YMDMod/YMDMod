'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { BrowserWindow, dialog } = require('electron');
const { state, SYSTEM_ADDONS } = require('./state');
const { log, errorText, readJson } = require('./storage');
const { manifestError, compatibility, entryPath } = require('./manifest');
const { rescanAddon } = require('./registry');
const { dependenciesOf, satisfies } = require('../dependencies');

const pending = new Map();

async function chooseFolder(sender) {
  const win = BrowserWindow.fromWebContents(sender);
  const result = await dialog.showOpenDialog(win, { title: 'Папка аддона (с manifest.json)', properties: ['openDirectory'] });
  return result.canceled || !result.filePaths[0] ? null : path.resolve(result.filePaths[0]);
}

function refusal(dir, manifest) {
  if (!manifest) return 'В папке нет manifest.json — это не аддон.';
  const error = manifestError(manifest);
  if (error) return `manifest.json: ${error}.`;
  if (SYSTEM_ADDONS.includes(manifest.id)) return 'Системные аддоны ставятся только из каталога.';
  if (dir.toLowerCase().startsWith(path.resolve(state.addonsDir).toLowerCase())) return 'Эта папка уже лежит в папке аддонов мода.';
  return null;
}

function describeDependencies(manifest) {
  return Object.entries(dependenciesOf(manifest)).map(([id, range]) => {
    const dep = state.addons.get(id);
    const installed = dep ? dep.manifest.version : null;
    return { id, range, name: dep ? dep.manifest.name : id, installed, ok: Boolean(dep) && satisfies(installed, range) };
  });
}

function describe(token, dir, manifest) {
  const installed = state.addons.get(manifest.id);
  return {
    token,
    dir,
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description || '',
    hasMain: Boolean(entryPath(dir, 'main')),
    installedVersion: installed ? installed.manifest.version : null,
    warning: compatibility(manifest).warning,
    dependencies: describeDependencies(manifest),
  };
}

async function pickLocalAddon(sender) {
  const dir = await chooseFolder(sender);
  if (!dir) return null;
  const manifest = readJson(path.join(dir, 'manifest.json'), null);
  const error = refusal(dir, manifest);
  if (error) return { error };
  const token = crypto.randomUUID();
  pending.clear();
  pending.set(token, { dir, manifest });
  return describe(token, dir, manifest);
}

function copyIntoAddons(dir, id) {
  const target = path.join(state.addonsDir, id);
  const temp = path.join(state.addonsDir, `.${id}.ymd-new`);
  const old = path.join(state.addonsDir, `.${id}.ymd-old`);
  try {
    fs.rmSync(temp, { recursive: true, force: true });
    fs.rmSync(old, { recursive: true, force: true });
    fs.cpSync(dir, temp, { recursive: true, filter: (source) => source === dir || !path.basename(source).startsWith('.') });
    if (fs.existsSync(target)) fs.renameSync(target, old);
    fs.renameSync(temp, target);
    fs.rmSync(old, { recursive: true, force: true });
  } catch (error) {
    if (!fs.existsSync(target) && fs.existsSync(old)) fs.renameSync(old, target);
    fs.rmSync(temp, { recursive: true, force: true });
    throw error;
  }
}

function installLocalAddon(token) {
  const chosen = pending.get(String(token));
  pending.delete(String(token));
  if (!chosen) return { error: 'Выберите папку заново.' };
  const { dir, manifest } = chosen;
  try {
    copyIntoAddons(dir, manifest.id);
  } catch (error) {
    log('local install failed', manifest.id, errorText(error));
    return { error: `Не удалось скопировать: ${error.message}` };
  }
  log('local addon installed', manifest.id, manifest.version, 'from', dir);
  return { addon: rescanAddon(manifest.id) };
}

module.exports = { pickLocalAddon, installLocalAddon };
