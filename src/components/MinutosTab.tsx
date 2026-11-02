import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Loader2, Plus, Save, Timer, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import {
  isMatchSession,
  samePlayer,
  saveMinutesBatch,
  type StoredMinutes,
  type StoredSession,
} from "@/lib/store";
import { formatMinutes, parseMinutesInput } from "@/lib/minutes";
import { getPlayerPhoto } from "@/lib/player-photos";

interface MinutosTabProps {
  callUpId: string;
  sessions: StoredSession[];
  players: string[];
  minutes: StoredMinutes[];
  minutesSupported: boolean;
  onSaved: () => void;
}

const cellKey = (sessionId: string, jugador: string) =>
  `${sessionId}|${jugador.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase()}`;

function formatDateShortES(iso: string) {
  const [, m, d] = iso.split("-");
  return d && m ? `${d}/${m}` : iso;
}

export function MinutosTab({
  callUpId,
  sessions,
  players,
  minutes,
  minutesSupported,
  onSaved,
}: MinutosTabProps) {
  const matches = useMemo(() => sessions.filter(isMatchSession), [sessions]);
  const [extraPlayers, setExtraPlayers] = useState<string[]>([]);
  const [newPlayer, setNewPlayer] = useState("");
  const [saving, setSaving] = useState(false);

  // Plantilla = quien respondió el Form + quien ya tiene minutos + añadidos a mano
  const roster = useMemo(() => {
    const list: string[] = [];
    for (const name of [...players, ...minutes.map((m) => m.jugador), ...extraPlayers]) {
      if (name && !list.some((x) => samePlayer(x, name))) list.push(name);
    }
    return list.sort((a, b) => a.localeCompare(b, "es"));
  }, [players, minutes, extraPlayers]);

  // Valores guardados → texto de cada celda
  const saved = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of minutes) map[cellKey(m.sessionId, m.jugador)] = formatMinutes(m.minutes);
    return map;
  }, [minutes]);

  const [draft, setDraft] = useState<Record<string, string>>(saved);
  useEffect(() => setDraft(saved), [saved]);

  const dirtyKeys = Object.keys({ ...saved, ...draft }).filter(
    (k) => (draft[k] ?? "").trim() !== (saved[k] ?? ""),
  );
  const invalidKeys = new Set(
    Object.entries(draft)
      .filter(([, v]) => Number.isNaN(parseMinutesInput(v)))
      .map(([k]) => k),
  );

  const valueOf = (sessionId: string, jugador: string) => {
    const v = parseMinutesInput(draft[cellKey(sessionId, jugador)] ?? "");
    return v === null || Number.isNaN(v) ? 0 : v;
  };

  function addPlayer() {
    const name = newPlayer.trim();
    if (!name) return;
    if (roster.some((x) => samePlayer(x, name))) {
      toast.info(`${name} ya está en la lista`);
    } else {
      setExtraPlayers((p) => [...p, name]);
    }
    setNewPlayer("");
  }

  async function handleSave() {
    if (invalidKeys.size > 0) {
      toast.error("Hay valores no válidos. Usa minutos (25) o mm:ss (25:30).");
      return;
    }
    const rows = [];
    for (const s of matches) {
      for (const j of roster) {
        const k = cellKey(s.id, j);
        if (!dirtyKeys.includes(k)) continue;
        const parsed = parseMinutesInput(draft[k] ?? "");
        rows.push({
          callUpId,
          session: s,
          jugador: j,
          minutes: parsed === null || Number.isNaN(parsed) ? null : parsed,
        });
      }
    }
    if (rows.length === 0) return;
    setSaving(true);
    try {
      await saveMinutesBatch(rows);
      toast.success(`Minutos guardados (${rows.length} cambios)`);
      onSaved();
    } catch (e) {
      toast.error(`Error al guardar minutos: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSaving(false);
    }
  }

  if (!minutesSupported) {
    return (
      <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-4 text-sm text-yellow-800 dark:text-yellow-200 flex gap-3">
        <AlertTriangle className="size-4 shrink-0 mt-0.5" />
        <div>
          <div className="font-medium">Falta actualizar el Apps Script</div>
          <p className="mt-1 text-xs">
            Para guardar minutos, pega el nuevo <code>apps-script/Code.gs</code> en el editor de
            Apps Script del Sheet y publica una nueva versión del despliegue (Implementar →
            Gestionar implementaciones → Editar → Nueva versión). La app no tocará la hoja de
            respuestas: solo creará una pestaña nueva llamada "Minutos".
          </p>
        </div>
      </div>
    );
  }

  if (matches.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        No hay partidos en esta convocatoria. Crea una sesión de tipo PARTIDO en la pestaña Sesiones
        para registrar minutos.
      </div>
    );
  }

  // Totales en vivo (mismos valores que "Total"): comparación y evolución
  const totals = new Map(roster.map((j) => [j, matches.reduce((a, s) => a + valueOf(s.id, j), 0)]));
  const maxTotal = Math.max(0, ...totals.values());
  const withMinutes = [...totals.values()].filter((t) => t > 0);
  const teamMean = withMinutes.length
    ? withMinutes.reduce((a, b) => a + b, 0) / withMinutes.length
    : 0;
  const maxMatch = Math.max(0, ...roster.flatMap((j) => matches.map((s) => valueOf(s.id, j))));

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Timer className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Minutos de juego</h3>
          <span className="text-[11px] text-muted-foreground">Formato: 25 · 25,5 · 25:30</span>
        </div>
        <div className="flex items-center gap-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addPlayer();
            }}
            className="flex items-center gap-1.5"
          >
            <Input
              value={newPlayer}
              onChange={(e) => setNewPlayer(e.target.value)}
              placeholder="Añadir jugador"
              className="h-8 text-xs w-40"
            />
            <button
              type="submit"
              className="p-2 rounded-md border hover:bg-accent text-muted-foreground"
              title="Añadir jugador a la lista"
            >
              <Plus className="size-3.5" />
            </button>
          </form>
          {dirtyKeys.length > 0 && (
            <button
              onClick={() => setDraft(saved)}
              disabled={saving}
              className="text-xs flex items-center gap-1.5 px-3 py-2 rounded-md border hover:bg-accent disabled:opacity-50"
            >
              <Undo2 className="size-3.5" /> Descartar
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving || dirtyKeys.length === 0}
            className="text-xs flex items-center gap-1.5 px-3 py-2 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : dirtyKeys.length === 0 ? (
              <Check className="size-3.5" />
            ) : (
              <Save className="size-3.5" />
            )}
            {dirtyKeys.length === 0 ? "Guardado" : `Guardar (${dirtyKeys.length})`}
          </button>
        </div>
      </div>

      {roster.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">
          Aún no hay jugadores. Añádelos con el campo "Añadir jugador".
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-3 py-2 sticky left-0 z-10 bg-card min-w-[220px] shadow-[1px_0_0_var(--border)]">
                  Jugador
                </th>
                {matches.map((s) => (
                  <th key={s.id} className="text-center font-medium px-2 py-2 min-w-[96px]">
                    <div>
                      {formatDateShortES(s.date)}
                      {s.dayLabel ? ` ${s.dayLabel}` : ""}
                    </div>
                    <div className="text-[10px] font-normal">{s.type}</div>
                  </th>
                ))}
                <th className="text-right font-medium px-3 py-2 min-w-[80px]">Total</th>
                <th className="text-right font-medium px-3 py-2 min-w-[80px]">Media</th>
                <th className="text-left font-medium px-3 py-2 min-w-[260px]">Comparativa</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((j) => {
                const values = matches.map((s) => valueOf(s.id, j));
                const played = values.filter((v) => v > 0);
                const total = played.reduce((a, b) => a + b, 0);
                return (
                  <tr key={j} className="border-t hover:bg-muted/20">
                    <td className="px-3 py-2 sticky left-0 z-10 bg-card shadow-[1px_0_0_var(--border)]">
                      <div className="flex items-center gap-3">
                        <PlayerPhoto name={j} />
                        <span className="font-semibold">{j}</span>
                      </div>
                    </td>
                    {matches.map((s) => {
                      const k = cellKey(s.id, j);
                      const isDirty = dirtyKeys.includes(k);
                      const isInvalid = invalidKeys.has(k);
                      return (
                        <td key={s.id} className="px-2 py-2">
                          <Input
                            inputMode="decimal"
                            value={draft[k] ?? ""}
                            placeholder="—"
                            onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                            onBlur={(e) => {
                              const v = parseMinutesInput(e.target.value);
                              if (v !== null && !Number.isNaN(v))
                                setDraft((d) => ({ ...d, [k]: formatMinutes(v) }));
                            }}
                            aria-label={`Minutos de ${j} el ${s.date}`}
                            aria-invalid={isInvalid}
                            className={`h-8 text-xs text-center tabular-nums ${isInvalid ? "border-destructive" : isDirty ? "border-primary" : ""}`}
                          />
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">
                      {total > 0 ? formatMinutes(total) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {played.length > 0 ? formatMinutes(total / played.length) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <MinutesComparison
                        total={total}
                        maxTotal={maxTotal}
                        teamMean={teamMean}
                        perMatch={matches.map((s, i) => ({
                          label: formatDateShortES(s.date) + (s.dayLabel ? ` ${s.dayLabel}` : ""),
                          value: values[i],
                        }))}
                        maxMatch={maxMatch}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="text-xs text-muted-foreground border-t bg-muted/20">
              <tr>
                <td className="px-3 py-2 sticky left-0 bg-muted/20">Total equipo</td>
                {matches.map((s) => {
                  const sum = roster.reduce((a, j) => a + valueOf(s.id, j), 0);
                  return (
                    <td key={s.id} className="px-2 py-2 text-center tabular-nums">
                      {sum > 0 ? formatMinutes(sum) : "—"}
                    </td>
                  );
                })}
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
          <p className="px-4 py-2 text-[11px] text-muted-foreground border-t">
            Barra: minutos totales respecto al que más ha jugado · línea discontinua: media del
            equipo · mini barras: minutos por partido
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Foto del jugador ─────────────────────────────────────────────────────────

function PlayerPhoto({ name }: { name: string }) {
  const [failed, setFailed] = useState(false);
  const src = getPlayerPhoto(name);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  if (!src || failed) {
    return (
      <div className="size-10 shrink-0 rounded-full border-2 border-border bg-muted text-muted-foreground grid place-items-center text-xs font-semibold shadow-sm">
        {initials}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={name}
      onError={() => setFailed(true)}
      className="size-10 shrink-0 rounded-full object-cover border-2 border-border shadow-sm"
    />
  );
}

// ─── Barra roja de comparación + mini barras de evolución ────────────────────

function MinutesComparison({
  total,
  maxTotal,
  teamMean,
  perMatch,
  maxMatch,
}: {
  total: number;
  maxTotal: number;
  teamMean: number;
  perMatch: { label: string; value: number }[];
  maxMatch: number;
}) {
  const pct = maxTotal > 0 ? (total / maxTotal) * 100 : 0;
  const meanPct = maxTotal > 0 ? (teamMean / maxTotal) * 100 : 0;
  const above = total >= teamMean;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <div className="relative h-2.5 flex-1 rounded-full bg-muted/40">
          {total > 0 && (
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-[#dc2626] transition-all duration-300"
              style={{ width: `${pct}%`, opacity: above ? 1 : 0.55 }}
              title={`${formatMinutes(total)} · ${Math.round(pct)} % del máximo`}
            />
          )}
          {teamMean > 0 && (
            <div
              className="absolute -top-1 -bottom-1 border-l-2 border-dashed border-white/90"
              style={{ left: `calc(${meanPct}% - 1px)` }}
              title={`Media equipo: ${formatMinutes(teamMean)}`}
            />
          )}
        </div>
        <span className="w-10 text-right text-[11px] tabular-nums text-muted-foreground">
          {total > 0 ? `${Math.round(pct)} %` : "—"}
        </span>
      </div>
      {perMatch.length > 0 && (
        <div
          className="flex items-end gap-1.5 h-6 border-b border-border/60 w-fit pr-1"
          aria-label="Minutos por partido"
        >
          {perMatch.map((m, i) => (
            <div
              key={i}
              title={`${m.label}: ${m.value > 0 ? formatMinutes(m.value) : "sin minutos"}`}
              className={`w-2.5 shrink-0 rounded-t-sm transition-all duration-300 ${m.value > 0 ? "bg-[#dc2626]" : "bg-muted-foreground/40"}`}
              style={{
                height:
                  m.value > 0 && maxMatch > 0
                    ? `${Math.max(3, (m.value / maxMatch) * 24)}px`
                    : "2px",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
