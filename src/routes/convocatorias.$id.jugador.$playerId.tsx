import { exportElementToPdf } from "@/lib/pdf-export";
import { Link, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { MetricCard } from "@/components/MetricCard";
import { players as allPlayers } from "@/lib/mock-data";
import { getLoadThresholds } from "@/lib/store";
import { useCallUpDashboard } from "@/hooks/useLoadData";
import { avg, std, calcACWRSeries, uaStatus, acwrStatus, statusColor } from "@/lib/metrics";
import { AlertTriangle, Download, Loader2 } from "lucide-react";
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";
import { PlayerReportPDF } from "@/components/PlayerReportPDF";
import { toast } from "sonner";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  Cell,
  ScatterChart,
  Scatter,
  ZAxis,
  ReferenceLine,
  ReferenceArea,
  Legend,
} from "recharts";

const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--popover-foreground)",
};

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

export default function Page() {
  const { id, playerId } = useParams<{ id: string; playerId: string }>();
  const {
    callUp,
    sessions,
    responses,
    minutes,
    loading,
    error,
  } = useCallUpDashboard(id);

  // playerId puede ser el id antiguo de la lista fija (p7) o el nombre del jugador en el Form
  const normalize = (name: string) =>
    name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
  const requested = safeDecode(playerId ?? "");
  const listed = allPlayers.find((x) => x.id === requested)
    ?? allPlayers.find((x) => normalize(x.name) === normalize(requested));
  const formName = responses.find((r) => normalize(r.jugador) === normalize(listed?.name ?? requested))?.jugador;
  const playerName = formName ?? listed?.name ?? requested;
  const mockPlayer = playerName
    ? {
        name: playerName,
        number: listed?.number ?? "—",
        position: listed?.position ?? "Jugador",
      }
    : undefined;
  const { optimo, moderado } = getLoadThresholds();
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (mockPlayer) {
      document.title = `Jugador ${mockPlayer.name} · SE-FS Load`;
    } else {
      document.title = "No encontrado · SE-FS Load";
    }
  }, [mockPlayer]);

  if (loading) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
          <div className="relative size-14">
            <div className="absolute inset-0 rounded-full border-4 border-muted" />
            <div className="absolute inset-0 rounded-full border-4 border-primary border-t-transparent animate-spin" />
          </div>
          <div>
            <p className="text-sm font-medium">Cargando datos del jugador…</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!callUp || !mockPlayer) {
    return (
      <AppLayout>
        <div className="p-10 text-muted-foreground">Jugador o convocatoria no encontrados.</div>
      </AppLayout>
    );
  }

  // ─── Data calculations using real Sheets responses ───────────────────────

  // Helper to normalize names by removing accents and converting to uppercase
  const normalizeName = (name: string) =>
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toUpperCase();

  // Filter responses belonging to this player using normalized comparison
  const playerResponses = responses.filter(
    (r) => normalizeName(r.jugador) === normalizeName(mockPlayer.name)
  );

  // Sort sessions chronologically
  const sortedSessions = [...sessions].sort((a, b) => {
    const priority: Record<string, number> = { "M": 1, "M-T": 2, "": 3, "T": 4 };
    const dateComp = a.date.localeCompare(b.date);
    if (dateComp !== 0) return dateComp;
    const pA = priority[a.dayLabel] ?? 99;
    const pB = priority[b.dayLabel] ?? 99;
    if (pA !== pB) return pA - pB;
    return a.id.localeCompare(b.id);
  });

  // Map sessions to player values
  const rawData = sortedSessions.map((s) => {
    const daySessions = sortedSessions.filter((x) => x.date === s.date);
    const sessionIndex = daySessions.indexOf(s);

    const playerDayResponses = playerResponses.filter((r) => r.fecha === s.date);
    playerDayResponses.sort((a, b) => {
      const parseTs = (ts: string) => {
        if (!ts) return 0;
        const slashMatch = ts.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (slashMatch) {
          const [, d, m, y] = slashMatch;
          return new Date(parseInt(y), parseInt(m) - 1, parseInt(d)).getTime();
        }
        return new Date(ts).getTime() || 0;
      };
      return parseTs(a.timestamp) - parseTs(b.timestamp);
    });

    const r = playerDayResponses[sessionIndex];

    const rpe = r ? r.rpe : 0;
    const fatiga = r ? r.fatigue : 0;
    const uaVal = r ? r.rpe * s.duration : 0; // Load: RPE * duration
    const uaFatigaVal = r ? r.fatigue * s.duration : 0;

    return {
      id: s.id,
      label: s.dayLabel ? `${s.date.slice(5)} ${s.dayLabel}` : s.date.slice(5),
      date: s.date,
      type: s.type,
      duration: s.duration,
      rpe,
      fatiga,
      ua: uaVal, // Load UA
      uaFatiga: uaFatigaVal,
      hasResponse: !!r,
    };
  });

  const completedSessions = rawData.filter((d) => d.hasResponse);
  
  // Calculate RPE-based ACWR series for the graphs on this page
  const acwrCargaSeries = calcACWRSeries(completedSessions.map((d) => ({ date: d.date, ua: d.ua })));

  const data = rawData.map((d) => {
    if (!d.hasResponse) {
      return { ...d, ac: 0 };
    }
    const idx = completedSessions.findIndex((s) => s.id === d.id);
    return { ...d, ac: acwrCargaSeries[idx]?.acwr ?? 0 };
  });

  const respondedData = data.filter((d) => d.hasResponse);

  const rpeAvg = avg(respondedData.map((d) => d.rpe));
  const fatAvg = avg(respondedData.map((d) => d.fatiga));
  const uaTot = respondedData.reduce((acc, d) => acc + d.ua, 0);
  const maxUa = respondedData.length > 0 ? Math.max(...respondedData.map((d) => d.ua)) : 0;
  
  const status = uaStatus(maxUa);
  const statusLabel =
    status === "riesgo" ? "Riesgo" : status === "moderado" ? "Precaución" : "Normal";

  const uaArr = respondedData.map((d) => d.ua);
  const monotonia = avg(uaArr) / (std(uaArr) || 1);
  const acLast = acwrCargaSeries[acwrCargaSeries.length - 1]?.acwr ?? 0;

  const alerts = respondedData.filter((d) => d.ua > moderado);

  async function handleExportPDF() {
    setExporting(true);
    await new Promise((r) => setTimeout(r, 500));
    const elementId = `pdf-report-${mockPlayer.name.replace(/\s+/g, "-")}`;
    const el = document.getElementById(elementId);
    if (!el) {
      toast.error("No se encontró el contenedor de reporte");
      setExporting(false);
      return;
    }

    try {
      await exportElementToPdf(el, `Reporte_Carga_${mockPlayer.name.replace(/\s+/g, "_")}_${callUp.name.replace(/\s+/g, "_")}.pdf`);
      toast.success("¡Reporte PDF descargado!");
    } catch (err) {
      console.error(err);
      toast.error("Error al generar el PDF");
    } finally {
      setExporting(false);
    }
  }

  return (
    <AppLayout>
      <div className="px-8 py-6 border-b">
        <Link
          to={`/convocatorias/${callUp.id}`}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← {callUp.name}
        </Link>
        <div className="flex items-center justify-between mt-2 flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="size-14 rounded-full bg-accent grid place-items-center text-xl font-bold">
              {mockPlayer.number}
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{mockPlayer.name}</h1>
              <p className="text-sm text-muted-foreground">
                {mockPlayer.position} · Métricas individuales de esta convocatoria
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="size-2.5 rounded-full" style={{ background: statusColor(status) }} />
              Estado: <span className="font-medium">{statusLabel}</span>
            </div>
            <button
              onClick={handleExportPDF}
              disabled={exporting}
              className="text-xs flex items-center gap-1.5 px-3 py-2 rounded-md border bg-primary text-primary-foreground font-medium hover:opacity-90 disabled:opacity-50 cursor-pointer"
            >
              {exporting ? (
                <Loader2 className="size-3.5 animate-spin text-primary-foreground" />
              ) : (
                <Download className="size-3.5" />
              )}
              <span>Descargar PDF</span>
            </button>
          </div>
        </div>
      </div>

      <div className="px-8 py-6 space-y-6">
        {error && (
          <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-xs text-yellow-700 dark:text-yellow-300 flex items-center gap-2">
            <AlertTriangle className="size-4 shrink-0" />
            Mostrando datos en caché. ({error})
          </div>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
          <MetricCard label="RPE Medio" value={rpeAvg.toFixed(1)} hint="Escala 1–10" />
          <MetricCard label="Fatiga Media" value={fatAvg.toFixed(1)} hint="Escala 1–10" />
          <MetricCard
            label="UA Total"
            value={Math.round(uaTot).toLocaleString()}
            hint={`${respondedData.length} sesiones`}
          />
          <MetricCard label="UA Máx" value={maxUa} tone={status} hint="Pico de carga" />
          <MetricCard
            label="Ratio A:C"
            value={acLast.toFixed(2)}
            tone={acwrStatus(acLast)}
            hint="Óptimo 0.8–1.3"
          />
          <MetricCard
            label="Monotonía"
            value={monotonia.toFixed(2)}
            tone={monotonia > 2 ? "riesgo" : monotonia > 1.5 ? "moderado" : "optimo"}
            hint="< 1.5 óptimo"
          />
        </div>

        {alerts.length > 0 && (
          <div className="rounded-lg border border-[color:var(--danger)]/40 bg-[color:var(--danger)]/10 p-4">
            <div className="flex items-center gap-2 text-[color:var(--danger)] text-sm font-medium">
              <AlertTriangle className="size-4" />
              {alerts.length} sesión{alerts.length > 1 ? "es" : ""} con carga elevada (UA &gt; {moderado})
              para {mockPlayer.name}
            </div>
          </div>
        )}

        <div className="grid lg:grid-cols-2 gap-4">
          <Panel title={`Evolución RPE y Fatiga — {mockPlayer.name}`}>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={data}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                <YAxis domain={[0, 10]} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="rpe" stroke="var(--chart-1)" strokeWidth={2} name="RPE" />
                <Line type="monotone" dataKey="fatiga" stroke="var(--chart-2)" strokeWidth={2} name="Fatiga" />
              </LineChart>
            </ResponsiveContainer>
          </Panel>

          <Panel title="Carga por sesión (UA = RPE × Tiempo)">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                <Tooltip contentStyle={tooltipStyle} />
                <ReferenceLine y={optimo} stroke="var(--warning)" strokeDasharray="4 4" />
                <ReferenceLine y={moderado} stroke="var(--danger)" strokeDasharray="4 4" />
                <Bar dataKey="ua" radius={[4, 4, 0, 0]} name="UA">
                  {data.map((d) => (
                    <Cell key={d.id} fill={statusColor(uaStatus(d.ua))} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Panel>

          <Panel title="Ratio Agudo:Crónico individual (RPE)">
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={data}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                <YAxis domain={[0, 2]} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                <Tooltip contentStyle={tooltipStyle} />
                <ReferenceArea y1={0.8} y2={1.3} fill="var(--success)" fillOpacity={0.12} />
                <ReferenceLine y={1.5} stroke="var(--danger)" strokeDasharray="4 4" />
                <Line
                  type="monotone"
                  dataKey="ac"
                  stroke="var(--chart-1)"
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                  name="Ratio A:C"
                />
              </LineChart>
            </ResponsiveContainer>
          </Panel>

          <Panel title="RPE vs. Fatiga por tipo de sesión">
            <ResponsiveContainer width="100%" height={260}>
              <ScatterChart>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  dataKey="rpe"
                  domain={[0, 10]}
                  name="RPE"
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                />
                <YAxis
                  type="number"
                  dataKey="fatiga"
                  domain={[0, 10]}
                  name="Fatiga"
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                />
                <ZAxis range={[80, 80]} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ strokeDasharray: "3 3" }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {(["TEC-TAC", "PARTIDO", "LIBRE"] as const).map((t, i) => (
                  <Scatter
                    key={t}
                    name={t}
                    data={data.filter((d) => d.type === t)}
                    fill={`var(--chart-${i + 1})`}
                  />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          </Panel>
        </div>

        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b">
            <h3 className="text-sm font-medium">Registro individual — {mockPlayer.name}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  {["Fecha", "Sesión", "Tipo", "Dur", "RPE", "Fatiga", "UA (Carga)", "A:C (Carga)", "Estado"].map(
                    (h) => (
                      <th key={h} className="text-left font-medium px-3 py-2">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {data.map((d) => {
                  const st = uaStatus(d.ua);
                  function formatDateES(dateStr: string): string {
                    if (!dateStr) return "";
                    const parts = dateStr.split("-");
                    if (parts.length === 3) {
                      return `${parts[2]}/${parts[1]}/${parts[0]}`;
                    }
                    return dateStr;
                  }
                  
                  return (
                    <tr key={d.id} className="border-t hover:bg-muted/20">
                      <td className="px-3 py-2 tabular-nums text-xs">{formatDateES(d.date)}</td>
                      <td className="px-3 py-2">{d.label}</td>
                      <td className="px-3 py-2">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent">
                          {d.type}
                        </span>
                      </td>
                      <td className="px-3 py-2 tabular-nums">{d.duration}'</td>
                      <td className="px-3 py-2 tabular-nums">{d.hasResponse ? d.rpe : "—"}</td>
                      <td className="px-3 py-2 tabular-nums">{d.hasResponse ? d.fatiga : "—"}</td>
                      <td className="px-3 py-2 tabular-nums" style={{ color: statusColor(st) }}>
                        {d.hasResponse ? d.ua : "—"}
                      </td>
                      <td
                        className="px-3 py-2 tabular-nums"
                        style={{ color: statusColor(acwrStatus(d.ac)) }}
                      >
                        {d.hasResponse ? d.ac.toFixed(2) : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {d.hasResponse ? (
                          <span className="inline-flex items-center gap-1.5 text-xs">
                            <span
                              className="size-2 rounded-full"
                              style={{ background: statusColor(st) }}
                            />
                            {st === "riesgo" ? "Riesgo" : st === "moderado" ? "Precaución" : "Óptimo"}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">Sin respuesta</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      
      {/* Hidden layout for PDF exports */}
      {exporting && callUp && (
        <PlayerReportPDF
          jugador={mockPlayer.name}
          callUp={callUp}
          sessions={sessions}
          responses={responses}
          minutes={minutes}
          optimo={optimo}
          moderado={moderado}
          containerId={`pdf-report-${mockPlayer.name.replace(/\s+/g, "-")}`}
        />
      )}
    </AppLayout>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="text-sm font-medium mb-3">{title}</h3>
      {children}
    </div>
  );
}
