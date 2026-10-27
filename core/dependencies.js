'use strict';
const { matchesCondition } = require('./versions');

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TYPES = ['addon', 'library'];

function dependenciesOf(manifest) {
  const deps = manifest && manifest.dependencies;
  return deps && typeof deps === 'object' && !Array.isArray(deps) ? deps : {};
}

function satisfies(version, range) {
  return !range || matchesCondition(version, range);
}

function dependencyManifestError(manifest) {
  if (manifest.type !== undefined && !TYPES.includes(manifest.type)) return `type: только ${TYPES.join(' или ')}`;
  const deps = manifest.dependencies;
  if (deps === undefined) return null;
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) return 'dependencies должен быть объектом { "id": "версии" }';
  for (const [id, range] of Object.entries(deps)) {
    if (!ID_PATTERN.test(id) || typeof range !== 'string' || !range.trim()) return `dependencies: неверная запись «${id}»`;
    if (id === manifest.id) return 'аддон не может зависеть от самого себя';
  }
  return null;
}

function orderByDependencies(addons) {
  const byId = new Map(addons.map((addon) => [addon.id, addon]));
  const visited = new Set();
  const ordered = [];
  const visit = (addon) => {
    if (visited.has(addon.id)) return;
    visited.add(addon.id);
    for (const id of Object.keys(dependenciesOf(addon.manifest)).sort()) {
      if (byId.has(id)) visit(byId.get(id));
    }
    ordered.push(addon);
  };
  for (const addon of addons) visit(addon);
  return ordered;
}

function dependencyProblem(manifest, find) {
  for (const [id, range] of Object.entries(dependenciesOf(manifest))) {
    const dep = find(id);
    if (!dep) return `Нужен аддон «${id}» ${range}: он не установлен.`;
    if (!satisfies(dep.version, range)) return `Нужен «${dep.name}» ${range}, установлен ${dep.version}.`;
    if (dep.status === 'failed') return `Нужен аддон «${dep.name}»: он отключён из-за ошибки.`;
    if (dep.status !== 'active') return `Нужен аддон «${dep.name}»: он выключен.`;
  }
  return null;
}

module.exports = { dependenciesOf, satisfies, dependencyManifestError, orderByDependencies, dependencyProblem };
