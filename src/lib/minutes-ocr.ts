/**
 * Lectura de minutos desde una imagen (tabla "TIEMPOS DE PARTICIPACIÓN").
 * El OCR (tesseract.js) se ejecuta en el navegador: la imagen no sale del equipo.
 */
import { parseMinutesInput } from "./minutes";

// ─── Preparar la imagen ───────────────────────────────────────────────────────

const TARGET_W = 2000;
const MAX_W = 2600;

/**
 * Gira la imagen según su EXIF (createImageBitmap con imageOrientation),
 * la pasa a gris con autocontraste y la amplía a ~2000 px de ancho si es pequeña.
 */
export async function prepareImage(file: Blob): Promise<HTMLCanvasElement> {
  let bmp: ImageBitmap | HTMLImageElement;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // Navegadores sin createImageBitmap para este formato: <img> ya respeta el EXIF
    bmp = await new Promise<HTMLImageElement>((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error("No se pudo abrir la imagen"));
      img.src = URL.createObjectURL(file);
    });
  }
  const w0 = bmp.width;
  const h0 = bmp.height;
  const scale = w0 < TARGET_W ? TARGET_W / w0 : w0 > MAX_W ? MAX_W / w0 : 1;
  const w = Math.round(w0 * scale);
  const h = Math.round(h0 * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return canvas;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, w, h);
  if ("close" in bmp) bmp.close();

  // Gris + autocontraste (percentiles 1 % y 99 %)
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const y = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    d[i] = y;
    hist[y]++;
  }
  const n = w * h;
  let lo = 0;
  let hi = 255;
  for (let acc = 0; lo < 255 && (acc += hist[lo]) < n * 0.01; lo++);
  for (let acc = 0; hi > 0 && (acc += hist[hi]) < n * 0.01; hi--);
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / range));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// ─── OCR ──────────────────────────────────────────────────────────────────────

export interface OcrJob {
  promise: Promise<string>;
  cancel: () => void;
}

/** Lanza el OCR (español, PSM 6). onProgress recibe 0–1. */
export function runOcr(
  image: HTMLCanvasElement,
  onProgress: (p: number, label: string) => void,
): OcrJob {
  let worker: { terminate: () => Promise<unknown> } | null = null;
  let cancelled = false;
  const promise = (async () => {
    onProgress(0, "Preparando el lector…");
    const T = await import("tesseract.js");
    if (cancelled) throw new Error("cancelado");
    const w = await T.createWorker("spa", T.OEM.LSTM_ONLY, {
      logger: (m: { status: string; progress: number }) => {
        if (m.status === "recognizing text") onProgress(m.progress, "Leyendo imagen…");
        else if (m.status.includes("loading")) onProgress(0, "Cargando diccionario de español…");
      },
    });
    worker = w;
    if (cancelled) {
      await w.terminate();
      throw new Error("cancelado");
    }
    await w.setParameters({ tessedit_pageseg_mode: T.PSM.SINGLE_BLOCK });
    const { data } = await w.recognize(image);
    await w.terminate();
    worker = null;
    return data.text;
  })();
  return {
    promise,
    cancel: () => {
      cancelled = true;
      worker?.terminate();
    },
  };
}

// ─── Analizar el texto ────────────────────────────────────────────────────────

export interface OcrLine {
  raw: string;
  name: string;
  times: number[];
}

const IGNORE_WORDS = new Set([
  "TOTAL",
  "TOTALES",
  "JUGADOR",
  "JUGADORES",
  "PRIMER",
  "SEGUNDO",
  "PERIODO",
  "MINUTOS",
  "SEGUNDOS",
  "TIEMPOS",
  "PARTICIPACION",
]);

