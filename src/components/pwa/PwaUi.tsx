/**
 * Piezas visibles de la app instalable:
 * - <UpdatePrompt />: avisa de una versión nueva (no actualiza a mitad de introducir minutos).
 * - <InstallButton />: botón "Instalar app" del menú lateral, con pasos para Safari.
 * - <OfflineBanner />: "Sin conexión · mostrando datos del …".
 * - <AppInfoSettings />: sección "Aplicación" de Ajustes.
 */
import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { Download, RefreshCw, Share, SquarePlus, WifiOff } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  APP_VERSION,
  BUILD_TIME,
  applyUpdate,
  checkForUpdate,
  detectPlatform,
  promptInstall,
  setNeedRefresh,
  setPwaRegistration,
  usePwa,
  type Platform,
} from "@/lib/pwa";
import { formatSavedAt, hasUnsavedChanges, retryNow, useConnection } from "@/lib/offline";

const UPDATE_TOAST = "pwa-update";

// ─── Aviso de actualización ───────────────────────────────────────────────────

export function UpdatePrompt() {
  const { unsaved } = useConnection();
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, r) {
      setPwaRegistration(r, updateServiceWorker);
      // Buscar versiones nuevas cada hora mientras la app está abierta
      if (r) setInterval(() => r.update().catch(() => {}), 60 * 60 * 1000);
    },
  });

  useEffect(() => {
    setNeedRefresh(needRefresh);
    if (!needRefresh) return;
    toast("Hay una versión nueva de la app", {
      id: UPDATE_TOAST,
      duration: Infinity,
      description: unsaved
        ? "Guarda antes de actualizar: tienes minutos sin guardar."
        : "Actualiza para cargar los últimos cambios.",
      action: {
        label: "Actualizar",
        onClick: () => {
          if (hasUnsavedChanges()) {
            toast.warning("Guarda antes de actualizar", {
              description: "Tienes minutos sin guardar en la tabla.",
            });
            return;
          }
          updateServiceWorker(true);
        },
      },
    });
  }, [needRefresh, unsaved, updateServiceWorker]);

  return null;
}

// ─── Botón "Instalar app" ────────────────────────────────────────────────────

export function InstallButton() {
  const { installed } = usePwa();
  const [help, setHelp] = useState<Platform | null>(null);
  if (installed) return null;

  async function onClick() {
    const shown = await promptInstall();
    if (!shown) setHelp(detectPlatform());
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md border border-sidebar-border text-xs font-medium text-sidebar-foreground hover:bg-sidebar-accent/60 transition-colors"
      >
        <Download className="size-3.5" /> Instalar app
      </button>
      <InstallHelp platform={help} onClose={() => setHelp(null)} />
    </>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 items-start">
      <span className="size-6 shrink-0 rounded-full bg-primary text-primary-foreground grid place-items-center text-xs font-bold">
        {n}
      </span>
      <span className="text-sm pt-0.5">{children}</span>
    </li>
  );
}

