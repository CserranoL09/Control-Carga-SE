import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Download, Info } from "lucide-react";
import type { SessionMetrics } from "@/lib/metrics";
import type { StoredMinutes } from "@/lib/store";
import { downloadBlob } from "@/lib/pdf-export";
import {
  calcZPlayerSummary,
  calcZSessions,
  fmtNum,
  fmtZ,
  zBand,
  zSessionsToCsv,
  type ZBand,
  type ZPlayerSummary,
  type ZSession,
} from "@/lib/zscore";

type Vista = "fatiga" | "carga";

interface ZScoreTabProps {
  sessionMetrics: SessionMetrics[];
  minutes: StoredMinutes[];
  /** Jugadores visibles (respeta el filtro de la página) */
  players: string[];
  callUpName: string;
  /** Botón "Copiar PNG" de la página */
  copyButton: (targetId: string) => ReactNode;
}

const BAND_STYLE: Record<ZBand, string> = {
  "muy-bajo": "bg-[#1d4ed8] text-white font-semibold",
  bajo: "bg-[#93c5fd] text-[#0b1f44] font-medium",
  normal: "bg-transparent text-foreground",
  alto: "bg-[#f59e0b] text-[#2b1700] font-semibold",
  "muy-alto": "bg-[#dc2626] text-white font-bold",
};

const LEGEND: { band: ZBand; label: string }[] = [
  { band: "muy-bajo", label: "z ≤ −2" },
  { band: "bajo", label: "−2 < z ≤ −1" },
  { band: "normal", label: "−1 < z < +1" },
  { band: "alto", label: "+1 ≤ z < +2" },
  { band: "muy-alto", label: "z ≥ +2" },
];

function dateLabel(iso: string, dayLabel: string) {
  const [, m, d] = iso.split("-");
  return `${d}/${m}${dayLabel ? ` ${dayLabel}` : ""}`;
}

function readVista(): Vista {
  try {
    return localStorage.getItem("zscore-vista") === "carga" ? "carga" : "fatiga";
  } catch {
    return "fatiga";
  }
}

