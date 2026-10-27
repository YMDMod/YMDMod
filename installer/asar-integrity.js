'use strict';

const fs = require('fs');
const crypto = require('crypto');

function readAsarHeaderHash(asarPath) {
    const fd = fs.openSync(asarPath, 'r');
    try {
        const prefix = Buffer.alloc(16);
        fs.readSync(fd, prefix, 0, 16, 0);
        const headerLength = prefix.readUInt32LE(12);
        const header = Buffer.alloc(headerLength);
        fs.readSync(fd, header, 0, headerLength, 16);
        return crypto.createHash('sha256').update(header).digest('hex');
    } finally {
        fs.closeSync(fd);
    }
}

function findIntegrityArray(exeBuf) {
    const marker = Buffer.from('"file":"resources\\\\app.asar"', 'utf8');
    const markerIdx = exeBuf.indexOf(marker);
    if (markerIdx < 0) throw new Error('integrity marker not found in exe');
    const start = exeBuf.lastIndexOf(Buffer.from('[', 'utf8'), markerIdx);
    const end = exeBuf.indexOf(Buffer.from(']', 'utf8'), markerIdx + marker.length);
    if (start < 0 || end < 0) throw new Error('integrity array bounds not found');
    const raw = exeBuf.subarray(start, end + 1);
    const arr = JSON.parse(raw.toString('utf8'));
    const entry = arr.find((item) => item && typeof item.file === 'string' && item.file.replace(/\\\\/g, '\\').toLowerCase() === 'resources\\app.asar');
    if (!entry) throw new Error('resources\\app.asar entry not found in integrity array');
    return { start, end, raw, arr, entry };
}

function readExeIntegrityValue(exePath) {
    const { entry } = findIntegrityArray(fs.readFileSync(exePath));
    return entry.value;
}

function setExeIntegrityValue(exePath, hex) {
    const buf = fs.readFileSync(exePath);
    const found = findIntegrityArray(buf);
    found.entry.value = hex;
    const json = Buffer.from(JSON.stringify(found.arr), 'utf8');
    if (json.length !== found.raw.length) throw new Error(`integrity JSON length changed: ${found.raw.length} -> ${json.length}`);
    json.copy(buf, found.start);
    fs.writeFileSync(exePath, buf);
}

module.exports = { readAsarHeaderHash, readExeIntegrityValue, setExeIntegrityValue, findIntegrityArray };
