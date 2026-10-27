'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const asar = require('../../installer/asar');
const { readAsarHeaderHash } = require('../../installer/asar-integrity');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ymdmod-asar-'));
}

test('правка архива: замена и добавление файлов, старые данные на месте', () => {
  const dir = tempDir();
  const src = path.join(dir, 'src.asar');
  const out = path.join(dir, 'out.asar');
  const big = Buffer.alloc(5 * 1024 * 1024 + 3, 7);
  asar.writeArchive(src, {
    'package.json': Buffer.from('{"main":"./index.js"}'),
    'index.js': Buffer.from('console.log(1)'),
    'big.bin': big,
  });
  const archive = asar.openArchive(src);
  assert.equal(archive.headerHash, readAsarHeaderHash(src));

  const hash = asar.writePatched(archive, out, {
    'package.json': Buffer.from('{"main":"./loader.js"}'),
    'loader.js': Buffer.from('require("./index.js")'),
  });
  const patched = asar.openArchive(out);
  assert.equal(patched.headerHash, hash);
  assert.equal(readAsarHeaderHash(out), hash, 'хэш заголовка совпадает с инструментом проверки exe');
  assert.equal(asar.readFile(patched, 'package.json').toString(), '{"main":"./loader.js"}');
  assert.equal(asar.readFile(patched, 'loader.js').toString(), 'require("./index.js")');
  assert.equal(asar.readFile(patched, 'index.js').toString(), 'console.log(1)');
  assert.ok(asar.readFile(patched, 'big.bin').equals(big));

  for (const name of ['package.json', 'loader.js', 'index.js', 'big.bin']) {
    const entry = asar.findEntry(patched.header, name);
    assert.deepEqual(entry.integrity, asar.fileIntegrity(asar.readFile(patched, name)), `integrity ${name}`);
  }
  assert.equal(asar.findEntry(patched.header, 'big.bin').integrity.blocks.length, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('не asar — понятная ошибка', () => {
  const dir = tempDir();
  const file = path.join(dir, 'x.asar');
  fs.writeFileSync(file, 'hello world, not an archive');
  assert.throws(() => asar.openArchive(file), /не asar/);
  fs.rmSync(dir, { recursive: true, force: true });
});
