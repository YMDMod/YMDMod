'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

function loaderLog(text) {
  try {
    fs.appendFileSync(path.join(os.tmpdir(), 'ymdmod-loader.log'), `${new Date().toISOString()} ${text}\n`);
  } catch {
  }
}

let config = { clientMain: './index.js' };
try {
  config = { ...config, ...JSON.parse(fs.readFileSync(path.join(__dirname, 'ymdmod.json'), 'utf8')) };
  const host = require(path.join(config.modDir, 'core', 'host.js'));
  host.start({ addonsDir: path.join(config.modDir, 'addons') });
} catch (error) {
  loaderLog(`YMDMod не загрузился: ${(error && (error.stack || error.message)) || error}`);
}

require(path.join(__dirname, config.clientMain));
