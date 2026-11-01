import { useEffect, useRef, useState } from "react";
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

export function PlayerMultiSelect({ players, value, onChange, compact }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const real = value.filter((v) => v !== NONE);
  const isSel = (p: string) => real.some((v) => normName(v) === normName(p));
  const toggle = (p: string) =>
    onChange(isSel(p) ? real.filter((v) => normName(v) !== normName(p)) : [...real, p]);
  const visible = players.filter((p) => normName(p).includes(normName(q)));
  const label =
    value.length === 0
      ? "Todos los jugadores"
      : real.length === 0
        ? "Ningún jugador"
        : real.length <= 2
          ? real.join(", ")
          : `${real.length} jugadores`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`flex items-center gap-1.5 rounded-md border bg-background hover:bg-accent ${compact ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm"}`}
      >
        <Users className="size-3.5" />
        <span className="max-w-[220px] truncate">{label}</span>
        <ChevronDown className="size-3.5 opacity-60" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-64 rounded-md border bg-popover shadow-lg p-2 space-y-2">
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
              {value.length === 0 ? "sin filtro" : `${real.length} elegidos`}
            </span>
          </div>
          <div className="max-h-64 overflow-y-auto space-y-0.5">
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
        </div>
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