/** Corrige confusiones típicas del OCR dentro de un tiempo y lo pasa a minutos */
export function parseTimeToken(token: string): number | null {
  if (!/\d/.test(token)) return null;
  let t = token
    .replace(/[*•·]+/g, "")
    .replace(/^[^\dOoIlS]+|[^\dOoIlS'"]+$/g, "")
    .replace(/[Oo]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/S/g, "5")
    .replace(/"$/, "");
  // 25'30 → 25:30 ; 25'30" ya sin la comilla final
  t = t.replace(/['´`’]/g, ":");
  // 25.30 → mm.ss si los segundos son < 60 (dos cifras)
  const dot = t.match(/^(\d{1,3})\.(\d{2})$/);
  if (dot && parseInt(dot[2], 10) < 60) t = `${dot[1]}:${dot[2]}`;
  if (!/^\d{1,3}(:\d{1,2}|,\d{1,2}|\.\d{1,2})?$/.test(t)) return null;
  const v = parseMinutesInput(t);
  return v === null || Number.isNaN(v) ? null : v;
}

export const normText = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.\-_'’]/g, " ")
    .replace(/[^A-Za-z0-9ñÑ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

/** Una línea por fila: nombre + tiempos. Ignora cabeceras, TOTAL y líneas sin tiempo. */
export function parseOcrText(text: string): OcrLine[] {
  const out: OcrLine[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const raw = rawLine.trim();
    if (!raw) continue;
    // Dorsal (1–2 cifras) al principio, seguido de letras
    const line = raw.replace(/^\d{1,2}[.)]?\s+(?=\p{L})/u, "");
    const tokens = line.split(/\s+/);
    const times: number[] = [];
    const nameParts: string[] = [];
    for (const tk of tokens) {
      const v = parseTimeToken(tk);
      if (v !== null) times.push(v);
      else if (times.length === 0) nameParts.push(tk);
    }
    if (times.length === 0) continue;
    const name = normText(nameParts.join(" "))
      .replace(/\b\d+\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (name.replace(/ /g, "").length < 2) continue;
    if (name.split(" ").some((w) => IGNORE_WORDS.has(w))) continue;
    out.push({ raw, name, times });
  }
  return out;
}

// ─── Qué contiene cada línea ──────────────────────────────────────────────────

export type Contenido = "auto" | "total" | "p1" | "p2" | "p12" | "p12t";
export const CONTENIDO_LABEL: Record<Contenido, string> = {
  auto: "Detectar automáticamente",
  total: "Solo total",
  p1: "Solo 1ª parte",
  p2: "Solo 2ª parte",
  p12: "1ª y 2ª parte",
  p12t: "1ª, 2ª y total",
};

export interface LineValues {
  p1: number | null;
  p2: number | null;
  total: number | null;
  warning?: string;
}

const TOL = 2 / 60; // ±0:02

export function valuesFor(times: number[], c: Contenido): LineValues {
  const [a, b, t] = times;
  const kind: Contenido =
    c !== "auto" ? c : times.length >= 3 ? "p12t" : times.length === 2 ? "p12" : "total";
  const need = { total: 1, p1: 1, p2: 1, p12: 2, p12t: 3, auto: 1 }[kind];
  const missing = times.length < need ? "Faltan tiempos en la línea" : undefined;
  if (kind === "total") return { p1: null, p2: null, total: times[times.length - 1] ?? null };
  if (kind === "p1") return { p1: a ?? null, p2: null, total: null };
  if (kind === "p2") return { p1: null, p2: a ?? null, total: null };
  if (kind === "p12") return { p1: a ?? null, p2: b ?? null, total: null, warning: missing };
  const v: LineValues = { p1: a ?? null, p2: b ?? null, total: t ?? null, warning: missing };
  if (!missing && Math.abs(a + b - t) > TOL) v.warning = "1ª + 2ª no da el total";
  return v;
}

// ─── Emparejar nombres ────────────────────────────────────────────────────────

export type MatchStatus = "coincide" | "revisar" | "sin";

const ALIAS_KEY = "minutos-ocr-alias";

export function loadAliases(): Record<string, string> {
  try {
    const raw = localStorage.getItem(ALIAS_KEY);
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export function saveAlias(text: string, jugador: string | null) {
  try {
    const all = loadAliases();
    if (jugador) all[normText(text)] = jugador;
    else delete all[normText(text)];
    localStorage.setItem(ALIAS_KEY, JSON.stringify(all));
  } catch {
    /* sin almacenamiento */
  }
}

export function clearAliases() {
  try {
    localStorage.removeItem(ALIAS_KEY);
  } catch {
    /* sin almacenamiento */
  }
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

export function matchName(
  name: string,
  roster: string[],
  aliases: Record<string, string>,
): { jugador: string | null; status: MatchStatus; motivo?: string } {
  const n = normText(name);
  const players = roster.map((j) => ({ j, n: normText(j), words: normText(j).split(" ") }));
  const words = n.split(" ").filter((w) => w.length >= 4);

  // 1. Alias recordado
  const alias = aliases[n];
  if (alias) {
    const p = players.find((x) => x.n === normText(alias));
    if (p) return { jugador: p.j, status: "coincide", motivo: "alias recordado" };
  }
  // 2. Nombre completo
  const exact = players.find((x) => x.n === n);
  if (exact) return { jugador: exact.j, status: "coincide" };
  // 3. Una palabra igual a una palabra de un solo jugador
  const byWord = new Set(
    players.filter((x) => words.some((w) => x.words.includes(w))).map((x) => x.j),
  );
  if (byWord.size === 1) return { jugador: [...byWord][0], status: "coincide" };
  if (byWord.size > 1) return { jugador: null, status: "sin", motivo: "varios candidatos" };
  // 4. Una palabra que es el principio de una palabra de un solo jugador
  const byPrefix = new Set(
    players
      .filter((x) =>
        words.some((w) => x.words.some((pw) => pw.length > w.length && pw.startsWith(w))),
      )
      .map((x) => x.j),
  );
  if (byPrefix.size === 1)
    return { jugador: [...byPrefix][0], status: "revisar", motivo: "nombre parecido" };
  if (byPrefix.size > 1) return { jugador: null, status: "sin", motivo: "varios candidatos" };
  // 5. Parecido (Levenshtein ≤ 2, ≥ 5 letras)
  if (n.replace(/ /g, "").length >= 5) {
    const near = players.filter(
      (x) =>
        levenshtein(n, x.n) <= 2 ||
        words.some((w) => w.length >= 5 && x.words.some((pw) => levenshtein(w, pw) <= 2)),
    );
    if (near.length === 1)
      return { jugador: near[0].j, status: "revisar", motivo: "nombre parecido" };
    if (near.length > 1) return { jugador: null, status: "sin", motivo: "varios candidatos" };
  }
  return { jugador: null, status: "sin" };
}
