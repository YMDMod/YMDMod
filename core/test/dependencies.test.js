'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { dependencyManifestError, orderByDependencies, dependencyProblem, satisfies } = require('../dependencies');

const addon = (id, dependencies) => ({ id, manifest: { id, dependencies } });

test('порядок запуска: зависимости раньше зависимых, остальное по порядку, цикл не зацикливает', () => {
  const order = orderByDependencies([
    addon('a-player', { lib: '>=1.0.0' }),
    addon('b-solo'),
    addon('lib', { core: '*' }),
    addon('core'),
    addon('x', { y: '*' }),
    addon('y', { x: '*' }),
  ]).map((a) => a.id);
  assert.deepEqual(order, ['core', 'lib', 'a-player', 'b-solo', 'y', 'x']);
});

test('проблемы зависимостей: нет, не та версия, выключена, упала, всё в порядке', () => {
  const installed = {
    lib: { name: 'Библиотека', version: '0.2.0', status: 'active' },
    off: { name: 'Выключенная', version: '1.0.0', status: 'disabled' },
    broken: { name: 'Сломанная', version: '1.0.0', status: 'failed' },
  };
  const find = (id) => installed[id];
  assert.match(dependencyProblem({ dependencies: { missing: '>=1.0.0' } }, find), /«missing» >=1\.0\.0: он не установлен/);
  assert.match(dependencyProblem({ dependencies: { lib: '>=0.3.0' } }, find), /Нужен «Библиотека» >=0\.3\.0, установлен 0\.2\.0/);
  assert.match(dependencyProblem({ dependencies: { off: '*' } }, find), /выключен/);
  assert.match(dependencyProblem({ dependencies: { broken: '*' } }, find), /из-за ошибки/);
  assert.equal(dependencyProblem({ dependencies: { lib: '>=0.2.0 <1.0.0' } }, find), null);
  assert.equal(dependencyProblem({}, find), null);
});

test('проверка манифеста: dependencies', () => {
  assert.equal(dependencyManifestError({ id: 'a', dependencies: { b: '>=1.0.0' } }), null);
  assert.equal(dependencyManifestError({ id: 'a', type: 'plugin' }), null, 'старое поле type больше не проверяется');
  assert.match(dependencyManifestError({ id: 'a', dependencies: ['b'] }), /объектом/);
  assert.match(dependencyManifestError({ id: 'a', dependencies: { 'B!': '*' } }), /неверная запись/);
  assert.match(dependencyManifestError({ id: 'a', dependencies: { a: '*' } }), /самого себя/);
  assert.equal(satisfies('0.3.0', undefined), true);
  assert.equal(satisfies('0.3.0', '>=0.4.0'), false);
});
