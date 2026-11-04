/**
 * Foto del jugador en toda la app: siempre PNG recortado, sin recuadro ni círculo.
 * Estilo, encuadre y tamaño se eligen en Ajustes → "Fotos de los jugadores".
 * Se dibuja en SVG, así se ve igual en la app, en las gráficas (PlayerAvatarSvg)
 * y en el PDF (html-to-image).
 */
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getPlayerPhoto } from "@/lib/player-photos";

// ─── Estilos ──────────────────────────────────────────────────────────────────

export type AvatarStyle =
  | "franja-oro"
  | "franja-roja"
  | "peana"
  | "limpio"
  | "contorno"
  | "fundido";
export type AvatarFrame = "busto" | "cara";
export type AvatarScale = "s" | "m" | "l";

export const AVATAR_STYLES: {
  id: AvatarStyle;
  letter: string;
  label: string;
  hint: string;
  group: "Con busto" | "Sin busto";
}[] = [
  {
    id: "franja-oro",
    letter: "A",
    label: "Busto con franja dorada",
    hint: "La cabeza sobresale de una franja dorada",
    group: "Con busto",
  },
  {
    id: "franja-roja",
    letter: "B",
    label: "Busto con franja roja",
    hint: "Igual, con franja roja de la selección",
    group: "Con busto",
  },
  {
    id: "peana",
    letter: "C",
    label: "Busto sobre peana dorada",
    hint: "Línea dorada fina con sombra suave",
    group: "Con busto",
  },
  {
    id: "limpio",
    letter: "D",
    label: "Recorte limpio con sombra",
    hint: "Solo la figura, con sombra suave",
    group: "Sin busto",
  },
  {
    id: "contorno",
    letter: "E",
    label: "Recorte con contorno dorado",
    hint: "Contorno dorado que sigue la silueta",
    group: "Sin busto",
  },
  {
    id: "fundido",
    letter: "F",
    label: "Recorte fundido",
    hint: "La parte de abajo se funde con el fondo",
    group: "Sin busto",
  },
];

export const FRAME_LABEL: Record<AvatarFrame, string> = { busto: "Busto", cara: "Primer plano" };
export const SCALE_LABEL: Record<AvatarScale, string> = { s: "Pequeño", m: "Mediano", l: "Grande" };
export const SCALE: Record<AvatarScale, number> = { s: 0.85, m: 1, l: 1.2 };

export const C = {
  red: "#c8102e",
  gold: "#f1bf00",
  gold1: "#ffd84d",
  gold2: "#e0a800",
  navy: "#001b36",
  silhouette: "#5a6478",
};

/** Las fotos ya no tienen recuadro: el avatar siempre es cuadrado (ancho = alto) */
export const avatarWidth = (_style: AvatarStyle, size: number) => Math.round(size);

// ─── Preferencias (Ajustes) ───────────────────────────────────────────────────

const KEY = "jugador-foto-estilo";
const KEY_PDF = "jugador-foto-estilo-pdf";
const KEY_FRAME = "jugador-foto-encuadre";
const KEY_SCALE = "jugador-foto-tamano";
const isStyle = (v: unknown): v is AvatarStyle => AVATAR_STYLES.some((s) => s.id === v);

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* sin almacenamiento */
  }
}

interface Prefs {
  style: AvatarStyle;
  pdfStyle: AvatarStyle | "app";
  frame: AvatarFrame;
  scale: AvatarScale;
}

interface StyleCtx extends Prefs {
  setStyle: (s: AvatarStyle) => void;
  setPdfStyle: (s: AvatarStyle | "app") => void;
  setFrame: (f: AvatarFrame) => void;
  setScale: (s: AvatarScale) => void;
  /** Estilo efectivo del PDF */
  pdfEffective: AvatarStyle;
}

const DEFAULT: AvatarStyle = "franja-oro";

/** Lee lo guardado; los estilos antiguos (Escudo, Hexágono…) pasan a A */
function initial(): Prefs {
  const s = read(KEY);
  const p = read(KEY_PDF);
  const f = read(KEY_FRAME);
  const z = read(KEY_SCALE);
  return {
    style: isStyle(s) ? s : DEFAULT,
    pdfStyle: p === "app" || isStyle(p) ? (p as AvatarStyle | "app") : "app",
    frame: f === "cara" ? "cara" : "busto",
    scale: z === "s" || z === "l" ? z : "m",
  };
}

