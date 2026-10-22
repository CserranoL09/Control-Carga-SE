import { useEffect, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { getLoadThresholds, saveLoadThresholds } from "@/lib/store";
import {
  getAppsScriptUrl,
  saveAppsScriptUrl,
  getSheetsCsvUrl,
  saveSheetsCsvUrl,
  testAppsScriptConnection,
  type ConnectionStatus,
} from "@/lib/config";
import { toast } from "sonner";

// ─── Small status badge ────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: ConnectionStatus | null }) {
  if (!status) return null;
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
        status.ok
          ? "bg-green-100 text-green-700"
          : "bg-red-100 text-red-700"
      }`}
    >
      {status.ok ? "✓ Conectado" : `✗ ${status.error ?? "Error"}`}
    </span>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function Ajustes() {
  // Thresholds
  const [optimo, setOptimo] = useState(400);
  const [moderado, setModerado] = useState(600);

  // Google integration URLs
  const [appsScriptUrl, setAppsScriptUrl] = useState("");
  const [sheetsCsvUrl, setSheetsCsvUrl] = useState("");

  // Connection test state
  const [testing, setTesting] = useState(false);
  const [connStatus, setConnStatus] = useState<ConnectionStatus | null>(null);

  useEffect(() => {
    document.title = "Ajustes · SE-FS Load";
    const thresholds = getLoadThresholds();
    setOptimo(thresholds.optimo);
    setModerado(thresholds.moderado);
    setAppsScriptUrl(getAppsScriptUrl());
    setSheetsCsvUrl(getSheetsCsvUrl());
  }, []);

  // ── Thresholds save ──────────────────────────────────────────────────────────
  const handleSaveThresholds = () => {
    if (optimo <= 0 || moderado <= 0) {
      toast.error("Los umbrales deben ser mayores que cero.");
      return;
    }
    if (optimo >= moderado) {
      toast.error("El umbral óptimo debe ser menor que el moderado.");
      return;
    }
    saveLoadThresholds({ optimo, moderado });
    toast.success("Umbrales de carga guardados correctamente.");
  };

  // ── Google URLs save ─────────────────────────────────────────────────────────
  const handleSaveUrls = () => {
    const trimmedScript = appsScriptUrl.trim();
    const trimmedCsv = sheetsCsvUrl.trim();

    if (trimmedScript && !trimmedScript.startsWith("https://script.google.com/macros/s/")) {
      toast.error("La URL de Apps Script no parece válida. Debe empezar por https://script.google.com/macros/s/…");
      return;
    }

    if (
      trimmedCsv &&
      !trimmedCsv.includes("docs.google.com/spreadsheets") &&
      !trimmedCsv.includes("output=csv")
    ) {
      toast.error("La URL de Google Sheets no parece válida. Pega la URL de la hoja publicada.");
      return;
    }

    if (trimmedScript) saveAppsScriptUrl(trimmedScript);
    if (trimmedCsv) saveSheetsCsvUrl(trimmedCsv);
    setConnStatus(null); // reset previous test result
    toast.success("URLs guardadas. Puedes probar la conexión ahora.");
  };

  // ── Connection test ──────────────────────────────────────────────────────────
  const handleTestConnection = async () => {
    setTesting(true);
    setConnStatus(null);
    try {
      const result = await testAppsScriptConnection();
      setConnStatus(result);
      if (result.ok) {
        toast.success("Conexión con Google Sheets correcta ✓");
      } else {
        toast.error(`No se pudo conectar: ${result.error}`);
      }
    } finally {
      setTesting(false);
    }
  };

  return (
    <AppLayout>
      <div className="px-8 py-8 max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ajustes</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configuración de umbrales, alertas e integración con Google Sheets.
          </p>
        </div>

        {/* ── Thresholds ─────────────────────────────────────────────────────── */}
        <div className="rounded-lg border bg-card p-5 space-y-5">
          <h3 className="text-sm font-medium">Umbrales de carga (UA por sesión)</h3>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full" style={{ background: "var(--success)" }} />
                <div>
                  <div className="text-sm font-medium">Óptimo</div>
                  <div className="text-xs text-muted-foreground">UA por debajo de…</div>
                </div>
              </div>
              <input
                type="number"
                value={optimo}
                onChange={(e) => setOptimo(parseInt(e.target.value, 10) || 0)}
                className="w-24 px-2 py-1 rounded-md border bg-background text-sm text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full" style={{ background: "var(--warning)" }} />
                <div>
                  <div className="text-sm font-medium">Moderado</div>
                  <div className="text-xs text-muted-foreground">UA entre óptimo y…</div>
                </div>
              </div>
              <input
                type="number"
                value={moderado}
                onChange={(e) => setModerado(parseInt(e.target.value, 10) || 0)}
                className="w-24 px-2 py-1 rounded-md border bg-background text-sm text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="flex items-center justify-between opacity-80">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full" style={{ background: "var(--danger)" }} />
                <div>
                  <div className="text-sm font-medium">Riesgo</div>
                  <div className="text-xs text-muted-foreground">UA por encima de {moderado}</div>
                </div>
              </div>
              <div className="w-24 px-2 py-1 text-sm text-right tabular-nums text-muted-foreground bg-muted/20 border rounded-md select-none">
                &gt; {moderado}
              </div>
            </div>
          </div>

          <div className="pt-2 border-t flex justify-end">
            <button
              onClick={handleSaveThresholds}
              className="text-xs font-semibold px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/95 rounded-md shadow-sm transition-colors"
            >
              Guardar umbrales
            </button>
          </div>
        </div>

        {/* ── Google Sheets integration ───────────────────────────────────────── */}
        <div className="rounded-lg border bg-card p-5 space-y-5">
          <div>
            <h3 className="text-sm font-medium">Integración con Google Sheets</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Conecta la aplicación con tu hoja de cálculo para leer y escribir datos de convocatorias,
              sesiones y respuestas de jugadores.
            </p>
          </div>

          {/* Apps Script URL */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">
              URL de la Web App (Apps Script)
            </label>
            <p className="text-xs text-muted-foreground">
              La obtienes en Google Sheets → Extensiones → Apps Script → Implementar → Administrar implementaciones.
            </p>
            <input
              type="url"
              value={appsScriptUrl}
              onChange={(e) => {
                setAppsScriptUrl(e.target.value);
                setConnStatus(null);
              }}
              placeholder="https://script.google.com/macros/s/…/exec"
              className="w-full px-3 py-2 rounded-md border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary font-mono text-xs"
            />
          </div>

          {/* Sheets CSV URL */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">
              URL de la hoja publicada (CSV — para leer respuestas)
            </label>
            <p className="text-xs text-muted-foreground">
              En Google Sheets → Archivo → Compartir → Publicar en la web → selecciona la hoja de respuestas del formulario (por ej. &quot;Respuestas de formulario 1&quot;) y formato &quot;CSV&quot; → Publicar. Copia la URL resultante.
            </p>
            <input
              type="url"
              value={sheetsCsvUrl}
              onChange={(e) => {
                setSheetsCsvUrl(e.target.value);
                setConnStatus(null);
              }}
              placeholder="https://docs.google.com/spreadsheets/d/e/…/pub?output=csv"
              className="w-full px-3 py-2 rounded-md border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary font-mono text-xs"
            />
          </div>

          <div className="pt-2 border-t flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {testing && (
                <span className="text-xs text-muted-foreground animate-pulse">
                  Probando conexión…
                </span>
              )}
              <StatusBadge status={connStatus} />
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleTestConnection}
                disabled={testing}
                className="text-xs px-3 py-2 rounded-md border hover:bg-accent disabled:opacity-50 transition-colors"
              >
                {testing ? "Probando…" : "Probar conexión"}
              </button>
              <button
                onClick={handleSaveUrls}
                disabled={testing}
                className="text-xs font-semibold px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/95 rounded-md shadow-sm disabled:opacity-50 transition-colors"
              >
                Guardar URLs
              </button>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
