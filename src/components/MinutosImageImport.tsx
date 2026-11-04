/**
 * "Cargar imagen": lee una tabla de minutos (TIEMPOS DE PARTICIPACIÓN) con OCR en el
 * navegador, empareja los nombres con los jugadores y deja revisar antes de rellenar.
 * No guarda nada: solo devuelve los valores para el borrador de la tabla.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ImageUp, Loader2, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatMinutes, parseMinutesInput } from "@/lib/minutes";
import type { StoredSession } from "@/lib/store";
import {
  clearAliases,
  CONTENIDO_LABEL,
  loadAliases,
  matchName,
  parseOcrText,
  prepareImage,
  runOcr,
  saveAlias,
  valuesFor,
  type Contenido,
  type MatchStatus,
  type OcrJob,
  type OcrLine,
} from "@/lib/minutes-ocr";
import { PlayerAvatar } from "@/components/PlayerAvatar";

export interface ExistingValues {
  p1: number | null;
  p2: number | null;
  hasParts: boolean;
  total: number;
  /** La celda tiene algo escrito (aunque sea 0) */
  filled: boolean;
}

export interface ImportEntry {
  jugador: string;
  p1: number | null;
  p2: number | null;
  total: number | null;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Imagen que llega arrastrada o pegada */
  initialFile: File | null;
  matches: StoredSession[];
  roster: string[];
  matchLabel: (s: StoredSession) => string;
  /** Valores actuales de la tabla (borrador) */
  existing: (sessionId: string, jugador: string) => ExistingValues;
  /** El partido ya tiene partes guardadas */
  matchHasSavedParts: (sessionId: string) => boolean;
  onApply: (sessionId: string, entries: ImportEntry[], overwrite: boolean) => void;
}

interface ReviewRow {
  id: number;
  raw: string;
  name: string;
  jugador: string | null;
  status: MatchStatus | "manual";
  motivo?: string;
  p1: string;
  p2: string;
  total: string;
  warning?: string;
}

type Phase = "idle" | "reading" | "review" | "error";

