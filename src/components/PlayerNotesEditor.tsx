import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  FileText,
  Loader2,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { deleteNote, newNoteId, samePlayer, saveNote, type StoredNote } from "@/lib/store";

export const NOTE_TITLE_MAX = 80;
export const NOTE_TEXT_MAX = 2000;

type Status = "guardado" | "sin-guardar" | "guardando";

interface Block {
  id: string;
  titulo: string;
  texto: string;
  enInforme: boolean;
  orden: number;
  /** Ya existe en el Sheet */
  persisted: boolean;
  status: Status;
  savedAt: string | null;
}

/** Nota lista para el informe */
export interface ReportNote {
  titulo: string;
  texto: string;
}

interface Props {
  callUpId: string;
  jugador: string;
  notes: StoredNote[];
  notesSupported: boolean;
  /** Notas vigentes (las que se ven en pantalla) marcadas para el informe */
  onReportNotesChange: (notes: ReportNote[]) => void;
}

function toBlocks(notes: StoredNote[], jugador: string): Block[] {
  return notes
    .filter((n) => samePlayer(n.jugador, jugador))
    .sort((a, b) => a.orden - b.orden)
    .map((n, i) => ({
      id: n.id,
      titulo: n.titulo,
      texto: n.texto,
      enInforme: n.enInforme,
      orden: i,
      persisted: true,
      status: "guardado",
      savedAt: n.actualizado || null,
    }));
}

