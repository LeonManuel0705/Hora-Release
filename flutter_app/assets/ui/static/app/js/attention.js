const fingers = matchMedia("(hover: none)");

const host = (() => {
  try {
    return window.parent !== window && window.parent.location.origin === location.origin ? window.parent : null;
  } catch {
    return null;
  }
})();

export const weakDevice = () => new URLSearchParams(location.search).has("lite")
  || !!navigator.connection?.saveData
  || (navigator.hardwareConcurrency || 8) <= 2
  || (navigator.deviceMemory || 8) <= 2;

export const attentive = () => document.visibilityState === "visible"
  && (fingers.matches || document.hasFocus() || !!host?.document.hasFocus());

export function onAttention(run) {
  document.addEventListener("visibilitychange", run);
  addEventListener("focus", run);
  addEventListener("blur", run);
  if (!host) return;
  const attach = () => {
    host.addEventListener("focus", run);
    host.addEventListener("blur", run);
  };
  attach();
  addEventListener("pageshow", attach);
  addEventListener("pagehide", () => {
    host.removeEventListener("focus", run);
    host.removeEventListener("blur", run);
  });
}
