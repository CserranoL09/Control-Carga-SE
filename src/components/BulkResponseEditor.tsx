/**
 * Edición en bloque de las respuestas (Resumen → "Editar valores").
 *
 * Cada celda jugador × sesión tiene dos casillas: fatiga y RPE (1–10). Los cambios se
 * marcan y se guardan todos juntos con UNA petición al Apps Script (saveResponsesBatch):
 * - celda con respuesta y valores nuevos → edita esa respuesta exacta (fila / marca temporal);
 * - celda con respuesta que se vacía → se borra (se pide confirmación);
 * - celda vacía que se rellena → respuesta nueva con una hora que la coloca en su sesión.
 * Moverse: Tab, Enter (abajo), Mayús+Enter (arriba) y flechas.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Save, X } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SessionMetrics } from "@/lib/metrics";
import type { FormResponse } from "@/lib/sheets-service";
import { saveResponsesBatch, type ResponseChange } from "@/lib/store";
import { OFFLINE_SAVE_MSG, setUnsavedChanges, useConnection } from "@/lib/offline";

type Draft = { f: string; r: string };

interface Props {
  players: string[];
  sessionMetrics: SessionMetrics[];
  /** Fechas de la convocatoria: el Apps Script devuelve las respuestas de ese rango */
  rango?: { desde: string; hasta: string };
  /** Salir del modo edición */
  onClose: () => void;
  /** Nº de cambios sin guardar (para avisar al cambiar de apartado) */
  onDirtyChange?: (n: number) => void;
  /** Respuestas actualizadas devueltas por el Apps Script */
  applyServerResponses: (all: FormResponse[]) => void;
  /** Con un Apps Script que no devuelve las respuestas: cambio local + recarga en segundo plano */
  updateResponseLocally: (
    jugador: string,
    fecha: string,
    fatigue: number | null,
    rpe: number | null,
    target?: { fila?: number; timestamp?: string },
  ) => void;
  refreshQuiet: () => void;
}

/**
 * Hora con la que se guarda una respuesta nueva, para que quede en su sesión al ordenar
 * por hora: primera del día → 06:00, última → 23:59, día con una sola → 12:00.
 */
function manualTimeFor(slot: { index: number; total: number }): string {
  if (slot.total <= 1) return "12:00:00";
  if (slot.index === 0) return "06:00:00";
  if (slot.index === slot.total - 1) return "23:59:00";
  return "15:00:00";
}

const keyOf = (sessionId: string, jugador: string) => `${sessionId}|${jugador}`;
const clean = (v: string) => v.replace(/\D/g, "").slice(0, 2);
const valid = (v: string) => /^\d{1,2}$/.test(v) && Number(v) >= 1 && Number(v) <= 10;

function formatDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return y ? `${Number(d)}/${Number(m)}` : iso;
}

