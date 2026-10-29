/**
 * Fotos de jugadores para el informe PDF.
 *
 * ── CÓMO AÑADIR O CORREGIR FOTOS (desde la web de GitHub) ─────────────────────
 * 1. Sube la foto a la carpeta  src/assets/jugadores/  (png, jpg, jpeg o webp).
 *    El nombre del archivo no tiene que ser exacto: "Javi M.png" o "javi.jpg" valen.
 * 2. La app busca la foto por el nombre que el jugador escribe en el Form:
 *      - primero en la lista FOTOS_POR_JUGADOR de abajo,
 *      - después un archivo con el mismo nombre,
 *      - y si no, uno cuyo nombre se parezca (p. ej. "DIDAC PLANA" → didac.png).
 * 3. Si un jugador sigue sin foto, añade una línea en FOTOS_POR_JUGADOR con
 *    su nombre tal como aparece en la app y el nombre exacto del archivo.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { players } from "./mock-data";

export const FOTOS_POR_JUGADOR: Record<string, string> = {
  // Ejemplos (quita las dos barras // del principio para activarlos):
  // "DAVID NOVOA": "novoa.png",
  // "PABLO": "pablo-ramirez.png",
  // "ADRIAN": "rivera.png",
};

export const ESCUDO_SRC = "/escudo-seleccion.png";
export const ESCUDO_FALLBACK_SRC = "/logo se fs.png";

/** Todas las fotos de src/assets/jugadores, detectadas automáticamente al compilar. */
const PHOTO_URLS = import.meta.glob("../assets/jugadores/*.{png,jpg,jpeg,webp,PNG,JPG,JPEG,WEBP}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

export function playerSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface PhotoFile {
  file: string; // nombre del archivo tal cual
  slug: string; // nombre normalizado sin extensión
  url: string;
}

const PHOTOS: PhotoFile[] = Object.entries(PHOTO_URLS).map(([path, url]) => {
  const file = path.split("/").pop() ?? path;
  return { file, slug: playerSlug(file.replace(/\.[^.]+$/, "")), url };
});

const words = (slug: string) => slug.split("-").filter(Boolean);

/** Busca una foto cuyo nombre se parezca al del jugador; solo si hay una única candidata. */
function fuzzyMatch(nameSlug: string): PhotoFile | undefined {
  const nameWords = words(nameSlug);
  const candidates = PHOTOS.filter((p) => {
    const pw = words(p.slug);
    if (pw.length === 0) return false;
    // Todas las palabras de la foto aparecen en el nombre ("didac" ⊂ "didac plana")
    // o todas las del nombre aparecen en la foto ("rivera" ⊂ "adrian rivera").
    // Una palabra de una sola letra cuenta como inicial ("javi m" ~ "javi minguez").
    const same = (a: string, b: string) =>
      a === b || (a.length === 1 && b.startsWith(a)) || (b.length === 1 && a.startsWith(b));
    const inName = (w: string) => nameWords.some((n) => same(n, w));
    const inPhoto = (w: string) => pw.some((p2) => same(p2, w));
    // Exigimos al menos una palabra completa en común (una inicial sola no basta)
    const sharesWord = pw.some((w) => w.length > 1 && nameWords.includes(w));
    return sharesWord && (pw.every(inName) || nameWords.every(inPhoto));
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

function byFileName(file: string): PhotoFile | undefined {
  const target = playerSlug(file.replace(/\.[^.]+$/, ""));
  return PHOTOS.find((p) => p.file === file) ?? PHOTOS.find((p) => p.slug === target);
}

/** URL de la foto del jugador, o "" si no se encuentra (el informe muestra el dorsal o las iniciales). */
export function getPlayerPhoto(name: string): string {
  const slug = playerSlug(name);

  const aliasKey = Object.keys(FOTOS_POR_JUGADOR).find((k) => playerSlug(k) === slug);
  if (aliasKey) {
    const p = byFileName(FOTOS_POR_JUGADOR[aliasKey]);
    if (p) return p.url;
  }

  const listed = players.find((p) => playerSlug(p.name) === slug);
  if (listed?.photo) return listed.photo;

  return (PHOTOS.find((p) => p.slug === slug) ?? fuzzyMatch(slug))?.url ?? "";
}
