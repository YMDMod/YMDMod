'use strict';
const fs = require('fs');
const crypto = require('crypto');

const BLOCK_SIZE = 4 * 1024 * 1024;
const COPY_CHUNK = 8 * 1024 * 1024;

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function fileIntegrity(buf) {
  const blocks = [];
  for (let i = 0; i < buf.length; i += BLOCK_SIZE) blocks.push(sha256(buf.subarray(i, i + BLOCK_SIZE)));
  if (!blocks.length) blocks.push(sha256(Buffer.alloc(0)));
  return { algorithm: 'SHA256', hash: sha256(buf), blockSize: BLOCK_SIZE, blocks };
}

function encodeHeader(header) {
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const padded = Math.ceil(json.length / 4) * 4;
  const payloadSize = 4 + padded;
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(payloadSize + 4, 4);
  prefix.writeUInt32LE(payloadSize, 8);
  prefix.writeUInt32LE(json.length, 12);
  return { bytes: Buffer.concat([prefix, json, Buffer.alloc(padded - json.length)]), json };
}

function openArchive(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const prefix = Buffer.alloc(16);
    if (fs.readSync(fd, prefix, 0, 16, 0) !== 16 || prefix.readUInt32LE(0) !== 4) throw new Error(`${file}: это не asar`);
    const jsonLength = prefix.readUInt32LE(12);
    const json = Buffer.alloc(jsonLength);
    fs.readSync(fd, json, 0, jsonLength, 16);
    return {
      file,
      header: JSON.parse(json.toString('utf8')),
      headerHash: sha256(json),
      dataStart: 8 + prefix.readUInt32LE(4),
      size: fs.fstatSync(fd).size,
    };
  } finally {
    fs.closeSync(fd);
  }
}

function findEntry(header, name) {
  let node = header;
  for (const part of name.split('/')) {
    if (!node.files || !Object.prototype.hasOwnProperty.call(node.files, part)) return null;
    node = node.files[part];
  }
  return node;
}

function readFile(archive, name) {
  const entry = findEntry(archive.header, name);
  if (!entry || entry.files || entry.unpacked || entry.link) throw new Error(`в архиве нет файла ${name}`);
  const fd = fs.openSync(archive.file, 'r');
  try {
    const buf = Buffer.alloc(entry.size);
    fs.readSync(fd, buf, 0, entry.size, archive.dataStart + Number(entry.offset));
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}

function writePatched(archive, outFile, files) {
  const header = JSON.parse(JSON.stringify(archive.header));
  const dataLength = archive.size - archive.dataStart;
  const appended = [];
  let offset = dataLength;
  for (const [name, buf] of Object.entries(files)) {
    if (name.includes('/')) throw new Error(`только файлы в корне архива: ${name}`);
    header.files[name] = { size: buf.length, offset: String(offset), integrity: fileIntegrity(buf) };
    appended.push(buf);
    offset += buf.length;
  }
  const encoded = encodeHeader(header);
  const src = fs.openSync(archive.file, 'r');
  const dst = fs.openSync(outFile, 'w');
  try {
    fs.writeSync(dst, encoded.bytes);
    const chunk = Buffer.alloc(COPY_CHUNK);
    for (let pos = archive.dataStart; pos < archive.size;) {
      const read = fs.readSync(src, chunk, 0, Math.min(COPY_CHUNK, archive.size - pos), pos);
      if (read <= 0) throw new Error('архив прочитан не до конца');
      fs.writeSync(dst, chunk, 0, read);
      pos += read;
    }
    for (const buf of appended) fs.writeSync(dst, buf);
  } finally {
    fs.closeSync(src);
    fs.closeSync(dst);
  }
  return sha256(encoded.json);
}

function writeArchive(outFile, files) {
  const header = { files: {} };
  let offset = 0;
  for (const [name, buf] of Object.entries(files)) {
    header.files[name] = { size: buf.length, offset: String(offset), integrity: fileIntegrity(buf) };
    offset += buf.length;
  }
  fs.writeFileSync(outFile, Buffer.concat([encodeHeader(header).bytes, ...Object.values(files)]));
}

module.exports = { fileIntegrity, openArchive, findEntry, readFile, writePatched, writeArchive, sha256 };
