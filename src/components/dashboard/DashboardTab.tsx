import { useEffect, useMemo, useState, type ReactNode } from "react";
import { FileDown, LayoutGrid, Loader2, Plus, RotateCcw, Rows3, Save } from "lucide-react";
import { toast } from "sonner";
import type { SessionMetrics } from "@/lib/metrics";
import type { StoredMinutes, StoredRecovery } from "@/lib/store";
import { buildDashboardData, type DashboardFilters } from "@/lib/dashboard-data";
import { ChartPanel, newPanel, type PanelConfig } from "./ChartPanel";
import { PlayerMultiSelect } from "./PlayerMultiSelect";
import { DashboardReport } from "./DashboardReport";
import { exportElementToPdf } from "@/lib/pdf-export";

interface DashboardTabProps {
  callUpId: string;
  callUpName: string;
  location: string;
  startDate: string;
  endDate: string;
  sessionMetrics: SessionMetrics[];
  minutes: StoredMinutes[];
  recovery: StoredRecovery[];
  formPlayers: string[];
  /** Filtro de jugadores de la página (valor inicial) */
  selectedPlayers: string[];
  copyButton: (targetId: string) => ReactNode;
}

interface DashboardState {
  filters: DashboardFilters;
  panels: PanelConfig[];
  columns: 1 | 2;
  /** Informe PDF */
  report?: { title: string; summary: boolean };
}

// ─── Plantillas ───────────────────────────────────────────────────────────────

type TemplateId = "carga-fatiga" | "minutos" | "dos-jugadores" | "carga-recuperacion" | "perfil";

const TEMPLATES: { id: TemplateId; label: string }[] = [
  { id: "carga-fatiga", label: "Carga vs fatiga del equipo" },
  { id: "minutos", label: "Minutos jugados por jugador" },
  { id: "dos-jugadores", label: "Comparar dos jugadores" },
  { id: "carga-recuperacion", label: "Carga vs recuperación" },
  { id: "perfil", label: "Perfil de jugadores" },
];

function templatePanel(id: TemplateId, players: string[]): PanelConfig {
  switch (id) {
    case "carga-fatiga":
      return newPanel({
        title: "Carga vs fatiga del equipo",
        chart: "combo",
        metric: "carga",
        metric2: "fatiga",
        groupBy: "dia",
        seriesBy: "equipo",
        agg: "defecto",
      });
    case "minutos":
      return newPanel({
        title: "Minutos jugados por jugador",
        chart: "barras",
        metric: "minutos",
        groupBy: "jugador",
        agg: "suma",
        teamRef: true,
        own: { players: [], onlyMatches: true },
      });
    case "dos-jugadores":
      return newPanel({
        title: "",
        chart: "lineas",
        metric: "carga",
        groupBy: "sesion",
        seriesBy: "jugador",
        teamRef: true,
        own: { players: players.slice(0, 2), onlyMatches: false },
      });
    case "carga-recuperacion":
      return newPanel({
        title: "Carga del día vs recuperación del día siguiente",
        chart: "dispersion",
        metric: "carga",
        metric2: "recuperacion",
        scatterUnit: "jugador-dia",
        lagY: 1,
        agg: "defecto",
      });
    case "perfil":
      return newPanel({
        title: "Perfil de jugadores",
        chart: "radar",
        radarMetrics: ["carga", "fatiga", "minutos", "recuperacion", "readiness"],
        agg: "defecto",
      });
  }
}

function defaultState(
  start: string,
  end: string,
  players: string[],
  selected: string[],
): DashboardState {
  return {
    filters: { players: selected, from: start, to: end, types: [], onlyMatches: false },
    panels: [templatePanel("carga-fatiga", players), templatePanel("minutos", players)],
    columns: 2,
  };
}

// ─── Persistencia (localStorage, por convocatoria) ────────────────────────────

const stateKey = (id: string) => `dashboard:${id}`;
const viewsKey = (id: string) => `dashboard-views:${id}`;

function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* sin almacenamiento: solo se pierde la configuración guardada */
  }
}

const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

// ─── Componente ───────────────────────────────────────────────────────────────

