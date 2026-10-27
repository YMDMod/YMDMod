'use strict';
process.noAsar = true;
const fs = require('fs');
const path = require('path');
const asar = require('./asar');
const { findIntegrityArray } = require('./asar-integrity');
const { parseVersion, compareVersions, pickAnchors } = require('../core/versions');

const ROOT = path.join(__dirname, '..');
const LOADER_NAME = 'ymdmod-loader.js';
const CONFIG_NAME = 'ymdmod.json';
const BACKUP = '.ymdmod-backup';
const NEW = '.ymdmod-new';

class InstallError extends Error {}

function parseArgs(argv) {
  const options = { command: argv[0], dir: null, modDir: null };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--dir') options.dir = path.resolve(argv[++i]);
    else if (argv[i] === '--mod-dir') options.modDir = path.resolve(argv[++i]);
    else throw new InstallError(`Неизвестный аргумент: ${argv[i]}`);
  }
  if (!options.dir) throw new InstallError('Не указана папка клиента (--dir).');
  return options;
}

function clientFiles(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    throw new InstallError(`Папка клиента не найдена: ${dir}`);
  }
  const exeName = names.find((n) => n.toLowerCase().endsWith('.exe') && !n.startsWith('Uninstall'));
  const asarPath = path.join(dir, 'resources', 'app.asar');
  if (!exeName || !fs.existsSync(asarPath)) throw new InstallError(`В ${dir} нет клиента Яндекс Музыки (exe или resources\\app.asar).`);
  const exe = path.join(dir, exeName);
  return { exe, asar: asarPath, exeBackup: exe + BACKUP, asarBackup: asarPath + BACKUP, exeNew: exe + NEW, asarNew: asarPath + NEW };
}

function exeHash(exePath) {
  return findIntegrityArray(fs.readFileSync(exePath)).entry.value;
}

function describe(exePath, asarPath) {
  const archive = asar.openArchive(asarPath);
  const pkg = JSON.parse(asar.readFile(archive, 'package.json').toString('utf8'));
  let config = null;
  if (asar.findEntry(archive.header, CONFIG_NAME)) config = JSON.parse(asar.readFile(archive, CONFIG_NAME).toString('utf8'));
  return { archive, pkg, version: pkg.version, patched: Boolean(config), config, integrityOk: exeHash(exePath) === archive.headerHash };
}

function loadTable() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'core', 'versions.json'), 'utf8'));
}

function anchorsFor(table, version) {
  const picked = pickAnchors(table, version);
  if (picked) return picked;
  const newest = Object.keys(table.versions || {})
    .filter((v) => parseVersion(v))
    .sort((a, b) => compareVersions(parseVersion(b), parseVersion(a)))[0];
  return newest ? { tableVersion: newest, exact: false, anchors: table.versions[newest].anchors } : null;
}

function status(files) {
  const current = describe(files.exe, files.asar);
  const result = {
    exe: files.exe,
    version: current.version,
    patched: current.patched,
    modDir: current.config ? current.config.modDir : null,
    integrityOk: current.integrityOk,
    backups: fs.existsSync(files.exeBackup) && fs.existsSync(files.asarBackup),
    backupVersion: null,
  };
  if (result.backups) {
    try {
      result.backupVersion = describe(files.exeBackup, files.asarBackup).version;
    } catch {
      result.backupVersion = null;
    }
  }
  return result;
}

