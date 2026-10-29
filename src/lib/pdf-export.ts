/**
 * Captura un contenedor HTML y lo convierte en un PDF A4 con fondo azul marino.
 *
 * Los saltos de página no cortan bloques: cualquier elemento con el atributo
 * `data-pdf-keep` (tarjetas, gráficas, la tabla completa o cada fila) pasa entero
 * a la página siguiente si no cabe. Un título con `data-pdf-keep-next` viaja
 * siempre junto al bloque que tiene debajo.
 */
import { toCanvas } from "html-to-image";
import { jsPDF } from "jspdf";

export const PDF_BG = "#001b36";

const PAGE_W_MM = 210;
const PAGE_H_MM = 297;
/** Margen superior de las páginas 2 y siguientes, y margen inferior de todas (px CSS) */
const TOP_MARGIN_PX = 40;
const BOTTOM_MARGIN_PX = 24;

/** Espera a que todas las imágenes del contenedor estén cargadas (o hayan fallado). */
export async function waitForImages(el: HTMLElement, timeoutMs = 5000): Promise<void> {
  const imgs = Array.from(el.querySelectorAll("img"));
  const loads = imgs.map((img) =>
    img.complete && img.naturalWidth > 0
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        }).then(() => img.decode?.().catch(() => undefined)),
  );
  await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, timeoutMs))]);
  // Un frame extra para que React pinte el fallback si alguna foto falló
  await new Promise((r) => requestAnimationFrame(() => r(null)));
}

interface Block {
  top: number;
  bottom: number;
}

/** Posiciones (px CSS, relativas al contenedor) de los bloques que no se pueden partir. */
function collectBlocks(el: HTMLElement): Block[] {
  const origin = el.getBoundingClientRect().top;
  const rect = (n: Element) => {
    const r = n.getBoundingClientRect();
    return { top: r.top - origin, bottom: r.bottom - origin };
  };
  const blocks: Block[] = Array.from(el.querySelectorAll("[data-pdf-keep]")).map(rect);

  // Título + bloque siguiente (o, si el bloque es muy alto, título + su primera parte)
  el.querySelectorAll("[data-pdf-keep-next]").forEach((title) => {
    const next = title.nextElementSibling;
    if (!next) return;
    const t = rect(title);
    const n = rect(next);
    blocks.push({ top: t.top, bottom: n.bottom });
    blocks.push({ top: t.top, bottom: Math.min(n.bottom, n.top + 90) });
  });
  return blocks;
}

/** Calcula dónde cortar cada página sin partir ningún bloque que quepa en una página. */
function computePageSlices(
  totalHeight: number,
  pageHeight: number,
  blocks: Block[],
): [number, number][] {
  const slices: [number, number][] = [];
  let start = 0;
  while (start < totalHeight - 1) {
    const isFirst = slices.length === 0;
    const available = pageHeight - BOTTOM_MARGIN_PX - (isFirst ? 0 : TOP_MARGIN_PX);
    const limit = start + available;
    if (limit >= totalHeight) {
      slices.push([start, totalHeight]);
      break;
    }
    let cut = limit;
    let changed = true;
    while (changed) {
      changed = false;
      for (const b of blocks) {
        const fitsInAPage = b.bottom - b.top <= available;
        if (fitsInAPage && b.top > start && b.top < cut && b.bottom > cut) {
          cut = b.top;
          changed = true;
        }
      }
    }
    if (cut - start < 60) cut = limit; // nada razonable que respetar: corte normal
    slices.push([start, cut]);
    start = cut;
  }
  return slices;
}

/** Genera el documento PDF a partir del contenedor del informe. */
export async function buildPdf(el: HTMLElement): Promise<jsPDF> {
  await waitForImages(el);
  const blocks = collectBlocks(el);
  const cssWidth = el.offsetWidth;
  const cssHeight = el.offsetHeight;

  const canvas = await toCanvas(el, {
    backgroundColor: PDF_BG,
    pixelRatio: 2,
    cacheBust: true,
    style: { transform: "scale(1)", transformOrigin: "top left" },
  });
  const scale = canvas.width / cssWidth;
  const pageHeightCss = (cssWidth * PAGE_H_MM) / PAGE_W_MM;
  const slices = computePageSlices(cssHeight, pageHeightCss, blocks);

  const pdf = new jsPDF("p", "mm", "a4");
  const mmPerCss = PAGE_W_MM / cssWidth;

  slices.forEach(([from, to], i) => {
    if (i > 0) pdf.addPage();
    pdf.setFillColor(0, 27, 54);
    pdf.rect(0, 0, PAGE_W_MM, PAGE_H_MM, "F");

    const sliceH = Math.max(1, Math.round((to - from) * scale));
    const page = document.createElement("canvas");
    page.width = canvas.width;
    page.height = sliceH;
    const ctx = page.getContext("2d")!;
    ctx.fillStyle = PDF_BG;
    ctx.fillRect(0, 0, page.width, page.height);
    ctx.drawImage(
      canvas,
      0,
      Math.round(from * scale),
      canvas.width,
      sliceH,
      0,
      0,
      canvas.width,
      sliceH,
    );

    const offsetY = i === 0 ? 0 : TOP_MARGIN_PX * mmPerCss;
    pdf.addImage(
      page.toDataURL("image/jpeg", 0.95),
      "JPEG",
      0,
      offsetY,
      PAGE_W_MM,
      (to - from) * mmPerCss,
    );
  });

  return pdf;
}

/** Descarga el informe como PDF. */
export async function exportElementToPdf(el: HTMLElement, fileName: string): Promise<void> {
  const pdf = await buildPdf(el);
  pdf.save(fileName);
}

/** Devuelve el informe como Blob (para empaquetar varios en un ZIP). */
export async function renderElementToPdfBlob(el: HTMLElement): Promise<Blob> {
  const pdf = await buildPdf(el);
  return pdf.output("blob");
}

/** Descarga un Blob con el nombre indicado. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
