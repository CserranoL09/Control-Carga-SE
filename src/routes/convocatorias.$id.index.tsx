import { useParams, Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { useCallUpDashboard } from "@/hooks/useLoadData";
import {
  saveSession, deleteSession, updateSession, SESSION_TYPES, type StoredSession, type SessionType, type DayLabel, getLoadThresholds,
  updateCallUp, type StoredCallUp, savePlayerResponse, deletePlayerResponse,
} from "@/lib/store";
import { avg, acwrStatus, uaStatus, statusColor, calcACWRSeries } from "@/lib/metrics";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ReferenceArea, ReferenceLine, Cell,
  ComposedChart, LabelList,
} from "recharts";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Download, RefreshCw, Plus, Trash2, Loader2, Users, Pencil, Check, X, Copy } from "lucide-react";
import { toBlob, toPng } from "html-to-image";
import { toast } from "sonner";
import { jsPDF } from "jspdf";
import { PlayerReportPDF } from "@/components/PlayerReportPDF";
import { getPlayerPhoto } from "@/lib/player-photos";
import { exportElementToPdf, renderElementToPdfBlob, downloadBlob } from "@/lib/pdf-export";
import JSZip from "jszip";
import { MinutosTab } from "@/components/MinutosTab";
import { ZScoreTab } from "@/components/ZScoreTab";
import { formatMinutes, playerMinutesSummary } from "@/lib/minutes";
import type { StoredMinutes } from "@/lib/store";
import { players as allPlayers } from "@/lib/mock-data";

const normalizeName = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();

type Tab = "resumen" | "sesiones" | "minutos" | "fatiga" | "carga" | "zscore" | "jugadores";

const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--popover-foreground)",
};

export default function ConvocatoriaPage() {
  const { id } = useParams<{ id: string }>();
  const {
    callUp,
    sessions,
    responses,
    sessionMetrics,
    acwrSeries,
    acwrSeriesRpe,
    players,
    playerMetrics,
    minutes,
    minutesSupported,
    loading,
    error,
    refresh,
    updateResponseLocally,
    updateSessionLocally
  } = useCallUpDashboard(id);
  const [tab, setTab] = useState<Tab>("resumen");
  const [sessionRefreshKey, setSessionRefreshKey] = useState(0);
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([]);
  const { optimo, moderado } = getLoadThresholds();
  const [exportingPlayer, setExportingPlayer] = useState<string | null>(null);
  const [isBulkExporting, setIsBulkExporting] = useState(false);

  useEffect(() => {
    document.title = callUp ? `${callUp.name} · SE-FS Load` : "Convocatoria · SE-FS Load";
  }, [callUp]);

  function refreshAll() {
    refresh();
    setSessionRefreshKey((k) => k + 1);
  }

  const safeFileName = (s: string) => s.replace(/\s+/g, "_").replace(/[\\/:*?"<>|]/g, "");
  const reportFileName = (playerName: string) =>
    `Reporte_Carga_${safeFileName(playerName)}_${safeFileName(callUp?.name ?? "")}.pdf`;

  /** Genera el PDF de un jugador. Con `asBlob` lo devuelve en vez de descargarlo. */
  async function generatePlayerPDF(playerName: string): Promise<void>;
  async function generatePlayerPDF(playerName: string, asBlob: true): Promise<Blob | null>;
  async function generatePlayerPDF(playerName: string, asBlob = false): Promise<Blob | null | void> {
    setExportingPlayer(playerName);
    // Wait for Recharts SVG to render with animations disabled
    await new Promise((resolve) => setTimeout(resolve, 500));

    const elementId = `pdf-report-${playerName.replace(/\s+/g, "-")}`;
    const el = document.getElementById(elementId);
    if (!el) {
      toast.error(`No se encontró el contenedor de reporte para ${playerName}`);
      setExportingPlayer(null);
      return asBlob ? null : undefined;
    }

    try {
      if (asBlob) return await renderElementToPdfBlob(el);
      await exportElementToPdf(el, reportFileName(playerName));
    } catch (error) {
      console.error("Error generating PDF:", error);
      toast.error(`Error al generar el PDF de ${playerName}`);
      throw error;
    } finally {
      setExportingPlayer(null);
    }
  }

  async function handleBulkExport() {
    setIsBulkExporting(true);
    const targetPlayers = selectedPlayers.length === 0 ? players : selectedPlayers;
    
    if (targetPlayers.length === 0) {
      toast.error("No hay jugadores para exportar");
      setIsBulkExporting(false);
      return;
    }

    // Un solo jugador: descarga directa del PDF
    if (targetPlayers.length === 1) {
      try {
        await generatePlayerPDF(targetPlayers[0]);
      } finally {
        setIsBulkExporting(false);
      }
      return;
    }

    // Varios jugadores: un único ZIP con una carpeta que contiene todos los PDF
    const folderName = `Informes_${safeFileName(callUp?.name ?? "Convocatoria")}`;
    const zip = new JSZip();
    const folder = zip.folder(folderName)!;
    const toastId = toast.loading(`Generando informes: 0 de ${targetPlayers.length}...`);

    try {
      let ok = 0;
      for (let i = 0; i < targetPlayers.length; i++) {
        const pName = targetPlayers[i];
        toast.loading(`Generando informe de ${pName} (${i + 1}/${targetPlayers.length})...`, { id: toastId });
        const blob = await generatePlayerPDF(pName, true);
        if (blob) {
          folder.file(reportFileName(pName), blob);
          ok++;
        }
      }
      toast.loading("Comprimiendo carpeta...", { id: toastId });
      const zipBlob = await zip.generateAsync({ type: "blob" });
      downloadBlob(zipBlob, `${folderName}.zip`);
      toast.success(`Carpeta descargada con ${ok} informes PDF`, { id: toastId });
    } catch (err) {
      console.error("Bulk export error:", err);
      toast.error("Hubo un error durante la exportación masiva", { id: toastId });
    } finally {
      setIsBulkExporting(false);
      setExportingPlayer(null);
    }
  }

  // ─── Filter logic ────────────────────────────────────────────────────────
  // selectedPlayers=[] means "Equipo" (all). Otherwise filter to chosen players.
  const activePlayers = selectedPlayers.length === 0 ? players : selectedPlayers;

  const filteredSessionMetrics = sessionMetrics.map((sm) => {
    if (selectedPlayers.length === 0) return sm;
    // Recalculate per-session metrics restricted to selected players
    const filteredFatigues = activePlayers
      .map((p) => sm.playerFatigue[p])
      .filter((v): v is number => v !== undefined);
    const filteredRPEs = activePlayers
      .map((p) => sm.playerRPE[p])
      .filter((v): v is number => v !== undefined);
    const fatigaMedia = filteredFatigues.length > 0
      ? +(filteredFatigues.reduce((a, b) => a + b, 0) / filteredFatigues.length).toFixed(2)
      : 0;
    const rpeMedia = filteredRPEs.length > 0
      ? +(filteredRPEs.reduce((a, b) => a + b, 0) / filteredRPEs.length).toFixed(2)
      : 0;
    const fatigaXTiempo = +(fatigaMedia * sm.duration).toFixed(0);
    const rpeXTiempo = +(rpeMedia * sm.duration).toFixed(0);
    const playerFatigue = Object.fromEntries(activePlayers.map((p) => [p, sm.playerFatigue[p]]).filter(([, v]) => v !== undefined));
    const playerRPE = Object.fromEntries(activePlayers.map((p) => [p, sm.playerRPE[p]]).filter(([, v]) => v !== undefined));
    const playerUA = Object.fromEntries(activePlayers.map((p) => [p, sm.playerUA[p]]).filter(([, v]) => v !== undefined));
    const playerRpeUA = Object.fromEntries(activePlayers.map((p) => [p, sm.playerRpeUA[p]]).filter(([, v]) => v !== undefined));
    return { ...sm, fatigaMedia, rpeMedia, fatigaXTiempo, rpeXTiempo, responseCount: filteredFatigues.length, playerFatigue, playerRPE, playerUA, playerRpeUA };
  });

  const completedFilteredSessionMetrics = filteredSessionMetrics.filter((s) => s.duration > 0);
  const filteredAcwrSeries = calcACWRSeries(completedFilteredSessionMetrics.map((s) => ({ date: s.date, ua: s.fatigaXTiempo })));
  const filteredAcwrSeriesRpe = calcACWRSeries(completedFilteredSessionMetrics.map((s) => ({ date: s.date, ua: s.rpeXTiempo })));

  const filteredPlayerMetrics = selectedPlayers.length === 0
    ? playerMetrics
    : playerMetrics.filter((p) => selectedPlayers.includes(p.jugador));
  // ─────────────────────────────────────────────────────────────────────────

  if (!callUp && !loading) {
    return (
      <AppLayout>
        <div className="p-10 text-muted-foreground">Convocatoria no encontrada.</div>
      </AppLayout>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "resumen", label: "Resumen" },
    { id: "sesiones", label: "Sesiones" },
    { id: "minutos", label: "Minutos partido" },
    { id: "fatiga", label: "Control de Fatiga" },
    { id: "carga", label: "Control de Carga" },
    { id: "zscore", label: "Z-Score" },
    { id: "jugadores", label: "Jugadores" },
  ];

  return (
    <AppLayout>
      <div className="px-8 py-6 border-b">
        <div className="flex items-end justify-between">
          <div>
            <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">← Convocatorias</Link>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">{callUp?.name ?? "…"}</h1>
            {callUp && (
              <p className="text-sm text-muted-foreground">
                {callUp.startDate} → {callUp.endDate} · {callUp.location}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
            {players.length > 0 && (
              <PlayerFilter
                players={players}
                selected={selectedPlayers}
                onChange={setSelectedPlayers}
              />
            )}
            {players.length > 0 && (
              <button
                onClick={handleBulkExport}
                disabled={isBulkExporting || exportingPlayer !== null}
                className="text-xs flex items-center gap-1.5 px-3 py-2 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90 disabled:opacity-50 cursor-pointer"
                title="Exportar reportes PDF de jugadores"
              >
                {isBulkExporting ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Download className="size-3.5" />
                )}
                <span>
                  {selectedPlayers.length > 0
                    ? `Exportar PDFs (${selectedPlayers.length})`
                    : "Exportar PDFs (Todos)"}
                </span>
              </button>
            )}
            {callUp && (
              <EditarConvocatoriaDialog callUp={callUp} onUpdated={refreshAll} />
            )}
            <button
              onClick={refreshAll}
              className="text-xs flex items-center gap-1.5 px-3 py-2 rounded-md border hover:bg-accent"
              title="Refrescar datos del formulario"
            >
              <RefreshCw className="size-3.5" /> Sincronizar
            </button>
            {/* <button className="text-xs flex items-center gap-1.5 px-3 py-2 rounded-md border hover:bg-accent">
              <Download className="size-3.5" /> Exportar CSV
            </button> */}
          </div>
        </div>
        <div className="mt-5 flex gap-1 -mb-6">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm border-b-2 transition-colors ${tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-8 py-6 space-y-6">
        {error && (
          <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-xs text-yellow-700 dark:text-yellow-300 flex items-center gap-2">
            <AlertTriangle className="size-4 shrink-0" />
            No se pudo conectar con Google Sheets. Mostrando datos en caché. ({error})
          </div>
        )}

        {loading ? (
          <SyncingOverlay />
        ) : (
          <>
            {tab === "resumen" && callUp && (
              <ResumenTab
                sessionMetrics={filteredSessionMetrics}
                acwrSeries={filteredAcwrSeries}
                acwrSeriesRpe={filteredAcwrSeriesRpe}
                players={activePlayers}
                playerMetrics={filteredPlayerMetrics}
                sessions={sessions}
                onSessionUpdated={refreshAll}
                onResponseUpdated={refreshAll}
                updateResponseLocally={updateResponseLocally}
                updateSessionLocally={updateSessionLocally}
              />
            )}
            {tab === "sesiones" && callUp && (
              <SesionesTab
                callUpId={callUp.id}
                sessions={sessions}
                key={sessionRefreshKey}
                onChanged={refreshAll}
              />
            )}
            {tab === "minutos" && callUp && (
              <MinutosTab
                callUpId={callUp.id}
                sessions={sessions}
                players={players}
                minutes={minutes}
                minutesSupported={minutesSupported}
                onSaved={refreshAll}
              />
            )}
            {tab === "fatiga" && (
              <ControlFatigaTab
                sessionMetrics={filteredSessionMetrics.filter((s) => s.duration > 0)}
                acwrSeries={filteredAcwrSeries}
              />
            )}
            {tab === "carga" && (
              <ControlCargaTab
                sessionMetrics={filteredSessionMetrics.filter((s) => s.duration > 0)}
                acwrSeries={filteredAcwrSeriesRpe}
              />
            )}
            {tab === "zscore" && callUp && (
              <ZScoreTab
                sessionMetrics={sessionMetrics}
                minutes={minutes}
                players={activePlayers}
                callUpName={callUp.name}
                copyButton={(targetId) => <CopyPNGButton targetId={targetId} />}
              />
            )}
            {tab === "jugadores" && (
              <JugadoresTab
                players={players}
                playerMetrics={filteredPlayerMetrics}
                sessions={sessions}
                minutes={minutes}
                onExportPDF={generatePlayerPDF}
                exportingPlayer={exportingPlayer}
                isDisabled={isBulkExporting || exportingPlayer !== null}
              />
            )}
          </>
        )}
      </div>
      {exportingPlayer && callUp && (
        <PlayerReportPDF
          jugador={exportingPlayer}
          callUp={callUp}
          sessions={sessions}
          responses={responses}
          minutes={minutes}
          optimo={optimo}
          moderado={moderado}
          containerId={`pdf-report-${exportingPlayer.replace(/\s+/g, "-")}`}
        />
      )}
    </AppLayout>
  );
}

// ─── Custom tooltips ──────────────────────────────────────────────────────────

/** Shared tooltip container style */
const TT_STYLE: React.CSSProperties = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--popover-foreground)",
  padding: "8px 12px",
  minWidth: 160,
};

function TTRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 3 }}>
      <span style={{ color: "var(--muted-foreground)" }}>{label}</span>
      <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 500, color: color ?? "var(--popover-foreground)" }}>
        {value}
      </span>
    </div>
  );
}

