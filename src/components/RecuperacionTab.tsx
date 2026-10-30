import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Info, Minus } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SessionMetrics } from "@/lib/metrics";
import type { StoredRecovery } from "@/lib/store";
import {
  buildRecovery,
  fmt1,
  fmt2,
  normName,
  recoveryAlerts,
  recoveryCategory,
  RECOVERY_CATEGORIES,
  RECOVERY_ALERT_VALUE,
} from "@/lib/recovery";

interface RecuperacionTabProps {
  recovery: StoredRecovery[];
  recoverySupported: boolean;
  /** Todos los jugadores con respuestas de fatiga/RPE en la convocatoria */
  formPlayers: string[];
  /** Jugadores elegidos en el filtro ([] = equipo completo) */
  selectedPlayers: string[];
  sessionMetrics: SessionMetrics[];
  copyButton: (targetId: string) => ReactNode;
}

const LINE_COLORS = [
  "#60a5fa",
  "#f472b6",
  "#a78bfa",
  "#34d399",
  "#fbbf24",
  "#22d3ee",
  "#fb7185",
  "#c084fc",
];

function dm(iso: string) {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

function weekday(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return ["DOM", "LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB"][new Date(y, m - 1, d).getDay()];
}

function hora(ts: string) {
  const d = new Date(ts);
  if (!isNaN(d.getTime()) && ts.includes("T"))
    return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const m = ts.match(/(\d{1,2}:\d{2})/);
  return m ? m[1] : "";
}

export function RecuperacionTab({
  recovery,
  recoverySupported,
  formPlayers,
  selectedPlayers,
  sessionMetrics,
  copyButton,
}: RecuperacionTabProps) {
  const data = useMemo(
    () => buildRecovery(recovery, formPlayers, sessionMetrics),
    [recovery, formPlayers, sessionMetrics],
  );
  const lastDay = data.days[data.days.length - 1]?.fecha ?? "";
  const [fecha, setFecha] = useState<string>("");
  const dia = fecha && data.days.some((d) => d.fecha === fecha) ? fecha : lastDay;
  const [mostrarCarga, setMostrarCarga] = useState(true);

  const filtering = selectedPlayers.length > 0;
  const shown = filtering
    ? data.roster.filter((j) => selectedPlayers.some((s) => normName(s) === normName(j)))
    : data.roster;

  if (!recoverySupported) {
    return (
      <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-4 text-sm text-yellow-800 dark:text-yellow-200 flex gap-3">
        <AlertTriangle className="size-4 shrink-0 mt-0.5" />
        <div>
          <div className="font-medium">Falta actualizar el Apps Script</div>
          <p className="mt-1 text-xs">
            Para ver la recuperación, pega el nuevo <code>apps-script/Code.gs</code> en el editor de
            Apps Script del Sheet de carga y publica una nueva versión (Implementar → Gestionar
            implementaciones → Editar → Nueva versión). Google pedirá permiso para leer el Sheet de
            recuperación; no se modifica nada.
          </p>
        </div>
      </div>
    );
  }

  if (data.days.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        No hay respuestas del cuestionario de recuperación en las fechas de esta convocatoria.
      </div>
    );
  }

  const idx = data.days.findIndex((d) => d.fecha === dia);
  const yesterday = idx > 0 ? data.days[idx - 1] : undefined;
  const shownToday = shown
    .map((j) => data.cell(j, dia))
    .filter((c): c is NonNullable<typeof c> => !!c);
  const mediaHoy = shownToday.length
    ? shownToday.reduce((a, c) => a + c.valor, 0) / shownToday.length
    : 0;
  const mediaAyer = (() => {
    if (!yesterday) return null;
    const v = shown
      .map((j) => data.cell(j, yesterday.fecha)?.valor)
      .filter((x): x is number => x !== undefined);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  })();
  const diff = mediaAyer === null ? null : mediaHoy - mediaAyer;
  const nAlto = shownToday.filter((c) => c.valor >= RECOVERY_ALERT_VALUE).length;
  const expected = filtering ? shown.length : formPlayers.length || data.roster.length;
  const alerts = recoveryAlerts(data, dia, shown);
  const missing = (filtering ? shown : formPlayers).filter((j) => !data.cell(j, dia));
  const catHoy = recoveryCategory(mediaHoy);

  // Datos de la gráfica
  const chartPlayers = filtering ? shown.slice(0, LINE_COLORS.length) : [];
  const chartData = data.days.map((d) => {
    const vals = shown
      .map((j) => data.cell(j, d.fecha)?.valor)
      .filter((x): x is number => x !== undefined);
    const row: Record<string, number | string | null> = {
      label: dm(d.fecha),
      media: vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2) : null,
      carga: Math.round(d.cargaDiaAnterior),
    };
    for (const j of chartPlayers) row[j] = data.cell(j, d.fecha)?.valor ?? null;
    return row;
  });

  const sticky = "sticky left-0 z-10 bg-card shadow-[1px_0_0_var(--border)]";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Día</span>
          <select
            value={dia}
            onChange={(e) => setFecha(e.target.value)}
            className="bg-background border border-border rounded-md px-2 py-1.5 text-sm"
          >
            {[...data.days].reverse().map((d) => (
              <option key={d.fecha} value={d.fecha}>
                {weekday(d.fecha)} {dm(d.fecha)}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-muted-foreground flex items-center gap-1.5 max-w-xl">
          <Info className="size-3.5 shrink-0" />
          "¿Cómo te sientes esta mañana?" de 0 a 10: cuanto más bajo, mejor recuperado.
        </p>
      </div>

      {/* a) Tarjetas */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground">Media del equipo</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold tabular-nums">{fmt2(mediaHoy)}</span>
            <span className={`text-[10px] rounded px-1.5 py-0.5 ${catHoy.cls}`}>
              {catHoy.label}
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            {weekday(dia)} {dm(dia)}
          </div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground">
            Jugadores con valor ≥ {RECOVERY_ALERT_VALUE}
          </div>
          <div
            className={`text-2xl font-bold tabular-nums mt-1 ${nAlto > 0 ? "text-[#f97316]" : ""}`}
          >
            {nAlto}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">poco o muy poco recuperados</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground">Respuestas</div>
          <div className="text-2xl font-bold tabular-nums mt-1">
            {shownToday.length} / {expected}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">jugadores de la convocatoria</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs text-muted-foreground">Cambio vs. día anterior</div>
          <div
            className={`text-2xl font-bold tabular-nums mt-1 flex items-center gap-1 ${
              diff === null
                ? ""
                : diff > 0.05
                  ? "text-[#f97316]"
                  : diff < -0.05
                    ? "text-[#4ade80]"
                    : ""
            }`}
          >
            {diff === null ? (
              "—"
            ) : (
              <>
                {diff > 0.05 ? (
                  <ArrowUp className="size-5" />
                ) : diff < -0.05 ? (
                  <ArrowDown className="size-5" />
                ) : (
                  <Minus className="size-5" />
                )}
                {(diff > 0 ? "+" : "") + fmt2(diff)}
              </>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            {diff === null
              ? "sin día anterior"
              : diff > 0.05
                ? "peor recuperados"
                : diff < -0.05
                  ? "mejor recuperados"
                  : "igual"}
          </div>
        </div>
      </div>

      {/* d) Alertas y e) sin respuesta */}
      {(alerts.length > 0 || missing.length > 0) && (
        <div className="grid lg:grid-cols-2 gap-4">
          {alerts.length > 0 && (
            <div className="rounded-lg border border-[#f97316]/40 bg-[#f97316]/10 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-[#fb923c]">
                <AlertTriangle className="size-4" /> {alerts.length} jugador(es) a vigilar
              </div>
              <ul className="mt-2 space-y-1 text-xs">
                {alerts.map((a) => (
                  <li key={a.jugador} className="flex items-baseline gap-2">
                    <span
                      className={`inline-block min-w-[1.75rem] text-center rounded px-1 ${recoveryCategory(a.valor).cls}`}
                    >
                      {fmt1(a.valor)}
                    </span>
                    <span className="font-medium">{a.jugador}</span>
                    <span className="text-muted-foreground">{a.motivos.join(" · ")}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {missing.length > 0 && (
            <div className="rounded-lg border bg-card p-4">
              <div className="text-sm font-medium">Sin respuesta este día ({missing.length})</div>
              <p className="mt-2 text-xs text-muted-foreground">{missing.join(" · ")}</p>
            </div>
          )}
        </div>
      )}

      {/* b) Heatmap jugadores × días */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Recuperación matinal — jugadores × días</h3>
          {copyButton("recuperacion-heatmap")}
        </div>
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table
            id="recuperacion-heatmap"
            className="w-full text-[11px] border-collapse text-center bg-card"
          >
            <thead>
              <tr className="border-b bg-muted/30">
                <th
                  className={`${sticky} px-3 py-1.5 text-left text-[10px] uppercase tracking-wider min-w-[150px]`}
                >
                  Fecha
                </th>
                {data.days.map((d) => (
                  <th
                    key={d.fecha}
                    className={`px-2 py-1.5 border-l font-semibold tabular-nums whitespace-nowrap ${d.fecha === dia ? "bg-primary/20" : ""}`}
                  >
                    {dm(d.fecha)}
                  </th>
                ))}
              </tr>
              <tr className="border-b bg-muted/30">
                <th
                  className={`${sticky} px-3 py-1.5 text-left text-[10px] uppercase tracking-wider`}
                >
                  Jugador
                </th>
                {data.days.map((d) => (
                  <th
                    key={d.fecha}
                    className="px-2 py-1.5 border-l text-[10px] font-medium text-muted-foreground"
                  >
                    {weekday(d.fecha)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((j) => (
                <tr key={j} className="border-b">
                  <td
                    className={`${sticky} px-3 py-1 text-left font-bold uppercase text-[10px] whitespace-nowrap`}
                  >
                    {j}
                  </td>
                  {data.days.map((d) => {
                    const c = data.cell(j, d.fecha);
                    if (!c) {
                      return (
                        <td key={d.fecha} className="px-2 py-1 border-l text-muted-foreground/60">
                          —
                        </td>
                      );
                    }
                    const cat = recoveryCategory(c.valor);
                    const h = hora(c.timestamp);
                    return (
                      <td
                        key={d.fecha}
                        title={`${j} · ${dm(d.fecha)}: ${fmt1(c.valor)} — ${cat.label}${h ? ` · respondió a las ${h}` : ""}`}
                        className={`px-2 py-1 border-l tabular-nums ${cat.cls}`}
                      >
                        {fmt1(c.valor)}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="border-b bg-muted/30 font-semibold">
                <td
                  className={`${sticky} px-3 py-1.5 text-left text-[10px] uppercase tracking-wider`}
                >
                  Media equipo
                </td>
                {data.days.map((d) => {
                  const v = shown
                    .map((j) => data.cell(j, d.fecha)?.valor)
                    .filter((x): x is number => x !== undefined);
                  const m = v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
                  return (
                    <td key={d.fecha} className="px-2 py-1.5 border-l tabular-nums">
                      {m === null ? "—" : fmt2(m)}
                    </td>
                  );
                })}
              </tr>
              <tr className="bg-muted/10 text-muted-foreground">
                <td
                  className={`${sticky} px-3 py-1.5 text-left text-[10px] uppercase tracking-wider`}
                >
                  Carga día anterior (UA)
                </td>
                {data.days.map((d) => (
                  <td key={d.fecha} className="px-2 py-1.5 border-l tabular-nums">
                    {d.cargaDiaAnterior > 0
                      ? Math.round(d.cargaDiaAnterior).toLocaleString("es-ES")
                      : "—"}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
          {RECOVERY_CATEGORIES.map((c) => (
            <span key={c.key} className="inline-flex items-center gap-1.5">
              <span className={`inline-block size-3 rounded-sm ${c.cls}`} />
              {c.range} {c.label}
            </span>
          ))}
          <span>· — = sin respuesta</span>
        </div>
      </section>

      {/* c) Evolución */}
      <section id="recuperacion-evolucion" className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">
            Evolución de la recuperación
            {filtering ? " — jugadores seleccionados" : " — media del equipo"}
          </h3>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={mostrarCarga}
                onChange={(e) => setMostrarCarga(e.target.checked)}
              />
              Mostrar carga del día anterior
            </label>
            {copyButton("recuperacion-evolucion")}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart
            data={chartData}
            margin={{ top: 10, right: mostrarCarga ? 10 : 20, left: 0, bottom: 0 }}
          >
            <ReferenceArea yAxisId="rec" y1={0} y2={4} fill="#22c55e" fillOpacity={0.08} />
            <ReferenceArea yAxisId="rec" y1={4} y2={6} fill="#facc15" fillOpacity={0.08} />
            <ReferenceArea yAxisId="rec" y1={6} y2={10} fill="#ef4444" fillOpacity={0.08} />
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
            <YAxis
              yAxisId="rec"
              domain={[0, 10]}
              ticks={[0, 2, 4, 6, 8, 10]}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            />
            {mostrarCarga && (
              <YAxis
                yAxisId="carga"
                orientation="right"
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              />
            )}
            <Tooltip
              contentStyle={{
                background: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
                color: "var(--popover-foreground)",
              }}
              formatter={(v: number, name: string) =>
                name === "Carga día anterior (UA)"
                  ? [Math.round(v).toLocaleString("es-ES"), name]
                  : [fmt2(v), name]
              }
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {mostrarCarga && (
              <Bar
                yAxisId="carga"
                dataKey="carga"
                name="Carga día anterior (UA)"
                fill="#64748b"
                fillOpacity={0.45}
                barSize={22}
              />
            )}
            <Line
              yAxisId="rec"
              type="monotone"
              dataKey="media"
              name={filtering ? "Media seleccionados" : "Media equipo"}
              stroke="#ffffff"
              strokeWidth={2.5}
              dot={{ r: 4, fill: "#ffffff" }}
              connectNulls
            />
            {chartPlayers.map((j, i) => (
              <Line
                key={j}
                yAxisId="rec"
                type="monotone"
                dataKey={j}
                name={j}
                stroke={LINE_COLORS[i]}
                strokeWidth={1.5}
                dot={{ r: 3 }}
                connectNulls
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </section>
    </div>
  );
}