function relative(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "hace un momento";
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  return d.toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PlayerNotesEditor({
  callUpId,
  jugador,
  notes,
  notesSupported,
  onReportNotesChange,
}: Props) {
  const [blocks, setBlocks] = useState<Block[]>(() => toBlocks(notes, jugador));
  const signature = notes.map((n) => `${n.id}|${n.actualizado}`).join(",");
  const dirtyRef = useRef(false);
  dirtyRef.current = blocks.some((b) => b.status !== "guardado");

  // Recargar desde los datos si llegan cambios y no hay ediciones pendientes
  useEffect(() => {
    if (!dirtyRef.current) setBlocks(toBlocks(notes, jugador));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, jugador]);

  // Notas para el informe: lo que se ve en pantalla, en orden
  const reportNotes = useMemo(
    () =>
      blocks
        .filter((b) => b.enInforme && (b.titulo.trim() || b.texto.trim()))
        .map((b) => ({ titulo: b.titulo.trim(), texto: b.texto })),
    [blocks],
  );
  useEffect(() => onReportNotesChange(reportNotes), [reportNotes, onReportNotesChange]);

  // Aviso al salir con cambios sin guardar
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // Refresca el texto "hace X min"
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const update = (id: string, patch: Partial<Block>) =>
    setBlocks((bs) =>
      bs.map((b) => (b.id === id ? { ...b, ...patch, status: patch.status ?? "sin-guardar" } : b)),
    );

  function add() {
    setBlocks((bs) => [
      ...bs,
      {
        id: newNoteId(),
        titulo: "",
        texto: "",
        enInforme: true,
        orden: bs.length,
        persisted: false,
        status: "sin-guardar",
        savedAt: null,
      },
    ]);
  }

  async function persist(b: Block) {
    setBlocks((bs) => bs.map((x) => (x.id === b.id ? { ...x, status: "guardando" } : x)));
    try {
      const at = await saveNote({
        id: b.id,
        callUpId,
        jugador,
        orden: b.orden,
        titulo: b.titulo,
        texto: b.texto,
        enInforme: b.enInforme,
      });
      // Si se ha editado mientras se guardaba, se queda como "sin guardar"
      setBlocks((bs) =>
        bs.map((x) =>
          x.id === b.id
            ? {
                ...x,
                persisted: true,
                savedAt: at,
                status:
                  x.titulo === b.titulo &&
                  x.texto === b.texto &&
                  x.enInforme === b.enInforme &&
                  x.orden === b.orden
                    ? "guardado"
                    : "sin-guardar",
              }
            : x,
        ),
      );
      return true;
    } catch (e) {
      setBlocks((bs) => bs.map((x) => (x.id === b.id ? { ...x, status: "sin-guardar" } : x)));
      toast.error(`No se pudo guardar: ${e instanceof Error ? e.message : e}`);
      return false;
    }
  }

  async function remove(b: Block) {
    const name = b.titulo.trim() ? `"${b.titulo.trim()}"` : "este bloque";
    if (!window.confirm(`¿Eliminar ${name}? No se puede deshacer.`)) return;
    try {
      if (b.persisted) await deleteNote(b.id);
      setBlocks((bs) => bs.filter((x) => x.id !== b.id).map((x, i) => ({ ...x, orden: i })));
      toast.success("Bloque eliminado");
    } catch (e) {
      toast.error(`No se pudo eliminar: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[j]] = [next[j], next[index]];
    const renumbered = next.map((b, i) => ({ ...b, orden: i }));
    setBlocks(renumbered);
    // Guardar el nuevo orden de los dos bloques afectados si ya existían y no tienen otros cambios
    for (const b of [renumbered[index], renumbered[j]]) {
      if (b.persisted && b.status === "guardado") await persist(b);
      else if (b.persisted) update(b.id, {});
    }
  }

  if (!notesSupported) {
    return (
      <section className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-4 text-sm text-yellow-800 dark:text-yellow-200 flex gap-3">
        <AlertTriangle className="size-4 shrink-0 mt-0.5" />
        <div>
          <div className="font-medium">
            Observaciones para el informe: falta actualizar el Apps Script
          </div>
          <p className="mt-1 text-xs">
            Pega el nuevo <code>apps-script/Code.gs</code> en el Apps Script del Sheet de carga y
            publica una nueva versión (Implementar → Gestionar implementaciones → Editar → Nueva
            versión). Las notas se guardarán en una pestaña nueva llamada "Notas".
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Observaciones para el informe</h3>
          <span className="text-[11px] text-muted-foreground">
            {blocks.filter((b) => b.enInforme).length} de {blocks.length} se incluyen en el PDF
          </span>
        </div>
        <button
          type="button"
          onClick={add}
          className="text-xs flex items-center gap-1.5 px-3 py-2 rounded-md border hover:bg-accent"
        >
          <Plus className="size-3.5" /> Añadir bloque de texto
        </button>
      </div>

      {blocks.length === 0 && (
        <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
          Sin observaciones. Añade un bloque con un título y un texto; aparecerá en el informe PDF
          del jugador.
        </div>
      )}

      {blocks.map((b, i) => (
        <NoteCard
          key={b.id}
          block={b}
          first={i === 0}
          last={i === blocks.length - 1}
          onChange={(patch) => update(b.id, patch)}
          onSave={() => persist(b)}
          onDelete={() => remove(b)}
          onMove={(dir) => move(i, dir)}
        />
      ))}
    </section>
  );
}

function NoteCard({
  block: b,
  first,
  last,
  onChange,
  onSave,
  onDelete,
  onMove,
}: {
  block: Block;
  first: boolean;
  last: boolean;
  onChange: (patch: Partial<Block>) => void;
  onSave: () => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const ta = useRef<HTMLTextAreaElement>(null);

  // Textarea autoajustable
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, 120)}px`;
  }, [b.texto]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (b.status !== "guardando") onSave();
    }
  };

  const status =
    b.status === "guardando" ? (
      <span className="flex items-center gap-1 text-muted-foreground">
        <Loader2 className="size-3 animate-spin" /> Guardando…
      </span>
    ) : b.status === "sin-guardar" ? (
      <span className="text-[#fbbf24]">● Sin guardar</span>
    ) : (
      <span className="flex items-center gap-1 text-[#4ade80]">
        <Check className="size-3" /> Guardado {relative(b.savedAt)}
      </span>
    );

  const iconBtn =
    "p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30 disabled:pointer-events-none";

  return (
    <div
      className={`rounded-lg border bg-card p-4 space-y-3 ${b.status === "sin-guardar" ? "border-[#fbbf24]/50" : ""}`}
      onKeyDown={onKeyDown}
    >
      <div className="flex items-start gap-2">
        <input
          value={b.titulo}
          maxLength={NOTE_TITLE_MAX}
          onChange={(e) => onChange({ titulo: e.target.value })}
          placeholder="Título, p. ej. Valoración del preparador físico"
          aria-label="Título del bloque"
          className="flex-1 min-w-0 px-3 py-2 rounded-md border bg-background text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <div className="flex items-center gap-0.5 shrink-0 pt-1">
          <button
            type="button"
            title="Subir"
            aria-label="Subir"
            onClick={() => onMove(-1)}
            disabled={first}
            className={iconBtn}
          >
            <ArrowUp className="size-3.5" />
          </button>
          <button
            type="button"
            title="Bajar"
            aria-label="Bajar"
            onClick={() => onMove(1)}
            disabled={last}
            className={iconBtn}
          >
            <ArrowDown className="size-3.5" />
          </button>
          <button
            type="button"
            title="Eliminar"
            aria-label="Eliminar"
            onClick={onDelete}
            className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      <div>
        <textarea
          ref={ta}
          value={b.texto}
          maxLength={NOTE_TEXT_MAX}
          onChange={(e) => onChange({ texto: e.target.value })}
          rows={5}
          placeholder={
            "Escribe aquí las observaciones.\n- Las líneas que empiezan por guion\n- aparecen como viñetas en el informe"
          }
          aria-label="Texto del bloque"
          className="w-full px-3 py-2 rounded-md border bg-background text-sm leading-relaxed resize-none focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <div className="flex justify-end text-[10px] text-muted-foreground tabular-nums">
          {b.texto.length.toLocaleString("es-ES")} / {NOTE_TEXT_MAX.toLocaleString("es-ES")}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={b.enInforme}
            onChange={(e) => onChange({ enInforme: e.target.checked })}
          />
          Incluir en el informe PDF
        </label>
        <div className="flex items-center gap-3">
          {status}
          <button
            type="button"
            onClick={onSave}
            disabled={b.status !== "sin-guardar"}
            title="Guardar (Ctrl/Cmd + S)"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90 disabled:opacity-40"
          >
            <Save className="size-3.5" /> Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