const withSetters = (p: Prefs, set: (x: Partial<Prefs>) => void): StyleCtx => ({
  ...p,
  pdfEffective: p.pdfStyle === "app" ? p.style : p.pdfStyle,
  setStyle: (style) => {
    write(KEY, style);
    set({ style });
  },
  setPdfStyle: (pdfStyle) => {
    write(KEY_PDF, pdfStyle);
    set({ pdfStyle });
  },
  setFrame: (frame) => {
    write(KEY_FRAME, frame);
    set({ frame });
  },
  setScale: (scale) => {
    write(KEY_SCALE, scale);
    set({ scale });
  },
});

const Ctx = createContext<StyleCtx | null>(null);

export function PlayerAvatarStyleProvider({ children }: { children: ReactNode }) {
  const [p, setP] = useState(initial);
  const value = useMemo(() => withSetters(p, (x) => setP((o) => ({ ...o, ...x }))), [p]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Preferencias elegidas en Ajustes (funciona también fuera del proveedor) */
export function usePlayerAvatarStyle(): StyleCtx {
  const ctx = useContext(Ctx);
  return ctx ?? withSetters(initial(), () => {});
}

/** Tamaño final de un avatar: base × tamaño elegido, sin pasar de `max` */
export function useAvatarSize(base: number, max?: number): number {
  const { scale } = usePlayerAvatarStyle();
  const v = Math.round(base * SCALE[scale]);
  return max ? Math.min(v, max) : v;
}

// ─── Recorte del fondo de la foto ─────────────────────────────────────────────
// Las fotos con fondo liso claro se recortan en el navegador (relleno desde los
// bordes) y se suaviza el borde. El archivo original no se modifica. También se
// calcula dónde está la cabeza para el encuadre "Primer plano".

interface Processed {
  url: string;
  /** Centro horizontal de la cabeza y parte de arriba de la figura (0–1) */
  headX: number;
  headTop: number;
}
const processedCache = new Map<string, Processed>();
const pending = new Map<string, Promise<Processed>>();
const N = 320;

function headPosition(d: Uint8ClampedArray): { headX: number; headTop: number } {
  let top = -1;
  for (let y = 0; y < N && top < 0; y++)
    for (let x = 0; x < N; x++)
      if (d[(y * N + x) * 4 + 3] > 60) {
        top = y;
        break;
      }
  if (top < 0) return { headX: 0.5, headTop: 0 };
  let sx = 0;
  let n = 0;
  for (let y = top; y < Math.min(N, top + N * 0.18); y++)
    for (let x = 0; x < N; x++)
      if (d[(y * N + x) * 4 + 3] > 60) {
        sx += x;
        n++;
      }
  return { headX: n ? sx / n / N : 0.5, headTop: top / N };
}

/** Desenfoque 3×3 del canal alfa (borde suave de ~1 px) */
function softenAlpha(d: Uint8ClampedArray) {
  const a = new Uint8ClampedArray(N * N);
  for (let i = 0; i < N * N; i++) a[i] = d[i * 4 + 3];
  for (let y = 1; y < N - 1; y++)
    for (let x = 1; x < N - 1; x++) {
      const i = y * N + x;
      if (
        a[i] === 255 &&
        a[i - 1] === 255 &&
        a[i + 1] === 255 &&
        a[i - N] === 255 &&
        a[i + N] === 255
      )
        continue;
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += a[i + dy * N + dx];
      d[i * 4 + 3] = Math.min(a[i], Math.round(s / 9));
    }
}

function cutOut(img: HTMLImageElement): Processed {
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { url: img.src, headX: 0.5, headTop: 0 };
  ctx.drawImage(img, 0, 0, N, N);
  const data = ctx.getImageData(0, 0, N, N);
  const d = data.data;
  const at = (x: number, y: number) => (y * N + x) * 4;

  // Ya transparente: solo la posición de la cabeza
  if (d[at(2, 2) + 3] < 30 && d[at(N - 3, 2) + 3] < 30) return { url: img.src, ...headPosition(d) };

  // Fondo liso: esquinas de arriba parecidas y claras
  const c1 = [d[at(2, 2)], d[at(2, 2) + 1], d[at(2, 2) + 2]];
  const c2 = [d[at(N - 3, 2)], d[at(N - 3, 2) + 1], d[at(N - 3, 2) + 2]];
  const diff = Math.abs(c1[0] - c2[0]) + Math.abs(c1[1] - c2[1]) + Math.abs(c1[2] - c2[2]);
  const bright = (c1[0] + c1[1] + c1[2]) / 3;
  if (diff > 30 || bright < 150) return { url: img.src, headX: 0.5, headTop: 0.04 };
  const bg = c1.map((v, k) => (v + c2[k]) / 2);
  const dist = (o: number) =>
    Math.abs(d[o] - bg[0]) + Math.abs(d[o + 1] - bg[1]) + Math.abs(d[o + 2] - bg[2]);
  const TOL = 26;
  const EDGE = 56;
  const seen = new Uint8Array(N * N);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= N || y >= N) return;
    const k = y * N + x;
    if (seen[k]) return;
    seen[k] = 1;
    stack.push(k);
  };
  // Semillas: borde superior y laterales (abajo suele estar la camiseta)
  for (let x = 0; x < N; x++) push(x, 0);
  for (let y = 0; y < N * 0.75; y++) {
    push(0, y);
    push(N - 1, y);
  }
  let removed = 0;
  while (stack.length) {
    const k = stack.pop()!;
    const o = k * 4;
    const dd = dist(o);
    const mn = Math.min(d[o], d[o + 1], d[o + 2]);
    const mx = Math.max(d[o], d[o + 1], d[o + 2]);
    // Fondo en degradado: muy claro y sin color, conectado con el borde
    const lightNeutral = mn >= 232 && mx - mn <= 14;
    if (dd > EDGE && !lightNeutral) continue;
    if (dd <= TOL || lightNeutral) {
      d[o + 3] = 0;
      removed++;
      const x = k % N;
      const y = (k - x) / N;
      push(x + 1, y);
      push(x - 1, y);
      push(x, y + 1);
      push(x, y - 1);
    } else {
      d[o + 3] = Math.min(d[o + 3], Math.round(((dd - TOL) / (EDGE - TOL)) * 255));
    }
  }
  if (removed < N * N * 0.08) return { url: img.src, headX: 0.5, headTop: 0.04 };
  softenAlpha(d);
  ctx.putImageData(data, 0, 0);
  return { url: c.toDataURL("image/png"), ...headPosition(d) };
}

