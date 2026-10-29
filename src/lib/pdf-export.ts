/**
 * Captura un contenedor HTML y lo guarda como PDF A4 con fondo azul marino.
 */
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";

export const PDF_BG = "#001b36";

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

export async function exportElementToPdf(el: HTMLElement, fileName: string): Promise<void> {
  await waitForImages(el);
  const dataUrl = await toPng(el, {
    backgroundColor: PDF_BG,
    pixelRatio: 2,
    cacheBust: true,
    style: { transform: "scale(1)", transformOrigin: "top left" },
  });

  const pdf = new jsPDF("p", "mm", "a4");
  const pageWidth = 210;
  const pageHeight = 297;
  const imgHeight = (el.offsetHeight * pageWidth) / el.offsetWidth;

  const paintBackground = () => {
    pdf.setFillColor(0, 27, 54);
    pdf.rect(0, 0, pageWidth, pageHeight, "F");
  };

  let heightLeft = imgHeight;
  let position = 0;
  paintBackground();
  pdf.addImage(dataUrl, "PNG", 0, position, pageWidth, imgHeight);
  heightLeft -= pageHeight;

  while (heightLeft > 0.5) {
    position = heightLeft - imgHeight;
    pdf.addPage();
    paintBackground();
    pdf.addImage(dataUrl, "PNG", 0, position, pageWidth, imgHeight);
    heightLeft -= pageHeight;
  }

  pdf.save(fileName);
}