function prepare(files, modDir) {
  if (!modDir) throw new InstallError('Не указана папка мода (--mod-dir).');
  if (!fs.existsSync(path.join(modDir, 'core', 'host.js'))) throw new InstallError(`В папке мода нет core\\host.js: ${modDir}`);
  for (const file of [files.exeNew, files.asarNew]) fs.rmSync(file, { force: true });

  const current = describe(files.exe, files.asar);
  let source;
  if (current.patched) {
    if (!fs.existsSync(files.exeBackup) || !fs.existsSync(files.asarBackup)) {
      throw new InstallError('Мод уже установлен, но резервных копий штатных файлов нет. Переустановите клиент Яндекс Музыки и запустите установку снова.');
    }
    source = { exe: files.exeBackup, asar: files.asarBackup, ...describe(files.exeBackup, files.asarBackup) };
    if (source.patched || !source.integrityOk) throw new InstallError('Резервные копии не штатные. Переустановите клиент Яндекс Музыки и запустите установку снова.');
    if (source.version !== current.version) throw new InstallError(`Версия резервных копий (${source.version}) не совпадает с установленной (${current.version}).`);
    console.log(`Мод уже установлен, пересобираю из резервных копий (клиент ${source.version}).`);
  } else {
    if (!current.integrityOk) throw new InstallError('Хэш архива не совпадает с записанным в exe: файлы клиента изменены не этим установщиком. Ничего не меняю.');
    source = { exe: files.exe, asar: files.asar, ...current };
  }

  const picked = anchorsFor(loadTable(), source.version);
  if (!picked || !picked.anchors.packageMain) throw new InstallError('Таблица якорей пуста. Ничего не меняю.');
  if (!picked.exact) console.log(`Клиент ${source.version} не проверялся, беру якоря версии ${picked.tableVersion}.`);
  const clientMain = picked.anchors.packageMain;
  if (source.pkg.main !== clientMain) throw new InstallError(`Якорь не найден: точка входа клиента «${source.pkg.main}», ожидалась «${clientMain}». Ничего не меняю.`);
  if (!asar.findEntry(source.archive.header, clientMain.replace(/^\.\//, ''))) throw new InstallError(`Якорь не найден: в архиве нет ${clientMain}. Ничего не меняю.`);

  if (!current.patched) {
    fs.copyFileSync(files.asar, files.asarBackup);
    fs.copyFileSync(files.exe, files.exeBackup);
    console.log('Резервные копии штатных файлов сохранены.');
  }

  const modVersion = JSON.parse(fs.readFileSync(path.join(modDir, 'package.json'), 'utf8')).version;
  const pkg = { ...source.pkg, main: `./${LOADER_NAME}` };
  const config = { modDir, modVersion, clientMain, clientVersion: source.version, installedAt: new Date().toISOString() };
  const headerHash = asar.writePatched(source.archive, files.asarNew, {
    [LOADER_NAME]: fs.readFileSync(path.join(ROOT, 'core', 'loader.js')),
    [CONFIG_NAME]: Buffer.from(JSON.stringify(config, null, 2), 'utf8'),
    'package.json': Buffer.from(JSON.stringify(pkg, null, 2), 'utf8'),
  });

  const exeBuf = fs.readFileSync(source.exe);
  const found = findIntegrityArray(exeBuf);
  found.entry.value = headerHash;
  const json = Buffer.from(JSON.stringify(found.arr), 'utf8');
  if (json.length !== found.raw.length) throw new InstallError('Не удалось записать хэш архива в exe: изменилась длина записи.');
  json.copy(exeBuf, found.start);
  fs.writeFileSync(files.exeNew, exeBuf);

  const check = describe(files.exeNew, files.asarNew);
  if (!check.patched || !check.integrityOk) throw new InstallError('Проверка собранных файлов не прошла. Ничего не меняю.');
  console.log(`Файлы с модом собраны: клиент ${source.version}, мод ${modVersion}, папка мода ${modDir}.`);
}

function check(files) {
  const current = describe(files.exe, files.asar);
  if (!current.integrityOk) throw new InstallError('Хэш архива не совпадает с exe: клиент не запустится. Запустите uninstall.ps1.');
  console.log(current.patched
    ? `Мод установлен: клиент ${current.version}, мод ${current.config.modVersion}, папка мода ${current.config.modDir}.`
    : `Клиент ${current.version} штатный, мода нет.`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const files = clientFiles(options.dir);
  if (options.command === 'status') console.log(JSON.stringify(status(files)));
  else if (options.command === 'prepare') prepare(files, options.modDir);
  else if (options.command === 'check') check(files);
  else throw new InstallError(`Неизвестная команда: ${options.command}`);
}

module.exports = { describe, clientFiles };

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.log(error instanceof InstallError ? error.message : `Ошибка: ${error.stack || error.message}`);
    process.exitCode = 1;
  }
}
