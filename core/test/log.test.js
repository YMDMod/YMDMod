'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { log, openLog, MAX_LOG_BYTES } = require('../host/storage');

test('лог: при переполнении старый уходит в .1, на диске не больше двух файлов', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ymd-log-'));
  try {
    const file = path.join(dir, 'ymdmod.log');
    fs.writeFileSync(`${file}.1`, 'очень старое');
    log('до открытия');
    openLog(file);
    const chunk = 'x'.repeat(1000);
    for (let i = 0; i < 2500; i++) log(`строка ${i}`, chunk);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['ymdmod.log', 'ymdmod.log.1']);
    assert.ok(fs.statSync(file).size <= MAX_LOG_BYTES);
    assert.ok(fs.statSync(`${file}.1`).size <= MAX_LOG_BYTES);
    assert.doesNotMatch(fs.readFileSync(`${file}.1`, 'utf8'), /очень старое/);
    assert.match(fs.readFileSync(file, 'utf8'), /строка 2499/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
