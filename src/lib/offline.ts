/**
 * Conexión y datos sin conexión.
 *
 * - fetchAppsScriptJson(): lee el Apps Script (con 8 s de margen). Si va bien, guarda
 *   una copia en la Cache API del navegador; si no hay red o falla, devuelve la última
 *   copia guardada e indica desde cuándo es.
 * - useConnection(): estado para la interfaz (banner "Sin conexión", botones de guardar).
 * - setUnsavedChanges(): avisa de que hay cambios sin guardar (para no actualizar la app
 *   a mitad de introducir minutos).
 * Los envíos (POST) nunca se encolan ni se reintentan solos, para no duplicar datos.
 */
import { useSyncExternalStore } from "react";

const CACHE = "control-carga-datos";
const KEY_URL = "/__datos/apps-script.json";
const KEY_SAVED_AT = "datos-guardados-en";
/**
 * Tiempo máximo de espera al Apps Script con conexión. Google tarda a menudo entre
 * 5 y 15 s (más la primera vez, "arranque en frío"), así que se espera hasta 30 s
 * antes de recurrir a la copia guardada.
 */
const TIMEOUT_MS = 30000;
/** Si se tuvo que usar la copia teniendo conexión, se reintenta solo cada 20 s (3 veces) */
const RETRY_MS = 20000;
const MAX_RETRIES = 3;
const RELOAD_EVENT = "control-carga:recargar-datos";
let retries = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

interface State {
  online: boolean;
  /** Se están mostrando datos guardados (sin conexión o el Sheet no respondió) */
  usingSaved: boolean;
  /** Fecha (ms) de la copia guardada que se muestra */
  savedAt: number | null;
  unsaved: boolean;
}

let state: State = {
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  usingSaved: false,
  savedAt: null,
  unsaved: false,
};
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

if (typeof window !== "undefined") {
  window.addEventListener("online", () => set({ online: true }));
  window.addEventListener("offline", () => set({ online: false }));
}

export function useConnection(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

export const isOffline = () => !state.online;

/** Llamar con `true` mientras haya cambios sin guardar (p. ej. tabla de minutos) */
export function setUnsavedChanges(v: boolean) {
  if (state.unsaved !== v) set({ unsaved: v });
}
export const hasUnsavedChanges = () => state.unsaved;

/**
 * Avisar cuando hay que recargar los datos: al volver la conexión, al pulsar
 * "Reintentar" en el aviso o en los reintentos automáticos.
 */
export function onReconnect(cb: () => void): () => void {
  const h = () => cb();
  window.addEventListener("online", h);
  window.addEventListener(RELOAD_EVENT, h);
  return () => {
    window.removeEventListener("online", h);
    window.removeEventListener(RELOAD_EVENT, h);
  };
}

/** Vuelve a pedir los datos al Google Sheet (botón "Reintentar") */
export function retryNow() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  window.dispatchEvent(new Event(RELOAD_EVENT));
}

function scheduleRetry() {
  if (retryTimer || retries >= MAX_RETRIES || !navigator.onLine) return;
  retries++;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    window.dispatchEvent(new Event(RELOAD_EVENT));
  }, RETRY_MS);
}

async function saveCopy(json: unknown) {
  try {
    const c = await caches.open(CACHE);
    await c.put(
      KEY_URL,
      new Response(JSON.stringify(json), { headers: { "Content-Type": "application/json" } }),
    );
    localStorage.setItem(KEY_SAVED_AT, String(Date.now()));
  } catch {
    /* sin Cache API o sin espacio: la app sigue funcionando sin copia */
  }
}

async function readCopy(): Promise<{ json: unknown; savedAt: number | null } | null> {
  try {
    const c = await caches.open(CACHE);
    const r = await c.match(KEY_URL);
    if (!r) return null;
    const json = await r.json();
    let savedAt: number | null = null;
    try {
      savedAt = Number(localStorage.getItem(KEY_SAVED_AT)) || null;
    } catch {
      /* sin almacenamiento */
    }
    return { json, savedAt };
  } catch {
    return null;
  }
}

/** Evita pedir dos veces lo mismo a la vez (la app lee el Apps Script desde dos sitios) */
const inflight = new Map<string, Promise<unknown>>();

/**
 * GET al Apps Script con copia sin conexión. Lanza un error solo si no hay red
 * y tampoco hay copia guardada.
 */
export function fetchAppsScriptJson<T = Record<string, unknown>>(url: string): Promise<T> {
  const running = inflight.get(url);
  if (running) return running as Promise<T>;
  const p = (async () => {
    try {
      if (!navigator.onLine) throw new Error("Sin conexión");
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(url, { cache: "no-cache", signal: ctrl.signal });
      } finally {
        clearTimeout(t);
      }
      if (!res.ok) throw new Error(`Apps Script GET falló: HTTP ${res.status}`);
      const json = await res.json();
      void saveCopy(json);
      retries = 0;
      set({ usingSaved: false, savedAt: null, online: true });
      return json as T;
    } catch (e) {
      const copy = await readCopy();
      if (copy) {
        console.warn("[datos] No se pudo leer el Google Sheet; se usa la copia guardada:", e);
        set({ usingSaved: true, savedAt: copy.savedAt });
        // Con conexión, probablemente Google tardó demasiado: reintentar en segundo plano
        scheduleRetry();
        return copy.json as T;
      }
      throw e;
    }
  })();
  inflight.set(url, p);
  p.finally(() => setTimeout(() => inflight.delete(url), 0));
  return p;
}

/** "04/11 a las 22:10" */
export function formatSavedAt(ms: number | null): string {
  if (!ms) return "una sesión anterior";
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm} a las ${hh}:${mi}`;
}

export const OFFLINE_SAVE_MSG = "Sin conexión: no se puede guardar";
