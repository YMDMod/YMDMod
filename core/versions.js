'use strict';

function parseVersion(text) {
  const parts = String(text).split('.').map((n) => (/^\d+$/.test(n) ? Number(n) : NaN));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return parts;
}

function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

function matchesCondition(version, condition) {
  const current = parseVersion(version);
  if (!current) return false;
  const text = String(condition).trim();
  if (text === '*') return true;
  return text.split(/\s+/).every((part) => {
    const match = /^(>=|<=|>|<|=)?(\d+\.\d+\.\d+)$/.exec(part);
    if (!match) return false;
    const cmp = compareVersions(current, parseVersion(match[2]));
    switch (match[1] || '=') {
      case '>=': return cmp >= 0;
      case '<=': return cmp <= 0;
      case '>': return cmp > 0;
      case '<': return cmp < 0;
      default: return cmp === 0;
    }
  });
}

function matchesAny(version, conditions) {
  return Array.isArray(conditions) && conditions.some((condition) => matchesCondition(version, condition));
}

function pickAnchors(table, clientVersion) {
  const versions = (table && table.versions) || {};
  if (versions[clientVersion]) return { tableVersion: clientVersion, exact: true, anchors: versions[clientVersion].anchors };
  const current = parseVersion(clientVersion);
  if (!current) return null;
  let best = null;
  for (const version of Object.keys(versions)) {
    const parsed = parseVersion(version);
    if (!parsed || compareVersions(parsed, current) > 0) continue;
    if (!best || compareVersions(parsed, best.parsed) > 0) best = { version, parsed };
  }
  if (!best) return null;
  return { tableVersion: best.version, exact: false, anchors: versions[best.version].anchors };
}

module.exports = { parseVersion, compareVersions, matchesCondition, matchesAny, pickAnchors };
