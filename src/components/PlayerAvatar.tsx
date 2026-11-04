/**
 * Foto del jugador en toda la app, con un único estilo fijo:
 * PNG recortado en primer plano, sobre una franja dorada ("Busto con franja dorada").
 * Se dibuja en SVG, así se ve igual en la app, en las gráficas (PlayerAvatarSvg)
 * y en el PDF (html-to-image).
 */
import { useEffect, useId, useState } from "react";
import { getPlayerPhoto } from "@/lib/player-photos";

const C = {
  gold1: "#ffd84d",
  gold2: "#e0a800",
  silhouette: "#5a6478",
};

/** Claves de la antigua configuración de fotos (ya no se usan) */
const OLD_KEYS = [
  "jugador-foto-estilo",
  "jugador-foto-estilo-pdf",
  "jugador-foto-encuadre",
  "jugador-foto-tamano",
];

/** Borra de localStorage las preferencias antiguas de fotos */
export function clearOldAvatarPrefs() {
  try {
    for (const k of OLD_KEYS) localStorage.removeItem(k);
  } catch {
    /* sin almacenamiento */
  }
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
  /** Tamaño en px */
  size: number;
  /** Tope en px (p. ej. el alto de la fila de la tabla) */
  max?: number;
  /** Color que sustituye al dorado (p. ej. semáforo de disponibilidad) */
  accent?: string;
  /** Se mantiene por compatibilidad: el estilo es el mismo sobre fondo claro u oscuro */
  theme?: "app" | "pdf";
  className?: string;
  title?: string;
}

const BAND = { y: 64, r: 14 };
/** Zona visible de la figura: todo lo de arriba y, abajo, solo dentro de la franja */
const CLIP = `M0,0 H100 V${100 - BAND.r} Q100,100 ${100 - BAND.r},100 H${BAND.r} Q0,100 0,${100 - BAND.r} Z`;
/** Primer plano: se ve ~66 % del ancho de la foto, centrado en la cabeza */
const ZOOM = 0.66;

function AvatarInner({ name, accent, uid }: { name: string; accent?: string; uid: string }) {
  const src = getPlayerPhoto(name);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const photo = useProcessedPhoto(src && !failed ? src : "");
  const hasPhoto = !!src && !failed;
  const id = (s: string) => `${uid}-${s}`;

  // Posición de la foto en primer plano (mientras se procesa, centrada arriba)
  const W = 100 / ZOOM;
  const headX = photo?.headX ?? 0.5;
  const headTop = photo?.headTop ?? 0.04;
  const cx = Math.min(1 - ZOOM / 2, Math.max(ZOOM / 2, headX));
  const img = {
    x: -(cx - ZOOM / 2) * W,
    y: Math.max(100 - W, -Math.max(0, headTop - 0.04) * W),
    w: W,
    h: W,
  };

  return (
    <>
      <defs>
        <clipPath id={id("clip")}>
          <path d={CLIP} />
        </clipPath>
        <linearGradient id={id("gold")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={C.gold1} />
          <stop offset="1" stopColor={C.gold2} />
        </linearGradient>
      </defs>

      {/* Franja (detrás de la figura) */}
      <rect
        x="0"
        y={BAND.y}
        width="100"
        height={100 - BAND.y}
        rx={BAND.r}
        fill={accent ?? `url(#${id("gold")})`}
      />

      {/* Figura: foto recortada o silueta con iniciales */}
      <g clipPath={`url(#${id("clip")})`}>
        {hasPhoto ? (
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
        )}
      </g>
    </>
  );
}

const svgId = (raw: string) => `pa${raw.replace(/[^a-zA-Z0-9]/g, "")}`;

/** Avatar en HTML (bloque con su propio <svg>) */
export function PlayerAvatar({ name, size, max, accent, className = "", title }: AvatarProps) {
  const s = max ? Math.min(size, max) : size;
  const uid = svgId(useId());
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 100 100"
      className={`shrink-0 overflow-visible ${className}`}
      role="img"
      aria-label={name}
      data-avatar="franja-oro"
      data-frame="cara"
      style={{ display: "block", flexShrink: 0 }}
    >
      {title && <title>{title}</title>}
      <AvatarInner name={name} accent={accent} uid={uid} />
    </svg>
  );
}

/** Avatar dentro de un SVG (eje de una gráfica). (x, y) = esquina superior izquierda */
export function PlayerAvatarSvg({
  name,
  x,
  y,
  size,
}: {
  name: string;
  x: number;
  y: number;
  size: number;
}) {
  const uid = svgId(useId());
  return (
    <svg
      x={x}
      y={y}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      overflow="visible"
      data-avatar="franja-oro"
    >
      <AvatarInner name={name} uid={uid} />
    </svg>
  );
}
