'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { matchesCondition, matchesAny, pickAnchors } = require('../versions');
const table = require(path.join(__dirname, '..', 'versions.json'));

test('условия совместимости аддона', () => {
  assert.equal(matchesCondition('5.124.1', '*'), true);
  assert.equal(matchesCondition('5.124.1', '5.124.1'), true);
  assert.equal(matchesCondition('5.124.1', '5.124.0'), false);
  assert.equal(matchesCondition('5.124.1', '>=5.122.0 <5.125.0'), true);
  assert.equal(matchesCondition('5.125.0', '>=5.122.0 <5.125.0'), false);
  assert.equal(matchesCondition('5.121.9', '>=5.122.0 <5.125.0'), false);
  assert.equal(matchesCondition('5.124.1', '~5.124'), false, 'неизвестный синтаксис не совпадает');
  assert.equal(matchesCondition('5.124.1-beta', '*'), false, 'нестандартная версия клиента не совпадает');
  assert.equal(matchesAny('5.124.1', ['5.122.0', '>=5.124.0']), true);
  assert.equal(matchesAny('5.124.1', undefined), false);
});

test('якоря: точная версия', () => {
  const picked = pickAnchors(table, '5.124.1');
  assert.equal(picked.exact, true);
  assert.equal(picked.tableVersion, '5.124.1');
  assert.equal(picked.anchors.ipcPlayerAction, 'desktop:player:action');
});

test('якоря: неизвестная версия берёт ближайшую младшую', () => {
  assert.deepEqual(
    [pickAnchors(table, '5.124.2').tableVersion, pickAnchors(table, '5.124.2').exact],
    ['5.124.1', false],
  );
  assert.equal(pickAnchors(table, '5.123.0').tableVersion, '5.122.0');
  assert.equal(pickAnchors(table, '5.125.0').tableVersion, '5.124.1');
  assert.equal(pickAnchors(table, '5.130.0').tableVersion, '5.125.3');
});

test('якоря: версия старше таблицы или мусор — мод не включается', () => {
  assert.equal(pickAnchors(table, '5.100.0'), null);
  assert.equal(pickAnchors(table, 'abc'), null);
  assert.equal(pickAnchors({}, '5.124.1'), null);
});
