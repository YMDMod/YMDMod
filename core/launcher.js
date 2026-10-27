'use strict';
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const HOST_PATH = path.join(__dirname, 'host.js');
const WAIT_PORT_MS = 20000;
const WAIT_PAUSE_MS = 8000;
const ALIVE_CHECK_MS = 4000;
const ALREADY_RUNNING = 'Клиент уже запущен с этим профилем, мод в этот раз не подключался. Если в клиенте нет шестерёнки YMDMod, закройте его и запустите лаунчер снова.';

function parseArgs(argv) {
  const options = { lab: false, exe: null, userDataDir: null, addonsDir: path.join(ROOT, 'addons'), keepInspector: false, clientArgs: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--lab') options.lab = true;
    else if (arg === '--keep-inspector') options.keepInspector = true;
    else if (arg === '--client-arg') options.clientArgs.push(argv[++i]);
    else if (arg === '--exe') options.exe = argv[++i];
    else if (arg === '--user-data-dir') options.userDataDir = argv[++i];
    else if (arg === '--addons') options.addonsDir = path.resolve(argv[++i]);
    else throw new Error(`Неизвестный аргумент: ${arg}`);
  }
  return options;
}

function findExe(dir) {
  const name = fs.readdirSync(dir).find((n) => n.toLowerCase().endsWith('.exe') && !n.startsWith('Uninstall'));
  if (!name) throw new Error(`В ${dir} не найден exe клиента`);
  return path.join(dir, name);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitInspector(port, child) {
  const deadline = Date.now() + WAIT_PORT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return { exited: child.exitCode };
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const node = targets.find((t) => t.type === 'node');
      if (node) return { url: node.webSocketDebuggerUrl };
    } catch {
    }
    await sleep(200);
  }
  return { timeout: true };
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const pending = new Map();
    const events = [];
    let nextId = 1;
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      } else if (message.method) {
        for (const listener of events) listener(message);
      }
    });
    ws.addEventListener('open', () => resolve({
      ws,
      call: (method, params = {}) => new Promise((done) => {
        const id = nextId++;
        pending.set(id, done);
        ws.send(JSON.stringify({ id, method, params }));
      }),
      onEvent: (listener) => events.push(listener),
    }));
    ws.addEventListener('error', () => reject(new Error('не удалось подключиться к инспектору')));
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const installDir = options.lab
    ? path.join(ROOT, 'lab', 'YandexMusic')
    : path.join(process.env.LOCALAPPDATA || '', 'Programs', 'YandexMusic');
  const exe = options.exe || findExe(installDir);
  const userDataDir = options.userDataDir || (options.lab ? path.join(ROOT, 'lab', 'profile') : null);
  const port = await freePort();

  const args = [`--inspect-brk=127.0.0.1:${port}`];
  if (userDataDir) args.push(`--user-data-dir=${userDataDir}`);
  args.push(...options.clientArgs);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  console.log(`Запуск: ${exe}${userDataDir ? `, профиль ${userDataDir}` : ''}`);
  const child = spawn(exe, args, { detached: true, stdio: 'ignore', env, windowsHide: false });

  const found = await waitInspector(port, child);
  if (found.exited !== undefined) {
    console.log(found.exited === 0
      ? ALREADY_RUNNING
      : `Клиент завершился с кодом ${found.exited}.`);
    process.exitCode = found.exited === 0 ? 2 : 1;
    return;
  }
  if (found.timeout) {
    child.kill();
    throw new Error('Инспектор клиента не ответил, клиент остановлен. Запустите ещё раз.');
  }

  const session = await connect(found.url);
  let resumed = false;
  try {
    const paused = new Promise((resolve) => {
      session.onEvent((m) => m.method === 'Debugger.paused' && resolve(true));
      setTimeout(() => resolve(false), WAIT_PAUSE_MS);
    });
    await session.call('Runtime.runIfWaitingForDebugger');
    await session.call('Debugger.enable');
    if (!(await paused)) console.log('Пауза старта не пришла, хост подключается без неё.');

    const expression = `process.mainModule.require(${JSON.stringify(HOST_PATH)}).start(${JSON.stringify({ addonsDir: options.addonsDir })})`;
    const result = await session.call('Runtime.evaluate', { expression, returnByValue: true });
    const failure = result.error?.message || result.result?.exceptionDetails?.exception?.description;
    if (failure) console.log(`Хост не подключился, клиент запустится без мода: ${failure}`);
    else console.log(result.result.result.value);
  } finally {
    await session.call('Debugger.resume');
    resumed = true;
    if (options.keepInspector) {
      await session.call('Debugger.disable');
      session.ws.close();
      child.unref();
      console.log(`ОТЛАДКА: инспектор оставлен открытым на 127.0.0.1:${port}`);
      return;
    }
    session.call('Runtime.evaluate', { expression: 'setImmediate(() => process.mainModule.require("inspector").close())' });
    await Promise.race([new Promise((resolve) => session.ws.addEventListener('close', resolve)), sleep(5000)]);
    try {
      session.ws.close();
    } catch {
    }
    if (resumed) child.unref();
  }

  const deadline = Date.now() + ALIVE_CHECK_MS;
  while (Date.now() < deadline && child.exitCode === null) await sleep(200);
  if (child.exitCode !== null) {
    console.log(child.exitCode === 0
      ? ALREADY_RUNNING
      : `Клиент завершился с кодом ${child.exitCode}.`);
    process.exitCode = child.exitCode === 0 ? 2 : 1;
    return;
  }

  try {
    await fetch(`http://127.0.0.1:${port}/json/list`);
    console.log(`ВНИМАНИЕ: порт инспектора ${port} всё ещё открыт.`);
  } catch {
    console.log('Инспектор закрыт, клиент работает с модом.');
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
