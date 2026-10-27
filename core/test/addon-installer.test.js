'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { loadCatalog, installEntry, installedVersion, nodeFetchBytes } = require('../addon-installer');

const COMMIT = 'a'.repeat(40);

function setup(version) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ymd-installer-'));
  const repoDir = path.join(root, 'raw', 'owner', 'hello', COMMIT);
  fs.mkdirSync(repoDir, { recursive: true });
  const files = {
    'manifest.json': JSON.stringify({ id: 'hello', name: 'Hello', version, apiVersion: 1, renderer: 'renderer.js' }),
    'renderer.js': 'module.exports = {};',
  };
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(repoDir, name), text);
  const entry = {
    id: 'hello', name: 'Hello', version, repo: 'owner/hello', commit: COMMIT,
    files: Object.entries(files).map(([name, text]) => ({ path: name, size: Buffer.byteLength(text), sha256: crypto.createHash('sha256').update(text).digest('hex') })),
  };
  const catalogFile = path.join(root, 'catalog.json');
  fs.writeFileSync(catalogFile, JSON.stringify({ schema: 2, rawBase: pathToFileURL(path.join(root, 'raw')).href, addons: [entry, { id: 'Bad' }] }));
  return { root, repoDir, entry, catalogUrl: pathToFileURL(catalogFile).href, addonsDir: path.join(root, 'addons') };
}

test('каталог: битые записи отбрасываются, rawBase из каталога', async () => {
  const t = setup('1.0.0');
  try {
    const catalog = await loadCatalog(t.catalogUrl, nodeFetchBytes);
    assert.deepEqual(catalog.entries.map((e) => e.id), ['hello']);
    assert.equal(catalog.skipped, 1);
    assert.match(catalog.rawBase, /^file:/);
  } finally {
    fs.rmSync(t.root, { recursive: true, force: true });
  }
});

test('установка по коммиту и отказ при несовпадении sha256 без порчи установленной версии', async () => {
  const t = setup('1.0.0');
  try {
    const { rawBase } = await loadCatalog(t.catalogUrl, nodeFetchBytes);
    await installEntry(t.entry, { rawBase, addonsDir: t.addonsDir, fetchBytes: nodeFetchBytes });
    assert.equal(installedVersion(t.addonsDir, 'hello'), '1.0.0');

    fs.writeFileSync(path.join(t.repoDir, 'renderer.js'), 'module.exports = 1;;');
    const newer = { ...t.entry, version: '1.0.0' };
    await assert.rejects(installEntry(newer, { rawBase, addonsDir: t.addonsDir, fetchBytes: nodeFetchBytes }), /sha256/);
    assert.equal(installedVersion(t.addonsDir, 'hello'), '1.0.0');
    assert.deepEqual(fs.readdirSync(t.addonsDir), ['hello']);
  } finally {
    fs.rmSync(t.root, { recursive: true, force: true });
  }
});
