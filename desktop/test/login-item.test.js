// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  HIDDEN, autostartEnabled, autostartFile, createLoginItem, desktopEntry, execLine, launchCommand, startedHidden,
} = require('../src/login-item');

test('the autostart command quotes and escapes like the desktop entry spec asks', () => {
  assert.equal(execLine('/usr/bin/app', [HIDDEN]), '/usr/bin/app --hidden');
  assert.equal(execLine('/opt/My App/app', [HIDDEN]), '"/opt/My App/app" --hidden');
  assert.equal(execLine('/opt/100%/app'), '/opt/100%%/app');
  assert.equal(execLine('/home/a "b"/$c/app'), '"/home/a \\\\"b\\\\"/\\\\$c/app"');
});

test('the autostart entry starts the app hidden in the tray', () => {
  const entry = desktopEntry({ name: 'App', command: '/opt/App/app' });
  assert.match(entry, /^\[Desktop Entry\]\n/);
  assert.match(entry, /^Name=App$/m);
  assert.match(entry, /^Exec=\/opt\/App\/app --hidden$/m);
  assert.equal(autostartEnabled(entry), true);
});

test('an autostart entry switched off in the desktop settings counts as off', () => {
  const entry = desktopEntry({ name: 'App', command: '/opt/App/app' });
  assert.equal(autostartEnabled(`${entry}Hidden=true\n`), false);
  assert.equal(autostartEnabled(entry.replace('X-GNOME-Autostart-enabled=true', 'X-GNOME-Autostart-enabled=False')), false);
  assert.equal(autostartEnabled(null), false);
  assert.equal(autostartEnabled('not a desktop file'), false);
});

test('the autostart file follows an absolute XDG_CONFIG_HOME only', () => {
  assert.equal(autostartFile('app.x', { XDG_CONFIG_HOME: '/cfg' }, '/home/a'), path.join('/cfg', 'autostart', 'app.x.desktop'));
  assert.equal(autostartFile('app.x', { XDG_CONFIG_HOME: 'cfg' }, '/home/a'), path.join('/home/a', '.config', 'autostart', 'app.x.desktop'));
  assert.equal(autostartFile('app.x', {}, '/home/a'), path.join('/home/a', '.config', 'autostart', 'app.x.desktop'));
});

test('an AppImage starts itself, not its temporary mount', () => {
  assert.equal(launchCommand({ APPIMAGE: '/home/a/App.AppImage' }, '/tmp/.mount_x/app'), '/home/a/App.AppImage');
  assert.equal(launchCommand({ APPIMAGE: 'App.AppImage' }, '/opt/App/app'), '/opt/App/app');
  assert.equal(launchCommand({}, '/opt/App/app'), '/opt/App/app');
});

test('only a start with the hidden flag counts as a start at login', () => {
  assert.equal(startedHidden(['/opt/App/app', HIDDEN]), true);
  assert.equal(startedHidden(['/opt/App/app']), false);
});

test('on Linux the switch writes and removes the autostart entry', () => {
  const config = fs.mkdtempSync(path.join(os.tmpdir(), 'login-item-'));
  try {
    const item = createLoginItem({ appId: 'app.test', name: 'App', platform: 'linux', env: { XDG_CONFIG_HOME: config, APPIMAGE: '/home/a/App.AppImage' } });
    const file = path.join(config, 'autostart', 'app.test.desktop');
    assert.deepEqual(item.state(), { supported: true, enabled: false, pending: false });
    item.set(true);
    assert.match(fs.readFileSync(file, 'utf8'), /^Exec=\/home\/a\/App\.AppImage --hidden$/m);
    assert.deepEqual(item.state(), { supported: true, enabled: true, pending: false });
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['app.test.desktop']);
    item.set(false);
    assert.equal(fs.existsSync(file), false);
    assert.equal(item.state().enabled, false);
  } finally {
    fs.rmSync(config, { recursive: true, force: true });
  }
});

test('on Windows the switch registers the hidden start and notices a start blocked in Windows', () => {
  const calls = [];
  let settings = { openAtLogin: false, executableWillLaunchAtLogin: false };
  const app = {
    setLoginItemSettings: (options) => calls.push(options),
    getLoginItemSettings: (options) => {
      calls.push({ asked: options });
      return settings;
    },
  };
  const item = createLoginItem({ app, appId: 'app.test', name: 'App', platform: 'win32' });
  item.set(true);
  assert.deepEqual(calls[0], { args: [HIDDEN], openAtLogin: true, enabled: true });
  settings = { openAtLogin: true, executableWillLaunchAtLogin: true };
  assert.deepEqual(item.state(), { supported: true, enabled: true, pending: false });
  assert.deepEqual(calls[1], { asked: { args: [HIDDEN] } });
  settings = { openAtLogin: true, executableWillLaunchAtLogin: false };
  assert.deepEqual(item.state(), { supported: true, enabled: true, pending: true });
  item.set(false);
  assert.deepEqual(calls.at(-1), { args: [HIDDEN], openAtLogin: false, enabled: false });
});

test('Windows opens its own autostart settings, other systems have none to open', async () => {
  const opened = [];
  const shell = { openExternal: async (url) => opened.push(url) };
  assert.equal(await createLoginItem({ shell, appId: 'a', name: 'A', platform: 'win32' }).openSettings(), true);
  assert.deepEqual(opened, ['ms-settings:startupapps']);
  assert.equal(await createLoginItem({ shell, appId: 'a', name: 'A', platform: 'linux' }).openSettings(), false);
});

test('a system without a login item API reports no support', () => {
  assert.deepEqual(createLoginItem({ appId: 'a', name: 'A', platform: 'freebsd' }).state(), { supported: false, enabled: false, pending: false });
});
