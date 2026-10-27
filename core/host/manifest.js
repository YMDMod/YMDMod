'use strict';
const path = require('path');
const { state, SUPPORTED_API_VERSIONS, ID_PATTERN } = require('./state');
const { readJson } = require('./storage');
const { matchesAny } = require('../versions');
const { dependencyManifestError } = require('../dependencies');

function manifestError(manifest) {
  if (!manifest || typeof manifest !== 'object') return 'manifest.json не читается';
  if (!ID_PATTERN.test(manifest.id || '')) return 'некорректный id';
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') return 'нет name или version';
  if (!SUPPORTED_API_VERSIONS.includes(manifest.apiVersion)) return `apiVersion ${manifest.apiVersion} не поддерживается ядром`;
  if (manifest.modVersions !== undefined && !Array.isArray(manifest.modVersions)) return 'modVersions должен быть списком';
  if (manifest.permissions !== undefined && !Array.isArray(manifest.permissions)) return 'permissions должен быть списком';
  return dependencyManifestError(manifest);
}

function readManifest(dir) {
  const manifest = readJson(path.join(dir, 'manifest.json'), null);
  const error = manifestError(manifest) || (path.basename(dir) !== manifest.id ? 'имя папки не совпадает с id' : null);
  return error ? { error } : { manifest };
}

function compatibility(manifest) {
  if (!manifest || !SUPPORTED_API_VERSIONS.includes(manifest.apiVersion)) {
    return { ok: false, reason: `apiVersion ${manifest && manifest.apiVersion} не поддерживается ядром`, warning: '' };
  }
  const wanted = manifest.modVersions;
  if (Array.isArray(wanted) && !matchesAny(state.modVersion, wanted)) {
    return { ok: true, reason: '', warning: `Рассчитан на мод ${wanted.join(', ')}, установлен ${state.modVersion}. Может работать неправильно.` };
  }
  return { ok: true, reason: '', warning: '' };
}

module.exports = { manifestError, readManifest, compatibility };