const STATUS_UI: Record<ReviewRow["status"], { label: string; cls: string }> = {
  coincide: { label: "Coincide", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  manual: { label: "Asignado", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  revisar: { label: "Revisar", cls: "bg-yellow-500/15 text-yellow-400 border-yellow-500/40" },
  sin: { label: "Sin coincidencia", cls: "bg-muted text-muted-foreground border-border" },
};

const fmt = (v: number | null) => (v === null ? "" : formatMinutes(v));
const val = (s: string): number | null => {
  const v = parseMinutesInput(s);
  return v === null || Number.isNaN(v) ? null : v;
};

export function MinutosImageImport({
  open,
  onOpenChange,
  initialFile,
  matches,
  roster,
  matchLabel,
  existing,
  matchHasSavedParts,
  onApply,
}: Props) {
  const [sessionId, setSessionId] = useState(matches[matches.length - 1]?.id ?? "");
  const [contenido, setContenido] = useState<Contenido>("auto");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState({ p: 0, label: "" });
  const [error, setError] = useState("");
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(false);
  const [lines, setLines] = useState<OcrLine[]>([]);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [overwrite, setOverwrite] = useState(true);
  const [aliasCount, setAliasCount] = useState(() => Object.keys(loadAliases()).length);
  const job = useRef<OcrJob | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Al abrir: último partido; con imagen arrastrada/pegada, empezar a leer
  useEffect(() => {
    if (!open) return;
    setSessionId((id) =>
      matches.some((m) => m.id === id) ? id : (matches[matches.length - 1]?.id ?? ""),
    );
    if (initialFile) read(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialFile]);

  // Sobrescribir: marcado si el partido no tiene partes guardadas
  useEffect(() => {
    if (sessionId) setOverwrite(!matchHasSavedParts(sessionId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, open]);

  // Rehacer la revisión al cambiar qué contiene la imagen
  useEffect(() => {
    if (phase === "review") setRows(buildRows(lines, contenido));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contenido]);

  function reset() {
    job.current?.cancel();
    job.current = null;
    setPhase("idle");
    setLines([]);
    setRows([]);
    setError("");
    if (imgUrl) URL.revokeObjectURL(imgUrl);
    setImgUrl(null);
  }

  function close(o: boolean) {
    if (!o) reset();
    onOpenChange(o);
  }

  function buildRows(ls: OcrLine[], c: Contenido): ReviewRow[] {
    const aliases = loadAliases();
    const used = new Set<string>();
    return ls.map((l, i) => {
      const m = matchName(l.name, roster, aliases);
      const v = valuesFor(l.times, c);
      let status: ReviewRow["status"] = m.status;
      let motivo = m.motivo;
      if (m.jugador && used.has(m.jugador)) {
        status = "revisar";
        motivo = "jugador ya asignado a otra línea";
      }
      if (m.jugador) used.add(m.jugador);
      if (v.warning && status === "coincide") status = "revisar";
      return {
        id: i,
        raw: l.raw,
        name: l.name,
        jugador: m.jugador,
        status,
        motivo,
        p1: fmt(v.p1),
        p2: fmt(v.p2),
        total: fmt(v.total),
        warning: v.warning,
      };
    });
  }

  async function read(file: File) {
    reset();
    if (!file.type.startsWith("image/")) {
      setError("El archivo no es una imagen (jpg, png o webp).");
      setPhase("error");
      return;
    }
    setImgUrl(URL.createObjectURL(file));
    setPhase("reading");
    setProgress({ p: 0, label: "Preparando la imagen…" });
    try {
      const canvas = await prepareImage(file);
      const j = runOcr(canvas, (p, label) => setProgress({ p, label }));
      job.current = j;
      const text = await j.promise;
      if (job.current !== j) return; // cancelado
      job.current = null;
      const ls = parseOcrText(text);
      if (ls.length === 0) {
        setError(
          "No se han encontrado minutos en la imagen. Prueba con una foto más nítida y recta o escríbelos a mano.",
        );
        setPhase("error");
        return;
      }
      setLines(ls);
      setRows(buildRows(ls, contenido));
      setPhase("review");
    } catch (e) {
      if (e instanceof Error && e.message === "cancelado") return;
      setError(
        `No se pudo leer la imagen (${e instanceof Error ? e.message : e}). Comprueba la conexión: la primera vez se descarga el diccionario de español.`,
      );
      setPhase("error");
    }
  }

  function cancel() {
    reset();
  }

  function setRow(id: number, patch: Partial<ReviewRow>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function assign(row: ReviewRow, jugador: string | null) {
    setRow(row.id, {
      jugador,
      status: jugador ? "manual" : "sin",
      motivo: jugador ? undefined : row.motivo,
    });
    // Recordar el alias para la próxima imagen
    saveAlias(row.name, jugador);
    setAliasCount(Object.keys(loadAliases()).length);
  }

  // Jugadores asignados (el primero gana si se repite)
  const assigned = useMemo(() => {
    const seen = new Set<string>();
    return rows.filter((r) => {
      if (!r.jugador || seen.has(r.jugador)) return false;
      seen.add(r.jugador);
      return true;
    });
  }, [rows]);
  const unassigned = rows.filter((r) => !r.jugador).length;
  const missingPlayers = roster.filter((j) => !rows.some((r) => r.jugador === j));
  const dupIds = new Set(rows.filter((r) => r.jugador && !assigned.includes(r)).map((r) => r.id));

  function apply() {
    const entries: ImportEntry[] = assigned.map((r) => ({
      jugador: r.jugador as string,
      p1: val(r.p1),
      p2: val(r.p2),
      total: val(r.total),
    }));
    onApply(sessionId, entries, overwrite);
    close(false);
  }

  const match = matches.find((m) => m.id === sessionId);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-5xl w-[calc(100vw-2rem)] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImageUp className="size-4" /> Cargar minutos desde una imagen
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Partido</span>
            <select
              aria-label="Partido"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              className="bg-background border border-border rounded-md px-2 py-1.5 text-sm"
            >
              {matches.map((m) => (
                <option key={m.id} value={m.id}>
                  {matchLabel(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">La imagen contiene</span>
            <select
              aria-label="La imagen contiene"
              value={contenido}
              onChange={(e) => setContenido(e.target.value as Contenido)}
              className="bg-background border border-border rounded-md px-2 py-1.5 text-sm"
            >
              {(Object.keys(CONTENIDO_LABEL) as Contenido[]).map((c) => (
                <option key={c} value={c}>
                  {CONTENIDO_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="h-9 px-3 rounded-md border hover:bg-accent text-sm flex items-center gap-1.5"
          >
            <ImageUp className="size-4" /> {imgUrl ? "Elegir otra imagen" : "Elegir imagen"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/*"
            className="hidden"
            data-testid="ocr-file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) read(f);
            }}
          />
          {aliasCount > 0 && (
            <button
              type="button"
              onClick={() => {
                clearAliases();
                setAliasCount(0);
              }}
              className="text-xs text-primary hover:underline ml-auto"
              title="Borra los nombres que la app ha aprendido (p. ej. «Adri Rivera» → ADRIÁN)"
            >
              Olvidar alias ({aliasCount})
            </button>
          )}
        </div>

        {phase === "idle" && !imgUrl && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full rounded-lg border-2 border-dashed p-10 text-center text-sm text-muted-foreground hover:bg-accent/40"
          >
            Elige una imagen, arrástrala aquí o pégala con Ctrl+V.
            <div className="text-xs mt-1">
              Se lee en tu navegador: la imagen no se sube a ningún servidor.
            </div>
          </button>
        )}

        {phase === "reading" && (
          <div className="rounded-lg border p-6 space-y-3" data-testid="ocr-progress">
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" />
              {progress.label} {progress.p > 0 && `${Math.round(progress.p * 100)} %`}
            </div>
            <div className="h-2 rounded bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-[width]"
                style={{ width: `${Math.round(progress.p * 100)}%` }}
              />
            </div>
            <button
              type="button"
              onClick={cancel}
              className="text-xs px-3 py-1.5 rounded-md border hover:bg-accent"
            >
              Cancelar
            </button>
          </div>
        )}

        {phase === "error" && (
          <div
            className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-4 text-sm"
            data-testid="ocr-error"
          >
            {error}
          </div>
        )}

        {phase === "review" && (
          <div className="grid gap-4 md:grid-cols-[180px_1fr]">
            <div className="space-y-2">
              {imgUrl && (
                <button type="button" onClick={() => setZoom(true)} title="Ver grande">
                  <img src={imgUrl} alt="Imagen cargada" className="w-full rounded border" />
                </button>
              )}
              <div className="text-xs text-muted-foreground">
                {rows.length} líneas leídas · partido {match ? matchLabel(match) : ""}
              </div>
            </div>
            <div className="space-y-3 min-w-0">
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-xs" data-testid="ocr-review">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="text-left px-2 py-1.5 font-medium">Leído</th>
                      <th className="text-left px-2 py-1.5 font-medium">Jugador</th>
                      <th className="px-2 py-1.5 font-medium w-20">1ª</th>
                      <th className="px-2 py-1.5 font-medium w-20">2ª</th>
                      <th className="px-2 py-1.5 font-medium w-20">Total</th>
                      <th className="text-left px-2 py-1.5 font-medium">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const ex = r.jugador && sessionId ? existing(sessionId, r.jugador) : null;
                      const p1 = val(r.p1);
                      const p2 = val(r.p2);
                      const nuevo =
                        p1 !== null || p2 !== null ? (p1 ?? 0) + (p2 ?? 0) : val(r.total);
                      const differs =
                        ex &&
                        ex.filled &&
                        nuevo !== null &&
                        formatMinutes(ex.total) !== formatMinutes(nuevo);
                      const skipped = ex && ex.filled && !overwrite;
                      const st = STATUS_UI[dupIds.has(r.id) ? "revisar" : r.status];
                      return (
                        <tr key={r.id} className="border-t align-middle" data-row={r.name}>
                          <td
                            className="px-2 py-1 text-muted-foreground max-w-[160px] truncate"
                            title={r.raw}
                          >
                            {r.raw}
                          </td>
                          <td className="px-2 py-1">
                            <div className="flex items-center gap-1.5">
                              <MiniPhoto key={r.jugador ?? "-"} name={r.jugador} />
                              <select
                                aria-label={`Jugador para ${r.name}`}
                                value={r.jugador ?? ""}
                                onChange={(e) => assign(r, e.target.value || null)}
                                className="bg-background border border-border rounded px-1.5 py-1 text-xs max-w-[160px]"
                              >
                                <option value="">— No asignar —</option>
                                {roster.map((j) => (
                                  <option key={j} value={j}>
                                    {j}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </td>
                          {(["p1", "p2", "total"] as const).map((k) => (
                            <td key={k} className="px-1 py-1">
                              <Input
                                value={r[k]}
                                onChange={(e) => setRow(r.id, { [k]: e.target.value })}
                                placeholder="—"
                                aria-label={`${k === "p1" ? "1ª" : k === "p2" ? "2ª" : "Total"} de ${r.name}`}
                                className="h-7 px-1 text-xs md:text-xs text-center tabular-nums"
                                disabled={k === "total" && (p1 !== null || p2 !== null)}
                                title={
                                  k === "total" && (p1 !== null || p2 !== null)
                                    ? "Con partes, el total es 1ª + 2ª"
                                    : undefined
                                }
                              />
                            </td>
                          ))}
                          <td className="px-2 py-1">
                            <span
                              className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium ${st.cls}`}
                              data-status={dupIds.has(r.id) ? "revisar" : r.status}
                              title={r.motivo}
                            >
                              {st.label}
                            </span>
                            {(r.warning || dupIds.has(r.id)) && (
                              <div className="text-[10px] text-yellow-400 mt-0.5">
                                {dupIds.has(r.id) ? "Jugador repetido: no se rellenará" : r.warning}
                              </div>
                            )}
                            {differs && !skipped && (
                              <div className="text-[10px] text-[#f97316] mt-0.5" data-diff>
                                ahora {formatMinutes(ex!.total)} → {formatMinutes(nuevo!)}
                              </div>
                            )}
                            {skipped && (
                              <div className="text-[10px] text-muted-foreground mt-0.5" data-skip>
                                ya tenía {formatMinutes(ex!.total)}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {missingPlayers.length > 0 && (
                <div className="text-xs" data-testid="ocr-missing">
                  <span className="font-medium">Jugadores de la tabla sin dato en la imagen: </span>
                  <span className="text-muted-foreground">{missingPlayers.join(" · ")}</span>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={overwrite}
                    onChange={(e) => setOverwrite(e.target.checked)}
                  />
                  Sobrescribir valores que ya existen
                </label>
                <div className="flex items-center gap-2">
                  {unassigned > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {unassigned} sin coincidencia: quedarán vacías
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => close(false)}
                    className="h-9 px-3 rounded-md border hover:bg-accent text-sm"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={apply}
                    disabled={assigned.length === 0}
                    className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
                  >
                    Rellenar tabla ({assigned.length} jugadores)
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {zoom && imgUrl && (
          <div
            className="fixed inset-0 z-[70] bg-black/80 grid place-items-center p-6"
            onClick={() => setZoom(false)}
          >
            <button
              type="button"
              className="absolute top-4 right-4 text-white"
              aria-label="Cerrar imagen"
            >
              <X className="size-6" />
            </button>
            <img src={imgUrl} alt="Imagen cargada" className="max-h-full max-w-full rounded" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MiniPhoto({ name }: { name: string | null }) {
  if (!name)
    return <span className="size-6 shrink-0 rounded-md border border-dashed bg-muted/40" />;
  return <PlayerAvatar name={name} size={24} />;
}