function TTDivider() {
  return <div style={{ borderTop: "1px solid var(--border)", margin: "5px 0" }} />;
}

function FatigaTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const fatiga = payload.find((p) => p.name === "Fatiga");
  const rpe = payload.find((p) => p.name === "RPE");
  const fatVal = fatiga?.value ?? 0;
  const fatColor = fatVal >= 7 ? "var(--danger)" : fatVal >= 4 ? "var(--warning)" : "var(--success)";

  return (
    <div style={TT_STYLE}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{label}</div>
      {fatiga && <TTRow label="Fatiga media" value={fatVal.toFixed(1)} color={fatColor} />}
      {rpe && <TTRow label="RPE medio" value={rpe.value.toFixed(1)} />}
    </div>
  );
}

function UATooltip({ active, payload, label, optimo, moderado }: {
  active?: boolean;
  payload?: Array<{ payload: { label: string; ua: number; fatigaMedia: number; duration: number; tipo: string } }>;
  label?: string;
  optimo: number;
  moderado: number;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const uaColor = d.ua >= moderado ? "var(--danger)" : d.ua >= optimo ? "var(--warning)" : "var(--success)";

  return (
    <div style={TT_STYLE}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{label ?? d.label}</div>
      <TTRow label="Tipo" value={d.tipo} />
      <TTRow label="Fatiga media" value={d.fatigaMedia.toFixed(1)} />
      <TTRow label="Tiempo" value={`${d.duration} min`} />
      <TTDivider />
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
        <span style={{ color: "var(--muted-foreground)" }}>UA (F × T)</span>
        <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, color: uaColor }}>
          {d.ua}
        </span>
      </div>
    </div>
  );
}

function UATooltipCarga({ active, payload, label, optimo, moderado }: {
  active?: boolean;
  payload?: Array<{ payload: { label: string; ua: number; rpeMedia: number; duration: number; tipo: string } }>;
  label?: string;
  optimo: number;
  moderado: number;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const uaColor = d.ua >= moderado ? "var(--danger)" : d.ua >= optimo ? "var(--warning)" : "var(--success)";

  return (
    <div style={TT_STYLE}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{label ?? d.label}</div>
      <TTRow label="Tipo" value={d.tipo} />
      <TTRow label="RPE medio" value={d.rpeMedia.toFixed(1)} />
      <TTRow label="Tiempo" value={`${d.duration} min`} />
      <TTDivider />
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
        <span style={{ color: "var(--muted-foreground)" }}>UA (RPE × T)</span>
        <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, color: uaColor }}>
          {d.ua}
        </span>
      </div>
    </div>
  );
}

function ACWRTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ payload: { label: string; acwr: number; aguda: number; cronica: number } }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const ratio = d.acwr;
  const ratioColor =
    ratio >= 0.8 && ratio <= 1.3
      ? "var(--success)"
      : ratio > 1.3 && ratio <= 1.5
        ? "var(--warning)"
        : "var(--danger)";

  return (
    <div
      style={{
        background: "var(--popover)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        fontSize: 12,
        color: "var(--popover-foreground)",
        padding: "8px 12px",
        minWidth: 160,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 6, color: "var(--popover-foreground)" }}>
        {label ?? d.label}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 3 }}>
        <span style={{ color: "var(--muted-foreground)" }}>Fatiga Aguda</span>
        <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>{d.aguda} UA</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 6 }}>
        <span style={{ color: "var(--muted-foreground)" }}>Fatiga Crónica</span>
        <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>{d.cronica} UA</span>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 16,
          paddingTop: 6,
          borderTop: "1px solid var(--border)",
        }}
      >
        <span style={{ color: "var(--muted-foreground)" }}>Ratio A:C</span>
        <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, color: ratioColor }}>
          {ratio.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

function formatDateESZeroPadded(dateStr: string): string {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
}

// ─── Syncing overlay ─────────────────────────────────────────────────────────


function SyncingOverlay() {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
      <div className="relative size-14">
        <div className="absolute inset-0 rounded-full border-4 border-muted" />
        <div className="absolute inset-0 rounded-full border-4 border-primary border-t-transparent animate-spin" />
      </div>
      <div>
        <p className="text-sm font-medium">Sincronizando con Google Sheets…</p>
        <p className="text-xs text-muted-foreground mt-1">
          Cargando sesiones, convocatorias y respuestas del formulario.
        </p>
      </div>
    </div>
  );
}

