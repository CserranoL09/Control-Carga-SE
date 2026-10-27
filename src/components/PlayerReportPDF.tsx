import React from "react";
import { StoredCallUp, StoredSession, isMatchSession, type StoredMinutes } from "@/lib/store";
import { formatMinutes, playerMinutesSummary } from "@/lib/minutes";
import { FormResponse } from "@/lib/sheets-service";
import { players as allPlayers } from "@/lib/mock-data";
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
    const priority: Record<string, number> = { "M": 1, "M-T": 2, "": 3, "T": 4 };
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
    (r) => normalizeName(r.jugador) === normalizeName(jugador)
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

  const acwrCargaSeries = calcACWRSeries(completedSessions.map((d) => ({ date: d.date, ua: d.uaCarga })));
  const acwrFatigaSeries = calcACWRSeries(completedSessions.map((d) => ({ date: d.date, ua: d.uaFatiga })));

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
  const uaCargaMax = respondedData.length > 0 ? Math.max(...respondedData.map((d) => d.uaCarga)) : 0;
  const uaFatigaMax = respondedData.length > 0 ? Math.max(...respondedData.map((d) => d.uaFatiga)) : 0;

  const acwrCargaLast = acwrCargaSeries[acwrCargaSeries.length - 1]?.acwr ?? 0;
  const acwrFatigaLast = acwrFatigaSeries[acwrFatigaSeries.length - 1]?.acwr ?? 0;

  const uaCargaArr = respondedData.map((d) => d.uaCarga);
  const stdCarga = std(uaCargaArr);
  const monotoniaCarga = avg(uaCargaArr) / (stdCarga || 1);

  // 6. Look up player info in mock-data DB using normalized comparison
  const dbPlayer = allPlayers.find(
    (p) => normalizeName(p.name) === normalizeName(jugador)
  );
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
    if (status === "riesgo") return "#ef4444"; // red
    if (status === "moderado") return "#f59e0b"; // amber
    return "#10b981"; // emerald
  }

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
          backgroundColor: "#ffffff",
          color: "#1f2937",
          fontFamily: "system-ui, -apple-system, sans-serif",
          padding: "40px",
          boxSizing: "border-box",
        }}
      >
      {/* HEADER SECTION */}
      <div
        style={{
          borderBottom: "3px solid #8c0000",
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
              color: "#8c0000",
              letterSpacing: "1.5px",
              textTransform: "uppercase",
              marginBottom: "4px",
            }}
          >
            Selección Española de Fútbol Sala · RFEF
          </div>
          <h1
            style={{
              fontSize: "24px",
              fontWeight: 800,
              color: "#111827",
              margin: 0,
              letterSpacing: "-0.5px",
            }}
          >
            INFORME INDIVIDUAL DE CARGA Y FATIGA
          </h1>
        </div>
        <div style={{ textAlign: "right" }}>
          <span
            style={{
              fontSize: "10px",
              fontWeight: 750,
              backgroundColor: "#f3f4f6",
              padding: "4px 8px",
              borderRadius: "4px",
              color: "#4b5563",
            }}
          >
            CONFIDENCIAL
          </span>
        </div>
      </div>

      {/* PLAYER INFO PANEL */}
      <div
        style={{
          backgroundColor: "#fdf8f8",
          border: "1px solid #f3e8e8",
          borderRadius: "8px",
          padding: "16px",
          marginBottom: "24px",
          display: "flex",
          gap: "24px",
        }}
      >
        <div
          style={{
            minWidth: "60px",
            height: "60px",
            borderRadius: "50%",
            backgroundColor: "#8c0000",
            color: "#ffffff",
            display: "grid",
            placeItems: "center",
            fontSize: "24px",
            fontWeight: "bold",
          }}
        >
          {playerNumber}
        </div>
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <div>
            <div style={{ fontSize: "10px", color: "#6b7280", textTransform: "uppercase", fontWeight: 600 }}>
              Jugador
            </div>
            <div style={{ fontSize: "16px", fontWeight: 700, color: "#111827" }}>{jugador}</div>
            <div style={{ fontSize: "12px", color: "#4b5563", marginTop: "2px" }}>{playerPosition}</div>
          </div>
          <div>
            <div style={{ fontSize: "10px", color: "#6b7280", textTransform: "uppercase", fontWeight: 600 }}>
              Convocatoria
            </div>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "#111827" }}>{callUp.name}</div>
            <div style={{ fontSize: "11px", color: "#4b5563", marginTop: "2px" }}>
              Sede: {callUp.location} · {formatDateES(callUp.startDate)} al {formatDateES(callUp.endDate)}
            </div>
          </div>
        </div>
        <div style={{ textAlign: "right", borderLeft: "1px solid #e5e7eb", paddingLeft: "24px", minWidth: "120px" }}>
          <div style={{ fontSize: "10px", color: "#6b7280", textTransform: "uppercase", fontWeight: 600 }}>
            Respuestas Formulario
          </div>
          <div style={{ fontSize: "20px", fontWeight: 800, color: "#8c0000", marginTop: "4px" }}>
            {respondedData.length} / {sessions.length}
          </div>
          <div style={{ fontSize: "10px", color: "#6b7280", marginTop: "2px" }}>Sesiones completadas</div>
        </div>
        {matchCount > 0 && (
          <div style={{ textAlign: "right", borderLeft: "1px solid #e5e7eb", paddingLeft: "24px", minWidth: "120px" }}>
            <div style={{ fontSize: "10px", color: "#6b7280", textTransform: "uppercase", fontWeight: 600 }}>
              Minutos Jugados
            </div>
            <div style={{ fontSize: "20px", fontWeight: 800, color: "#8c0000", marginTop: "4px" }}>
              {mins.total > 0 ? formatMinutes(mins.total) : "—"}
            </div>
            <div style={{ fontSize: "10px", color: "#6b7280", marginTop: "2px" }}>
              {mins.matchesPlayed} / {matchCount} partidos
              {mins.matchesPlayed > 0 ? ` · media ${formatMinutes(mins.average)}` : ""}
            </div>
          </div>
        )}
      </div>

      {/* METRICS SUMMARY GRID */}
      <h2 style={{ fontSize: "13px", fontWeight: 700, color: "#8c0000", textTransform: "uppercase", marginBottom: "10px" }}>
        Métricas Resumen de la Convocatoria
      </h2>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(6, 1fr)",
          gap: "10px",
          marginBottom: "24px",
        }}
      >
        <div style={{ border: "1px solid #e5e7eb", borderRadius: "6px", padding: "10px", textAlign: "center" }}>
          <div style={{ fontSize: "9px", color: "#6b7280", textTransform: "uppercase", fontWeight: 600 }}>RPE Medio</div>
          <div style={{ fontSize: "18px", fontWeight: 700, marginTop: "4px" }}>{rpeAvg.toFixed(1)}</div>
          <div style={{ fontSize: "8px", color: "#9ca3af", marginTop: "2px" }}>Escala 1–10</div>
        </div>

        <div style={{ border: "1px solid #e5e7eb", borderRadius: "6px", padding: "10px", textAlign: "center" }}>
          <div style={{ fontSize: "9px", color: "#6b7280", textTransform: "uppercase", fontWeight: 600 }}>Fatiga Media</div>
          <div style={{ fontSize: "18px", fontWeight: 700, marginTop: "4px" }}>{fatigueAvg.toFixed(1)}</div>
          <div style={{ fontSize: "8px", color: "#9ca3af", marginTop: "2px" }}>Escala 1–10</div>
        </div>

        <div style={{ border: "1px solid #e5e7eb", borderRadius: "6px", padding: "10px", textAlign: "center" }}>
          <div style={{ fontSize: "9px", color: "#6b7280", textTransform: "uppercase", fontWeight: 600 }}>UA Carga Tot</div>
          <div style={{ fontSize: "18px", fontWeight: 700, marginTop: "4px" }}>{uaCargaTotal.toLocaleString()}</div>
          <div style={{ fontSize: "8px", color: "#9ca3af", marginTop: "2px" }}>RPE × Tiempo</div>
        </div>

        <div style={{ border: "1px solid #e5e7eb", borderRadius: "6px", padding: "10px", textAlign: "center" }}>
          <div style={{ fontSize: "9px", color: "#6b7280", textTransform: "uppercase", fontWeight: 600 }}>UA Fatiga Tot</div>
          <div style={{ fontSize: "18px", fontWeight: 700, marginTop: "4px" }}>{uaFatigaTotal.toLocaleString()}</div>
          <div style={{ fontSize: "8px", color: "#9ca3af", marginTop: "2px" }}>Fatiga × Tiempo</div>
        </div>

        <div style={{ border: "1px solid #e5e7eb", borderRadius: "6px", padding: "10px", textAlign: "center" }}>
          <div style={{ fontSize: "9px", color: "#6b7280", textTransform: "uppercase", fontWeight: 600 }}>Ratio ACWR Carga</div>
          <div style={{ fontSize: "18px", fontWeight: 700, marginTop: "4px", color: getStatusColorHex(acwrStatus(acwrCargaLast)) }}>
            {acwrCargaLast.toFixed(2)}
          </div>
          <div style={{ fontSize: "8px", color: "#6b7280", marginTop: "2px" }}>
            {getStatusLabel(acwrStatus(acwrCargaLast))}
          </div>
        </div>

        <div style={{ border: "1px solid #e5e7eb", borderRadius: "6px", padding: "10px", textAlign: "center" }}>
          <div style={{ fontSize: "9px", color: "#6b7280", textTransform: "uppercase", fontWeight: 600 }}>Ratio ACWR Fatiga</div>
          <div style={{ fontSize: "18px", fontWeight: 700, marginTop: "4px", color: getStatusColorHex(acwrStatus(acwrFatigaLast)) }}>
            {acwrFatigaLast.toFixed(2)}
          </div>
          <div style={{ fontSize: "8px", color: "#6b7280", marginTop: "2px" }}>
            {getStatusLabel(acwrStatus(acwrFatigaLast))}
          </div>
        </div>
      </div>

      {/* CHARTS CONTAINER */}
      <h2 style={{ fontSize: "13px", fontWeight: 700, color: "#8c0000", textTransform: "uppercase", marginBottom: "10px" }}>
        Evolución y Gráficas de Control
      </h2>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "20px" }}>
        {/* CHART 1: RPE & FATIGUE */}
        <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", padding: "12px" }}>
          <h3 style={{ fontSize: "11px", fontWeight: 600, color: "#374151", margin: "0 0 10px 0", textAlign: "center" }}>
            Evolución Individual: RPE y Fatiga
          </h3>
          <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
            <LineChart width={330} height={160} data={respondedData} margin={{ top: 5, right: 10, left: -25, bottom: 5 }}>
              <CartesianGrid stroke="#f3f4f6" strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#6b7280" }} />
              <YAxis domain={[0, 10]} tick={{ fontSize: 9, fill: "#6b7280" }} />
              <Legend wrapperStyle={{ fontSize: 10, paddingTop: 5 }} />
              <Line type="monotone" dataKey="rpe" stroke="#3b82f6" strokeWidth={2} name="RPE" isAnimationActive={false} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="fatigue" stroke="#ec4899" strokeWidth={2} name="Fatiga" isAnimationActive={false} dot={{ r: 3 }} />
            </LineChart>
          </div>
        </div>

        {/* CHART 2: SESSION WORKLOAD (UA) */}
        <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", padding: "12px" }}>
          <h3 style={{ fontSize: "11px", fontWeight: 600, color: "#374151", margin: "0 0 10px 0", textAlign: "center" }}>
            Cargas por Sesión: UA Carga vs. UA Fatiga
          </h3>
          <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
            <BarChart width={330} height={160} data={respondedData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
              <CartesianGrid stroke="#f3f4f6" strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#6b7280" }} />
              <YAxis tick={{ fontSize: 9, fill: "#6b7280" }} />
              <ReferenceLine y={optimo} stroke="#f59e0b" strokeDasharray="3 3" />
              <ReferenceLine y={moderado} stroke="#ef4444" strokeDasharray="3 3" />
              <Legend wrapperStyle={{ fontSize: 10, paddingTop: 5 }} />
              <Bar dataKey="uaCarga" fill="#10b981" name="UA Carga (RPE)" isAnimationActive={false} radius={[2, 2, 0, 0]} />
              <Bar dataKey="uaFatiga" fill="#8b5cf6" name="UA Fatiga" isAnimationActive={false} radius={[2, 2, 0, 0]} />
            </BarChart>
          </div>
        </div>
      </div>

      {/* CHART 3: ACWR COMPARISON */}
      <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", padding: "12px", marginBottom: "24px" }}>
        <h3 style={{ fontSize: "11px", fontWeight: 600, color: "#374151", margin: "0 0 10px 0", textAlign: "center" }}>
          Evolución del Ratio Agudo:Crónico (ACWR) individual
        </h3>
        <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
          <LineChart width={680} height={150} data={respondedData} margin={{ top: 5, right: 10, left: -25, bottom: 5 }}>
            <CartesianGrid stroke="#f3f4f6" strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#6b7280" }} />
            <YAxis domain={[0, 2.0]} tick={{ fontSize: 9, fill: "#6b7280" }} />
            <ReferenceArea y1={0.8} y2={1.3} fill="#d1fae5" fillOpacity={0.4} />
            <ReferenceLine y={1.5} stroke="#ef4444" strokeDasharray="4 4" />
            <Legend wrapperStyle={{ fontSize: 10, paddingTop: 5 }} />
            <Line type="monotone" dataKey="acwrCarga" stroke="#047857" strokeWidth={2} name="ACWR Carga (RPE)" isAnimationActive={false} dot={{ r: 4 }} />
            <Line type="monotone" dataKey="acwrFatiga" stroke="#6d28d9" strokeWidth={2} name="ACWR Fatiga" isAnimationActive={false} dot={{ r: 4 }} />
          </LineChart>
        </div>
      </div>

      {/* DETAILED DATA TABLE */}
      <h2 style={{ fontSize: "13px", fontWeight: 700, color: "#8c0000", textTransform: "uppercase", marginBottom: "10px" }}>
        Registro de Sesiones Individual
      </h2>
      <div style={{ border: "1px solid #e5e7eb", borderRadius: "6px", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "10px", textAlign: "left" }}>
          <thead>
            <tr style={{ backgroundColor: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
              <th style={{ padding: "8px 10px", fontWeight: 600, color: "#4b5563" }}>Fecha</th>
              <th style={{ padding: "8px 10px", fontWeight: 600, color: "#4b5563" }}>Sesión / Tipo</th>
              <th style={{ padding: "8px 10px", fontWeight: 600, color: "#4b5563", textAlign: "right" }}>Duración</th>
              <th style={{ padding: "8px 10px", fontWeight: 600, color: "#4b5563", textAlign: "right" }}>Min. jugados</th>
              <th style={{ padding: "8px 10px", fontWeight: 600, color: "#4b5563", textAlign: "center" }}>RPE</th>
              <th style={{ padding: "8px 10px", fontWeight: 600, color: "#4b5563", textAlign: "center" }}>Fatiga</th>
              <th style={{ padding: "8px 10px", fontWeight: 600, color: "#4b5563", textAlign: "right" }}>UA Carga</th>
              <th style={{ padding: "8px 10px", fontWeight: 600, color: "#4b5563", textAlign: "center" }}>ACWR Carga</th>
              <th style={{ padding: "8px 10px", fontWeight: 600, color: "#4b5563", textAlign: "right" }}>UA Fatiga</th>
              <th style={{ padding: "8px 10px", fontWeight: 600, color: "#4b5563", textAlign: "center" }}>ACWR Fatiga</th>
            </tr>
          </thead>
          <tbody>
            {finalSessionData.map((d, index) => {
              const bg = index % 2 === 0 ? "#ffffff" : "#fcfdfd";
              if (!d.hasResponse) {
                return (
                  <tr key={d.sessionId} style={{ backgroundColor: bg, borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: "8px 10px", color: "#9ca3af", fontVariantNumeric: "tabular-nums" }}>{formatDateES(d.date)}</td>
                    <td style={{ padding: "8px 10px" }}>
                      <span style={{ color: "#9ca3af" }}>{d.type}</span>
                      {d.dayLabel && <span style={{ fontSize: "8px", backgroundColor: "#f3f4f6", padding: "1px 3px", borderRadius: "3px", marginLeft: "4px", color: "#6b7280" }}>{d.dayLabel}</span>}
                    </td>
                    <td style={{ padding: "8px 10px", textAlign: "right", color: "#9ca3af", fontVariantNumeric: "tabular-nums" }}>{d.duration} min</td>
                    <td style={{ padding: "8px 10px", textAlign: "right", color: "#9ca3af", fontVariantNumeric: "tabular-nums" }}>
                      {d.isMatch && d.minutesPlayed !== undefined ? formatMinutes(d.minutesPlayed) : "—"}
                    </td>
                    <td colSpan={6} style={{ padding: "8px 10px", textAlign: "center", color: "#9ca3af", fontStyle: "italic" }}>
                      Sin respuesta registrada
                    </td>
                  </tr>
                );
              }

              return (
                <tr key={d.sessionId} style={{ backgroundColor: bg, borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "8px 10px", fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{formatDateES(d.date)}</td>
                  <td style={{ padding: "8px 10px" }}>
                    <span style={{ fontWeight: 600 }}>{d.type}</span>
                    {d.dayLabel && <span style={{ fontSize: "8px", backgroundColor: "#f3f4f6", padding: "1px 3px", borderRadius: "3px", marginLeft: "4px", color: "#6b7280" }}>{d.dayLabel}</span>}
                  </td>
                  <td style={{ padding: "8px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{d.duration} min</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: d.isMatch ? 600 : 400, color: d.isMatch ? "#111827" : "#9ca3af" }}>
                    {d.isMatch && d.minutesPlayed !== undefined ? formatMinutes(d.minutesPlayed) : "—"}
                  </td>
                  <td style={{ padding: "8px 10px", textAlign: "center", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{d.rpe}</td>
                  <td style={{ padding: "8px 10px", textAlign: "center", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{d.fatigue}</td>
                  <td
                    style={{
                      padding: "8px 10px",
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                      fontWeight: 600,
                      color: getStatusColorHex(uaStatus(d.uaCarga)),
                    }}
                  >
                    {d.uaCarga}
                  </td>
                  <td
                    style={{
                      padding: "8px 10px",
                      textAlign: "center",
                      fontVariantNumeric: "tabular-nums",
                      fontWeight: 700,
                      color: getStatusColorHex(acwrStatus(d.acwrCarga)),
                    }}
                  >
                    {d.acwrCarga.toFixed(2)}
                  </td>
                  <td
                    style={{
                      padding: "8px 10px",
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                      fontWeight: 600,
                      color: getStatusColorHex(uaStatus(d.uaFatiga)),
                    }}
                  >
                    {d.uaFatiga}
                  </td>
                  <td
                    style={{
                      padding: "8px 10px",
                      textAlign: "center",
                      fontVariantNumeric: "tabular-nums",
                      fontWeight: 700,
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

      {/* FOOTER */}
      <div
        style={{
          marginTop: "32px",
          borderTop: "1px solid #e5e7eb",
          paddingTop: "12px",
          display: "flex",
          justifyContent: "space-between",
          fontSize: "9px",
          color: "#9ca3af",
        }}
      >
        <div>Generado automáticamente por SE-FS Load</div>
        <div>Fecha de emisión: {new Date().toLocaleDateString("es-ES")}</div>
      </div>
    </div>
    </div>
  );
}
