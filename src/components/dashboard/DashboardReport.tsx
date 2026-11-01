/**
 * Informe PDF del Dashboard. Misma estética que el informe individual de jugador:
 * fondo azul marino #001b36, cabecera RFEF, escudo y "CONFIDENCIAL".
 * Se renderiza fuera de pantalla y se captura con exportElementToPdf.
 */
import { useState, type CSSProperties } from "react";
import type { DashboardData, DashboardFilters } from "@/lib/dashboard-data";
import {
  aggregate,
  fmtValue,
  GROUP_LABEL,
  METRIC,
  observations,
  resolveAgg,
} from "@/lib/dashboard-data";
import { ESCUDO_FALLBACK_SRC, ESCUDO_SRC } from "@/lib/player-photos";
import {
  autoTitle,
  CHART_LABEL,
  PanelChartBody,
  panelFilters,
  PrintContext,
  usePanelComputed,
  type PanelConfig,
} from "./ChartPanel";
import { NONE } from "./PlayerMultiSelect";

const C = {
  bg: "#001b36",
  panel: "#0a2540",
  border: "rgba(255,255,255,0.12)",
  text: "#ffffff",
  muted: "#9fb3c8",
};

/** Variables del tema para que tablas, ejes y heatmaps usen la paleta del informe */
const THEME_VARS = {
  "--background": C.bg,
  "--foreground": C.text,
  "--card": C.panel,
  "--card-foreground": C.text,
  "--popover": C.panel,
  "--popover-foreground": C.text,
  "--border": C.border,
  "--muted": "rgba(255,255,255,0.06)",
  "--muted-foreground": C.muted,
  "--accent": "rgba(255,255,255,0.08)",
} as CSSProperties;

const label: CSSProperties = {
  fontSize: 10,
  color: C.muted,
  textTransform: "uppercase",
  fontWeight: 600,
  letterSpacing: 0.4,
};
const sectionTitle: CSSProperties = {
  fontSize: 13,
  fontWeight: 800,
  color: C.text,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  margin: "0 0 10px 0",
};
const card: CSSProperties = {
  backgroundColor: C.panel,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
};

const fecha = (iso: string) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

interface DashboardReportProps {
  containerId: string;
  title: string;
  callUp: { name: string; location: string; startDate: string; endDate: string };
  data: DashboardData;
  filters: DashboardFilters;
  panels: PanelConfig[];
  includeSummary: boolean;
}

export function DashboardReport({
  containerId,
  title,
  callUp,
  data,
  filters,
  panels,
  includeSummary,
}: DashboardReportProps) {
  const players = filters.players.filter((p) => p !== NONE);
  const playersText =
    filters.players.length === 0
      ? "Todos"
      : players.length === 0
        ? "Ninguno"
        : players.length <= 6
          ? players.join(", ")
          : `${players.length} jugadores`;
  const typesText = filters.onlyMatches
    ? "Solo partidos"
    : filters.types.length
      ? filters.types.join(", ")
      : "Todos";

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: 800,
        height: 0,
        overflow: "hidden",
        zIndex: -100,
        pointerEvents: "none",
      }}
    >
      <PrintContext.Provider value={true}>
        <div
          id={containerId}
          style={{
            ...THEME_VARS,
            width: 800,
            backgroundColor: C.bg,
            color: C.text,
            fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
            padding: 40,
            boxSizing: "border-box",
          }}
        >
          {/* CABECERA */}
          <div
            data-pdf-keep
            style={{
              borderBottom: `2px solid ${C.text}`,
              paddingBottom: 16,
              marginBottom: 24,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-end",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 2,
                  textTransform: "uppercase",
                  marginBottom: 8,
                }}
              >
                Selección Española de Fútbol Sala · RFEF
              </div>
              <h1
                style={{
                  fontSize: 26,
                  fontWeight: 800,
                  margin: 0,
                  letterSpacing: -0.3,
                  textTransform: "uppercase",
                }}
              >
                {title || "Informe de carga y fatiga"}
              </h1>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <Escudo />
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1 }}>CONFIDENCIAL</span>
            </div>
          </div>

          {/* DATOS DE LA CONVOCATORIA Y FILTROS */}
          <div
            data-pdf-keep
            style={{
              ...card,
              padding: "16px 20px",
              marginBottom: 24,
              display: "grid",
              gridTemplateColumns: "1.2fr 1fr 1fr",
              gap: 20,
            }}
          >
            <div>
              <div style={label}>Convocatoria</div>
              <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>{callUp.name}</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                Sede: {callUp.location} · {fecha(callUp.startDate)} al {fecha(callUp.endDate)}
              </div>
            </div>
            <div>
              <div style={label}>Periodo analizado</div>
              <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>
                {fecha(filters.from || callUp.startDate)} – {fecha(filters.to || callUp.endDate)}
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                Sesiones: {typesText}
              </div>
            </div>
            <div>
              <div style={label}>Jugadores</div>
              <div style={{ fontSize: 12, fontWeight: 600, marginTop: 2, lineHeight: 1.35 }}>
                {playersText}
              </div>
            </div>
          </div>

          {includeSummary && <Summary data={data} filters={filters} />}

          <h2 style={sectionTitle}>Visualizaciones</h2>
          {panels.length === 0 && (
            <div style={{ ...card, padding: 20, color: C.muted, fontSize: 12 }}>
              No hay gráficas seleccionadas para el informe.
            </div>
          )}
          {panels.map((p) => (
            <ReportPanel key={p.id} c={p} data={data} globalFilters={filters} />
          ))}

          {/* PIE */}
          <div
            data-pdf-keep
            style={{
              marginTop: 32,
              borderTop: `1px solid ${C.border}`,
              paddingTop: 12,
              display: "flex",
              justifyContent: "space-between",
              fontSize: 9,
              color: C.muted,
            }}
          >
            <div>Generado automáticamente por SE-FS Load · Dashboard</div>
            <div>Fecha de emisión: {new Date().toLocaleDateString("es-ES")}</div>
          </div>
        </div>
      </PrintContext.Provider>
    </div>
  );
}

