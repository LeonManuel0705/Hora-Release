// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

const fs = require('fs');
const os = require('os');
const path = require('path');

const HIDDEN = '--hidden';

function execArgument(value) {
  const quoted = /[\s"'\\><~|&;$*?#()`]/.test(value) ? `"${value.replace(/["`$\\]/g, (char) => `\\${char}`)}"` : value;
  return quoted.replace(/\\/g, '\\\\').replace(/%/g, '%%');
}

function execLine(command, args = []) {
  return [command, ...args].map(execArgument).join(' ');
}

function desktopEntry({ name, command }) {
  return [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${name}`,
    `Exec=${execLine(command, [HIDDEN])}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
}

function autostartFile(appId, env = process.env, home = os.homedir()) {
  const config = env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : path.join(home, '.config');
  return path.join(config, 'autostart', `${appId}.desktop`);
}

function autostartEnabled(text) {
  if (typeof text !== 'string' || !/^\[Desktop Entry\]/m.test(text)) return false;
  const value = (key) => {
    const line = text.split(/\r?\n/).find((entry) => entry.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).trim().toLowerCase() : null;
  };
  return value('Hidden') !== 'true' && value('X-GNOME-Autostart-enabled') !== 'false';
}

// An AppImage runs from a mount that changes with every start; APPIMAGE is the file itself.
function launchCommand(env = process.env, execPath = process.execPath) {
  return env.APPIMAGE && path.isAbsolute(env.APPIMAGE) ? env.APPIMAGE : execPath;
}

function startedHidden(argv = process.argv) {
  return argv.includes(HIDDEN);
}

function createLoginItem({ app, shell, appId, name, platform = process.platform, env = process.env, files = fs }) {
  const windows = { args: [HIDDEN] };
  const file = () => autostartFile(appId, env);

  function state() {
    if (platform === 'linux') {
      let text = null;
      try {
        text = files.readFileSync(file(), 'utf8');
      } catch {}
      return { supported: true, enabled: autostartEnabled(text), pending: false };
    }
    if (platform !== 'win32' && platform !== 'darwin') return { supported: false, enabled: false, pending: false };
    const settings = app.getLoginItemSettings(platform === 'win32' ? windows : undefined);
    const enabled = Boolean(settings.openAtLogin);
    return { supported: true, enabled, pending: platform === 'win32' && enabled && settings.executableWillLaunchAtLogin === false };
  }

  function set(enabled) {
    if (platform === 'linux') {
      const target = file();
      if (!enabled) {
        files.rmSync(target, { force: true });
        return;
      }
      files.mkdirSync(path.dirname(target), { recursive: true });
      const partial = `${target}.tmp`;
      files.writeFileSync(partial, desktopEntry({ name, command: launchCommand(env) }), { mode: 0o644 });
      files.renameSync(partial, target);
      return;
    }
    if (platform === 'win32') app.setLoginItemSettings({ ...windows, openAtLogin: enabled, enabled });
    else if (platform === 'darwin') app.setLoginItemSettings({ openAtLogin: enabled });
  }

  async function openSettings() {
    if (platform !== 'win32') return false;
    try {
      await shell.openExternal('ms-settings:startupapps');
      return true;
    } catch {
      return false;
    }
  }

  return { state, set, openSettings };
}

module.exports = { HIDDEN, autostartEnabled, autostartFile, createLoginItem, desktopEntry, execLine, launchCommand, startedHidden };
