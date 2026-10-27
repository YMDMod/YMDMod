'use strict';
process.noAsar = true;
const path = require('path');
const { CATALOG_URL, loadCatalog, installEntry, installedVersion, isNewer, nodeFetchBytes } = require('../core/addon-installer');
const SYSTEM_ADDONS = require('../core/system-addons.json');

function parseArgs(argv) {
  const options = { addonsDir: null, catalog: CATALOG_URL };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--addons-dir') options.addonsDir = path.resolve(argv[++i]);
    else if (argv[i] === '--catalog') options.catalog = argv[++i];
    else throw new Error(`Неизвестный аргумент: ${argv[i]}`);
  }
  if (!options.addonsDir) throw new Error('Не указана папка аддонов (--addons-dir).');
  return options;
}

async function main() {
  const { addonsDir, catalog: url } = parseArgs(process.argv.slice(2));
  let catalog = null;
  try {
    catalog = await loadCatalog(url, nodeFetchBytes);
  } catch (error) {
    console.log(`Каталог аддонов недоступен: ${error.message}`);
  }

  let missing = 0;
  for (const id of SYSTEM_ADDONS) {
    const installed = installedVersion(addonsDir, id);
    const entry = catalog && catalog.entries.find((e) => e.id === id);
    if (!entry) {
      console.log(installed ? `${id} ${installed}: оставляю установленную версию.` : `${id}: нет в каталоге, не установлен.`);
      if (!installed) missing += 1;
      continue;
    }
    if (installed && !isNewer(entry.version, installed)) {
      console.log(`${id} ${installed}: актуальная версия.`);
      continue;
    }
    try {
      await installEntry(entry, { rawBase: catalog.rawBase, addonsDir, fetchBytes: nodeFetchBytes });
      console.log(`${id}: ${installed ? `обновлён ${installed} -> ${entry.version}` : `установлен ${entry.version}`}.`);
    } catch (error) {
      console.log(`${id}: не установлен — ${error.message}`);
      if (!installed) missing += 1;
    }
  }
  process.exitCode = missing ? 1 : 0;
}

main().catch((error) => {
  console.log(`Ошибка: ${error.message}`);
  process.exitCode = 1;
});