function Summary({ data, filters }: { data: DashboardData; filters: DashboardFilters }) {
  const carga = observations(data, "carga", filters);
  const fatiga = observations(data, "fatiga", filters);
  const minutos = observations(data, "minutos", filters);
  const rec = observations(data, "recuperacion", filters);
  const sesiones = new Set(carga.map((o) => o.sessionId)).size;
  const jugadores = new Set([...carga, ...rec].map((o) => o.jugador)).size;
  const sum = (a: { value: number }[]) => a.reduce((s, o) => s + o.value, 0);
  const avg = (a: { value: number }[]) => (a.length ? sum(a) / a.length : null);
  const perPlayer = aggregate(data, {
    metrics: ["carga"],
    groupBy: "jugador",
    seriesBy: "equipo",
    agg: "suma",
    filters,
  });
  const vals = perPlayer.rows.map((r) => r.carga).filter((v): v is number => typeof v === "number");

  const tiles: { t: string; v: string; h: string }[] = [
    { t: "Sesiones", v: String(sesiones), h: `${jugadores} jugadores` },
    { t: "Carga total", v: fmtValue("carga", sum(carga)), h: "UA (RPE × tiempo)" },
    {
      t: "Carga media jugador",
      v: fmtValue(
        "carga",
        vals.length ? sum(vals.map((value) => ({ value }))) / vals.length : null,
      ),
      h: "UA en el periodo",
    },
    { t: "Fatiga media", v: fmtValue("fatiga", avg(fatiga)), h: "Escala 1–10" },
    { t: "Minutos jugados", v: fmtValue("minutos", sum(minutos)), h: "Total en partidos" },
    { t: "Recuperación media", v: fmtValue("recuperacion", avg(rec)), h: "0–10 (más alto = peor)" },
  ];

  return (
    <div data-pdf-keep style={{ marginBottom: 24 }}>
      <h2 style={sectionTitle}>Resumen del periodo</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10 }}>
        {tiles.map((x) => (
          <div key={x.t} style={{ ...card, padding: "10px 6px", textAlign: "center" }}>
            <div style={{ ...label, fontSize: 9 }}>{x.t}</div>
            <div style={{ fontSize: 19, fontWeight: 800, marginTop: 4 }}>{x.v}</div>
            <div style={{ fontSize: 8, color: C.muted, marginTop: 2 }}>{x.h}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReportPanel({
  c,
  data,
  globalFilters,
}: {
  c: PanelConfig;
  data: DashboardData;
  globalFilters: DashboardFilters;
}) {
  const filters = panelFilters(c, globalFilters);
  const computed = usePanelComputed(c, data, filters);
  const players = filters.players.filter((p) => p !== NONE);
  const parts: string[] = [CHART_LABEL[c.chart]];
  if (c.chart !== "radar") {
    parts.push(`${METRIC[c.metric].short}${c.metric2 ? ` y ${METRIC[c.metric2].short}` : ""}`);
    if (c.chart !== "dispersion") parts.push(`por ${GROUP_LABEL[c.groupBy].toLowerCase()}`);
    parts.push(
      resolveAgg(c.metric, c.agg) === "suma"
        ? "suma"
        : resolveAgg(c.metric, c.agg) === "media"
          ? "media"
          : resolveAgg(c.metric, c.agg),
    );
  }
  if (c.own) parts.push(`filtros propios${c.own.onlyMatches ? " · solo partidos" : ""}`);

  return (
    <div data-pdf-keep style={{ ...card, padding: 14, marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>
        {c.title || autoTitle(c, players)}
      </div>
      <div style={{ fontSize: 10, color: C.muted, marginBottom: 10 }}>{parts.join(" · ")}</div>
      <div style={{ width: 692 }}>
        <PanelChartBody c={c} data={data} computed={computed} />
      </div>
    </div>
  );
}

function Escudo() {
  const [src, setSrc] = useState(ESCUDO_SRC);
  return (
    <img
      src={src}
      alt="Escudo"
      onError={() => src !== ESCUDO_FALLBACK_SRC && setSrc(ESCUDO_FALLBACK_SRC)}
      style={{ height: 56, width: "auto", display: "block" }}
    />
  );
}