export function DashboardTab({
  callUpId,
  callUpName,
  location,
  startDate,
  endDate,
  sessionMetrics,
  minutes,
  recovery,
  formPlayers,
  selectedPlayers,
  copyButton,
}: DashboardTabProps) {
  const data = useMemo(
    () => buildDashboardData(sessionMetrics, minutes, recovery, formPlayers),
    [sessionMetrics, minutes, recovery, formPlayers],
  );
  const firstDate = data.dates[0] ?? startDate;
  const lastDate = data.dates[data.dates.length - 1] ?? endDate;

  const [state, setState] = useState<DashboardState>(
    () =>
      load<DashboardState>(stateKey(callUpId)) ??
      defaultState(startDate, endDate, data.players, selectedPlayers),
  );
  const [views, setViews] = useState<Record<string, DashboardState>>(
    () => load(viewsKey(callUpId)) ?? {},
  );
  const [viewName, setViewName] = useState("");
  const [generating, setGenerating] = useState(false);
  const report = state.report ?? { title: "Informe de carga y fatiga", summary: true };
  const setReport = (patch: Partial<NonNullable<DashboardState["report"]>>) =>
    setState((s) => ({ ...s, report: { ...report, ...patch } }));
  const reportPanels = state.panels.filter((p) => p.inReport !== false);

  async function generatePdf() {
    if (reportPanels.length === 0) {
      toast.error("Marca al menos una gráfica con la casilla PDF");
      return;
    }
    setGenerating(true);
    const toastId = toast.loading("Generando informe PDF…");
    try {
      // Dar tiempo a que las gráficas del informe se dibujen
      await new Promise((r) => setTimeout(r, 900));
      const el = document.getElementById("dashboard-report");
      if (!el) throw new Error("No se encontró el informe");
      const safe = (t: string) => t.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, "_");
      await exportElementToPdf(el, `${safe(report.title || "Informe")}_${safe(callUpName)}.pdf`);
      toast.success("Informe PDF descargado", { id: toastId });
    } catch (e) {
      console.error(e);
      toast.error("No se pudo generar el informe PDF", { id: toastId });
    } finally {
      setGenerating(false);
    }
  }

  useEffect(() => store(stateKey(callUpId), state), [callUpId, state]);

  const f = state.filters;
  const setFilters = (patch: Partial<DashboardFilters>) =>
    setState((s) => ({ ...s, filters: { ...s.filters, ...patch } }));
  const setPanels = (fn: (p: PanelConfig[]) => PanelConfig[]) =>
    setState((s) => ({ ...s, panels: fn(s.panels) }));

  function addTemplate(id: TemplateId) {
    setPanels((p) => [...p, templatePanel(id, f.players.length ? f.players : data.players)]);
    toast.success(`Plantilla añadida: ${TEMPLATES.find((t) => t.id === id)?.label}`);
  }

  function saveView() {
    const name = viewName.trim();
    if (!name) {
      toast.error("Escribe un nombre para la vista");
      return;
    }
    const next = { ...views, [name]: state };
    setViews(next);
    store(viewsKey(callUpId), next);
    setViewName("");
    toast.success(`Vista "${name}" guardada`);
  }

  function loadView(name: string) {
    const v = views[name];
    if (v) setState(v);
  }

  function deleteView(name: string) {
    const next = { ...views };
    delete next[name];
    setViews(next);
    store(viewsKey(callUpId), next);
  }

  function reset() {
    setState(defaultState(startDate, endDate, data.players, selectedPlayers));
    toast.success("Dashboard restablecido");
  }

  if (data.sessionRows.length === 0 && data.dayRows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        No hay datos en esta convocatoria todavía.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filtros globales */}
      <div className="rounded-lg border bg-card p-3 flex flex-wrap items-end gap-x-5 gap-y-3 text-xs">
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground">Jugadores</span>
          <PlayerMultiSelect
            players={data.players}
            value={f.players}
            onChange={(players) => setFilters({ players })}
          />
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground">Días</span>
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={f.from}
              min={startDate}
              max={f.to || endDate}
              onChange={(e) => setFilters({ from: e.target.value })}
              className="bg-background border rounded-md px-2 py-1"
              aria-label="Desde"
            />
            <span className="text-muted-foreground">→</span>
            <input
              type="date"
              value={f.to}
              min={f.from || startDate}
              max={endDate}
              onChange={(e) => setFilters({ to: e.target.value })}
              className="bg-background border rounded-md px-2 py-1"
              aria-label="Hasta"
            />
          </div>
        </div>

        <div className="flex items-center gap-1">
          {[
            ["Toda la convocatoria", startDate, endDate],
            [
              "Últimos 3 días",
              addDays(lastDate, -2) < firstDate ? firstDate : addDays(lastDate, -2),
              lastDate,
            ],
            ["Último día", lastDate, lastDate],
          ].map(([label, from, to]) => (
            <button
              key={label}
              type="button"
              onClick={() => setFilters({ from, to })}
              className={`px-2 py-1 rounded-md border hover:bg-accent ${f.from === from && f.to === to ? "bg-accent text-foreground" : "text-muted-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground">Tipos de sesión</span>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {data.sessionTypes.map((t) => (
              <label key={t} className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={f.types.length === 0 || f.types.includes(t)}
                  onChange={(e) => {
                    const current = f.types.length === 0 ? data.sessionTypes : f.types;
                    const next = e.target.checked
                      ? [...current, t]
                      : current.filter((x) => x !== t);
                    setFilters({ types: next.length === data.sessionTypes.length ? [] : next });
                  }}
                />
                {t}
              </label>
            ))}
            <label className="flex items-center gap-1 cursor-pointer border-l pl-3">
              <input
                type="checkbox"
                checked={f.onlyMatches}
                onChange={(e) => setFilters({ onlyMatches: e.target.checked })}
              />
              Solo partidos
            </label>
          </div>
        </div>
      </div>

      {/* Barra de herramientas */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => setPanels((p) => [...p, newPanel()])}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90"
        >
          <Plus className="size-3.5" /> Añadir gráfica
        </button>
        <select
          value=""
          onChange={(e) => e.target.value && addTemplate(e.target.value as TemplateId)}
          className="bg-background border rounded-md px-2 py-1.5"
          aria-label="Cargar plantilla"
        >
          <option value="">Cargar plantilla…</option>
          {TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>

        <div
          className="inline-flex rounded-md border p-0.5 bg-muted/30"
          role="group"
          aria-label="Columnas"
        >
          {([1, 2] as const).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setState((s) => ({ ...s, columns: n }))}
              aria-pressed={state.columns === n}
              title={n === 1 ? "Una columna" : "Dos columnas"}
              className={`px-2 py-1 rounded ${state.columns === n ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {n === 1 ? <Rows3 className="size-3.5" /> : <LayoutGrid className="size-3.5" />}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 ml-auto">
          {Object.keys(views).length > 0 && (
            <select
              value=""
              onChange={(e) => {
                const v = e.target.value;
                if (v.startsWith("del:")) deleteView(v.slice(4));
                else if (v) loadView(v);
              }}
              className="bg-background border rounded-md px-2 py-1.5"
              aria-label="Vistas guardadas"
            >
              <option value="">Vistas guardadas…</option>
              <optgroup label="Abrir">
                {Object.keys(views).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Eliminar">
                {Object.keys(views).map((n) => (
                  <option key={`del-${n}`} value={`del:${n}`}>
                    🗑 {n}
                  </option>
                ))}
              </optgroup>
            </select>
          )}
          <input
            value={viewName}
            onChange={(e) => setViewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveView()}
            placeholder="Nombre de la vista"
            className="bg-background border rounded-md px-2 py-1.5 w-36"
          />
          <button
            type="button"
            onClick={saveView}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md border hover:bg-accent"
          >
            <Save className="size-3.5" /> Guardar vista
          </button>
          <button
            type="button"
            onClick={reset}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md border hover:bg-accent text-muted-foreground"
          >
            <RotateCcw className="size-3.5" /> Restablecer
          </button>
        </div>
      </div>

      {/* Informe PDF */}
      <div className="rounded-lg border bg-card px-3 py-2.5 flex flex-wrap items-center gap-3 text-xs">
        <span className="font-medium text-sm">Informe PDF</span>
        <input
          value={report.title}
          onChange={(e) => setReport({ title: e.target.value })}
          placeholder="Título del informe"
          aria-label="Título del informe"
          className="bg-background border rounded-md px-2 py-1.5 w-64"
        />
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={report.summary}
            onChange={(e) => setReport({ summary: e.target.checked })}
          />
          Incluir resumen del periodo
        </label>
        <span className="text-muted-foreground">
          {reportPanels.length} de {state.panels.length} gráficas marcadas con "PDF"
        </span>
        <button
          type="button"
          onClick={generatePdf}
          disabled={generating}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90 disabled:opacity-50"
        >
          {generating ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <FileDown className="size-3.5" />
          )}
          Generar informe PDF
        </button>
      </div>

      {generating && (
        <DashboardReport
          containerId="dashboard-report"
          title={report.title}
          callUp={{ name: callUpName, location, startDate, endDate }}
          data={data}
          filters={f}
          panels={reportPanels}
          includeSummary={report.summary}
        />
      )}

      {/* Paneles */}
      {state.panels.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No hay gráficas. Pulsa "Añadir gráfica" o carga una plantilla.
        </div>
      ) : (
        <div className={`grid gap-4 ${state.columns === 2 ? "xl:grid-cols-2" : "grid-cols-1"}`}>
          {state.panels.map((p, i) => (
            <ChartPanel
              key={p.id}
              config={p}
              data={data}
              globalFilters={f}
              copyButton={copyButton}
              onChange={(c) => setPanels((ps) => ps.map((x) => (x.id === c.id ? c : x)))}
              onDuplicate={() =>
                setPanels((ps) => {
                  const copy = {
                    ...p,
                    id: newPanel().id,
                    title: p.title ? `${p.title} (copia)` : "",
                  };
                  return [...ps.slice(0, i + 1), copy, ...ps.slice(i + 1)];
                })
              }
              onDelete={() => setPanels((ps) => ps.filter((x) => x.id !== p.id))}
              onMove={(dir) =>
                setPanels((ps) => {
                  const j = i + dir;
                  if (j < 0 || j >= ps.length) return ps;
                  const next = [...ps];
                  [next[i], next[j]] = [next[j], next[i]];
                  return next;
                })
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
