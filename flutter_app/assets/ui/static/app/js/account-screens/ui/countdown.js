// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

export function countdown(until, { onTick, onDone }) {
  let deadline = until;
  let timer = 0;
  let stopped = false;

  const tick = () => {
    if (stopped) return;
    const remaining = Math.ceil((deadline - Date.now()) / 1000);
    if (remaining <= 0) {
      stopped = true;
      onTick(0);
      onDone?.();
      return;
    }
    onTick(remaining);
    const wait = (deadline - Date.now()) % 1000 || 1000;
    timer = setTimeout(tick, Math.max(60, wait));
  };

  tick();

  return {
    restart(next) {
      clearTimeout(timer);
      deadline = next;
      stopped = false;
      tick();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
