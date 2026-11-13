/**
 * App instalable (PWA): estado de instalación y de actualizaciones.
 * El aviso del navegador para instalar (beforeinstallprompt) llega muy pronto,
 * por eso se escucha aquí desde el arranque (ver initPwa en main.tsx).
 */
import { useSyncExternalStore } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface PwaState {
  /** La app se está usando instalada (ventana propia / pantalla de inicio) */
  installed: boolean;
  /** El navegador ofrece instalar con su propio diálogo (Chrome, Edge, Android) */
  canPrompt: boolean;
  /** Hay una versión nueva lista para cargar */
  needRefresh: boolean;
}

let deferred: BeforeInstallPromptEvent | null = null;
let registration: ServiceWorkerRegistration | undefined;
let updater: ((reload?: boolean) => Promise<void>) | null = null;

const standalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true);

let state: PwaState = { installed: standalone(), canPrompt: false, needRefresh: false };
const listeners = new Set<() => void>();
const set = (p: Partial<PwaState>) => {
  state = { ...state, ...p };
  listeners.forEach((l) => l());
};

export function usePwa(): PwaState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

export function initPwa() {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    set({ canPrompt: true });
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    set({ installed: true, canPrompt: false });
  });
  window
    .matchMedia?.("(display-mode: standalone)")
    .addEventListener?.("change", (e) => set({ installed: e.matches }));
}

/** Abre el diálogo de instalación del navegador. Devuelve false si no está disponible. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  set({ canPrompt: false, installed: outcome === "accepted" || state.installed });
  return true;
}

export type Platform = "ios" | "mac-safari" | "android" | "desktop";

export function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  const iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/.test(ua) || iPadOS) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|Edg|Firefox/.test(ua))
    return "mac-safari";
  return "desktop";
}

// ─── Actualizaciones (lo rellena UpdatePrompt con useRegisterSW) ─────────────

export function setPwaRegistration(
  r: ServiceWorkerRegistration | undefined,
  update: (reload?: boolean) => Promise<void>,
) {
  registration = r;
  updater = update;
}

export function setNeedRefresh(v: boolean) {
  if (state.needRefresh !== v) set({ needRefresh: v });
}

export function applyUpdate() {
  return updater?.(true);
}

/** Busca una versión nueva. Devuelve true si la hay. */
export async function checkForUpdate(): Promise<boolean | null> {
  if (!registration) return null;
  await registration.update();
  // Si hay una nueva, el service worker queda "esperando" y useRegisterSW avisa
  await new Promise((r) => setTimeout(r, 1500));
  return !!registration.waiting || state.needRefresh;
}

export const APP_VERSION = __APP_VERSION__;
export const BUILD_TIME = __BUILD_TIME__;