function processPhoto(src: string): Promise<Processed> {
  if (processedCache.has(src)) return Promise.resolve(processedCache.get(src)!);
  if (pending.has(src)) return pending.get(src)!;
  const p = new Promise<Processed>((resolve) => {
    const img = new Image();
    img.onload = () => {
      let r: Processed = { url: src, headX: 0.5, headTop: 0.04 };
      try {
        r = cutOut(img);
      } catch {
        /* canvas no disponible */
      }
      processedCache.set(src, r);
      resolve(r);
    };
    img.onerror = () => resolve({ url: src, headX: 0.5, headTop: 0.04 });
    img.src = src;
  });
  pending.set(src, p);
  return p;
}

function useProcessedPhoto(src: string): Processed | null {
  const [v, setV] = useState<Processed | null>(() =>
    src ? (processedCache.get(src) ?? null) : null,
  );
  useEffect(() => {
    if (!src) {
      setV(null);
      return;
    }
    let alive = true;
    processPhoto(src).then((r) => alive && setV(r));
    return () => {
      alive = false;
    };
  }, [src]);
  return v;
}

// ─── Dibujo (viewBox 100 × 100) ───────────────────────────────────────────────

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

export interface AvatarProps {
  name: string;
  /** Tamaño base en px (se multiplica por el tamaño elegido en Ajustes) */
  size: number;
  /** Tope en px (p. ej. el alto de la fila de la tabla) */
  max?: number;
  /** Tamaño exacto, sin aplicar el tamaño de Ajustes (galería de Ajustes) */
  exact?: boolean;
  /** Fuerza un estilo (si no, el de Ajustes) */
  variant?: AvatarStyle;
  /** Fuerza un encuadre (si no, el de Ajustes) */
  frame?: AvatarFrame;
  /** Se mantiene por compatibilidad (el dorsal ya no se dibuja en la foto) */
  dorsal?: string | number;
  /** "pdf": sobre fondo azul marino */
  theme?: "app" | "pdf";
  /** Color que sustituye al dorado/rojo (p. ej. semáforo de disponibilidad) */
  accent?: string;
  /** Usar el estilo del PDF elegido en Ajustes */
  forPdf?: boolean;
  className?: string;
  title?: string;
}

