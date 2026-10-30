'use strict';
const fs = require('fs');
const path = require('path');
const { state, ID_PATTERN } = require('./state');
const { readJson } = require('./storage');
const { matchesAny } = require('../versions');
const { dependencyManifestError } = require('../dependencies');

function manifestError(manifest) {
  if (!manifest || typeof manifest !== 'object') return 'manifest.json не читается';
  if (!ID_PATTERN.test(manifest.id || '')) return 'некорректный id';
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') return 'нет name или version';
  if (manifest.modVersions !== undefined && !Array.isArray(manifest.modVersions)) return 'modVersions должен быть списком';
  return dependencyManifestError(manifest);
}

function readManifest(dir) {
  const manifest = readJson(path.join(dir, 'manifest.json'), null);
  const error = manifestError(manifest) || (path.basename(dir) !== manifest.id ? 'имя папки не совпадает с id' : null);
  return error ? { error } : { manifest };
}

function compatibility(manifest) {
  if (!manifest) return { ok: false, reason: 'manifest.json не читается', warning: '' };
  const wanted = manifest.modVersions;
  if (Array.isArray(wanted) && !matchesAny(state.modVersion, wanted)) {
    return { ok: true, reason: '', warning: `Рассчитан на мод ${wanted.join(', ')}, установлен ${state.modVersion}. Может работать неправильно.` };
  }
  return { ok: true, reason: '', warning: '' };
}

const ENTRY_FILES = { main: 'main.js', renderer: 'renderer.js' };

function entryPath(dir, kind) {
  const file = path.join(dir, ENTRY_FILES[kind]);
  return fs.existsSync(file) ? file : null;
}

module.exports = { manifestError, readManifest, compatibility, entryPath };
