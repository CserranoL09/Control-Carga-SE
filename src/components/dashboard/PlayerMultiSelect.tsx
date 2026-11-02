import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Users } from "lucide-react";
import { getPlayerPhoto } from "@/lib/player-photos";
import { normName } from "@/lib/recovery";

/** Valor especial: ningún jugador seleccionado ([] significa "todos") */
export const NONE = "__ninguno__";

interface Props {
  players: string[];
  /** [] = todos */
  value: string[];
  onChange: (v: string[]) => void;
  compact?: boolean;
}

const PANEL_W = 256; // w-64
const GAP = 4;

export function PlayerMultiSelect({ players, value, onChange, compact }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0 });

  // Posición del desplegable (fixed, en un portal) pegada al botón
  const place = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const panelH = panelRef.current?.offsetHeight ?? 360;
    const left =
      r.left + PANEL_W <= window.innerWidth - 8 ? r.left : Math.max(8, r.right - PANEL_W);
    const fitsBelow = r.bottom + GAP + panelH <= window.innerHeight - 8;
    const fitsAbove = r.top - GAP - panelH >= 8;
    setPos(
      fitsBelow || !fitsAbove
        ? { left, top: r.bottom + GAP }
        : { left, bottom: window.innerHeight - r.top + GAP },
    );
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    // Segundo ajuste cuando ya conocemos la altura real del panel
    const raf = requestAnimationFrame(place);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onHide = () => document.hidden && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [open]);

  // El selector se desmonta al cambiar de pestaña de la app: se cierra solo.

  const all = value.length === 0;
  const real = value.filter((v) => v !== NONE);
  const isSel = (p: string) => all || real.some((v) => normName(v) === normName(p));
  const selected = players.filter(isSel);

  const commit = (list: string[]) => {
    if (list.length === 0) onChange([NONE]);
    else if (
      players.length > 0 &&
      players.every((p) => list.some((v) => normName(v) === normName(p)))
    )
      onChange([]);
    else onChange(list);
  };
  const toggle = (p: string) =>
    commit(isSel(p) ? selected.filter((v) => normName(v) !== normName(p)) : [...selected, p]);

  const visible = players.filter((p) => normName(p).includes(normName(q)));
  const missing = players.filter((p) => !isSel(p));
  const label = all
    ? "Todos los jugadores"
    : selected.length === 0
      ? "Ningún jugador"
      : missing.length === 1 && players.length > 2
        ? `Todos menos ${missing[0]}`
        : selected.length <= 2
          ? selected.join(", ")
          : `${selected.length} de ${players.length} jugadores`;

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`flex items-center gap-1.5 rounded-md border bg-background hover:bg-accent ${compact ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm"}`}
      >
        <Users className="size-3.5" />
        <span className="max-w-[220px] truncate">{label}</span>
        <ChevronDown className="size-3.5 opacity-60" />
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Seleccionar jugadores"
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top,
              bottom: pos.bottom,
              zIndex: 60,
            }}
            className="w-64 rounded-md border bg-popover text-popover-foreground shadow-lg p-2 space-y-2"
          >
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar jugador…"
              className="w-full bg-background border rounded px-2 py-1 text-xs"
            />
            <div className="flex gap-2 text-[11px]">
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => onChange([])}
              >
                Todos
              </button>
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => onChange([NONE])}
              >
                Ninguno
              </button>
              <span className="text-muted-foreground ml-auto">
                {selected.length} de {players.length}
              </span>
            </div>
            <div className="max-h-72 overflow-y-auto overscroll-contain space-y-0.5">
              {visible.map((p) => (
                <label
                  key={p}
                  className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-accent cursor-pointer text-xs"
                >
                  <input type="checkbox" checked={isSel(p)} onChange={() => toggle(p)} />
                  <Avatar name={p} />
                  <span className="truncate">{p}</span>
                </label>
              ))}
              {visible.length === 0 && (
                <div className="text-xs text-muted-foreground px-1.5 py-2">Sin resultados</div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  const [failed, setFailed] = useState(false);
  const src = getPlayerPhoto(name);
  if (!src || failed)
    return (
      <span className="size-5 rounded-full border grid place-items-center text-[8px] font-semibold text-muted-foreground shrink-0">
        {name
          .split(/\s+/)
          .slice(0, 2)
          .map((w) => w[0])
          .join("")}
      </span>
    );
  return (
    <img
      src={src}
      alt=""
      onError={() => setFailed(true)}
      className="size-5 rounded-full object-cover shrink-0"
    />
  );
}
