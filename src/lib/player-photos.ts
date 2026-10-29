/**
 * Fotos de jugadores y escudo para el informe PDF.
 * Las fotos se sirven desde /public/jugadores (mismo dominio → html-to-image las captura sin CORS).
 * Nombre de archivo = nombre del jugador tal como aparece en el Form, en minúsculas,
 * sin acentos y con guiones: "Javi Mínguez" → /jugadores/javi-minguez.png
 */
import { players } from "./mock-data";

export const ESCUDO_SRC = "/escudo-seleccion.png";
export const ESCUDO_FALLBACK_SRC = "/logo se fs.png";

export function playerSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function getPlayerPhoto(name: string): string {
  const listed = players.find((p) => playerSlug(p.name) === playerSlug(name));
  if (listed?.photo) return listed.photo;
  return `/jugadores/${playerSlug(name)}.png`;
}