function AvatarInner({
  name,
  size,
  style,
  frame,
  theme = "app",
  accent,
  uid,
}: {
  name: string;
  size: number;
  style: AvatarStyle;
  frame: AvatarFrame;
  theme?: "app" | "pdf";
  accent?: string;
  uid: string;
}) {
  const src = getPlayerPhoto(name);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const photo = useProcessedPhoto(src && !failed ? src : "");
  const hasPhoto = !!src && !failed;
  const px = 100 / size; // 1 px real en unidades del viewBox
  const id = (s: string) => `${uid}-${s}`;
  const gold = accent ?? `url(#${id("gold")})`;
  const solid = accent ?? C.gold;

  // Posición de la foto: busto (foto completa algo ampliada) o primer plano
  const img = (() => {
    if (frame === "cara" && photo) {
      const W = 100 / 0.66;
      const cx = Math.min(0.67, Math.max(0.33, photo.headX));
      const x = -(cx - 0.33) * W;
      const y = Math.max(100 - W, -Math.max(0, photo.headTop - 0.04) * W);
      return { x, y, w: W, h: W };
    }
    return { x: -8, y: 0, w: 116, h: 116 };
  })();

  // Zona visible de la figura según el estilo
  const band = { y: 64, r: 14 };
  const clipPath = (() => {
    switch (style) {
      case "franja-oro":
      case "franja-roja":
        return `M0,0 H100 V${100 - band.r} Q100,100 ${100 - band.r},100 H${band.r} Q0,100 0,${100 - band.r} Z`;
      case "peana":
        return "M0,0 H100 V93 H0 Z";
      default:
        return "M0,0 H100 V100 H0 Z";
    }
  })();

  // Figura: foto recortada o silueta genérica con iniciales
  const figure = hasPhoto ? (
    <image
      href={photo?.url ?? src}
      x={img.x}
      y={img.y}
      width={img.w}
      height={img.h}
      preserveAspectRatio="xMidYMin slice"
      onError={() => setFailed(true)}
      style={{ opacity: photo ? 1 : 0 }}
    />
  ) : (
    <g>
      <ellipse cx="50" cy="36" rx="19" ry="22" fill={C.silhouette} />
      <path d="M8,104 C8,70 26,60 50,60 C74,60 92,70 92,104 Z" fill={C.silhouette} />
      <text
        x="50"
        y="37"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="17"
        fontWeight={700}
        fill="#e6e9f0"
        fontFamily="system-ui, sans-serif"
      >
        {initialsOf(name)}
      </text>
    </g>
  );

  const contourR = Math.max(1.5, size / 22) * px;

  return (
    <>
      <defs>
        <clipPath id={id("clip")}>
          <path d={clipPath} />
        </clipPath>
        <linearGradient id={id("gold")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={C.gold1} />
          <stop offset="1" stopColor={C.gold2} />
        </linearGradient>
        <linearGradient
          id={id("fade")}
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="58"
          x2="0"
          y2="100"
        >
          <stop offset="0" stopColor="#fff" stopOpacity="1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id={id("mask")} maskUnits="userSpaceOnUse" x="-10" y="-10" width="120" height="120">
          <rect x="-10" y="-10" width="120" height="120" fill={`url(#${id("fade")})`} />
        </mask>
        <filter id={id("shadow")} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow
            dx={1 * px}
            dy={2 * px}
            stdDeviation={2 * px}
            floodColor={theme === "pdf" ? "#ffffff" : "#000000"}
            floodOpacity={theme === "pdf" ? 0.28 : 0.45}
          />
        </filter>
        <filter id={id("contour")} x="-20%" y="-20%" width="140%" height="140%">
          <feMorphology in="SourceAlpha" operator="dilate" radius={contourR} result="d" />
          <feFlood floodColor={solid} />
          <feComposite in2="d" operator="in" result="o" />
          <feMerge>
            <feMergeNode in="o" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id={id("blur")} x="-30%" y="-100%" width="160%" height="300%">
          <feGaussianBlur stdDeviation={Math.max(1.5 * px, 3)} />
        </filter>
      </defs>

      {/* Base (detrás de la figura) */}
      {(style === "franja-oro" || style === "franja-roja") && (
        <rect
          x="0"
          y={band.y}
          width="100"
          height={100 - band.y}
          rx={band.r}
          fill={style === "franja-oro" ? gold : (accent ?? C.red)}
        />
      )}
      {style === "peana" && (
        <ellipse
          cx="50"
          cy="93"
          rx="38"
          ry="5"
          fill="#000"
          opacity="0.45"
          filter={`url(#${id("blur")})`}
        />
      )}

      {/* Figura */}
      <g clipPath={`url(#${id("clip")})`}>
        {style === "limpio" ? (
          <g filter={`url(#${id("shadow")})`}>{figure}</g>
        ) : style === "contorno" ? (
          <g filter={`url(#${id("contour")})`}>{figure}</g>
        ) : style === "fundido" ? (
          <g mask={`url(#${id("mask")})`}>{figure}</g>
        ) : (
          figure
        )}
      </g>

      {/* Detalles delante */}
      {style === "peana" && (
        <rect x="10" y="93" width="80" height={Math.max(4, 2 * px)} rx="2" fill={gold} />
      )}
      {accent && (style === "limpio" || style === "fundido") && (
        <rect
          x="15"
          y={100 - Math.max(3, 2 * px)}
          width="70"
          height={Math.max(3, 2 * px)}
          rx="1.5"
          fill={accent}
        />
      )}
    </>
  );
}

const svgId = (raw: string) => `pa${raw.replace(/[^a-zA-Z0-9]/g, "")}`;

/** Avatar en HTML (bloque con su propio <svg>) */
export function PlayerAvatar({
  name,
  size,
  max,
  exact,
  variant,
  frame,
  theme,
  accent,
  forPdf,
  className = "",
  title,
}: AvatarProps) {
  const pref = usePlayerAvatarStyle();
  const style = variant ?? (forPdf ? pref.pdfEffective : pref.style);
  const fr = frame ?? pref.frame;
  const scaled = useAvatarSize(size, max);
  const s = exact ? size : scaled;
  const uid = svgId(useId());
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 100 100"
      className={`shrink-0 overflow-visible ${className}`}
      role="img"
      aria-label={name}
      data-avatar={style}
      data-frame={fr}
      style={{ display: "block", flexShrink: 0 }}
    >
      {title && <title>{title}</title>}
      <AvatarInner
        name={name}
        size={s}
        style={style}
        frame={fr}
        theme={theme}
        accent={accent}
        uid={uid}
      />
    </svg>
  );
}

/** Avatar dentro de un SVG (eje de una gráfica). (x, y) = esquina superior izquierda */
export function PlayerAvatarSvg({
  name,
  x,
  y,
  size,
  variant,
  frame,
}: {
  name: string;
  x: number;
  y: number;
  /** Tamaño final en px (ya escalado) */
  size: number;
  variant?: AvatarStyle;
  frame?: AvatarFrame;
}) {
  const pref = usePlayerAvatarStyle();
  const style = variant ?? pref.style;
  const fr = frame ?? pref.frame;
  const uid = svgId(useId());
  return (
    <svg
      x={x}
      y={y}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      overflow="visible"
      data-avatar={style}
    >
      <AvatarInner name={name} size={size} style={style} frame={fr} uid={uid} />
    </svg>
  );
}