function InstallHelp({ platform, onClose }: { platform: Platform | null; onClose: () => void }) {
  return (
    <Dialog open={!!platform} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Instalar Control de Carga</DialogTitle>
          <DialogDescription>
            Tendrás la app con su icono y en su propia ventana. Se actualiza sola.
          </DialogDescription>
        </DialogHeader>
        {platform === "ios" && (
          <ol className="space-y-3">
            <Step n={1}>
              Abre esta página en <b>Safari</b>.
            </Step>
            <Step n={2}>
              Pulsa <Share className="inline size-4 -mt-0.5" /> <b>Compartir</b> (abajo en el
              iPhone, arriba en el iPad).
            </Step>
            <Step n={3}>
              Elige <SquarePlus className="inline size-4 -mt-0.5" />{" "}
              <b>Añadir a pantalla de inicio</b> y pulsa <b>Añadir</b>.
            </Step>
          </ol>
        )}
        {platform === "mac-safari" && (
          <ol className="space-y-3">
            <Step n={1}>
              En la barra de menús de Safari, abre <b>Archivo</b>.
            </Step>
            <Step n={2}>
              Elige <b>Añadir al Dock…</b> y pulsa <b>Añadir</b>.
            </Step>
          </ol>
        )}
        {(platform === "desktop" || platform === "android") && (
          <ol className="space-y-3">
            <Step n={1}>
              {platform === "android" ? (
                <>
                  En Chrome, abre el menú <b>⋮</b> de arriba a la derecha.
                </>
              ) : (
                <>
                  En Chrome o Edge, pulsa el icono <Download className="inline size-4 -mt-0.5" /> de
                  la barra de direcciones (a la derecha) o abre el menú <b>⋮</b>.
                </>
              )}
            </Step>
            <Step n={2}>
              Elige <b>Instalar aplicación</b> (o <b>Añadir a pantalla de inicio</b>) y confirma.
            </Step>
            <li className="text-xs text-muted-foreground">
              Si no aparece la opción, puede que ya esté instalada: búscala en tus aplicaciones.
            </li>
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Banner sin conexión ─────────────────────────────────────────────────────

export function OfflineBanner() {
  const { online, usingSaved, savedAt } = useConnection();
  if (online && !usingSaved) return null;
  const text = !online
    ? usingSaved
      ? `Sin conexión · mostrando datos del ${formatSavedAt(savedAt)}`
      : "Sin conexión · no se puede guardar hasta que vuelva la red"
    : `Google Sheets no responde · mostrando datos del ${formatSavedAt(savedAt)}`;
  return (
    <div
      role="status"
      data-testid="offline-banner"
      className="flex items-center justify-center gap-2 px-4 py-1 text-xs font-medium bg-[#f1bf00] text-[#001b36]"
    >
      <WifiOff className="size-3.5" /> {text}
      {online && (
        <button
          type="button"
          onClick={retryNow}
          className="ml-2 underline underline-offset-2 font-semibold hover:opacity-80"
        >
          Reintentar
        </button>
      )}
    </div>
  );
}

// ─── Ajustes → Aplicación ────────────────────────────────────────────────────

export function AppInfoSettings() {
  const { installed } = usePwa();
  const [checking, setChecking] = useState(false);
  const built = new Date(BUILD_TIME);

  async function check() {
    setChecking(true);
    try {
      const r = await checkForUpdate();
      if (r === null)
        toast.info("Las actualizaciones automáticas no están activas en este navegador.");
      else if (r) {
        toast("Hay una versión nueva de la app", {
          action: { label: "Actualizar", onClick: () => applyUpdate() },
        });
      } else toast.success("Tienes la última versión");
    } catch {
      toast.error("No se pudo comprobar (¿sin conexión?)");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="rounded-lg border bg-card p-5 space-y-4" data-testid="app-info">
      <h3 className="text-sm font-medium">Aplicación</h3>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Estado</dt>
        <dd className="font-medium">{installed ? "Instalada" : "En el navegador"}</dd>
        <dt className="text-muted-foreground">Versión</dt>
        <dd className="font-medium tabular-nums">{APP_VERSION}</dd>
        <dt className="text-muted-foreground">Última actualización</dt>
        <dd className="font-medium">
          {built.toLocaleDateString("es-ES")} a las{" "}
          {built.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
        </dd>
      </dl>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={check}
          disabled={checking}
          className="text-xs flex items-center gap-1.5 px-3 py-2 rounded-md border hover:bg-accent disabled:opacity-50"
        >
          <RefreshCw className={`size-3.5 ${checking ? "animate-spin" : ""}`} /> Buscar
          actualización
        </button>
        {!installed && <InstallButtonInline />}
      </div>
    </div>
  );
}

function InstallButtonInline() {
  const [help, setHelp] = useState<Platform | null>(null);
  return (
    <>
      <button
        type="button"
        onClick={async () => {
          if (!(await promptInstall())) setHelp(detectPlatform());
        }}
        className="text-xs flex items-center gap-1.5 px-3 py-2 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90"
      >
        <Download className="size-3.5" /> Instalar app
      </button>
      <InstallHelp platform={help} onClose={() => setHelp(null)} />
    </>
  );
}
