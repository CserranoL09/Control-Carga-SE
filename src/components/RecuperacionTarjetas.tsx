/**
 * Recuperación: una tarjeta por jugador, con la misma estética que "Informe jugadores".
 */
import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, ArrowDown, ArrowUp, Minus } from "lucide-react";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, YAxis } from "recharts";
import { CardAvatar, MiniStat } from "@/components/PlayerCardParts";
import {
  fmt1,
  fmt2,
  personalBaseline,
  recoveryAlerts,
  recoveryCategory,
  type RecoveryAlert,
  type RecoveryData,
} from "@/lib/recovery";

const SECTION_ID = "recuperacion-tarjetas";
const SORT_KEY = "recuperacion-tarjetas-orden";
const WORSE = "#f97316";
const BETTER = "#4ade80";

type SortKey = "peor" | "nombre" | "base";
const SORT_LABEL: Record<SortKey, string> = {
  peor: "Peor recuperado hoy",
  nombre: "Nombre",
  base: "Más por encima de su base",
};

function dm(iso: string) {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

function readSort(): SortKey {
  try {
    const v = localStorage.getItem(SORT_KEY);
    if (v === "peor" || v === "nombre" || v === "base") return v;
  } catch {
    /* sin almacenamiento */
  }
  return "peor";
}

interface CardInfo {
  jugador: string;
  hoy: number | null;
  hora: string;
  media: number | null;
  base: number | null;
  vsBase: number | null;
  vsAyer: number | null;
  peor: { valor: number; fecha: string } | null;
  mejor: { valor: number; fecha: string } | null;
  respondidos: number;
  serie: { fecha: string; valor: number | null }[];
  alerta?: RecoveryAlert;
}

function buildCard(
  data: RecoveryData,
  jugador: string,
  dia: string,
  alerts: RecoveryAlert[],
  horaOf: (ts: string) => string,
): CardInfo {
  const idx = data.days.findIndex((d) => d.fecha === dia);
  const ayer = idx > 0 ? data.days[idx - 1].fecha : null;
  const cHoy = data.cell(jugador, dia);
  const cAyer = ayer ? data.cell(jugador, ayer) : undefined;
  const serie = data.days.map((d) => ({
    fecha: d.fecha,
    valor: data.cell(jugador, d.fecha)?.valor ?? null,
  }));
  const vals = serie.filter((x): x is { fecha: string; valor: number } => x.valor !== null);
  const media = vals.length ? vals.reduce((a, x) => a + x.valor, 0) / vals.length : null;
  const base = personalBaseline(data, jugador, dia);
  let peor: CardInfo["peor"] = null;
  let mejor: CardInfo["mejor"] = null;
  for (const x of vals) {
    if (!peor || x.valor > peor.valor) peor = x;
    if (!mejor || x.valor < mejor.valor) mejor = x;
  }
  return {
    jugador,
    hoy: cHoy?.valor ?? null,
    hora: cHoy ? horaOf(cHoy.timestamp) : "",
    media,
    base,
    vsBase: cHoy && base !== null ? cHoy.valor - base : null,
    vsAyer: cHoy && cAyer ? cHoy.valor - cAyer.valor : null,
    peor,
    mejor,
    respondidos: vals.length,
    serie,
    alerta: alerts.find((a) => a.jugador === jugador),
  };
}

const signed = (v: number, f: (n: number) => string) =>
  (v > 0 ? "+" : v < 0 ? "−" : "") + f(Math.abs(v));
const deltaColor = (v: number | null) =>
  v === null || Math.abs(v) < 0.05 ? undefined : v > 0 ? WORSE : BETTER;

export function RecuperacionTarjetas({
  data,
  dia,
  players,
  copyButton,
  horaOf,
}: {
  data: RecoveryData;
  dia: string;
  /** Jugadores a mostrar (ya filtrados por el filtro de la página) */
  players: string[];
  copyButton: (targetId: string) => ReactNode;
  horaOf: (ts: string) => string;
}) {
  const [sort, setSortState] = useState<SortKey>(readSort);
  const [soloAlerta, setSoloAlerta] = useState(false);
  const setSort = (s: SortKey) => {
    setSortState(s);
    try {
      localStorage.setItem(SORT_KEY, s);
    } catch {
      /* sin almacenamiento */
    }
  };

  const alerts = recoveryAlerts(data, dia, players);
  const all = players.map((j) => buildCard(data, j, dia, alerts, horaOf));
  const nAlert = all.filter((c) => c.alerta).length;
  const nSin = all.filter((c) => c.hoy === null).length;

  const cards = (soloAlerta ? all.filter((c) => c.alerta) : all).sort((a, b) => {
    if (sort === "nombre") return a.jugador.localeCompare(b.jugador, "es");
    const ka = sort === "peor" ? a.hoy : a.vsBase;
    const kb = sort === "peor" ? b.hoy : b.vsBase;
    if (ka === null && kb === null) return a.jugador.localeCompare(b.jugador, "es");
    if (ka === null) return 1;
    if (kb === null) return -1;
    return kb - ka || a.jugador.localeCompare(b.jugador, "es");
  });

  return (
    <section id={SECTION_ID} className="rounded-lg border bg-card p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Recuperación por jugador</h3>
          <p className="text-[11px] text-muted-foreground">
            {all.length} jugadores · {nAlert} con alerta · {nSin} sin respuesta
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">Ordenar por</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="bg-background border border-border rounded-md px-2 py-1 text-xs"
            >
              {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={soloAlerta}
              onChange={(e) => setSoloAlerta(e.target.checked)}
            />
            Solo con alerta
          </label>
          {copyButton(SECTION_ID)}
        </div>
      </div>

      {data.days.length === 0 || all.every((c) => c.respondidos === 0) ? (
        <div className="py-8 text-center text-sm text-muted-foreground border border-dashed rounded-md">
          Sin respuestas de recuperación en este periodo
        </div>
      ) : cards.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground border border-dashed rounded-md">
          Ningún jugador con alerta este día
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {cards.map((c) => (
            <RecoveryCard key={c.jugador} c={c} dia={dia} nDays={data.days.length} />
          ))}
        </div>
      )}
    </section>
  );
}

function RecoveryCard({ c, dia, nDays }: { c: CardInfo; dia: string; nDays: number }) {
  const { id: callUpId } = useParams<{ id: string }>();
  const detailUrl = `/convocatorias/${callUpId}/jugador/${encodeURIComponent(c.jugador)}`;
  const cat = c.hoy !== null ? recoveryCategory(c.hoy) : null;
  const catMedia = c.media !== null ? recoveryCategory(c.media) : null;

  return (
    <div
      className="rounded-lg border bg-card p-4 flex flex-col justify-between h-full"
      style={{ borderLeft: `3px solid ${cat ? cat.color : "var(--border)"}` }}
      data-player={c.jugador}
    >
      <div>
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <CardAvatar name={c.jugador} />
            <div className="min-w-0">
              <Link
                to={detailUrl}
                className="text-sm font-semibold hover:underline text-foreground block truncate"
                title={c.jugador}
              >
                {c.jugador}
              </Link>
              <div className="text-[11px] text-muted-foreground">
                {c.hoy === null
                  ? "Sin respuesta"
                  : c.hora
                    ? `Respondió a las ${c.hora}`
                    : "Respondió"}
              </div>
            </div>
          </div>
          <div className="text-right shrink-0">
            {cat && c.hoy !== null ? (
              <>
                <span
                  className={`inline-block min-w-[2.5rem] text-center rounded-md px-2 py-0.5 text-xl tabular-nums ${cat.cls}`}
                  data-valor
                >
                  {fmt1(c.hoy)}
                </span>
                <div className="text-[10px] text-muted-foreground mt-1 max-w-[110px] leading-tight">
                  {cat.label}
                </div>
              </>
            ) : (
              <span className="text-xl font-semibold text-muted-foreground" data-valor>
                —
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 text-xs mb-3">
          <MiniStat
            label="Media periodo"
            value={c.media !== null ? fmt2(c.media) : "—"}
            color={catMedia?.color}
          />
          <MiniStat label="Línea base" value={c.base !== null ? fmt2(c.base) : "—"} />
          <MiniStat
            label="Vs. base"
            value={c.vsBase !== null ? signed(c.vsBase, fmt2) : "—"}
            color={deltaColor(c.vsBase)}
          />
          <div>
            <div className="text-muted-foreground">Cambio vs. ayer</div>
            <div
              className="font-semibold tabular-nums flex items-center gap-0.5"
              style={{ color: deltaColor(c.vsAyer) }}
            >
              {c.vsAyer === null ? (
                "—"
              ) : (
                <>
                  {c.vsAyer > 0.05 ? (
                    <ArrowUp className="size-3" />
                  ) : c.vsAyer < -0.05 ? (
                    <ArrowDown className="size-3" />
                  ) : (
                    <Minus className="size-3" />
                  )}
                  {signed(c.vsAyer, fmt1)}
                </>
              )}
            </div>
          </div>
          <MiniStat
            label="Peor valor"
            value={c.peor ? `${fmt1(c.peor.valor)} · ${dm(c.peor.fecha)}` : "—"}
          />
          <MiniStat
            label="Mejor valor"
            value={c.mejor ? `${fmt1(c.mejor.valor)} · ${dm(c.mejor.fecha)}` : "—"}
          />
          <MiniStat label="Respuestas" value={`${c.respondidos} / ${nDays}`} />
        </div>

        <Sparkline serie={c.serie} dia={dia} media={c.media} />
      </div>

      <div className="border-t pt-3 mt-3 flex items-center justify-between">
        <Link to={detailUrl} className="text-[11px] text-primary hover:underline font-medium">
          Ver Detalles
        </Link>
        {c.alerta && (
          <span
            className="text-[11px] font-medium flex items-center gap-1"
            style={{ color: WORSE }}
            title={c.alerta.motivos.join(" · ")}
          >
            <AlertTriangle className="size-3" /> Alerta
          </span>
        )}
      </div>
    </div>
  );
}

function Sparkline({
  serie,
  dia,
  media,
}: {
  serie: { fecha: string; valor: number | null }[];
  dia: string;
  media: number | null;
}) {
  if (serie.every((x) => x.valor === null)) return <div className="h-10" />;
  return (
    <div className="h-10" title="Recuperación por día (más alto = peor)">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={serie} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <YAxis hide domain={[0, 10]} />
          {media !== null && (
            <ReferenceLine y={media} stroke="var(--muted-foreground)" strokeDasharray="3 3" />
          )}
          <Line
            type="monotone"
            dataKey="valor"
            stroke="var(--muted-foreground)"
            strokeWidth={1.5}
            connectNulls={false}
            isAnimationActive={false}
            dot={(p: {
              cx?: number;
              cy?: number;
              payload?: { fecha: string; valor: number | null };
            }) => {
              const v = p.payload?.valor;
              if (p.cx === undefined || p.cy === undefined || v === null || v === undefined)
                return <g key={`${p.payload?.fecha}-x`} />;
              const sel = p.payload?.fecha === dia;
              return (
                <circle
                  key={p.payload?.fecha}
                  cx={p.cx}
                  cy={p.cy}
                  r={sel ? 3.5 : 1.5}
                  fill={sel ? recoveryCategory(v).color : "var(--muted-foreground)"}
                  stroke={sel ? "var(--card)" : "none"}
                  strokeWidth={sel ? 1 : 0}
                />
              );
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
