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

export function MinutosTab({ callUpId, sessions, players, minutes, minutesSupported, onSaved }: MinutosTabProps) {
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
        rows.push({ callUpId, session: s, jugador: j, minutes: parsed === null || Number.isNaN(parsed) ? null : parsed });
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
            Para guardar minutos, pega el nuevo <code>apps-script/Code.gs</code> en el editor de Apps Script del Sheet
            y publica una nueva versión del despliegue (Implementar → Gestionar implementaciones → Editar → Nueva versión).
            La app no tocará la hoja de respuestas: solo creará una pestaña nueva llamada "Minutos".
          </p>
        </div>
      </div>
    );
  }

  if (matches.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        No hay partidos en esta convocatoria. Crea una sesión de tipo PARTIDO en la pestaña Sesiones para registrar minutos.
      </div>
    );
  }

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
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : dirtyKeys.length === 0 ? <Check className="size-3.5" /> : <Save className="size-3.5" />}
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
                <th className="text-left font-medium px-3 py-2 sticky left-0 bg-muted/40 min-w-[170px]">Jugador</th>
                {matches.map((s) => (
                  <th key={s.id} className="text-center font-medium px-2 py-2 min-w-[96px]">
                    <div>{formatDateShortES(s.date)}{s.dayLabel ? ` ${s.dayLabel}` : ""}</div>
                    <div className="text-[10px] font-normal">{s.type}</div>
                  </th>
                ))}
                <th className="text-right font-medium px-3 py-2 min-w-[80px]">Total</th>
                <th className="text-right font-medium px-3 py-2 min-w-[80px]">Media</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((j) => {
                const values = matches.map((s) => valueOf(s.id, j));
                const played = values.filter((v) => v > 0);
                const total = played.reduce((a, b) => a + b, 0);
                return (
                  <tr key={j} className="border-t hover:bg-muted/20">
                    <td className="px-3 py-1.5 font-medium sticky left-0 bg-card">{j}</td>
                    {matches.map((s) => {
                      const k = cellKey(s.id, j);
                      const isDirty = dirtyKeys.includes(k);
                      const isInvalid = invalidKeys.has(k);
                      return (
                        <td key={s.id} className="px-2 py-1.5">
                          <Input
                            inputMode="decimal"
                            value={draft[k] ?? ""}
                            placeholder="—"
                            onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                            onBlur={(e) => {
                              const v = parseMinutesInput(e.target.value);
                              if (v !== null && !Number.isNaN(v)) setDraft((d) => ({ ...d, [k]: formatMinutes(v) }));
                            }}
                            aria-label={`Minutos de ${j} el ${s.date}`}
                            aria-invalid={isInvalid}
                            className={`h-8 text-xs text-center tabular-nums ${isInvalid ? "border-destructive" : isDirty ? "border-primary" : ""}`}
                          />
                        </td>
                      );
                    })}
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{total > 0 ? formatMinutes(total) : "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                      {played.length > 0 ? formatMinutes(total / played.length) : "—"}
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
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
