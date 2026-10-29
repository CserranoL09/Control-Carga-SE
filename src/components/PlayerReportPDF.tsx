import React from "react";
import { StoredCallUp, StoredSession, isMatchSession, type StoredMinutes } from "@/lib/store";
import { formatMinutes, playerMinutesSummary } from "@/lib/minutes";
import { FormResponse } from "@/lib/sheets-service";
import { players as allPlayers } from "@/lib/mock-data";
import { getPlayerPhoto, ESCUDO_SRC, ESCUDO_FALLBACK_SRC } from "@/lib/player-photos";
import { avg, std, calcACWRSeries, acwrStatus, uaStatus } from "@/lib/metrics";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  ReferenceLine,
  ReferenceArea,
  Legend,
} from "recharts";

interface PlayerReportPDFProps {
  jugador: string;
  callUp: StoredCallUp;
  sessions: StoredSession[];
  responses: FormResponse[];
  minutes?: StoredMinutes[];
  optimo: number;
  moderado: number;
  containerId: string;
}

export function PlayerReportPDF({
  jugador,
  callUp,
  sessions,
  responses,
  minutes = [],
  optimo,
  moderado,
  containerId,
}: PlayerReportPDFProps) {
  const mins = playerMinutesSummary(jugador, minutes);
  const matchCount = sessions.filter(isMatchSession).length;
  // 1. Sort sessions chronologically by date and dayLabel priority
  const sortedSessions = [...sessions].sort((a, b) => {
    const priority: Record<string, number> = { M: 1, "M-T": 2, "": 3, T: 4 };
    const dateComp = a.date.localeCompare(b.date);
    if (dateComp !== 0) return dateComp;
    const pA = priority[a.dayLabel] ?? 99;
    const pB = priority[b.dayLabel] ?? 99;
    if (pA !== pB) return pA - pB;
    return a.id.localeCompare(b.id);
  });

  // Helper to normalize names by removing accents and converting to uppercase
  const normalizeName = (name: string) =>
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toUpperCase();

  // 2. Filter responses belonging to this player using normalized comparison
  const playerResponses = responses.filter(
    (r) => normalizeName(r.jugador) === normalizeName(jugador),
  );

  // 3. Build session-by-session data map
  const sessionData = sortedSessions.map((s) => {
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
    const fatigue = r ? r.fatigue : 0;
    const uaCarga = r ? r.rpe * s.duration : 0;
    const uaFatiga = r ? r.fatigue * s.duration : 0;

    return {
      sessionId: s.id,
      date: s.date,
      dayLabel: s.dayLabel,
      type: s.type,
      duration: s.duration,
      label: s.dayLabel ? `${s.date.slice(5)} ${s.dayLabel}` : s.date.slice(5),
      rpe,
      fatigue,
      uaCarga,
      uaFatiga,
      hasResponse: !!r,
      isMatch: isMatchSession(s),
      minutesPlayed: mins.bySession[s.id],
    };
  });

  // 4. Calculate ACWR for load (RPE) and wellness (Fatigue)
  const completedSessions = sessionData.filter((d) => d.hasResponse);

  const acwrCargaSeries = calcACWRSeries(
    completedSessions.map((d) => ({ date: d.date, ua: d.uaCarga })),
  );
  const acwrFatigaSeries = calcACWRSeries(
    completedSessions.map((d) => ({ date: d.date, ua: d.uaFatiga })),
  );

  const finalSessionData = sessionData.map((d) => {
    if (!d.hasResponse) {
      return {
        ...d,
        acwrCarga: 0,
        acwrFatiga: 0,
      };
    }
    const idx = completedSessions.findIndex((s) => s.sessionId === d.sessionId);
    return {
      ...d,
      acwrCarga: acwrCargaSeries[idx]?.acwr ?? 0,
      acwrFatiga: acwrFatigaSeries[idx]?.acwr ?? 0,
    };
  });

  // 5. Aggregate metrics
  const respondedData = finalSessionData.filter((d) => d.hasResponse);
  const rpeAvg = avg(respondedData.map((d) => d.rpe));
  const fatigueAvg = avg(respondedData.map((d) => d.fatigue));
  const uaCargaTotal = respondedData.reduce((acc, d) => acc + d.uaCarga, 0);
  const uaFatigaTotal = respondedData.reduce((acc, d) => acc + d.uaFatiga, 0);
  const uaCargaMax =
    respondedData.length > 0 ? Math.max(...respondedData.map((d) => d.uaCarga)) : 0;
  const uaFatigaMax =
    respondedData.length > 0 ? Math.max(...respondedData.map((d) => d.uaFatiga)) : 0;

  const acwrCargaLast = acwrCargaSeries[acwrCargaSeries.length - 1]?.acwr ?? 0;
  const acwrFatigaLast = acwrFatigaSeries[acwrFatigaSeries.length - 1]?.acwr ?? 0;

  const uaCargaArr = respondedData.map((d) => d.uaCarga);
  const stdCarga = std(uaCargaArr);
  const monotoniaCarga = avg(uaCargaArr) / (stdCarga || 1);

  // 6. Look up player info in mock-data DB using normalized comparison
  const dbPlayer = allPlayers.find((p) => normalizeName(p.name) === normalizeName(jugador));
  const playerNumber = dbPlayer?.number ?? "—";
  const playerPosition = dbPlayer?.position ?? "Jugador";

  // Helpers for ES format and coloring
  function formatDateES(dateStr: string): string {
    if (!dateStr) return "";
    const parts = dateStr.split("-");
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return dateStr;
  }

  function getStatusLabel(status: "optimo" | "moderado" | "riesgo") {
    if (status === "riesgo") return "Riesgo";
    if (status === "moderado") return "Precaución";
    return "Óptimo";
  }

  function getStatusColorHex(status: "optimo" | "moderado" | "riesgo") {
    if (status === "riesgo") return C.red;
    if (status === "moderado") return C.amber;
    return C.green;
  }

  const photoSrc = getPlayerPhoto(jugador);

  const card: React.CSSProperties = {
    backgroundColor: C.panel,
    border: `1px solid ${C.border}`,
    borderRadius: "8px",
  };
  const sectionTitle: React.CSSProperties = {
    fontSize: "13px",
    fontWeight: 800,
    color: C.text,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    margin: "0 0 10px 0",
  };
  const label: React.CSSProperties = {
    fontSize: "10px",
    color: C.muted,
    textTransform: "uppercase",
    fontWeight: 600,
    letterSpacing: "0.4px",
  };
  const chartTitle: React.CSSProperties = {
    fontSize: "11px",
    fontWeight: 600,
    color: C.text,
    margin: "0 0 10px 0",
    textAlign: "center",
  };
  const axisTick = { fontSize: 9, fill: C.muted };
  const legendStyle = { fontSize: 10, paddingTop: 5, color: C.legend };
  const th: React.CSSProperties = { padding: "8px 8px", fontWeight: 600, color: C.muted };
  const td: React.CSSProperties = { padding: "8px 8px", fontVariantNumeric: "tabular-nums" };

  const metricTiles: { title: string; value: string; hint: string; color?: string }[] = [
    { title: "RPE Medio", value: rpeAvg.toFixed(1), hint: "Escala 1–10" },
    { title: "Fatiga Media", value: fatigueAvg.toFixed(1), hint: "Escala 1–10" },
    { title: "UA Carga Tot", value: uaCargaTotal.toLocaleString(), hint: "RPE × Tiempo" },
    { title: "UA Fatiga Tot", value: uaFatigaTotal.toLocaleString(), hint: "Fatiga × Tiempo" },
    {
      title: "Ratio ACWR Carga",
      value: acwrCargaLast.toFixed(2),
      hint: getStatusLabel(acwrStatus(acwrCargaLast)),
      color: getStatusColorHex(acwrStatus(acwrCargaLast)),
    },
    {
      title: "Ratio ACWR Fatiga",
      value: acwrFatigaLast.toFixed(2),
      hint: getStatusLabel(acwrStatus(acwrFatigaLast)),
      color: getStatusColorHex(acwrStatus(acwrFatigaLast)),
    },
  ];

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "800px",
        height: 0,
        overflow: "hidden",
        zIndex: -100,
        pointerEvents: "none",
      }}
    >
      <div
        id={containerId}
        style={{
          width: "800px",
          backgroundColor: C.bg,
          color: C.text,
          fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
          padding: "40px",
          boxSizing: "border-box",
        }}
      >
        {/* CABECERA */}
        <div
          style={{
            borderBottom: `2px solid ${C.text}`,
            paddingBottom: "16px",
            marginBottom: "24px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: C.text,
                letterSpacing: "2px",
                textTransform: "uppercase",
                marginBottom: "8px",
              }}
            >
              Selección Española de Fútbol Sala · RFEF
            </div>
            <h1
              style={{
                fontSize: "26px",
                fontWeight: 800,
                color: C.text,
                margin: 0,
                letterSpacing: "-0.3px",
              }}
            >
              INFORME INDIVIDUAL DE CARGA Y FATIGA
            </h1>
          </div>
          <div
            style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}
          >
            <Escudo />
            <span style={{ fontSize: "9px", fontWeight: 700, color: C.text, letterSpacing: "1px" }}>
              CONFIDENCIAL
            </span>
          </div>
        </div>

        {/* PANEL DEL JUGADOR */}
        <div
          style={{
            ...card,
            padding: "16px 20px",
            marginBottom: "24px",
            display: "flex",
            gap: "20px",
            alignItems: "center",
          }}
        >
          <PlayerAvatar src={photoSrc} number={playerNumber} name={jugador} />
          <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1.3fr", gap: "16px" }}>
            <div>
              <div style={label}>Jugador</div>
              <div style={{ fontSize: "17px", fontWeight: 800, color: C.text, marginTop: "2px" }}>
                {jugador}
              </div>
              <div style={{ fontSize: "12px", color: C.muted, marginTop: "2px" }}>
                {playerPosition}
              </div>
            </div>
            <div>
              <div style={label}>Convocatoria</div>
              <div style={{ fontSize: "14px", fontWeight: 700, color: C.text, marginTop: "2px" }}>
                {callUp.name}
              </div>
              <div style={{ fontSize: "11px", color: C.muted, marginTop: "2px" }}>
                Sede: {callUp.location} · {formatDateES(callUp.startDate)} al{" "}
                {formatDateES(callUp.endDate)}
              </div>
            </div>
          </div>
          <div
            style={{
              textAlign: "center",
              borderLeft: `1px solid ${C.border}`,
              paddingLeft: "20px",
              minWidth: "120px",
            }}
          >
            <div style={label}>Respuestas Formulario</div>
            <div style={{ fontSize: "22px", fontWeight: 800, color: C.text, marginTop: "4px" }}>
              {respondedData.length} / {sessions.length}
            </div>
            <div style={{ fontSize: "10px", color: C.muted, marginTop: "2px" }}>
              Sesiones completadas
            </div>
          </div>
          {matchCount > 0 && (
            <div
              style={{
                textAlign: "center",
                borderLeft: `1px solid ${C.border}`,
                paddingLeft: "20px",
                minWidth: "120px",
              }}
            >
              <div style={label}>Minutos Jugados</div>
              <div style={{ fontSize: "22px", fontWeight: 800, color: C.text, marginTop: "4px" }}>
                {mins.total > 0 ? formatMinutes(mins.total) : "—"}
              </div>
              <div style={{ fontSize: "10px", color: C.muted, marginTop: "2px" }}>
                {mins.matchesPlayed} / {matchCount} partidos
                {mins.matchesPlayed > 0 ? ` · media ${formatMinutes(mins.average)}` : ""}
              </div>
            </div>
          )}
        </div>

        {/* MÉTRICAS RESUMEN */}
        <h2 style={sectionTitle}>Métricas Resumen de la Convocatoria</h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(6, 1fr)",
            gap: "10px",
            marginBottom: "24px",
          }}
        >
          {metricTiles.map((m) => (
            <div key={m.title} style={{ ...card, padding: "10px 6px", textAlign: "center" }}>
              <div style={{ ...label, fontSize: "9px" }}>{m.title}</div>
              <div
                style={{
                  fontSize: "19px",
                  fontWeight: 800,
                  marginTop: "4px",
                  color: m.color ?? C.text,
                }}
              >
                {m.value}
              </div>
              <div style={{ fontSize: "8px", color: C.muted, marginTop: "2px" }}>{m.hint}</div>
            </div>
          ))}
        </div>

        {/* GRÁFICAS */}
        <h2 style={sectionTitle}>Evolución y Gráficas de Control</h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "20px",
            marginBottom: "20px",
          }}
        >
          <div style={{ ...card, padding: "12px" }}>
            <h3 style={chartTitle}>Evolución Individual: RPE y Fatiga</h3>
            <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
              <LineChart
                width={330}
                height={160}
                data={respondedData}
                margin={{ top: 5, right: 10, left: -25, bottom: 5 }}
              >
                <CartesianGrid stroke={C.grid} strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={axisTick} stroke={C.grid} />
                <YAxis domain={[0, 10]} tick={axisTick} stroke={C.grid} />
                <Legend wrapperStyle={legendStyle} />
                <Line
                  type="monotone"
                  dataKey="rpe"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  name="RPE"
                  isAnimationActive={false}
                  dot={{ r: 3 }}
                />
                <Line
                  type="monotone"
                  dataKey="fatigue"
                  stroke="#ec4899"
                  strokeWidth={2}
                  name="Fatiga"
                  isAnimationActive={false}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </div>
          </div>

          <div style={{ ...card, padding: "12px" }}>
            <h3 style={chartTitle}>Cargas por Sesión: UA Carga vs. UA Fatiga</h3>
            <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
              <BarChart
                width={330}
                height={160}
                data={respondedData}
                margin={{ top: 5, right: 10, left: -20, bottom: 5 }}
              >
                <CartesianGrid stroke={C.grid} strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={axisTick} stroke={C.grid} />
                <YAxis tick={axisTick} stroke={C.grid} />
                <ReferenceLine y={optimo} stroke={C.amber} strokeDasharray="3 3" />
                <ReferenceLine y={moderado} stroke={C.red} strokeDasharray="3 3" />
                <Legend wrapperStyle={legendStyle} />
                <Bar
                  dataKey="uaCarga"
                  fill={C.green}
                  name="UA Carga (RPE)"
                  isAnimationActive={false}
                  radius={[2, 2, 0, 0]}
                />
                <Bar
                  dataKey="uaFatiga"
                  fill="#8b5cf6"
                  name="UA Fatiga"
                  isAnimationActive={false}
                  radius={[2, 2, 0, 0]}
                />
              </BarChart>
            </div>
          </div>
        </div>

        <div style={{ ...card, padding: "12px", marginBottom: "24px" }}>
          <h3 style={chartTitle}>Evolución del Ratio Agudo:Crónico (ACWR) individual</h3>
          <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
            <LineChart
              width={680}
              height={150}
              data={respondedData}
              margin={{ top: 5, right: 10, left: -25, bottom: 5 }}
            >
              <CartesianGrid stroke={C.grid} strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={axisTick} stroke={C.grid} />
              <YAxis domain={[0, 2.0]} tick={axisTick} stroke={C.grid} />
              <ReferenceArea y1={0.8} y2={1.3} fill="#10b981" fillOpacity={0.15} />
              <ReferenceLine y={1.5} stroke={C.red} strokeDasharray="4 4" />
              <Legend wrapperStyle={legendStyle} />
              <Line
                type="monotone"
                dataKey="acwrCarga"
                stroke="#34d399"
                strokeWidth={2}
                name="ACWR Carga (RPE)"
                isAnimationActive={false}
                dot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="acwrFatiga"
                stroke="#a78bfa"
                strokeWidth={2}
                name="ACWR Fatiga"
                isAnimationActive={false}
                dot={{ r: 4 }}
              />
            </LineChart>
          </div>
        </div>

        {/* TABLA DE SESIONES */}
        <h2 style={sectionTitle}>Registro de Sesiones Individual</h2>
        <div style={{ ...card, overflow: "hidden" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "10px",
              textAlign: "left",
              color: C.text,
            }}
          >
            <thead>
              <tr style={{ backgroundColor: C.tableHead, borderBottom: `1px solid ${C.border}` }}>
                <th style={th}>Fecha</th>
                <th style={th}>Sesión / Tipo</th>
                <th style={{ ...th, textAlign: "right" }}>Duración</th>
                <th style={{ ...th, textAlign: "right" }}>Min. jugados</th>
                <th style={{ ...th, textAlign: "center" }}>RPE</th>
                <th style={{ ...th, textAlign: "center" }}>Fatiga</th>
                <th style={{ ...th, textAlign: "right" }}>UA Carga</th>
                <th style={{ ...th, textAlign: "center" }}>ACWR Carga</th>
                <th style={{ ...th, textAlign: "right" }}>UA Fatiga</th>
                <th style={{ ...th, textAlign: "center" }}>ACWR Fatiga</th>
              </tr>
            </thead>
            <tbody>
              {finalSessionData.map((d, index) => {
                const rowStyle: React.CSSProperties = {
                  backgroundColor: index % 2 === 0 ? "transparent" : C.rowAlt,
                  borderBottom: `1px solid ${C.grid}`,
                };
                const minutesCell =
                  d.isMatch && d.minutesPlayed !== undefined ? formatMinutes(d.minutesPlayed) : "—";
                const dayBadge = d.dayLabel && (
                  <span
                    style={{
                      fontSize: "8px",
                      backgroundColor: C.tableHead,
                      padding: "1px 4px",
                      borderRadius: "3px",
                      marginLeft: "4px",
                      color: C.muted,
                    }}
                  >
                    {d.dayLabel}
                  </span>
                );

                if (!d.hasResponse) {
                  return (
                    <tr key={d.sessionId} style={rowStyle}>
                      <td style={{ ...td, color: C.muted }}>{formatDateES(d.date)}</td>
                      <td style={{ ...td, color: C.muted }}>
                        {d.type}
                        {dayBadge}
                      </td>
                      <td style={{ ...td, textAlign: "right", color: C.muted }}>
                        {d.duration} min
                      </td>
                      <td style={{ ...td, textAlign: "right", color: C.muted }}>{minutesCell}</td>
                      <td
                        colSpan={6}
                        style={{ ...td, textAlign: "center", color: C.muted, fontStyle: "italic" }}
                      >
                        Sin respuesta registrada
                      </td>
                    </tr>
                  );
                }

                return (
                  <tr key={d.sessionId} style={rowStyle}>
                    <td style={{ ...td, fontWeight: 600 }}>{formatDateES(d.date)}</td>
                    <td style={td}>
                      <span style={{ fontWeight: 700 }}>{d.type}</span>
                      {dayBadge}
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>{d.duration} min</td>
                    <td
                      style={{
                        ...td,
                        textAlign: "right",
                        fontWeight: d.isMatch ? 700 : 400,
                        color: d.isMatch ? C.text : C.muted,
                      }}
                    >
                      {minutesCell}
                    </td>
                    <td style={{ ...td, textAlign: "center", fontWeight: 700 }}>{d.rpe}</td>
                    <td style={{ ...td, textAlign: "center", fontWeight: 700 }}>{d.fatigue}</td>
                    <td
                      style={{
                        ...td,
                        textAlign: "right",
                        fontWeight: 700,
                        color: getStatusColorHex(uaStatus(d.uaCarga)),
                      }}
                    >
                      {d.uaCarga}
                    </td>
                    <td
                      style={{
                        ...td,
                        textAlign: "center",
                        fontWeight: 800,
                        color: getStatusColorHex(acwrStatus(d.acwrCarga)),
                      }}
                    >
                      {d.acwrCarga.toFixed(2)}
                    </td>
                    <td
                      style={{
                        ...td,
                        textAlign: "right",
                        fontWeight: 700,
                        color: getStatusColorHex(uaStatus(d.uaFatiga)),
                      }}
                    >
                      {d.uaFatiga}
                    </td>
                    <td
                      style={{
                        ...td,
                        textAlign: "center",
                        fontWeight: 800,
                        color: getStatusColorHex(acwrStatus(d.acwrFatiga)),
                      }}
                    >
                      {d.acwrFatiga.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* PIE */}
        <div
          style={{
            marginTop: "32px",
            borderTop: `1px solid ${C.border}`,
            paddingTop: "12px",
            display: "flex",
            justifyContent: "space-between",
            fontSize: "9px",
            color: C.muted,
          }}
        >
          <div>Generado automáticamente por SE-FS Load</div>
          <div>Fecha de emisión: {new Date().toLocaleDateString("es-ES")}</div>
        </div>
      </div>
    </div>
  );
}

// ─── Paleta del informe (tema azul marino) ────────────────────────────────────

const C = {
  bg: "#001b36",
  panel: "rgba(255,255,255,0.04)",
  border: "rgba(255,255,255,0.12)",
  grid: "rgba(255,255,255,0.08)",
  tableHead: "rgba(255,255,255,0.06)",
  rowAlt: "rgba(255,255,255,0.025)",
  text: "#ffffff",
  muted: "#9fb3c8",
  legend: "#cbd5e1",
  gold: "#d4a017",
  green: "#10b981",
  amber: "#f59e0b",
  red: "#ef4444",
};

function Escudo() {
  const [src, setSrc] = React.useState(ESCUDO_SRC);
  return (
    <img
      src={src}
      alt="Escudo"
      onError={() => src !== ESCUDO_FALLBACK_SRC && setSrc(ESCUDO_FALLBACK_SRC)}
      style={{ height: "56px", width: "auto", display: "block" }}
    />
  );
}

/** Foto circular con el dorsal en una insignia dorada. Si no hay foto, círculo con el dorsal. */
function PlayerAvatar({
  src,
  number,
  name,
}: {
  src: string;
  number: number | string;
  name: string;
}) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [src]);
  const hasNumber = number !== "—" && number !== "" && number !== undefined;
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

  if (failed) {
    return (
      <div
        style={{
          minWidth: "64px",
          width: "64px",
          height: "64px",
          borderRadius: "50%",
          border: `2px solid ${C.text}`,
          backgroundColor: "rgba(255,255,255,0.08)",
          color: C.text,
          display: "grid",
          placeItems: "center",
          fontSize: hasNumber ? "24px" : "20px",
          fontWeight: 800,
          boxSizing: "border-box",
        }}
      >
        {hasNumber ? number : initials}
      </div>
    );
  }

  return (
    <div style={{ position: "relative", width: "64px", height: "64px", minWidth: "64px" }}>
      <img
        src={src}
        alt={name}
        onError={() => setFailed(true)}
        style={{
          width: "64px",
          height: "64px",
          borderRadius: "50%",
          border: `2px solid ${C.text}`,
          objectFit: "cover",
          display: "block",
          boxSizing: "border-box",
          backgroundColor: "rgba(255,255,255,0.08)",
        }}
      />
      {hasNumber && (
        <div
          style={{
            position: "absolute",
            right: "-4px",
            bottom: "-4px",
            width: "22px",
            height: "22px",
            borderRadius: "50%",
            backgroundColor: C.gold,
            border: `2px solid ${C.bg}`,
            color: "#ffffff",
            display: "grid",
            placeItems: "center",
            fontSize: "11px",
            fontWeight: 800,
          }}
        >
          {number}
        </div>
      )}
    </div>
  );
}
