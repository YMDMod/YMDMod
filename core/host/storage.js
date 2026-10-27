'use strict';
const fs = require('fs');
const { state } = require('./state');

const MAX_LOG_BYTES = 1024 * 1024;
const pendingLines = [];
let logBytes = 0;

function errorText(error) {
  return (error && (error.stack || error.message)) || String(error);
}

function toText(value) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function log(...parts) {
  const line = `${new Date().toISOString()} ${parts.map(toText).join(' ')}\n`;
  if (!state.logPath) {
    pendingLines.push(line);
    return;
  }
  try {
    appendLine(line);
  } catch {
  }
}

function rotateLog() {
  fs.rmSync(`${state.logPath}.1`, { force: true });
  if (fs.existsSync(state.logPath)) fs.renameSync(state.logPath, `${state.logPath}.1`);
  logBytes = 0;
}

function appendLine(line) {
  const size = Buffer.byteLength(line);
  if (logBytes + size > MAX_LOG_BYTES) rotateLog();
  fs.appendFileSync(state.logPath, line);
  logBytes += size;
}

function openLog(file) {
  state.logPath = file;
  logBytes = fs.existsSync(file) ? fs.statSync(file).size : 0;
  for (const line of pendingLines.splice(0)) appendLine(line);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  try {
    const temp = `${file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(value, null, 2));
    fs.renameSync(temp, file);
  } catch (error) {
    log('write failed', file, errorText(error));
  }
}

module.exports = { log, openLog, errorText, readJson, writeJson, MAX_LOG_BYTES };