// ─── Resumen tab ──────────────────────────────────────────────────────────────

function ResumenTab({
  sessionMetrics,
  acwrSeries,
  acwrSeriesRpe,
  players,
  playerMetrics,
  sessions,
  onSessionUpdated,
  onResponseUpdated,
  updateResponseLocally,
  updateSessionLocally,
}: {
  sessionMetrics: ReturnType<typeof useCallUpDashboard>["sessionMetrics"];
  acwrSeries: ReturnType<typeof useCallUpDashboard>["acwrSeries"];
  acwrSeriesRpe: ReturnType<typeof useCallUpDashboard>["acwrSeries"];
  players: string[];
  playerMetrics: ReturnType<typeof useCallUpDashboard>["playerMetrics"];
  sessions: StoredSession[];
  onSessionUpdated?: () => void;
  onResponseUpdated?: () => void;
  updateResponseLocally: (jugador: string, fecha: string, fatigue: number | null, rpe: number | null) => void;
  updateSessionLocally: (sessionId: string, duration: number) => void;
}) {
  const { optimo, moderado } = getLoadThresholds();

  // Exclude sessions with 0 duration for team summary metrics and charts
  const completedMetrics = sessionMetrics.filter((s) => s.duration > 0);
  const teamFatMedia = avg(completedMetrics.map((s) => s.fatigaMedia));
  const teamRpeMedia = avg(completedMetrics.map((s) => s.rpeMedia));
  const teamUATotal = completedMetrics.reduce((a, b) => a + b.fatigaXTiempo, 0);
  const lastACWR = acwrSeries[acwrSeries.length - 1];
  const acwr = lastACWR?.acwr ?? 0;

  const highFatigueAlerts = playerMetrics.filter((p) => p.ratioACWR > 1.5);

  // Vista del resumen (Fatiga / Carga), recordada entre visitas
  const [vista, setVistaState] = useState<"fatiga" | "carga">(() => {
    try {
      return localStorage.getItem("resumen-vista") === "carga" ? "carga" : "fatiga";
    } catch {
      return "fatiga";
    }
  });
  const setVista = (v: "fatiga" | "carga") => {
    setVistaState(v);
    try {
      localStorage.setItem("resumen-vista", v);
    } catch {
      /* sin almacenamiento */
    }
  };

  return (
    <>
      {/* 4 Cards de metricas */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Fatiga Media Equipo" value={teamFatMedia.toFixed(1)} hint="Escala 1–10" />
        <MetricCard label="RPE Medio Equipo" value={teamRpeMedia.toFixed(1)} hint="Escala 1–10" />
        <MetricCard label="Carga Total (UA)" value={Math.round(teamUATotal).toLocaleString()} hint={`${completedMetrics.length} sesiones`} />
        <MetricCard
          label="Ratio ACWR Equipo"
          value={acwr.toFixed(2)}
          tone={acwrStatus(acwr)}
          hint="Óptimo: 0.8–1.3"
        />
      </div>

      {players.length === 0 && (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Sin respuestas del formulario en este rango de fechas. Los jugadores aparecerán aquí cuando respondan.
        </div>
      )}

      {/* Row de notificacion alerta */}
      {highFatigueAlerts.length > 0 && (
        <div className="rounded-lg border border-[color:var(--danger)]/40 bg-[color:var(--danger)]/10 p-4">
          <div className="flex items-center gap-2 text-[color:var(--danger)] text-sm font-medium">
            <AlertTriangle className="size-4" /> {highFatigueAlerts.length} jugador(es) con ratio ACWR {">"} 1.5: {highFatigueAlerts.map((p) => p.jugador).join(", ")}
          </div>
        </div>
      )}

      {/* Selector de vista: Fatiga / Carga */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="inline-flex rounded-md border p-0.5 bg-muted/30" role="group" aria-label="Vista del resumen">
            {(["fatiga", "carga"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setVista(v)}
                aria-pressed={vista === v}
                className={`px-4 py-1.5 text-sm rounded font-medium transition-colors ${
                  vista === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {v === "fatiga" ? "Fatiga" : "Carga"}
              </button>
            ))}
          </div>
          {players.length > 0 && <CopyPNGButton targetId={`heatmap-${vista}-table`} />}
        </div>
        {players.length === 0 ? (
          <p className="text-xs text-muted-foreground py-8 text-center border rounded-lg bg-card">Sin datos de formulario.</p>
        ) : (
          <FatigaHeatmap
            key={vista}
            mode={vista}
            id={`heatmap-${vista}-table`}
            players={players}
            sessionMetrics={sessionMetrics}
            acwrSeries={vista === "carga" ? acwrSeriesRpe : acwrSeries}
            sessions={sessions}
            onSessionUpdated={onSessionUpdated}
            onResponseUpdated={onResponseUpdated}
            updateResponseLocally={updateResponseLocally}
            updateSessionLocally={updateSessionLocally}
          />
        )}
      </div>

      {vista === "fatiga" ? (
        <>
        <Panel
          id="control-fatiga-panel"
          title="Control de Fatiga por sesión (UA = Fatiga × Tiempo)"
          action={<CopyPNGButton targetId="control-fatiga-panel" />}
        >
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={completedMetrics.map((s) => ({
              label: s.date.slice(5),
              ua: s.fatigaXTiempo,
              fatigaMedia: s.fatigaMedia,
              duration: s.duration,
              tipo: s.type,
            }))}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
              <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
              <Tooltip content={<UATooltip optimo={optimo} moderado={moderado} />} />
              <ReferenceLine y={optimo} stroke="var(--warning)" strokeDasharray="4 4" />
              <ReferenceLine y={moderado} stroke="var(--danger)" strokeDasharray="4 4" />
              <Bar dataKey="ua" radius={[4, 4, 0, 0]} name="UA">
                {completedMetrics.map((s, i) => (
                  <Cell key={i} fill={statusColor(uaStatus(s.fatigaXTiempo))} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>
          <AcwrEvolutionPanel
            id="acwr-panel"
            title="Evolución de Fatiga Aguda, Crónica y Ratio A:C (2-5)"
            label="FATIGA"
            series={acwrSeries}
            sessionMetrics={sessionMetrics}
          />
        </>
      ) : (
        <>
        <Panel
          id="control-carga-panel"
          title="Control de Carga por sesión (UA = RPE × Tiempo)"
          action={<CopyPNGButton targetId="control-carga-panel" />}
        >
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={completedMetrics.map((s) => ({
              label: s.date.slice(5),
              ua: s.rpeXTiempo,
              rpeMedia: s.rpeMedia,
              duration: s.duration,
              tipo: s.type,
            }))}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
              <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
              <Tooltip content={<UATooltipCarga optimo={optimo} moderado={moderado} />} />
              <ReferenceLine y={optimo} stroke="var(--warning)" strokeDasharray="4 4" />
              <ReferenceLine y={moderado} stroke="var(--danger)" strokeDasharray="4 4" />
              <Bar dataKey="ua" radius={[4, 4, 0, 0]} name="UA">
                {completedMetrics.map((s, i) => (
                  <Cell key={i} fill={statusColor(uaStatus(s.rpeXTiempo))} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>
          <AcwrEvolutionPanel
            id="acwr-carga-panel"
            title="Evolución de Carga Aguda, Crónica y Ratio A:C (2-5)"
            label="CARGA"
            series={acwrSeriesRpe}
            sessionMetrics={sessionMetrics}
          />
        </>
      )}
    </>
  );
}

/** Gráfica de evolución Aguda / Crónica / Ratio A:C, para fatiga o para carga. */
function AcwrEvolutionPanel({
  id,
  title,
  label,
  series,
  sessionMetrics,
}: {
  id: string;
  title: string;
  /** "FATIGA" o "CARGA" (leyendas de las barras) */
  label: string;
  series: ReturnType<typeof useCallUpDashboard>["acwrSeries"];
  sessionMetrics: ReturnType<typeof useCallUpDashboard>["sessionMetrics"];
}) {
  return (
    <Panel
      id={id}
      title={title}
      action={<CopyPNGButton targetId={id} />}
    >
      <ResponsiveContainer width="100%" height={400}>
        <ComposedChart
          data={series.map((s) => {
            const session = sessionMetrics.find((sm) => sm.date === s.date);
            const label = formatDateESZeroPadded(s.date) + (session?.dayLabel ? ` ${session.dayLabel}` : "");
            return {
              label,
              aguda: Math.round(s.aguda),
              cronica: Math.round(s.cronica),
              acwr: s.acwr,
              valorBajo: 0.8,
              valorAlto: 1.5,
            };
          })}
          margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
        >
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
          <YAxis
            yAxisId="left"
            domain={[0, (max: number) => Math.max(1250, Math.ceil(max / 250) * 250)]}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
          <YAxis
            yAxisId="right"
            orientation="right"
            domain={[0.0, 1.5]}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            tickFormatter={(v) => v.toFixed(2).replace('.', ',')}
          />
          <Tooltip content={<ACWRTooltip />} />
          <Legend
            verticalAlign="top"
            height={36}
            wrapperStyle={{ fontSize: 11, fontWeight: "bold" }}
          />
          <Bar yAxisId="left" dataKey="aguda" fill="#ff0000" name={`${label} AGUDA`} barSize={35}>
            <LabelList dataKey="aguda" position="inside" fill="#ffffff" fontSize={11} fontWeight="bold" />
          </Bar>
          <Bar yAxisId="left" dataKey="cronica" fill="#2f5597" name={`${label} CRÓNICA`} barSize={35}>
            <LabelList dataKey="cronica" position="inside" fill="#ffffff" fontSize={11} fontWeight="bold" />
          </Bar>
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="acwr"
            stroke="#ffffff"
            strokeWidth={2}
            dot={{ r: 4, fill: "#ffffff", stroke: "#ffffff" }}
            name="RATIO A:C (2-5)"
          >
            <LabelList
              dataKey="acwr"
              position="top"
              formatter={(v: number) => v.toFixed(2).replace('.', ',')}
              fontSize={11}
              fontWeight="bold"
              fill="#ffffff"
              offset={10}
            />
          </Line>
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="valorBajo"
            stroke="#2ebb5c"
            strokeDasharray="5 5"
            strokeWidth={2}
            dot={false}
            activeDot={false}
            name="VALOR BAJO"
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="valorAlto"
            stroke="#ef4444"
            strokeDasharray="5 5"
            strokeWidth={2}
            dot={false}
            activeDot={false}
            name="VALOR ALTO"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </Panel>
  );
}

// ─── Sesión type badge helper ──────────────────────────────────────────────────

function getSessionTypeBadge(type: SessionType) {
  const styles: Record<SessionType, string> = {
    "PARTIDO": "bg-rose-500/10 text-rose-600 dark:text-rose-450 border border-rose-500/20",
    "TEC-TAC": "bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20",
    "FÍSICO": "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20",
    "LIBRE": "bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20",
    "GYM+TEC-TAC": "bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20",
    "FÍSICO+TEC-TAC": "bg-amber-500/10 text-amber-600 dark:text-amber-450 border border-amber-500/20",
    "FÍSICO+PARTIDO": "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400 border border-fuchsia-500/20",
    "TEC-TAC+TEC-TAC": "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20",
    "ACTIVACIÓN": "bg-yellow-500/10 text-yellow-600 dark:text-yellow-450 border border-yellow-500/20",
    "REGENERATIVO": "bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20",
  };
  const cls = styles[type] || "bg-muted text-muted-foreground border";
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${cls}`}>
      {type}
    </span>
  );
}

// ─── Sesiones tab ─────────────────────────────────────────────────────────────

function SesionesTab({ callUpId, sessions, onChanged }: {
  callUpId: string; sessions: StoredSession[]; onChanged: () => void;
}) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Inline editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editDayLabelSelect, setEditDayLabelSelect] = useState<string>("single");
  const [editType, setEditType] = useState<SessionType>("TEC-TAC");
  const [editDuration, setEditDuration] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  function startEdit(s: StoredSession) {
    setEditingId(s.id);
    setEditDate(s.date);
    setEditDayLabelSelect(s.dayLabel === "" ? "single" : s.dayLabel);
    setEditType(s.type);
    setEditDuration(s.duration === 0 ? "" : String(s.duration));
  }

  async function handleSave(s: StoredSession) {
    if (!editDate) return;
    setSavingId(s.id);
    try {
      const dayLabel: DayLabel = editDayLabelSelect === "single" ? "" : (editDayLabelSelect as DayLabel);
      const duration = editDuration ? parseInt(editDuration, 10) : 0;
      await updateSession({ ...s, date: editDate, dayLabel, type: editType, duration });
      setEditingId(null);
      onChanged();
    } catch (e) {
      alert(`Error al guardar sesión: ${e}`);
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("¿Eliminar esta sesión?")) return;
    setDeletingId(id);
    try {
      await deleteSession(id);
      onChanged();
    } catch (e) {
      alert(`Error al eliminar sesión: ${e}`);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <h3 className="text-sm font-medium">Sesiones de trabajo</h3>
        <NuevaSesionDialog callUpId={callUpId} onCreated={onChanged} />
      </div>
      {sessions.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">
          No hay sesiones. Usa "+ Añadir sesión" para registrar los entrenamientos.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[650px] table-fixed">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-3 py-2 w-[160px]">Fecha</th>
                <th className="text-left font-medium px-3 py-2 w-[150px]">Día</th>
                <th className="text-left font-medium px-3 py-2 w-[170px]">Tipo</th>
                <th className="text-left font-medium px-3 py-2 w-[110px]">Duración (min)</th>
                <th className="text-left font-medium px-3 py-2 w-[80px]"></th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => {
                const isEditing = editingId === s.id;
                return (
                  <tr
                    key={s.id}
                    onClick={() => !isEditing && startEdit(s)}
                    className={`border-t hover:bg-muted/20 align-middle ${!isEditing ? "cursor-pointer" : ""}`}
                  >
                    {isEditing ? (
                      <>
                        <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                          <Input
                            type="date"
                            value={editDate}
                            onChange={(e) => setEditDate(e.target.value)}
                            className="h-8 py-1 text-xs w-full"
                          />
                        </td>
                        <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                          <Select value={editDayLabelSelect} onValueChange={setEditDayLabelSelect}>
                            <SelectTrigger className="h-8 text-xs w-full"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="single">Dia (único)</SelectItem>
                              <SelectItem value="M">Dia M (Mañana)</SelectItem>
                              <SelectItem value="T">Dia T (Tarde)</SelectItem>
                              <SelectItem value="M-T">Dia M-T (Mañana-Tarde)</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                          <Select value={editType} onValueChange={(v) => setEditType(v as SessionType)}>
                            <SelectTrigger className="h-8 text-xs w-full"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {SESSION_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                          <Input
                            type="number"
                            min={1}
                            max={240}
                            placeholder="Ej. 75"
                            value={editDuration}
                            onChange={(e) => setEditDuration(e.target.value)}
                            className="h-8 py-1 text-xs w-full"
                          />
                        </td>
                        <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => handleSave(s)}
                              disabled={savingId === s.id || !editDate}
                              className="p-1 rounded hover:bg-emerald-500/10 text-emerald-600 hover:text-emerald-700 transition-colors disabled:opacity-40"
                              title="Guardar"
                            >
                              {savingId === s.id ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <Check className="size-3.5" />
                              )}
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              disabled={savingId === s.id}
                              className="p-1 rounded hover:bg-destructive/10 text-destructive hover:text-destructive transition-colors disabled:opacity-40"
                              title="Cancelar"
                            >
                              <X className="size-3.5" />
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2.5 tabular-nums">{s.date}</td>
                        <td className="px-3 py-2.5 text-muted-foreground">
                          {s.dayLabel ? `Dia ${s.dayLabel}` : "Dia"}
                        </td>
                        <td className="px-3 py-2.5">
                          {getSessionTypeBadge(s.type)}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums">
                          {s.duration === 0 ? "—" : s.duration}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => handleDelete(s.id)}
                              disabled={deletingId === s.id}
                              className="p-1 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-colors disabled:opacity-40"
                              title="Eliminar sesión"
                            >
                              {deletingId === s.id ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="size-3.5" />
                              )}
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Control Fatiga tab ────────────────────────────────────────────────────────

function ControlFatigaTab({ sessionMetrics, acwrSeries }: {
  sessionMetrics: ReturnType<typeof useCallUpDashboard>["sessionMetrics"];
  acwrSeries: ReturnType<typeof useCallUpDashboard>["acwrSeries"];
}) {
  const tableData = sessionMetrics.map((s, i) => {
    return {
      ...s,
      aguda: acwrSeries[i]?.aguda ?? 0,
      cronica: acwrSeries[i]?.cronica ?? 0,
      acwr: acwrSeries[i]?.acwr ?? 0,
    };
  });

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Control de Fatiga — Tabla completa</h3>
          <p className="text-xs text-muted-foreground mt-0.5">UA = Fatiga × Duración (min)</p>
        </div>
        {tableData.length > 0 && <CopyPNGButton targetId="control-fatiga-table" />}
      </div>
      <div className="overflow-x-auto">
        <table id="control-fatiga-table" className="w-full text-sm bg-card">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              {["Fecha", "Tipo", "Dur (min)", "Resp.", "Fatiga media", "UA (F×T)", "Aguda", "Crónica", "Ratio A:C"].map((h) => (
                <th key={h} className="text-left font-medium px-3 py-2">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableData.map((r) => (
              <tr key={r.sessionId} className="border-t hover:bg-muted/20">
                <td className="px-3 py-2 tabular-nums">{r.date}</td>
                <td className="px-3 py-2">{getSessionTypeBadge(r.type)}</td>
                <td className="px-3 py-2 tabular-nums">{r.duration}</td>
                <td className="px-3 py-2 tabular-nums text-muted-foreground">{r.responseCount}</td>
                <td className="px-3 py-2 tabular-nums">{r.fatigaMedia.toFixed(1)}</td>
                <td className="px-3 py-2 tabular-nums font-medium" style={{ color: statusColor(uaStatus(r.fatigaXTiempo)) }}>
                  {Math.round(r.fatigaXTiempo)}
                </td>
                <td className="px-3 py-2 tabular-nums">{r.aguda}</td>
                <td className="px-3 py-2 tabular-nums">{r.cronica}</td>
                <td className="px-3 py-2 tabular-nums font-medium" style={{ color: statusColor(acwrStatus(r.acwr)) }}>
                  {r.acwr.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Control Carga tab ─────────────────────────────────────────────────────────

function ControlCargaTab({ sessionMetrics, acwrSeries }: {
  sessionMetrics: ReturnType<typeof useCallUpDashboard>["sessionMetrics"];
  acwrSeries: ReturnType<typeof useCallUpDashboard>["acwrSeriesRpe"];
}) {
  const tableData = sessionMetrics.map((s, i) => {
    return {
      ...s,
      aguda: acwrSeries[i]?.aguda ?? 0,
      cronica: acwrSeries[i]?.cronica ?? 0,
      acwr: acwrSeries[i]?.acwr ?? 0,
    };
  });

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Control de Carga — Tabla completa</h3>
          <p className="text-xs text-muted-foreground mt-0.5">UA = RPE × Duración (min)</p>
        </div>
        {tableData.length > 0 && <CopyPNGButton targetId="control-carga-table" />}
      </div>
      <div className="overflow-x-auto">
        <table id="control-carga-table" className="w-full text-sm bg-card">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              {["Fecha", "Tipo", "Dur (min)", "Resp.", "RPE media", "UA (RPE×T)", "Aguda", "Crónica", "Ratio A:C"].map((h) => (
                <th key={h} className="text-left font-medium px-3 py-2">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableData.map((r) => (
              <tr key={r.sessionId} className="border-t hover:bg-muted/20">
                <td className="px-3 py-2 tabular-nums">{r.date}</td>
                <td className="px-3 py-2">{getSessionTypeBadge(r.type)}</td>
                <td className="px-3 py-2 tabular-nums">{r.duration}</td>
                <td className="px-3 py-2 tabular-nums text-muted-foreground">{r.responseCount}</td>
                <td className="px-3 py-2 tabular-nums">{r.rpeMedia.toFixed(1)}</td>
                <td className="px-3 py-2 tabular-nums font-medium" style={{ color: statusColor(uaStatus(r.rpeXTiempo)) }}>
                  {Math.round(r.rpeXTiempo)}
                </td>
                <td className="px-3 py-2 tabular-nums">{r.aguda}</td>
                <td className="px-3 py-2 tabular-nums">{r.cronica}</td>
                <td className="px-3 py-2 tabular-nums font-medium" style={{ color: statusColor(acwrStatus(r.acwr)) }}>
                  {r.acwr.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Jugadores tab ────────────────────────────────────────────────────────────

function JugadoresTab({
  players,
  playerMetrics,
  sessions,
  minutes,
  onExportPDF,
  exportingPlayer,
  isDisabled,
}: {
  players: string[];
  playerMetrics: ReturnType<typeof useCallUpDashboard>["playerMetrics"];
  sessions: StoredSession[];
  minutes: StoredMinutes[];
  onExportPDF: (playerName: string) => Promise<void>;
  exportingPlayer: string | null;
  isDisabled: boolean;
}) {
  if (players.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        Sin respuestas del formulario en este rango de fechas.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Plantilla de Jugadores</h3>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {playerMetrics.map((p) => (
          <PlayerCard
            key={p.jugador}
            metrics={p}
            minutes={minutes}
            onExportPDF={onExportPDF}
            isExporting={exportingPlayer === p.jugador}
            isDisabled={isDisabled}
          />
        ))}
      </div>
    </div>
  );
}

function PlayerCard({
  metrics: p,
  minutes,
  onExportPDF,
  isExporting,
  isDisabled,
}: {
  metrics: ReturnType<typeof useCallUpDashboard>["playerMetrics"][number];
  minutes: StoredMinutes[];
  onExportPDF: (playerName: string) => Promise<void>;
  isExporting: boolean;
  isDisabled: boolean;
}) {
  const acwrSt = acwrStatus(p.ratioACWR);
  const uaSt = uaStatus(p.uaMax);
  const worst = acwrSt === "riesgo" || uaSt === "riesgo" ? "riesgo" : acwrSt === "moderado" || uaSt === "moderado" ? "moderado" : "optimo";

  const dbPlayer = allPlayers.find(
    (x) => normalizeName(x.name) === normalizeName(p.jugador)
  );

  const { id: callUpId } = useParams<{ id: string }>();
  const mins = playerMinutesSummary(p.jugador, minutes);
  // El enlace usa el nombre tal y como llega del Form, así funciona para cualquier jugador
  const detailUrl = `/convocatorias/${callUpId}/jugador/${encodeURIComponent(p.jugador)}`;

  return (
    <div className="rounded-lg border bg-card p-4 flex flex-col justify-between h-full">
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
          <CardAvatar name={p.jugador} />
          <div className="min-w-0">
            <Link
              to={detailUrl}
              className="text-sm font-medium hover:underline text-foreground flex items-center gap-1.5"
            >
              <span>{p.jugador}</span>
              {dbPlayer && (
                <span className="text-[10px] text-muted-foreground font-normal">({dbPlayer.position})</span>
              )}
            </Link>
            <div className="text-[11px] text-muted-foreground">{p.responseCount} respuestas</div>
          </div>
          </div>
          <span className="size-2.5 rounded-full shrink-0" style={{ background: statusColor(worst) }} />
        </div>
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 text-xs mb-4">
          <MiniStat label="Fatiga media" value={p.fatigaMedia.toFixed(1)} />
          <MiniStat label="RPE medio" value={p.rpeMedia.toFixed(1)} />
          <MiniStat label="UA total" value={Math.round(p.uaTotal).toLocaleString()} />
          <MiniStat label="UA máx" value={p.uaMax.toLocaleString()} color={statusColor(uaSt)} />
          <MiniStat label="Monotonía" value={p.indiceDeMonotonia.toFixed(2)} />
          <MiniStat label="ACWR" value={p.ratioACWR.toFixed(2)} color={statusColor(acwrSt)} />
          <MiniStat label="Minutos jugados" value={mins.total > 0 ? formatMinutes(mins.total) : "—"} />
          <MiniStat label="Partidos" value={String(mins.matchesPlayed)} />
        </div>
      </div>
      <div className="border-t pt-3 flex items-center justify-between mt-auto">
        <Link to={detailUrl} className="text-[11px] text-primary hover:underline font-medium">
          Ver Detalles
        </Link>
        <button
          onClick={() => onExportPDF(p.jugador)}
          disabled={isDisabled}
          className="text-[11px] flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-border bg-secondary hover:bg-muted/30 text-foreground transition-all disabled:opacity-50 cursor-pointer font-medium"
        >
          {isExporting ? (
            <Loader2 className="size-3 animate-spin text-primary" />
          ) : (
            <Download className="size-3" />
          )}
          <span>PDF</span>
        </button>
      </div>
    </div>
  );
}

/** Foto pequeña en la tarjeta: permite ver de un vistazo qué jugadores no tienen foto. */
function CardAvatar({ name }: { name: string }) {
  const src = getPlayerPhoto(name);
  const [failed, setFailed] = useState(false);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
  if (!src || failed) {
    return (
      <div
        className="size-9 shrink-0 rounded-full border border-dashed grid place-items-center text-[11px] font-semibold text-muted-foreground"
        title="Sin foto: revisa src/lib/player-photos.ts"
      >
        {initials}
      </div>
    );
  }
  return <img src={src} alt={name} onError={() => setFailed(true)} className="size-9 shrink-0 rounded-full object-cover border" />;
}

// ─── Heatmap ──────────────────────────────────────────────────────────────────

function FatigaHeatmap({
  mode = "fatiga",
  players,
  sessionMetrics,
  acwrSeries,
  id,
  sessions,
  onSessionUpdated,
  onResponseUpdated,
  updateResponseLocally,
  updateSessionLocally,
}: {
  /** "fatiga": valores de fatiga y UA = Fatiga × Tiempo; "carga": valores RPE y UA = RPE × Tiempo */
  mode?: "fatiga" | "carga";
  players: string[];
  sessionMetrics: ReturnType<typeof useCallUpDashboard>["sessionMetrics"];
  acwrSeries: ReturnType<typeof useCallUpDashboard>["acwrSeries"];
  id?: string;
  sessions: StoredSession[];
  onSessionUpdated?: () => void;
  onResponseUpdated?: () => void;
  updateResponseLocally: (jugador: string, fecha: string, fatigue: number | null, rpe: number | null) => void;
  updateSessionLocally: (sessionId: string, duration: number) => void;
}) {
  const [selectedCell, setSelectedCell] = useState<{
    jugador: string;
    sessionId: string;
    date: string;
    fatigue: number;
    rpe: number;
    hasResponse: boolean;
  } | null>(null);

  const [savingResponse, setSavingResponse] = useState(false);

  // Session duration inline editing
  const [editingSessionDurationId, setEditingSessionDurationId] = useState<string | null>(null);
  const [editDurationValue, setEditDurationValue] = useState("");
  const [savingDuration, setSavingDuration] = useState(false);

  // Helper for Spanish day names
  function getSpanishDayName(dateStr: string): string {
    if (!dateStr) return "";
    const days = ["DOMINGO", "LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES", "SÁBADO"];
    const parts = dateStr.split("-");
    if (parts.length === 3) {
      const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      return days[d.getDay()];
    }
    const d = new Date(dateStr);
    return days[isNaN(d.getDay()) ? 0 : d.getDay()];
  }

  // Helper for sample standard deviation
  function sampleStd(arr: number[]): number {
    if (arr.length < 2) return 0;
    const m = avg(arr);
    const sumSq = arr.reduce((sum, v) => sum + (v - m) ** 2, 0);
    return Math.sqrt(sumSq / (arr.length - 1));
  }

  // Format date to DD/MM/YYYY
  function formatDateES(dateStr: string): string {
    if (!dateStr) return "";
    const parts = dateStr.split("-");
    if (parts.length === 3) {
      return `${parseInt(parts[2], 10)}/${parseInt(parts[1], 10)}/${parts[0]}`;
    }
    return dateStr;
  }

  const isCarga = mode === "carga";
  const L = isCarga ? "Carga" : "Fatiga";
  const cellValue = (s: (typeof sessionMetrics)[number], jugador: string) =>
    isCarga ? s.playerRPE[jugador] : s.playerFatigue[jugador];
  const sessionUA = (s: (typeof sessionMetrics)[number]) => (isCarga ? s.rpeXTiempo : s.fatigaXTiempo);
  const sessionMean = (s: (typeof sessionMetrics)[number]) => (isCarga ? s.rpeMedia : s.fatigaMedia);

  // Calculations for summary rows
  const uaValues = sessionMetrics.map(sessionUA);
  const uaTotal = uaValues.reduce((a, b) => a + b, 0);
  const uaMedia = avg(uaValues);
  const stdDev = sampleStd(uaValues);
  const monotonia = stdDev > 0 ? uaMedia / stdDev : 0;
  const indiceFatiga = monotonia * uaTotal;

  // Colors for cell value (Fatigue 1-10)
  function getFatigueCellBg(val: number | undefined): string {
    if (val === undefined) return "bg-[#ffffff] text-black border-r border-b hover:bg-[#f1f5f9]";
    if (val === 0) return "bg-[#70ad47] text-white font-medium border-r border-b hover:opacity-85";
    if (val <= 3) return "bg-[#92d050] text-black font-medium border-r border-b hover:opacity-85";
    if (val <= 5) return "bg-[#ffd966] text-black font-medium border-r border-b hover:opacity-85";
    if (val <= 7) return "bg-[#ed7d31] text-white font-medium border-r border-b hover:opacity-85";
    return "bg-[#c00000] text-white font-bold border-r border-b hover:opacity-85";
  }

  // Colors for ACWR ratio
  function getAcwrCellBg(ratio: number): string {
    if (ratio >= 0.8 && ratio <= 1.3) return "bg-[#c6efce] text-[#006100]";
    if (ratio > 1.3 && ratio <= 1.5) return "bg-[#ffeb9c] text-[#9c6500]";
    return "bg-[#ffc7ce] text-[#9c0006]";
  }

  // Colors for session type in row 3
  function getSessionTypeHeaderBg(type: SessionType): string {
    const map: Record<SessionType, string> = {
      "PARTIDO": "bg-[#00ffff] text-black font-semibold",
      "TEC-TAC": "bg-[#f2f2f2] text-black",
      "FÍSICO": "bg-[#c6efce] text-black",
      "LIBRE": "bg-[#ffffff] text-black border",
      "GYM+TEC-TAC": "bg-[#e2efda] text-black",
      "FÍSICO+TEC-TAC": "bg-[#fff2cc] text-black",
      "FÍSICO+PARTIDO": "bg-[#fce4d6] text-black",
      "TEC-TAC+TEC-TAC": "bg-[#d9e1f2] text-black",
      "ACTIVACIÓN": "bg-[#fff2cc] text-black",
      "REGENERATIVO": "bg-[#e2efda] text-black",
    };
    return map[type] || "bg-[#f2f2f2] text-black";
  }

  async function handleSaveResponse() {
    if (!selectedCell) return;
    setSavingResponse(true);
    try {
      await savePlayerResponse({
        jugador: selectedCell.jugador,
        fecha: selectedCell.date,
        fatigue: selectedCell.fatigue,
        rpe: selectedCell.rpe,
      });
      updateResponseLocally(selectedCell.jugador, selectedCell.date, selectedCell.fatigue, selectedCell.rpe);
      setSelectedCell(null);
      toast.success(`Datos de ${selectedCell.jugador} guardados correctamente`);
      if (onResponseUpdated) onResponseUpdated();
    } catch (e) {
      console.error(e);
      toast.error(`Error al guardar: ${e}`);
    } finally {
      setSavingResponse(false);
    }
  }

  async function handleDeleteResponse() {
    if (!selectedCell) return;
    setSavingResponse(true);
    try {
      await deletePlayerResponse({
        jugador: selectedCell.jugador,
        fecha: selectedCell.date,
      });
      updateResponseLocally(selectedCell.jugador, selectedCell.date, null, null);
      setSelectedCell(null);
      toast.success("Respuesta eliminada con éxito");
      if (onResponseUpdated) onResponseUpdated();
    } catch (e) {
      console.error(e);
      toast.error(`Error al eliminar: ${e}`);
    } finally {
      setSavingResponse(false);
    }
  }

  async function handleSaveDuration(s: typeof sessionMetrics[0]) {
    const originalSession = sessions.find((sess) => sess.id === s.sessionId);
    if (!originalSession) return;
    const newDuration = parseInt(editDurationValue, 10);
    if (isNaN(newDuration) || newDuration < 0) {
      setEditingSessionDurationId(null);
      return;
    }

    setSavingDuration(true);
    try {
      await updateSession({ ...originalSession, duration: newDuration });
      updateSessionLocally(s.sessionId, newDuration);
      setEditingSessionDurationId(null);
      toast.success("Duración de la sesión actualizada");
      if (onSessionUpdated) onSessionUpdated();
    } catch (e) {
      console.error(e);
      toast.error(`Error al actualizar duración: ${e}`);
    } finally {
      setSavingDuration(false);
    }
  }

  return (
    <div className="overflow-x-auto w-full border rounded-lg bg-card shadow-sm">
      <table id={id} className="w-full text-[11px] border-collapse text-center border bg-card">
        <thead>
          {/* Row 1: FECHA */}
          <tr className="border-b bg-muted/30">
            <th className="px-3 py-1.5 text-left font-bold border-r w-[200px] bg-card text-[10px] uppercase tracking-wider sticky left-0 z-20 shadow-[1px_0_0_var(--border)]">Fecha</th>
            {sessionMetrics.map((s) => (
              <th key={s.sessionId} className="px-3 py-1.5 border-r font-bold tabular-nums whitespace-nowrap text-[10px]">
                {formatDateES(s.date)} {s.dayLabel}
              </th>
            ))}
          </tr>
          {/* Row 2: DIA */}
          <tr className="border-b bg-muted/30">
            <th className="px-3 py-1.5 text-left font-bold border-r w-[200px] bg-card text-[10px] uppercase tracking-wider sticky left-0 z-20 shadow-[1px_0_0_var(--border)]">Dia</th>
            {sessionMetrics.map((s) => (
              <th key={s.sessionId} className="px-3 py-1.5 border-r font-bold whitespace-nowrap text-[10px]">
                {getSpanishDayName(s.date)} {s.dayLabel}
              </th>
            ))}
          </tr>
          {/* Row 3: JUGADOR / Tipo Sesion */}
          <tr className="border-b bg-red-650 text-white font-semibold">
            <th className="px-3 py-1.5 text-left font-bold border-r w-[200px] bg-red-600 border-red-700 text-[10px] uppercase tracking-wider sticky left-0 z-20">Jugador</th>
            {sessionMetrics.map((s) => (
              <th key={s.sessionId} className={`px-3 py-1.5 border-r border-red-700 whitespace-nowrap text-[10px] ${getSessionTypeHeaderBg(s.type as SessionType)}`}>
                {s.type}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* Player Rows */}
          {players.map((jugador) => (
            <tr key={jugador} className="border-b hover:bg-muted/10">
              <td className="px-3 py-1 text-left border-r font-bold uppercase bg-card w-[200px] text-[10px] whitespace-nowrap sticky left-0 z-10 shadow-[1px_0_0_var(--border)]">{jugador}</td>
              {sessionMetrics.map((s) => {
                const val = cellValue(s, jugador);
                return (
                  <td
                    key={s.sessionId}
                    onClick={() => {
                      const fatVal = s.playerFatigue[jugador];
                      const rpeVal = s.playerRPE[jugador];
                      setSelectedCell({
                        jugador,
                        sessionId: s.sessionId,
                        date: s.date,
                        fatigue: fatVal || 5,
                        rpe: rpeVal || 5,
                        hasResponse: fatVal !== undefined || rpeVal !== undefined,
                      });
                    }}
                    className={`px-3 py-1 tabular-nums cursor-pointer select-none transition-all ${getFatigueCellBg(val)}`}
                    title={`Click para registrar/editar respuesta de ${jugador}`}
                  >
                    {val !== undefined ? val : "—"}
                  </td>
                );
              })}
            </tr>
          ))}

          {/* TIEMPO SESIÓN (min) */}
          <tr className="border-b font-bold bg-muted/30 text-[10px]">
            <td className="px-3 py-1.5 text-left border-r uppercase w-[200px] tracking-wider sticky left-0 z-10 bg-card shadow-[1px_0_0_var(--border)]">Tiempo Sesión (min)</td>
            {sessionMetrics.map((s) => {
              const isEditing = editingSessionDurationId === s.sessionId;
              return (
                <td
                  key={s.sessionId}
                  onClick={() => {
                    if (!isEditing) {
                      setEditingSessionDurationId(s.sessionId);
                      setEditDurationValue(String(s.duration));
                    }
                  }}
                  className="px-3 py-1.5 border-r tabular-nums cursor-pointer hover:bg-muted/20 select-none min-w-[50px]"
                  title="Click para editar duración"
                >
                  {isEditing ? (
                    <input
                      type="number"
                      autoFocus
                      disabled={savingDuration}
                      value={editDurationValue}
                      onChange={(e) => setEditDurationValue(e.target.value)}
                      onBlur={() => handleSaveDuration(s)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveDuration(s);
                        if (e.key === "Escape") setEditingSessionDurationId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="w-12 text-center bg-background border border-border text-foreground rounded text-[10px] py-0.5"
                    />
                  ) : (
                    s.duration
                  )}
                </td>
              );
            })}
          </tr>

          {/* FATIGA MEDIA SESIÓN */}
          <tr className="border-b bg-muted/10 text-[10px]">
            <td className="px-3 py-1.5 text-left border-r uppercase w-[200px] tracking-wider font-semibold sticky left-0 z-10 bg-card shadow-[1px_0_0_var(--border)]">{L} Media Sesión</td>
            {sessionMetrics.map((s) => (
              <td key={s.sessionId} className="px-3 py-1.5 border-r tabular-nums font-bold">
                {Math.round(sessionMean(s))}
              </td>
            ))}
          </tr>

          {/* FATIGA SESIÓN (FATIGA x TIEMPO) */}
          <tr className="border-b bg-muted/10 text-[10px]">
            <td className="px-3 py-1.5 text-left border-r uppercase w-[200px] tracking-wider font-semibold sticky left-0 z-10 bg-card shadow-[1px_0_0_var(--border)]">{isCarga ? "Carga Sesión (RPE x Tiempo)" : "Fatiga Sesión (Fatiga x Tiempo)"}</td>
            {sessionMetrics.map((s) => (
              <td key={s.sessionId} className="px-3 py-1.5 border-r tabular-nums font-bold">
                {Math.round(sessionUA(s))}
              </td>
            ))}
          </tr>

          {/* FATIGA MEDIA SEMANAL */}
          <tr className="border-b bg-muted/5 text-[10px]">
            <td className="px-3 py-1.5 text-left border-r uppercase w-[200px] tracking-wider font-semibold sticky left-0 z-10 bg-card shadow-[1px_0_0_var(--border)]">{L} Media Semanal</td>
            {sessionMetrics.map((s, i) => {
              const isMid = i === Math.floor(sessionMetrics.length / 2);
              return (
                <td key={s.sessionId} className="px-3 py-1.5  font-bold text-center tabular-nums">
                  {isMid ? Math.round(uaMedia) : ""}
                </td>
              );
            })}
          </tr>

          {/* DESVIACIÓN ESTÁNDAR */}
          <tr className="border-b bg-muted/5 text-[10px]">
            <td className="px-3 py-1.5 text-left border-r uppercase w-[200px] tracking-wider font-semibold sticky left-0 z-10 bg-card shadow-[1px_0_0_var(--border)]">Desviación Estándar</td>
            {sessionMetrics.map((s, i) => {
              const isMid = i === Math.floor(sessionMetrics.length / 2);
              return (
                <td key={s.sessionId} className="px-3 py-1.5  font-bold text-center tabular-nums">
                  {isMid ? Math.round(stdDev) : ""}
                </td>
              );
            })}
          </tr>

          {/* ÍNDICE DE MONOTONÍA */}
          <tr className="border-b bg-muted/5 text-[10px]">
            <td className="px-3 py-1.5 text-left border-r uppercase w-[200px] tracking-wider font-semibold sticky left-0 z-10 bg-card shadow-[1px_0_0_var(--border)]">Índice de Monotonía</td>
            {sessionMetrics.map((s, i) => {
              const isMid = i === Math.floor(sessionMetrics.length / 2);
              return (
                <td key={s.sessionId} className="px-3 py-1.5  font-bold text-center tabular-nums">
                  {isMid ? monotonia.toFixed(2) : ""}
                </td>
              );
            })}
          </tr>

          {/* ÍNDICE DE FATIGA */}
          <tr className="border-b bg-muted/5 text-[10px]">
            <td className="px-3 py-1.5 text-left border-r uppercase w-[200px] tracking-wider font-semibold sticky left-0 z-10 bg-card shadow-[1px_0_0_var(--border)]">Índice de {L}</td>
            {sessionMetrics.map((s, i) => {
              const isMid = i === Math.floor(sessionMetrics.length / 2);
              return (
                <td key={s.sessionId} className="px-3 py-1.5  font-bold text-center tabular-nums">
                  {isMid ? Math.round(indiceFatiga) : ""}
                </td>
              );
            })}
          </tr>

          {/* FATIGA AGUDA */}
          <tr className="border-b bg-muted/10 text-[10px]">
            <td className="px-3 py-1.5 text-left border-r uppercase w-[200px] tracking-wider font-semibold sticky left-0 z-10 bg-card shadow-[1px_0_0_var(--border)]">{L} Aguda</td>
            {sessionMetrics.map((s, i) => (
              <td key={s.sessionId} className="px-3 py-1.5 border-r tabular-nums">
                {acwrSeries[i]?.aguda ?? 0}
              </td>
            ))}
          </tr>

          {/* FATIGA CRÓNICA */}
          <tr className="border-b bg-muted/10 text-[10px]">
            <td className="px-3 py-1.5 text-left border-r uppercase w-[200px] tracking-wider font-semibold sticky left-0 z-10 bg-card shadow-[1px_0_0_var(--border)]">{L} Crónica</td>
            {sessionMetrics.map((s, i) => (
              <td key={s.sessionId} className="px-3 py-1.5 border-r tabular-nums">
                {acwrSeries[i]?.cronica ?? 0}
              </td>
            ))}
          </tr>

          {/* RATIO A:C (2-5) */}
          <tr className="border-b bg-muted/15 font-bold text-[10px]">
            <td className="px-3 py-1.5 text-left border-r uppercase w-[200px] tracking-wider font-bold sticky left-0 z-10 bg-card shadow-[1px_0_0_var(--border)]">Ratio A:C (2-5)</td>
            {sessionMetrics.map((s, i) => {
              const ratio = acwrSeries[i]?.acwr ?? 0;
              return (
                <td key={s.sessionId} className={`px-3 py-1.5 border-r tabular-nums ${getAcwrCellBg(ratio)}`}>
                  {ratio.toFixed(2)}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>

      {/* Dialog para editar/añadir respuestas de fatiga/RPE */}
      <Dialog open={selectedCell !== null} onOpenChange={(open) => !open && setSelectedCell(null)}>
        <DialogContent className="sm:max-w-[380px] bg-card text-foreground border border-border">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-foreground">
              Registro: {selectedCell?.jugador}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Sesión del {selectedCell && formatDateES(selectedCell.date)}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <label className="text-xs font-semibold text-muted-foreground">Fatiga (1-10)</label>
                <select
                  value={selectedCell?.fatigue ?? ""}
                  onChange={(e) => {
                    if (selectedCell) {
                      setSelectedCell({
                        ...selectedCell,
                        fatigue: parseInt(e.target.value, 10) || 0
                      });
                    }
                  }}
                  className="w-full bg-background border border-border text-foreground rounded p-2 text-xs"
                >
                  <option value="">Seleccionar...</option>
                  {[...Array(10)].map((_, i) => (
                    <option key={i + 1} value={i + 1}>{i + 1}</option>
                  ))}
                </select>
              </div>

              <div className="grid gap-2">
                <label className="text-xs font-semibold text-muted-foreground">Intensidad RPE (1-10)</label>
                <select
                  value={selectedCell?.rpe ?? ""}
                  onChange={(e) => {
                    if (selectedCell) {
                      setSelectedCell({
                        ...selectedCell,
                        rpe: parseInt(e.target.value, 10) || 0
                      });
                    }
                  }}
                  className="w-full bg-background border border-border text-foreground rounded p-2 text-xs"
                >
                  <option value="">Seleccionar...</option>
                  {[...Array(10)].map((_, i) => (
                    <option key={i + 1} value={i + 1}>{i + 1}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0 flex-row justify-between w-full mt-4">
            <div>
              {selectedCell?.hasResponse && (
                <button
                  type="button"
                  onClick={handleDeleteResponse}
                  disabled={savingResponse}
                  className="text-xs px-3 py-2 rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-all font-medium cursor-pointer"
                >
                  {savingResponse ? "Borrando..." : "Borrar"}
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <DialogClose asChild>
                <button className="text-xs px-3 py-2 rounded-md border border-border bg-transparent hover:bg-muted/10 transition-all font-medium text-foreground cursor-pointer">
                  Cancelar
                </button>
              </DialogClose>
              <button
                type="button"
                onClick={handleSaveResponse}
                disabled={savingResponse || !selectedCell?.fatigue || !selectedCell?.rpe}
                className="text-xs px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-all font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {savingResponse && <Loader2 className="size-3 animate-spin" />}
                Guardar
              </button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Nueva sesión dialog ──────────────────────────────────────────────────────

function NuevaSesionDialog({ callUpId, onCreated }: { callUpId: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  // Radix Select doesn't allow value="", so we use "single" to represent DayLabel ""
  const [dayLabelSelect, setDayLabelSelect] = useState<string>("single");
  const [type, setType] = useState<SessionType>("TEC-TAC");
  const [duration, setDuration] = useState("");

  const dayLabel: DayLabel = dayLabelSelect === "single" ? "" : (dayLabelSelect as DayLabel);

  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!date) return;
    setSaving(true);
    try {
      const parsedDuration = duration ? parseInt(duration, 10) : 0;
      await saveSession({ callUpId, date, dayLabel, type, duration: parsedDuration });
      setOpen(false);
      setDate(""); setDayLabelSelect("single"); setType("TEC-TAC"); setDuration("");
      onCreated();
    } catch (e) {
      alert(`Error al guardar sesión: ${e}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground flex items-center gap-1.5">
          <Plus className="size-3" /> Añadir sesión
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Nueva sesión de trabajo</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="ns-date">Fecha *</Label>
              <Input id="ns-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ns-label">Momento del día</Label>
              <Select value={dayLabelSelect} onValueChange={setDayLabelSelect}>
                <SelectTrigger id="ns-label">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">Dia (único)</SelectItem>
                  <SelectItem value="M">Dia M (Mañana)</SelectItem>
                  <SelectItem value="T">Dia T (Tarde)</SelectItem>
                  <SelectItem value="M-T">Dia M-T (Mañana-Tarde)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ns-type">Tipo de sesión *</Label>
            <Select value={type} onValueChange={(v) => setType(v as SessionType)}>
              <SelectTrigger id="ns-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SESSION_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ns-duration">Duración (minutos)</Label>
            <Input id="ns-duration" type="number" min={1} max={240} placeholder="Ej. 75"
              value={duration} onChange={(e) => setDuration(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
          <Button onClick={handleCreate} disabled={!date || saving}>
            {saving ? "Guardando…" : "Guardar sesión"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Player filter ────────────────────────────────────────────────────────────

function PlayerFilter({
  players,
  selected,
  onChange,
}: {
  players: string[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);

  const label =
    selected.length === 0
      ? "Equipo"
      : selected.length === 1
        ? selected[0]
        : `${selected.length} jugadores`;

  function toggle(player: string) {
    if (selected.includes(player)) {
      onChange(selected.filter((p) => p !== player));
    } else {
      onChange([...selected, player]);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`text-xs flex items-center gap-1.5 px-3 py-2 rounded-md border transition-colors ${selected.length > 0
          ? "bg-primary/10 border-primary/40 text-primary"
          : "hover:bg-accent"
          }`}
      >
        <Users className="size-3.5" />
        {label}
        <span className="ml-0.5 text-muted-foreground">▾</span>
      </button>

      {open && (
        <>
          {/* backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-lg border bg-popover shadow-lg py-1 text-sm text-popover-foreground">
            {/* Equipo = deselect all */}
            <button
              onClick={() => { onChange([]); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-accent ${selected.length === 0 ? "font-semibold text-primary" : ""
                }`}
            >
              <span className={`size-3.5 rounded border flex items-center justify-center ${selected.length === 0 ? "bg-primary border-primary" : "border-muted-foreground"
                }`}>
                {selected.length === 0 && <span className="text-primary-foreground text-[9px]">✓</span>}
              </span>
              Equipo (todos)
            </button>

            <div className="border-t my-1" />

            {players.map((p) => {
              const checked = selected.includes(p);
              return (
                <button
                  key={p}
                  onClick={() => toggle(p)}
                  className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-accent"
                >
                  <span className={`size-3.5 rounded border flex items-center justify-center shrink-0 ${checked ? "bg-primary border-primary" : "border-muted-foreground"
                    }`}>
                    {checked && <span className="text-primary-foreground text-[9px]">✓</span>}
                  </span>
                  <span className="truncate max-w-[140px]">{p}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}


// ─── Shared components ────────────────────────────────────────────────────────


function Panel({ title, children, id, action }: { title: string; children: React.ReactNode; id?: string; action?: React.ReactNode }) {
  return (
    <div id={id} className="rounded-lg border bg-card p-4 relative">
      <div className="flex items-center justify-between mb-3 gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function CopyPNGButton({ targetId }: { targetId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");

  async function handleCopy() {
    const el = document.getElementById(targetId);
    if (!el) {
      toast.error("No se encontró el elemento para copiar");
      return;
    }

    setState("loading");

    // Safari requires navigator.clipboard.write to be called synchronously within a user gesture.
    // To do this, we pass a Promise resolving to the Blob directly to ClipboardItem.
    const blobPromise = (async () => {
      // Small delay to allow the UI to update to "loading" state
      await new Promise((r) => setTimeout(r, 150));

      const blob = await toBlob(el, {
        backgroundColor: "oklch(0.22 0.05 265)", // Matches var(--card) background
        style: {
          borderRadius: "0.625rem",
          padding: el.tagName === "TABLE" ? "16px" : undefined,
        },
        filter: (node) => {
          if (node instanceof HTMLElement && node.classList.contains("no-export")) {
            return false;
          }
          return true;
        },
        cacheBust: true,
      });

      if (!blob) {
        throw new Error("No se pudo generar la imagen");
      }
      return blob;
    })();

    const clipboardItem = new ClipboardItem({
      "image/png": blobPromise,
    });

    const promise = navigator.clipboard.write([clipboardItem])
      .then(() => {
        setState("success");
        setTimeout(() => setState("idle"), 2000);
      })
      .catch((err) => {
        console.error(err);
        setState("error");
        setTimeout(() => setState("idle"), 2000);
        throw err;
      });

    toast.promise(promise, {
      loading: "Generando imagen...",
      success: "¡Imagen copiada al portapapeles!",
      error: "Error al copiar la imagen",
    });
  }

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        handleCopy();
      }}
      disabled={state === "loading"}
      className="no-export px-2 py-1 rounded-md border border-border bg-secondary hover:bg-muted/30 text-muted-foreground hover:text-foreground transition-all flex items-center justify-center gap-1 text-[11px] font-medium cursor-pointer"
      title="Copiar como imagen al portapapeles"
    >
      {state === "loading" && <Loader2 className="size-3 animate-spin text-primary" />}
      {state === "success" && <Check className="size-3 text-[#2ebb5c]" />}
      {state === "error" && <X className="size-3 text-destructive" />}
      {state === "idle" && <Copy className="size-3" />}
      <span>{state === "loading" ? "Copiando" : state === "success" ? "Copiado" : "Copiar"}</span>
    </button>
  );
}

function MetricCard({ label, value, hint, tone }: {
  label: string; value: string; hint?: string; tone?: "optimo" | "moderado" | "riesgo";
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold tabular-nums mt-1" style={tone ? { color: statusColor(tone) } : undefined}>
        {value}
      </div>
      {hint && <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums" style={color ? { color } : undefined}>{value}</div>
    </div>
  );
}

// ─── Editar Convocatoria Dialog ──────────────────────────────────────────────────

function EditarConvocatoriaDialog({ callUp, onUpdated }: { callUp: StoredCallUp; onUpdated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(callUp.name);
  const [startDate, setStartDate] = useState(callUp.startDate);
  const [endDate, setEndDate] = useState(callUp.endDate);
  const [location, setLocation] = useState(callUp.location);
  const [status, setStatus] = useState<StoredCallUp["status"]>(callUp.status);
  const [notes, setNotes] = useState(callUp.notes ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(callUp.name);
    setStartDate(callUp.startDate);
    setEndDate(callUp.endDate);
    setLocation(callUp.location);
    setStatus(callUp.status);
    setNotes(callUp.notes ?? "");
  }, [callUp]);

  async function handleSave() {
    if (!name || !startDate || !endDate) return;
    setSaving(true);
    try {
      await updateCallUp(callUp.id, { name, startDate, endDate, location, status, notes }, callUp);
      setOpen(false);
      onUpdated();
    } catch (e) {
      alert(`Error al guardar: ${e}`);
    } finally {
      setSaving(false);
    }
  }

  const valid = !!name && !!startDate && !!endDate;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="text-xs flex items-center gap-1.5 px-3 py-2 rounded-md border hover:bg-accent">
          <Pencil className="size-3.5" /> Editar Convocatoria
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar convocatoria</DialogTitle>
          <DialogDescription>Modifica los datos de la concentración.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 py-2">
          <div className="grid gap-2">
            <Label htmlFor="ec-name">Nombre *</Label>
            <Input id="ec-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="ec-start">Fecha inicio *</Label>
              <Input id="ec-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ec-end">Fecha fin *</Label>
              <Input id="ec-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="ec-location">Sede</Label>
              <Input id="ec-location" value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ec-status">Estado</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as StoredCallUp["status"])}>
                <SelectTrigger id="ec-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="En curso">En curso</SelectItem>
                  <SelectItem value="Finalizada">Finalizada</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ec-notes">Observaciones</Label>
            <Textarea id="ec-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
          <Button type="button" onClick={handleSave} disabled={!valid || saving}>
            {saving ? "Guardando…" : "Guardar cambios"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