export function BulkResponseEditor({
  players,
  sessionMetrics,
  rango,
  onClose,
  onDirtyChange,
  applyServerResponses,
  updateResponseLocally,
  refreshQuiet,
}: Props) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState(false);
  const [confirmDeletes, setConfirmDeletes] = useState<number | null>(null);
  const [failed, setFailed] = useState<Record<string, string>>({});
  const { online } = useConnection();
  const tableRef = useRef<HTMLTableElement>(null);

  const sessionById = useMemo(
    () => new Map(sessionMetrics.map((s) => [s.sessionId, s])),
    [sessionMetrics],
  );

  const original = (s: SessionMetrics, j: string): Draft => ({
    f: s.playerFatigue[j] !== undefined ? String(s.playerFatigue[j]) : "",
    r: s.playerRPE[j] !== undefined ? String(s.playerRPE[j]) : "",
  });

  // Estado de cada cambio
  const changes = useMemo(() => {
    const out: {
      key: string;
      jugador: string;
      s: SessionMetrics;
      d: Draft;
      kind: "nueva" | "editar" | "borrar";
      invalid: boolean;
    }[] = [];
    for (const [key, d] of Object.entries(drafts)) {
      const [sessionId, jugador] = [
        key.slice(0, key.indexOf("|")),
        key.slice(key.indexOf("|") + 1),
      ];
      const s = sessionById.get(sessionId);
      if (!s) continue;
      const o = original(s, jugador);
      if (o.f === d.f && o.r === d.r) continue; // sin cambio real
      const had = o.f !== "" || o.r !== "";
      const empty = d.f === "" && d.r === "";
      const kind = had ? (empty ? "borrar" : "editar") : "nueva";
      const invalid = !empty && !(valid(d.f) && valid(d.r));
      if (!had && empty) continue;
      out.push({ key, jugador, s, d, kind, invalid });
    }
    return out;
  }, [drafts, sessionById]);

  const changed = useMemo(() => new Map(changes.map((c) => [c.key, c])), [changes]);
  const invalidCount = changes.filter((c) => c.invalid).length;
  const deleteCount = changes.filter((c) => c.kind === "borrar").length;

  useEffect(() => {
    onDirtyChange?.(changes.length);
  }, [changes.length, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(0), [onDirtyChange]);
  // Que la app no se actualice sola (nueva versión) a mitad de introducir valores
  useEffect(() => {
    setUnsavedChanges(changes.length > 0);
    return () => setUnsavedChanges(false);
  }, [changes.length]);

  // Aviso del navegador al cerrar o recargar con cambios sin guardar
  useEffect(() => {
    if (!changes.length) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [changes.length]);

  function setValue(s: SessionMetrics, j: string, field: "f" | "r", v: string) {
    const key = keyOf(s.sessionId, j);
    setDrafts((prev) => {
      const cur = prev[key] ?? original(s, j);
      return { ...prev, [key]: { ...cur, [field]: clean(v) } };
    });
    setFailed((prev) => {
      if (!prev[key]) return prev;
      const { [key]: _, ...rest } = prev;
      return rest;
    });
  }

  function move(e: React.KeyboardEvent<HTMLInputElement>, row: number, col: number) {
    let r = row;
    let c = col;
    if (e.key === "ArrowRight") c++;
    else if (e.key === "ArrowLeft") c--;
    else if (e.key === "ArrowDown" || (e.key === "Enter" && !e.shiftKey)) r++;
    else if (e.key === "ArrowUp" || (e.key === "Enter" && e.shiftKey)) r--;
    else return;
    const next = tableRef.current?.querySelector<HTMLInputElement>(`input[data-cell="${r}:${c}"]`);
    if (next) {
      e.preventDefault();
      next.focus();
      next.select();
    }
  }

  function discard() {
    if (
      changes.length &&
      !window.confirm(`Hay ${changes.length} cambios sin guardar. ¿Descartarlos?`)
    )
      return;
    setDrafts({});
    onClose();
  }

  function requestSave() {
    if (!changes.length) return onClose();
    if (invalidCount) {
      toast.error(
        `Revisa ${invalidCount} celda${invalidCount > 1 ? "s" : ""}: fatiga y RPE deben ir los dos, de 1 a 10 (o los dos vacíos para borrar).`,
      );
      return;
    }
    if (deleteCount) setConfirmDeletes(deleteCount);
    else void save();
  }

  async function save() {
    setConfirmDeletes(null);
    setSaving(true);
    const list = changes;
    const rows: ResponseChange[] = list.map(({ jugador, s, d, kind }) => {
      const ref = s.playerRef?.[jugador];
      if (kind === "nueva") {
        const [y, m, dd] = s.date.split("-");
        return {
          jugador,
          fecha: s.date,
          fatigue: Number(d.f),
          rpe: Number(d.r),
          marcaTemporal: `${dd}/${m}/${y} ${manualTimeFor(s.slot ?? { index: 0, total: 1 })}`,
        };
      }
      return {
        jugador,
        fecha: s.date,
        fila: ref?.fila,
        timestamp: ref?.fila ? undefined : ref?.timestamp,
        ...(kind === "borrar" ? { borrar: true } : { fatigue: Number(d.f), rpe: Number(d.r) }),
      };
    });
    try {
      const res = await saveResponsesBatch(rows, rango);
      const ok = res.results.filter((x) => x.ok).map((x) => x.i);
      const bad = res.results.filter((x) => !x.ok);

      if (res.responses) {
        applyServerResponses(res.responses);
      } else {
        for (const i of ok) {
          const row = rows[i];
          const isDel = row.borrar;
          updateResponseLocally(
            row.jugador,
            row.fecha,
            isDel ? null : row.fatigue!,
            isDel ? null : row.rpe!,
            row.marcaTemporal
              ? { timestamp: row.marcaTemporal }
              : { fila: row.fila, timestamp: list[i].s.playerRef?.[row.jugador]?.timestamp },
          );
        }
        refreshQuiet();
      }

      // Quitar los guardados; los que fallan se quedan marcados para reintentar
      const okKeys = new Set(ok.map((i) => list[i].key));
      setDrafts((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !okKeys.has(k))));
      const failures: Record<string, string> = {};
      for (const b of bad) failures[list[b.i].key] = b.error ?? "Error";
      setFailed(failures);

      if (ok.length)
        toast.success(
          `${ok.length} respuesta${ok.length > 1 ? "s" : ""} guardada${ok.length > 1 ? "s" : ""}`,
        );
      if (bad.length) {
        toast.error(
          `No se guardaron ${bad.length}: ${bad
            .map(
              (b) =>
                `${list[b.i].jugador} (${formatDate(list[b.i].s.date)} ${list[b.i].s.dayLabel})`,
            )
            .join(", ")}. ${bad[0].error ?? ""}`,
          { duration: 10000 },
        );
      } else {
        onClose();
      }
    } catch (e) {
      toast.error(`No se pudo guardar: ${e instanceof Error ? e.message : e}`, { duration: 10000 });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2">
        <span className="text-sm font-medium">Editar valores</span>
        <span className="text-xs text-muted-foreground">
          Fatiga | RPE de 1 a 10 · vacía las dos casillas para borrar · Tab, Enter y flechas para
          moverte
        </span>
        <span
          className={`ml-auto text-xs font-medium ${changes.length ? "text-amber-600" : "text-muted-foreground"}`}
          aria-live="polite"
        >
          {changes.length
            ? `${changes.length} cambio${changes.length > 1 ? "s" : ""} sin guardar`
            : "Sin cambios"}
          {invalidCount > 0 && <span className="text-red-600"> · {invalidCount} incompletas</span>}
        </span>
        <button
          type="button"
          onClick={discard}
          disabled={saving}
          className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-md border hover:bg-accent disabled:opacity-50"
        >
          <X className="size-3.5" /> Descartar
        </button>
        <button
          type="button"
          onClick={requestSave}
          disabled={saving || !changes.length || !online}
          title={online ? undefined : OFFLINE_SAVE_MSG}
          className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Guardar todo
        </button>
      </div>

      <div className="overflow-x-auto w-full border rounded-lg bg-card shadow-sm">
        <table ref={tableRef} className="w-full text-[11px] border-collapse text-center">
          <thead>
            <tr className="border-b bg-muted/30">
              <th className="px-3 py-1.5 text-left font-bold border-r w-[180px] bg-card text-[10px] uppercase sticky left-0 z-20">
                Jugador
              </th>
              {sessionMetrics.map((s) => (
                <th
                  key={s.sessionId}
                  className="px-1 py-1 border-r text-[10px] font-bold whitespace-nowrap"
                >
                  {formatDate(s.date)} {s.dayLabel}
                  <div className="font-normal text-muted-foreground">{s.type}</div>
                  <div className="font-normal text-muted-foreground flex justify-center gap-1">
                    <span className="w-7">F</span>
                    <span className="w-7">RPE</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {players.map((j, row) => (
              <tr key={j} className="border-b">
                <td className="px-3 py-1 text-left border-r font-bold uppercase bg-card text-[10px] whitespace-nowrap sticky left-0 z-10">
                  {j}
                </td>
                {sessionMetrics.map((s, si) => {
                  const key = keyOf(s.sessionId, j);
                  const d = drafts[key] ?? original(s, j);
                  const ch = changed.get(key);
                  const err = failed[key];
                  const tone =
                    err || ch?.invalid
                      ? "bg-red-500/15 ring-1 ring-inset ring-red-500"
                      : ch?.kind === "borrar"
                        ? "bg-red-500/10 ring-1 ring-inset ring-red-400"
                        : ch
                          ? "bg-amber-400/20 ring-1 ring-inset ring-amber-500"
                          : "";
                  return (
                    <td
                      key={s.sessionId}
                      className={`px-1 py-0.5 border-r ${tone}`}
                      title={err ? `No se guardó: ${err}` : ch ? `Cambio: ${ch.kind}` : undefined}
                    >
                      <div className="flex justify-center gap-1">
                        {(["f", "r"] as const).map((field, fi) => (
                          <input
                            key={field}
                            data-cell={`${row}:${si * 2 + fi}`}
                            aria-label={`${field === "f" ? "Fatiga" : "RPE"} de ${j} el ${formatDate(s.date)} ${s.dayLabel}`}
                            inputMode="numeric"
                            value={d[field]}
                            onChange={(e) => setValue(s, j, field, e.target.value)}
                            onKeyDown={(e) => move(e, row, si * 2 + fi)}
                            onFocus={(e) => e.currentTarget.select()}
                            disabled={saving}
                            className="w-7 h-6 rounded border bg-background text-center tabular-nums text-[11px] focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        ))}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={confirmDeletes !== null} onOpenChange={(o) => !o && setConfirmDeletes(null)}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Borrar respuestas</DialogTitle>
            <DialogDescription>
              Se borrarán {confirmDeletes} respuesta{confirmDeletes === 1 ? "" : "s"} de la hoja del
              formulario. El resto de cambios se guardan a la vez.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <button
              type="button"
              onClick={() => setConfirmDeletes(null)}
              className="text-xs px-3 py-2 rounded-md border hover:bg-accent"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void save()}
              className="text-xs px-3 py-2 rounded-md bg-destructive text-white font-medium hover:opacity-90"
            >
              Borrar y guardar
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