export function ZScoreTab({
  sessionMetrics,
  minutes,
  players,
  callUpName,
  copyButton,
}: ZScoreTabProps) {
  const [vista, setVistaState] = useState<Vista>(readVista);
  const setVista = (v: Vista) => {
    setVistaState(v);
    try {
      localStorage.setItem("zscore-vista", v);
    } catch {
      /* sin almacenamiento */
    }
  };

  // El z se calcula siempre con TODO el grupo de la sesión; el filtro solo decide qué se muestra
  const zSessions = useMemo(
    () => calcZSessions(sessionMetrics, minutes),
    [sessionMetrics, minutes],
  );
  const visiblePlayers = useMemo(
    () => players.filter((p) => zSessions.some((s) => s.rows.some((r) => r.jugador === p))),
    [players, zSessions],
  );
  const summary = useMemo(
    () => calcZPlayerSummary(zSessions, visiblePlayers),
    [zSessions, visiblePlayers],
  );

  if (zSessions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        No hay sesiones con duración y respuestas en esta convocatoria. Añade la duración de las
        sesiones para calcular los z-score.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className="inline-flex rounded-md border p-0.5 bg-muted/30"
          role="group"
          aria-label="Variable del z-score"
        >
          {(["fatiga", "carga"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVista(v)}
              aria-pressed={vista === v}
              className={`px-4 py-1.5 text-sm rounded font-medium transition-colors ${
                vista === v
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {v === "fatiga" ? "Fatiga" : "Carga"}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground flex items-center gap-1.5 max-w-xl">
          <Info className="size-3.5 shrink-0" />
          El z-score compara a cada jugador con el grupo en esa misma sesión: 0 = como la media; +1
          / −1 = una desviación por encima / por debajo.
        </p>
      </div>

      <ZHeatmap
        zSessions={zSessions}
        players={visiblePlayers}
        vista={vista}
        copyButton={copyButton}
      />

      <ZSummaryTable summary={summary} vista={vista} copyButton={copyButton} />

      <ZDetailTable zSessions={zSessions} players={visiblePlayers} callUpName={callUpName} />
    </div>
  );
}

// ─── Heatmap jugadores × sesiones ─────────────────────────────────────────────

function ZHeatmap({
  zSessions,
  players,
  vista,
  copyButton,
}: {
  zSessions: ZSession[];
  players: string[];
  vista: Vista;
  copyButton: (id: string) => ReactNode;
}) {
  const id = `zscore-heatmap-${vista}`;
  const sticky = "sticky left-0 z-10 bg-card shadow-[1px_0_0_var(--border)]";
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">
          Z-score de {vista === "fatiga" ? "fatiga" : "carga (RPE × tiempo)"} — jugadores × sesiones
        </h3>
        {copyButton(id)}
      </div>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table id={id} className="w-full text-[11px] border-collapse text-center bg-card">
          <thead>
            <tr className="border-b bg-muted/30">
              <th
                className={`${sticky} px-3 py-1.5 text-left text-[10px] uppercase tracking-wider min-w-[150px]`}
              >
                Fecha
              </th>
              {zSessions.map((s) => (
                <th
                  key={s.sessionId}
                  className="px-2 py-1.5 border-l font-semibold tabular-nums whitespace-nowrap"
                >
                  {dateLabel(s.date, s.dayLabel)}
                </th>
              ))}
            </tr>
            <tr className="border-b bg-muted/30">
              <th
                className={`${sticky} px-3 py-1.5 text-left text-[10px] uppercase tracking-wider`}
              >
                Jugador
              </th>
              {zSessions.map((s) => (
                <th
                  key={s.sessionId}
                  className={`px-2 py-1.5 border-l text-[10px] font-medium whitespace-nowrap ${
                    s.isMatch ? "text-cyan-400" : "text-muted-foreground"
                  }`}
                >
                  {s.type}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {players.map((jugador) => (
              <tr key={jugador} className="border-b">
                <td
                  className={`${sticky} px-3 py-1 text-left font-bold uppercase text-[10px] whitespace-nowrap`}
                >
                  {jugador}
                </td>
                {zSessions.map((s) => {
                  const r = s.rows.find((x) => x.jugador === jugador);
                  if (!r) {
                    return (
                      <td key={s.sessionId} className="px-2 py-1 border-l text-muted-foreground/50">
                        ·
                      </td>
                    );
                  }
                  const z = vista === "fatiga" ? r.zFatiga : r.zCarga;
                  const band = zBand(z);
                  const raw =
                    vista === "fatiga"
                      ? `Fatiga ${r.fatiga} · media ${fmtNum(s.mediaFatiga, 1)} · DE ${fmtNum(s.sdFatiga, 2)}`
                      : `Carga ${fmtNum(r.cargaIndividual)} (RPE ${r.rpe} × ${fmtNum(r.tiempo, Number.isInteger(r.tiempo) ? 0 : 2)} min) · media ${fmtNum(s.cargaSesion)} · DE ${fmtNum(s.sdCarga, 1)}`;
                  const note = !s.hasZ
                    ? " · menos de 3 respuestas: sin z-score"
                    : vista === "carga" && r.sinMinutos
                      ? " · sin minutos jugados: se usó la duración"
                      : "";
                  return (
                    <td
                      key={s.sessionId}
                      title={`${jugador} — ${raw}${note}`}
                      className={`px-2 py-1 border-l tabular-nums ${band ? BAND_STYLE[band] : "text-muted-foreground"}`}
                    >
                      {fmtZ(z)}
                      {vista === "carga" && r.sinMinutos && (
                        <sup className="ml-0.5 opacity-80">*</sup>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr className="bg-muted/30 font-semibold">
              <td
                className={`${sticky} px-3 py-1.5 text-left text-[10px] uppercase tracking-wider`}
              >
                Promedio {vista === "fatiga" ? "fatiga" : "carga"}
              </td>
              {zSessions.map((s) => (
                <td key={s.sessionId} className="px-2 py-1.5 border-l tabular-nums">
                  {vista === "fatiga" ? fmtNum(s.mediaFatiga, 1) : fmtNum(s.cargaSesion)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
        {LEGEND.map((l) => (
          <span key={l.band} className="inline-flex items-center gap-1.5">
            <span className={`inline-block size-3 rounded-sm border ${BAND_STYLE[l.band]}`} />
            {l.label}
          </span>
        ))}
        {vista === "carga" && zSessions.some((s) => s.rows.some((r) => r.sinMinutos)) && (
          <span>* partido sin minutos registrados: se usa la duración de la sesión</span>
        )}
        <span>· = sin respuesta</span>
      </div>
    </section>
  );
}

// ─── Resumen por jugador ──────────────────────────────────────────────────────

type SortKey = "jugador" | "sesiones" | "zMedio" | "sobre1" | "sobre2" | "zUltima";

function ZSummaryTable({
  summary,
  vista,
  copyButton,
}: {
  summary: ZPlayerSummary[];
  vista: Vista;
  copyButton: (id: string) => ReactNode;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "zUltima", dir: -1 });
  const id = `zscore-resumen-${vista}`;
  const pick = (p: ZPlayerSummary) =>
    vista === "fatiga"
      ? {
          zMedio: p.zMedioFatiga,
          sobre1: p.fatigaSobre1,
          sobre2: p.fatigaSobre2,
          zUltima: p.zUltimaFatiga,
        }
      : {
          zMedio: p.zMedioCarga,
          sobre1: p.cargaSobre1,
          sobre2: p.cargaSobre2,
          zUltima: p.zUltimaCarga,
        };

  const rows = [...summary].sort((a, b) => {
    const va =
      sort.key === "jugador" ? a.jugador : sort.key === "sesiones" ? a.sesiones : pick(a)[sort.key];
    const vb =
      sort.key === "jugador" ? b.jugador : sort.key === "sesiones" ? b.sesiones : pick(b)[sort.key];
    if (typeof va === "string" && typeof vb === "string")
      return va.localeCompare(vb, "es") * sort.dir;
    return ((va ?? -Infinity) as number) > ((vb ?? -Infinity) as number) ? sort.dir : -sort.dir;
  });

  const Th = ({
    k,
    children,
    align = "right",
  }: {
    k: SortKey;
    children: ReactNode;
    align?: "left" | "right";
  }) => (
    <th className={`px-3 py-2 font-medium ${align === "left" ? "text-left" : "text-right"}`}>
      <button
        type="button"
        onClick={() =>
          setSort((s) => ({
            key: k,
            dir: s.key === k ? (s.dir === 1 ? -1 : 1) : k === "jugador" ? 1 : -1,
          }))
        }
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {children}
        {sort.key === k && <span aria-hidden>{sort.dir === 1 ? "▲" : "▼"}</span>}
      </button>
    </th>
  );

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">
          Resumen por jugador — {vista === "fatiga" ? "fatiga" : "carga"}
        </h3>
        {copyButton(id)}
      </div>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table id={id} className="w-full text-xs bg-card">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <Th k="jugador" align="left">
                Jugador
              </Th>
              <Th k="sesiones">Sesiones</Th>
              <Th k="zMedio">z medio</Th>
              <Th k="sobre1">Nº sesiones z ≥ +1</Th>
              <Th k="sobre2">Nº sesiones z ≥ +2</Th>
              <Th k="zUltima">z última sesión</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const v = pick(p);
              const alert = v.zUltima !== null && v.zUltima >= 2;
              const band = zBand(v.zUltima);
              return (
                <tr key={p.jugador} className={`border-t ${alert ? "bg-[#dc2626]/10" : ""}`}>
                  <td className="px-3 py-1.5 font-medium">
                    {p.jugador}
                    {alert && (
                      <span className="ml-2 text-[10px] font-semibold text-[#f87171]">ALERTA</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{p.sesiones}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtZ(v.zMedio)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{v.sobre1}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{v.sobre2}</td>
                  <td className="px-3 py-1.5 text-right">
                    <span
                      className={`inline-block min-w-[3rem] text-center rounded px-1.5 py-0.5 tabular-nums ${band ? BAND_STYLE[band] : ""}`}
                    >
                      {fmtZ(v.zUltima)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ─── Tabla detallada (BBDD FATIGA-CARGA) ──────────────────────────────────────

function ZDetailTable({
  zSessions,
  players,
  callUpName,
}: {
  zSessions: ZSession[];
  players: string[];
  callUpName: string;
}) {
  const [open, setOpen] = useState(false);

  function exportCsv() {
    const csv = zSessionsToCsv(zSessions, players);
    const safe = callUpName.replace(/\s+/g, "_").replace(/[\\/:*?"<>|]/g, "");
    downloadBlob(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
      `BBDD_Fatiga_Carga_${safe}.csv`,
    );
  }

  const fecha = (iso: string, dl: string) => {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}${dl ? ` ${dl}` : ""}`;
  };
  const zCell = (z: number | null) => {
    const band = zBand(z);
    return (
      <span
        className={`inline-block min-w-[2.5rem] rounded px-1 ${band && band !== "normal" ? BAND_STYLE[band] : ""}`}
      >
        {fmtZ(z)}
      </span>
    );
  };

  return (
    <section className="rounded-lg border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="inline-flex items-center gap-2 text-sm font-medium hover:text-foreground"
        >
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          Tabla detallada (BBDD Fatiga-Carga)
        </button>
        <button
          type="button"
          onClick={exportCsv}
          className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-md border hover:bg-accent"
        >
          <Download className="size-3.5" /> Exportar CSV
        </button>
      </div>
      {open && (
        <div className="overflow-x-auto border-t">
          <table className="w-full text-[11px]">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                {[
                  "Fecha",
                  "Tipo sesión",
                  "Jugador",
                  "RPE",
                  "Tiempo (min)",
                  "Fatiga",
                  "Carga sesión",
                  "Carga individual",
                  "Z-score fatiga",
                  "Z-score carga",
                ].map((h, i) => (
                  <th
                    key={h}
                    className={`px-3 py-2 font-medium whitespace-nowrap ${i < 3 ? "text-left" : "text-right"}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {zSessions.map((s) => {
                const rows = s.rows.filter((r) => players.includes(r.jugador));
                return [
                  ...rows.map((r) => (
                    <tr key={`${s.sessionId}-${r.jugador}`} className="border-t">
                      <td className="px-3 py-1 tabular-nums whitespace-nowrap">
                        {fecha(s.date, s.dayLabel)}
                      </td>
                      <td className="px-3 py-1">{s.type}</td>
                      <td className="px-3 py-1 font-medium">{r.jugador}</td>
                      <td className="px-3 py-1 text-right tabular-nums">{r.rpe}</td>
                      <td className="px-3 py-1 text-right tabular-nums">
                        {fmtNum(r.tiempo, Number.isInteger(r.tiempo) ? 0 : 2)}
                        {r.sinMinutos && (
                          <sup title="Sin minutos jugados: se usa la duración">*</sup>
                        )}
                      </td>
                      <td className="px-3 py-1 text-right tabular-nums">{r.fatiga}</td>
                      <td className="px-3 py-1 text-right tabular-nums text-muted-foreground">
                        {fmtNum(s.cargaSesion)}
                      </td>
                      <td className="px-3 py-1 text-right tabular-nums">
                        {fmtNum(r.cargaIndividual)}
                      </td>
                      <td className="px-3 py-1 text-right tabular-nums">{zCell(r.zFatiga)}</td>
                      <td className="px-3 py-1 text-right tabular-nums">{zCell(r.zCarga)}</td>
                    </tr>
                  )),
                  <tr key={`${s.sessionId}-prom`} className="border-t bg-muted/30 font-semibold">
                    <td className="px-3 py-1 tabular-nums whitespace-nowrap">
                      {fecha(s.date, s.dayLabel)}
                    </td>
                    <td className="px-3 py-1">{s.type}</td>
                    <td className="px-3 py-1">PROMEDIO</td>
                    <td className="px-3 py-1 text-right tabular-nums">{fmtNum(s.mediaRpe, 1)}</td>
                    <td className="px-3 py-1 text-right tabular-nums">{s.duration}</td>
                    <td className="px-3 py-1 text-right tabular-nums">
                      {fmtNum(s.mediaFatiga, 1)}
                    </td>
                    <td className="px-3 py-1 text-right tabular-nums">{fmtNum(s.cargaSesion)}</td>
                    <td className="px-3 py-1 text-right tabular-nums">{fmtNum(s.cargaSesion)}</td>
                    <td className="px-3 py-1" />
                    <td className="px-3 py-1" />
                  </tr>,
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
