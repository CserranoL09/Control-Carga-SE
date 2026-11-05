import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { VitePWA } from "vite-plugin-pwa";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version ?? "1.0.0"),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    rollupOptions: {
      output: {
        // El lector de imágenes (OCR) va en su propio archivo: no se precachea
        manualChunks: (id) => (id.includes("node_modules/tesseract.js") ? "tesseract" : undefined),
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    tsconfigPaths(),
    // App instalable (PWA)
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      includeAssets: [
        "favicon.ico",
        "apple-touch-icon.png",
        "escudo-seleccion.png",
        "logo se fs.png",
      ],
      manifest: {
        id: "/",
        name: "Control de Carga · Selección Española de Fútbol Sala",
        short_name: "Control Carga",
        description: "Carga, fatiga, recuperación y minutos de la selección",
        lang: "es",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "any",
        theme_color: "#001b36",
        background_color: "#001b36",
        categories: ["sports", "health"],
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // App shell: HTML, JS, CSS, iconos, escudo y fotos de los jugadores
        globPatterns: ["**/*.{js,css,html,ico,png,jpg,jpeg,webp,svg,woff,woff2}"],
        // Copias antiguas de fotos en public/jugadores y el OCR: se guardan al usarse
        globIgnores: ["**/jugadores/**", "**/tesseract-*.js"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: "/index.html",
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Lector de imágenes: archivos de tesseract.js (worker, núcleo y diccionario)
            urlPattern: ({ url }) =>
              url.hostname === "cdn.jsdelivr.net" && /tesseract/.test(url.pathname),
            handler: "CacheFirst",
            options: {
              cacheName: "ocr-tesseract",
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin &&
              (/\/assets\/tesseract-.*\.js$/.test(url.pathname) ||
                url.pathname.startsWith("/jugadores/")),
            handler: "CacheFirst",
            options: { cacheName: "app-extra", expiration: { maxEntries: 120 } },
          },
        ],
      },
    }),
  ],
});
