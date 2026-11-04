import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Check, ImageUp, Loader2, Plus, Save, Timer, Undo2 } from "lucide-react";
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
import { NONE, PlayerMultiSelect } from "@/components/dashboard/PlayerMultiSelect";
import { MinutosImageImport, type ImportEntry } from "@/components/MinutosImageImport";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { OFFLINE_SAVE_MSG, setUnsavedChanges, useConnection } from "@/lib/offline";

interface MinutosTabProps {
  callUpId: string;
  sessions: StoredSession[];
  players: string[];
  minutes: StoredMinutes[];
  minutesSupported: boolean;
  onSaved: () => void;
  /** Botón "Copiar PNG" de la página */
  copyButton?: (targetId: string) => ReactNode;
  /** Filtro de jugadores de la página (valor inicial del filtro de la gráfica) */
  selectedPlayers?: string[];
}

/** Vista de la tabla: partido completo, una parte, o las dos partes a la vez */
type Vista = "total" | "p1" | "p2" | "partes";
const VISTA_LABEL: Record<Vista, string> = {
  total: "Total",
  p1: "1ª parte",
  p2: "2ª parte",
  partes: "Por partes",
};
/** Etiquetas cortas para la barra de la tabla (la larga va en el tooltip) */
const VISTA_CORTA: Record<Vista, string> = { total: "Total", p1: "1ª", p2: "2ª", partes: "Partes" };
const VISTA_KEY = "minutos-tabla-vista";
/** Minutos por encima de los cuales una parte se marca en naranja */
const PART_WARN = 20;

const cellKey = (sessionId: string, jugador: string) =>
  `${sessionId}|${jugador.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase()}`;
/** Claves del borrador: total del partido, 1ª parte y 2ª parte */
const kTot = (base: string) => base;
const kP1 = (base: string) => `${base}|1`;
const kP2 = (base: string) => `${base}|2`;

/** "25:30" → 25.5 ; vacío o no válido → null */
const parsed = (txt: string | undefined): number | null => {
  const v = parseMinutesInput(txt ?? "");
  return v === null || Number.isNaN(v) ? null : v;
};

/** Valores de un jugador en un partido según un mapa de texto (guardado o borrador) */
function cellValues(map: Record<string, string>, base: string) {
  const p1 = parsed(map[kP1(base)]);
  const p2 = parsed(map[kP2(base)]);
  const hasParts = p1 !== null || p2 !== null;
  const total = hasParts ? (p1 ?? 0) + (p2 ?? 0) : (parsed(map[kTot(base)]) ?? 0);
  return { p1, p2, hasParts, total };
}

/** Minutos que cuentan en una vista (las partes sin desglose cuentan 0 en 1ª/2ª) */
function viewValue(v: ReturnType<typeof cellValues>, vista: Vista): number {
  if (vista === "p1") return v.p1 ?? 0;
  if (vista === "p2") return v.p2 ?? 0;
  return v.total;
}

// Tabla: medidas (px)
const ROW_MIN = 26;
const ROW_MIN_PARTES = 32;
const ROW_MAX = 40;
const COL_JUGADOR = 220;
const COL_JUGADOR_MIN = 190;
const COL_TOTAL = 84;
const COL_TOTAL_PARTES = 128;
const COL_MATCH_MIN = 84;
const COL_MATCH_MAX = 160;
/** En "Por partes", cada partido tiene dos subcolumnas de al menos 72 px */
const COL_SUB_MIN = 72;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Anchos de columna para ocupar todo el ancho disponible */
function columnWidths(
  available: number,
  nMatches: number,
  matchMin: number,
  matchMax: number,
  totalW: number,
) {
  const fixed = totalW * 2;
  if (nMatches === 0) return { jugador: Math.max(COL_JUGADOR_MIN, available - fixed), match: 0 };
  let match = (available - COL_JUGADOR - fixed) / nMatches;
  if (match > matchMax) {
    // Sobra espacio: se lo queda la columna Jugador
    return { jugador: available - fixed - matchMax * nMatches, match: matchMax };
  }
  if (match >= matchMin) return { jugador: COL_JUGADOR, match };
  // Falta espacio: primero se estrecha Jugador hasta su mínimo
  match = (available - COL_JUGADOR_MIN - fixed) / nMatches;
  if (match >= matchMin) return { jugador: COL_JUGADOR_MIN, match };
  // Ni así cabe: anchos mínimos y scroll horizontal
  return { jugador: COL_JUGADOR_MIN, match: matchMin };
}

function formatDateShortES(iso: string) {
  const [, m, d] = iso.split("-");
  return d && m ? `${d}/${m}` : iso;
}

const fmtOrDash = (v: number) => (v > 0 ? formatMinutes(v) : "—");

export function MinutosTab({
  callUpId,
  sessions,
  players,
  minutes,
  minutesSupported,
  onSaved,
  copyButton,
  selectedPlayers = [],
}: MinutosTabProps) {
  const matches = useMemo(() => sessions.filter(isMatchSession), [sessions]);
  const [extraPlayers, setExtraPlayers] = useState<string[]>([]);
  const [newPlayer, setNewPlayer] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Vista de la tabla (recordada)
  const [vista, setVistaState] = useState<Vista>(() => {
    try {
      const v = localStorage.getItem(VISTA_KEY);
      if (v === "total" || v === "p1" || v === "p2" || v === "partes") return v;
    } catch {
      /* sin almacenamiento */
    }
    return "total";
  });
  const setVista = (v: Vista) => {
    setVistaState(v);
    try {
      localStorage.setItem(VISTA_KEY, v);
    } catch {
      /* sin almacenamiento */
    }
  };
  const partes = vista === "partes";

  // Plantilla = quien respondió el Form + quien ya tiene minutos + añadidos a mano
  const roster = useMemo(() => {
    const list: string[] = [];
    for (const name of [...players, ...minutes.map((m) => m.jugador), ...extraPlayers]) {
      if (name && !list.some((x) => samePlayer(x, name))) list.push(name);
    }
    return list.sort((a, b) => a.localeCompare(b, "es"));
  }, [players, minutes, extraPlayers]);

  // Valores guardados → texto de cada celda (total, 1ª y 2ª)
  const saved = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of minutes) {
      const base = cellKey(m.sessionId, m.jugador);
      map[kTot(base)] = formatMinutes(m.minutes);
      if (m.minutes1 != null) map[kP1(base)] = formatMinutes(m.minutes1);
      if (m.minutes2 != null) map[kP2(base)] = formatMinutes(m.minutes2);
    }
    return map;
  }, [minutes]);

  const [draft, setDraft] = useState<Record<string, string>>(saved);
  useEffect(() => setDraft(saved), [saved]);
  const { online } = useConnection();

  const dirtyKeys = Object.keys({ ...saved, ...draft }).filter(
    (k) => (draft[k] ?? "").trim() !== (saved[k] ?? ""),
  );
  // Avisar a la app de que hay minutos sin guardar (no actualizar a mitad)
  const hasDirty = dirtyKeys.length > 0;
  useEffect(() => {
    setUnsavedChanges(hasDirty);
    return () => setUnsavedChanges(false);
  }, [hasDirty]);
  const invalidKeys = new Set(
    Object.entries(draft)
      .filter(([, v]) => Number.isNaN(parseMinutesInput(v)))
      .map(([k]) => k),
  );

  /** Valores en vivo (borrador) de un jugador en un partido */
  const live = (sessionId: string, jugador: string) =>
    cellValues(draft, cellKey(sessionId, jugador));

  // ── Filtro de jugadores de la tabla (solo oculta filas; no cambia lo guardado) ──
  const filterKey = `minutos-tabla-filtro:${callUpId}`;
  const [tableFilter, setTableFilterState] = useState<{ list: string[]; soloConMinutos: boolean }>(
    () => {
      try {
        const raw = localStorage.getItem(filterKey);
        if (raw) {
          const f = JSON.parse(raw);
          if (f && Array.isArray(f.list))
            return { list: f.list, soloConMinutos: !!f.soloConMinutos };
        }
      } catch {
        /* sin almacenamiento */
      }
      return { list: selectedPlayers, soloConMinutos: false };
    },
  );
  const setTableFilter = (f: { list: string[]; soloConMinutos: boolean }) => {
    setTableFilterState(f);
    try {
      localStorage.setItem(filterKey, JSON.stringify(f));
    } catch {
      /* sin almacenamiento */
    }
  };
  // "Solo con minutos" usa lo guardado (para que la fila no desaparezca mientras se
  // escribe) y la parte elegida: en "1ª parte", quien jugó la 1ª parte.
  const hasSavedMinutes = (j: string) =>
    matches.some((s) => viewValue(cellValues(saved, cellKey(s.id, j)), vista) > 0);
  const tableRows = roster.filter(
    (j) =>
      (tableFilter.list.length === 0 || tableFilter.list.some((x) => samePlayer(x, j))) &&
      (!tableFilter.soloConMinutos || hasSavedMinutes(j)),
  );
  const filterActive = tableFilter.list.length > 0 || tableFilter.soloConMinutos;

  // ── Cargar minutos desde una imagen ──
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const openImport = (file: File | null) => {
    setImportFile(file);
    setImportOpen(true);
  };
  // Pegar una imagen (Ctrl+V / Cmd+V) con la pestaña abierta
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
      const file = item?.getAsFile();
      if (!file) return;
      e.preventDefault();
      openImport(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  function applyImport(sessionId: string, entries: ImportEntry[], overwrite: boolean) {
    const patch: Record<string, string> = {};
    let filled = 0;
    let skipped = 0;
    let withParts = false;
    for (const e of entries) {
      const base = cellKey(sessionId, e.jugador);
      const hasValue = [kTot(base), kP1(base), kP2(base)].some(
        (k) => (draft[k] ?? "").trim() !== "",
      );
      if (hasValue && !overwrite) {
        skipped++;
        continue;
      }
      if (e.p1 !== null || e.p2 !== null) {
        withParts = true;
        patch[kP1(base)] = e.p1 === null ? "" : formatMinutes(e.p1);
        patch[kP2(base)] = e.p2 === null ? "" : formatMinutes(e.p2);
      } else if (e.total !== null) {
        patch[kTot(base)] = formatMinutes(e.total);
        patch[kP1(base)] = "";
        patch[kP2(base)] = "";
      } else continue;
      filled++;
    }
    setDraft((d) => ({ ...d, ...patch }));
    if (withParts) setVista("partes");
    const sinDato = roster.length - filled - skipped;
    const parts = [`${filled} ${filled === 1 ? "jugador rellenado" : "jugadores rellenados"}`];
    if (skipped) parts.push(`${skipped} ya tenían valor (no se han tocado)`);
    if (sinDato > 0)
      parts.push(
        `${sinDato} sin dato: ${sinDato === 1 ? "rellénalo" : "rellénalos"} a mano y pulsa Guardar`,
      );
    else parts.push("revisa y pulsa Guardar");
    toast.success(parts.join(" · "), { duration: 8000 });
  }

  // ── Ajuste automático de la tabla a la pantalla ──
  const rowMin = partes ? ROW_MIN_PARTES : ROW_MIN;
  const wrapRef = useRef<HTMLDivElement>(null);
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  const tfootRef = useRef<HTMLTableSectionElement>(null);
  const [rowH, setRowH] = useState(ROW_MIN);
  const [wrapW, setWrapW] = useState(0);
  const scrolledToEnd = useRef(false);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () => {
      const tbody = tbodyRef.current;
      if (!tbody) return;
      setWrapW(wrap.clientWidth);
      const top = tbody.getBoundingClientRect().top + window.scrollY;
      const foot = tfootRef.current?.getBoundingClientRect().height ?? 0;
      const hScrollbar = wrap.offsetHeight - wrap.clientHeight; // barra horizontal, si la hay
      const free = window.innerHeight - top - foot - hScrollbar - 12;
      const n = Math.max(1, tableRows.length);
      setRowH(clamp(Math.floor(free / n), rowMin, ROW_MAX));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [roster.length, tableRows.length, matches.length, rowMin]);

  const totW = partes ? COL_TOTAL_PARTES : COL_TOTAL;
  const cols = columnWidths(
    wrapW || 1000,
    matches.length,
    partes ? COL_SUB_MIN * 2 + 16 : COL_MATCH_MIN,
    partes ? 240 : COL_MATCH_MAX,
    totW,
  );
  const tableW = cols.jugador + cols.match * matches.length + totW * 2;

  // Con scroll horizontal, al abrir se ve el último partido
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || scrolledToEnd.current || !wrapW) return;
    if (wrap.scrollWidth > wrap.clientWidth) wrap.scrollLeft = wrap.scrollWidth;
    scrolledToEnd.current = true;
  }, [wrapW]);

  const big = rowH >= 30;
  const photoPx = clamp(rowH - 6, 20, 32);
  const inputH = partes ? Math.max(19, rowH - 14) : rowH - 4;
  const inputText = partes
    ? "text-[13px] md:text-[13px]"
    : big
      ? "text-[14px] md:text-[14px]"
      : "text-[13px] md:text-[13px]";
  const stickyLeft = "sticky left-0 bg-card shadow-[1px_0_0_var(--border)]";
  const stickyTotal = "sticky bg-card shadow-[-1px_0_0_var(--border)]";

  function addPlayer() {
    const name = newPlayer.trim();
    if (!name) return;
    if (roster.some((x) => samePlayer(x, name))) {
      toast.info(`${name} ya está en la lista`);
    } else {
      setExtraPlayers((p) => [...p, name]);
      // Que el nuevo jugador se vea aunque haya un filtro activo
      if (tableFilter.list.length > 0)
        setTableFilter({
          ...tableFilter,
          list: [...tableFilter.list.filter((x) => x !== NONE), name],
        });
    }
    setNewPlayer("");
    setAddOpen(false);
  }

  async function handleSave() {
    if (invalidKeys.size > 0) {
      toast.error("Hay valores no válidos. Usa minutos (25) o mm:ss (25:30).");
      return;
    }
    const rows = [];
    for (const s of matches) {
      for (const j of roster) {
        const base = cellKey(s.id, j);
        if (![kTot(base), kP1(base), kP2(base)].some((k) => dirtyKeys.includes(k))) continue;
        const v = cellValues(draft, base);
        const totalTyped = parsed(draft[kTot(base)]);
        rows.push({
          callUpId,
          session: s,
          jugador: j,
          minutes: v.hasParts ? v.total : totalTyped,
          minutes1: v.p1,
          minutes2: v.p2,
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

  // Datos en vivo para la gráfica (mismos valores que la tabla)
  const chartRows: ChartRow[] = roster.map((j) => {
    const vals = matches.map((m) => live(m.id, j));
    return {
      jugador: j,
      perMatch: vals.map((v) => v.total),
      perMatch1: vals.map((v) => v.p1 ?? 0),
      perMatch2: vals.map((v) => v.p2 ?? 0),
      perMatchSin: vals.map((v) => (v.hasParts ? 0 : v.total)),
    };
  });
  const matchLabels = matches.map(
    (m) => formatDateShortES(m.date) + (m.dayLabel ? ` ${m.dayLabel}` : ""),
  );

  /** Input de minutos (total, 1ª o 2ª) */
  const minutesInput = (
    k: string,
    label: string,
    opts: { part?: boolean; title?: string } = {},
  ) => {
    const isDirty = dirtyKeys.includes(k);
    const isInvalid = invalidKeys.has(k);
    const val = parsed(draft[k]);
    const warn = !!opts.part && val !== null && val > PART_WARN;
    const border = isInvalid
      ? "border-destructive"
      : warn
        ? "border-[#f97316] ring-1 ring-[#f97316]/40"
        : isDirty
          ? "border-primary"
          : "";
    return (
      <Input
        inputMode="decimal"
        value={draft[k] ?? ""}
        placeholder="—"
        onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
        onBlur={(e) => {
          const v = parseMinutesInput(e.target.value);
          if (v !== null && !Number.isNaN(v)) setDraft((d) => ({ ...d, [k]: formatMinutes(v) }));
        }}
        aria-label={label}
        aria-invalid={isInvalid}
        data-warn={warn || undefined}
        title={warn ? "Más de 20 minutos en una parte: ¿prórroga o error?" : opts.title}
        style={{ height: inputH }}
        className={`w-full max-w-[110px] mx-auto py-0 px-1 text-center tabular-nums ${inputText} ${border}`}
      />
    );
  };

  const totalTitle = (() => {
    if (vista === "p1") return "Suma de las 1ª partes";
    if (vista === "p2") return "Suma de las 2ª partes";
    return "Suma de los partidos";
  })();

  return (
    <div className="space-y-4">
      <div
        className={`rounded-lg border bg-card overflow-hidden relative ${dragOver ? "ring-2 ring-primary" : ""}`}
        onDragOver={(e) => {
          if ([...e.dataTransfer.items].some((i) => i.type.startsWith("image/"))) {
            e.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          const file = [...e.dataTransfer.files].find((f) => f.type.startsWith("image/"));
          setDragOver(false);
          if (!file) return;
          e.preventDefault();
          openImport(file);
        }}
      >
        {dragOver && (
          <div className="absolute inset-0 z-40 grid place-items-center bg-background/70 text-sm font-medium pointer-events-none">
            Suelta la imagen para cargar los minutos
          </div>
        )}
        <div className="px-4 py-2 border-b flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Timer className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-medium whitespace-nowrap">Minutos de juego</h3>
            <span
              className="grid place-items-center size-4 rounded-full border text-[10px] text-muted-foreground cursor-help"
              title="Formato: 25 · 25,5 · 25:30"
              aria-label="Formato: 25 · 25,5 · 25:30"
            >
              ?
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5" data-testid="minutos-barra">
            <div
              className="inline-flex rounded-md border p-0.5 bg-muted/30 text-xs"
              role="group"
              aria-label="Vista"
            >
              {(Object.keys(VISTA_LABEL) as Vista[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setVista(v)}
                  aria-pressed={vista === v}
                  aria-label={VISTA_LABEL[v]}
                  title={VISTA_LABEL[v]}
                  className={`px-2 py-1 rounded font-medium transition-colors whitespace-nowrap ${
                    vista === v
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {VISTA_CORTA[v]}
                </button>
              ))}
            </div>
            <PlayerMultiSelect
              players={roster}
              value={tableFilter.list}
              onChange={(list) => setTableFilter({ ...tableFilter, list })}
              compact
            />
            <label
              className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none whitespace-nowrap"
              title="Solo jugadores con minutos"
            >
              <input
                type="checkbox"
                checked={tableFilter.soloConMinutos}
                onChange={(e) =>
                  setTableFilter({ ...tableFilter, soloConMinutos: e.target.checked })
                }
              />
              <span className="sr-only">Solo </span>Con minutos
            </label>
            {filterActive && (
              <span
                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground whitespace-nowrap"
                data-testid="minutos-mostrando"
                title={`Mostrando ${tableRows.length} de ${roster.length} jugadores`}
              >
                <span className="sr-only">Mostrando </span>
                {tableRows.length}
                <span className="sr-only"> de </span>
                <span aria-hidden>/</span>
                {roster.length}
                <button
                  type="button"
                  onClick={() => setTableFilter({ list: [], soloConMinutos: false })}
                  className="text-primary hover:underline"
                  aria-label="Quitar filtro"
                  title="Quitar filtro"
                >
                  ✕
                </button>
              </span>
            )}
            <span className="w-px h-5 bg-border mx-0.5" aria-hidden />
            <button
              type="button"
              onClick={() => openImport(null)}
              className="size-8 grid place-items-center rounded-md border hover:bg-accent text-muted-foreground"
              aria-label="Cargar imagen"
              title="Cargar imagen: rellenar los minutos de un partido desde una imagen (también puedes arrastrarla o pegarla)"
            >
              <ImageUp className="size-4" />
            </button>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                addPlayer();
              }}
              className="relative flex items-center"
            >
              {addOpen && (
                <div className="absolute right-0 top-full mt-1 z-40 rounded-md border bg-popover p-1.5 shadow-lg">
                  <Input
                    autoFocus
                    value={newPlayer}
                    onChange={(e) => setNewPlayer(e.target.value)}
                    onKeyDown={(e) => e.key === "Escape" && (setNewPlayer(""), setAddOpen(false))}
                    onBlur={() => !newPlayer.trim() && setAddOpen(false)}
                    placeholder="Añadir jugador"
                    className="h-8 text-xs md:text-xs w-48"
                  />
                  <div className="text-[10px] text-muted-foreground mt-1 px-0.5">
                    Enter para añadir · Esc para cerrar
                  </div>
                </div>
              )}
              <button
                type={addOpen ? "submit" : "button"}
                onClick={(e) => {
                  if (!addOpen) {
                    e.preventDefault();
                    setAddOpen(true);
                  }
                }}
                className="size-8 grid place-items-center rounded-md border hover:bg-accent text-muted-foreground"
                aria-label="Añadir jugador"
                title="Añadir jugador a la lista"
              >
                <Plus className="size-3.5" />
              </button>
            </form>
            {dirtyKeys.length > 0 && (
              <button
                onClick={() => setDraft(saved)}
                disabled={saving}
                aria-label="Descartar"
                title="Descartar los cambios sin guardar"
                className="h-8 text-xs flex items-center gap-1.5 px-2.5 rounded-md border hover:bg-accent disabled:opacity-50 whitespace-nowrap"
              >
                <Undo2 className="size-3.5" />
                <span className="sr-only lg:not-sr-only">Descartar</span>
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={saving || dirtyKeys.length === 0 || !online}
              title={online ? undefined : OFFLINE_SAVE_MSG}
              className="h-8 text-xs flex items-center gap-1.5 px-3 whitespace-nowrap rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90 disabled:opacity-50"
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
            Aún no hay jugadores. Añádelos con el botón «+» (Añadir jugador).
          </div>
        ) : (
          <div ref={wrapRef} className="overflow-x-auto overflow-y-hidden">
            <table
              className="table-fixed text-[13px] border-collapse"
              style={{ width: tableW }}
              data-vista={vista}
            >
              <colgroup>
                <col style={{ width: cols.jugador }} />
                {matches.map((s) => (
                  <col key={s.id} style={{ width: cols.match }} />
                ))}
                <col style={{ width: totW }} />
                <col style={{ width: totW }} />
              </colgroup>
              <thead className="text-muted-foreground">
                <tr className="border-b">
                  <th className={`text-left text-xs font-medium px-2 py-1.5 z-30 ${stickyLeft}`}>
                    Jugador
                  </th>
                  {matches.map((s) => (
                    <th key={s.id} className="text-center font-medium px-2 py-1 leading-tight">
                      <div className="text-xs">
                        {formatDateShortES(s.date)}
                        {s.dayLabel ? ` ${s.dayLabel}` : ""}
                      </div>
                      {partes ? (
                        <div className="grid grid-cols-2 gap-2 text-[10px] font-normal">
                          <span>1ª</span>
                          <span>2ª</span>
                        </div>
                      ) : (
                        <div className="text-[10px] font-normal">
                          {vista === "p1" ? "1ª PARTE" : vista === "p2" ? "2ª PARTE" : s.type}
                        </div>
                      )}
                    </th>
                  ))}
                  <th
                    className={`text-right text-xs font-medium px-2 py-1.5 z-20 ${stickyTotal}`}
                    style={{ right: totW }}
                    title={totalTitle}
                  >
                    Total
                    {(vista === "p1" || vista === "p2") && (
                      <div className="text-[10px] font-normal">{VISTA_LABEL[vista]}</div>
                    )}
                  </th>
                  <th
                    className={`text-right text-xs font-medium px-2 py-1.5 z-20 right-0 ${stickyTotal}`}
                  >
                    Media
                    {(vista === "p1" || vista === "p2") && (
                      <div className="text-[10px] font-normal">{VISTA_LABEL[vista]}</div>
                    )}
                  </th>
                </tr>
              </thead>
              <tbody ref={tbodyRef}>
                {tableRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={matches.length + 3}
                      className="py-6 text-center text-muted-foreground"
                    >
                      Ningún jugador coincide con el filtro
                    </td>
                  </tr>
                )}
                {tableRows.map((j) => {
                  const vals = matches.map((s) => live(s.id, j));
                  const values = vals.map((v) => viewValue(v, vista));
                  const played = values.filter((v) => v > 0);
                  const total = played.reduce((a, b) => a + b, 0);
                  const sum1 = vals.reduce((a, v) => a + (v.p1 ?? 0), 0);
                  const sum2 = vals.reduce((a, v) => a + (v.p2 ?? 0), 0);
                  return (
                    <tr key={j} className="border-t" style={{ height: rowH }} data-player={j}>
                      <td className={`px-2 py-0 z-10 ${stickyLeft}`}>
                        <div className="flex items-center gap-2 min-w-0">
                          <PlayerPhoto name={j} size={photoPx} />
                          <span
                            className={`font-semibold truncate min-w-0 ${big ? "text-[14px]" : "text-[13px]"}`}
                            title={j}
                          >
                            {j}
                          </span>
                        </div>
                      </td>
                      {matches.map((s, i) => {
                        const base = cellKey(s.id, j);
                        const v = vals[i];
                        const who = `${j} el ${s.date}`;
                        if (partes) {
                          return (
                            <td key={s.id} className="px-2 py-0.5" data-match={s.id}>
                              <div className="grid grid-cols-2 gap-1.5">
                                {minutesInput(kP1(base), `1ª parte de ${who}`, { part: true })}
                                {minutesInput(kP2(base), `2ª parte de ${who}`, { part: true })}
                              </div>
                              <div
                                className="text-[10px] leading-[11px] text-center tabular-nums text-muted-foreground mt-px"
                                data-total
                              >
                                {v.hasParts
                                  ? formatMinutes(v.total)
                                  : v.total > 0
                                    ? `${formatMinutes(v.total)} sin desglose`
                                    : "—"}
                              </div>
                            </td>
                          );
                        }
                        if (vista === "p1" || vista === "p2") {
                          const noParts = !v.hasParts && v.total > 0;
                          return (
                            <td key={s.id} className="px-2 py-0" data-match={s.id}>
                              {minutesInput(
                                vista === "p1" ? kP1(base) : kP2(base),
                                `${VISTA_LABEL[vista]} de ${who}`,
                                {
                                  part: true,
                                  title: noParts
                                    ? `Sin desglose por partes (total ${formatMinutes(v.total)}). Si escribes una parte, el total pasará a ser 1ª + 2ª.`
                                    : undefined,
                                },
                              )}
                            </td>
                          );
                        }
                        // Vista Total
                        return (
                          <td key={s.id} className="px-2 py-0" data-match={s.id}>
                            {v.hasParts ? (
                              <div
                                style={{ height: inputH }}
                                className={`w-full max-w-[110px] mx-auto grid place-items-center rounded-md border border-dashed tabular-nums text-muted-foreground ${inputText}`}
                                title="Suma de 1ª + 2ª: edítalo en la vista Por partes"
                                data-readonly
                              >
                                {formatMinutes(v.total)}
                              </div>
                            ) : (
                              minutesInput(kTot(base), `Minutos de ${who}`)
                            )}
                          </td>
                        );
                      })}
                      <td
                        className={`px-2 py-0 text-right tabular-nums font-semibold text-[14px] z-10 ${stickyTotal}`}
                        style={{ right: totW }}
                        data-col="total"
                      >
                        {fmtOrDash(total)}
                        {partes && (sum1 > 0 || sum2 > 0) && (
                          <div className="text-[10px] leading-[11px] font-normal text-muted-foreground">
                            1ª {formatMinutes(sum1)} · 2ª {formatMinutes(sum2)}
                          </div>
                        )}
                      </td>
                      <td
                        className={`px-2 py-0 text-right tabular-nums text-[13px] text-muted-foreground z-10 right-0 ${stickyTotal}`}
                        data-col="media"
                      >
                        {played.length > 0 ? formatMinutes(total / played.length) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot ref={tfootRef} className="text-[13px] text-muted-foreground border-t">
                <tr>
                  <td className={`px-2 py-1.5 z-10 ${stickyLeft}`} data-total-label>
                    {filterActive
                      ? `Total filtrado (${tableRows.length} ${tableRows.length === 1 ? "jugador" : "jugadores"})`
                      : "Total equipo"}
                    {(vista === "p1" || vista === "p2") && ` · ${VISTA_LABEL[vista]}`}
                  </td>
                  {matches.map((s) => {
                    const vs = tableRows.map((j) => live(s.id, j));
                    if (partes) {
                      const s1 = vs.reduce((a, v) => a + (v.p1 ?? 0), 0);
                      const s2 = vs.reduce((a, v) => a + (v.p2 ?? 0), 0);
                      return (
                        <td key={s.id} className="px-2 py-1.5 tabular-nums" data-match={s.id}>
                          <div className="grid grid-cols-2 gap-1.5 text-center">
                            <span>{fmtOrDash(s1)}</span>
                            <span>{fmtOrDash(s2)}</span>
                          </div>
                        </td>
                      );
                    }
                    const sum = vs.reduce((a, v) => a + viewValue(v, vista), 0);
                    return (
                      <td
                        key={s.id}
                        className="px-2 py-1.5 text-center tabular-nums"
                        data-match={s.id}
                      >
                        {fmtOrDash(sum)}
                      </td>
                    );
                  })}
                  <td className={`z-10 ${stickyTotal}`} style={{ right: totW }} />
                  <td className={`z-10 right-0 ${stickyTotal}`} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
      <MinutosImageImport
        open={importOpen}
        onOpenChange={(o) => {
          setImportOpen(o);
          if (!o) setImportFile(null);
        }}
        initialFile={importFile}
        matches={matches}
        roster={roster}
        matchLabel={(m) =>
          `${formatDateShortES(m.date)}${m.dayLabel ? ` ${m.dayLabel}` : ""} · ${m.type}`
        }
        existing={(sid, j) => {
          const base = cellKey(sid, j);
          const v = cellValues(draft, base);
          return {
            ...v,
            filled: [kTot(base), kP1(base), kP2(base)].some((k) => (draft[k] ?? "").trim() !== ""),
          };
        }}
        matchHasSavedParts={(sid) =>
          roster.some((j) => cellValues(saved, cellKey(sid, j)).hasParts)
        }
        onApply={applyImport}
      />
      {roster.length > 0 && (
        <MinutosAcumuladosChart
          rows={chartRows}
          matchLabels={matchLabels}
          copyButton={copyButton}
          storageKey={`minutos-grafica-filtro:${callUpId}`}
          initialPlayers={selectedPlayers}
        />
      )}
    </div>
  );
}

// ─── Foto del jugador ─────────────────────────────────────────────────────────

function PlayerPhoto({ name, size = 28 }: { name: string; size?: number }) {
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
      <div
        style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.38)) }}
        className="shrink-0 rounded-full border border-border bg-muted text-muted-foreground grid place-items-center font-semibold"
      >
        {initials}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={name}
      onError={() => setFailed(true)}
      style={{ width: size, height: size }}
      className="shrink-0 rounded-full object-cover border border-border"
    />
  );
}

// ─── Gráfica: minutos acumulados por jugador ──────────────────────────────────

const CHART_ID = "minutos-acumulados-chart";
const ROW_PX = 32;

/** Tonos de rojo de más oscuro a más claro, uno por partido */
function redShade(i: number, n: number): string {
  const dark = [127, 29, 29]; // #7f1d1d
  const light = [252, 165, 165]; // #fca5a5
  if (n <= 1) return "#dc2626";
  const t = i / (n - 1);
  const c = dark.map((d, k) => Math.round(d + (light[k] - d) * t));
  return `rgb(${c.join(",")})`;
}

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

type Preset = "lista" | "conMinutos";
interface ChartFilter {
  preset: Preset;
  /** Con preset "lista": [] = todos; [NONE] = ninguno */
  list: string[];
}

function loadFilter(key: string, initial: string[]): ChartFilter {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const f = JSON.parse(raw);
      if (f && Array.isArray(f.list) && ["lista", "conMinutos"].includes(f.preset)) return f;
    }
  } catch {
    /* sin almacenamiento */
  }
  return { preset: "lista", list: initial };
}

interface ChartRow {
  jugador: string;
  /** Total por partido */
  perMatch: number[];
  /** 1ª y 2ª parte por partido (0 si no hay desglose) */
  perMatch1: number[];
  perMatch2: number[];
  /** Minutos sin desglose por partido (partidos con solo total) */
  perMatchSin: number[];
}

type Parte = "completo" | "p1" | "p2";
const PARTE_LABEL: Record<Parte, string> = {
  completo: "Partido completo",
  p1: "1ª parte",
  p2: "2ª parte",
};
type Modo = "total" | "partido" | "partes";
const MODO_LABEL: Record<Modo, string> = {
  total: "Total",
  partido: "Por partido",
  partes: "1ª vs 2ª",
};
const C_P1 = "#991b1b";
const C_P2 = "#f87171";
const C_SIN = "#6b7280";

function MinutosAcumuladosChart({
  rows,
  matchLabels,
  copyButton,
  storageKey,
  initialPlayers,
}: {
  rows: ChartRow[];
  matchLabels: string[];
  copyButton?: (targetId: string) => ReactNode;
  storageKey: string;
  initialPlayers: string[];
}) {
  const [mode, setMode] = useState<Modo>("total");
  const [parte, setParte] = useState<Parte>("completo");
  const [filter, setFilterState] = useState<ChartFilter>(() =>
    loadFilter(storageKey, initialPlayers),
  );
  const setFilter = (f: ChartFilter) => {
    setFilterState(f);
    try {
      localStorage.setItem(storageKey, JSON.stringify(f));
    } catch {
      /* sin almacenamiento */
    }
  };

  // En "1ª vs 2ª" se muestra el partido completo repartido por partes
  const parteEf: Parte = mode === "partes" ? "completo" : parte;
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

  // Ordenadas de más a menos minutos; los que no han jugado, al final
  const data = rows
    .map((r) => {
      const series = parteEf === "p1" ? r.perMatch1 : parteEf === "p2" ? r.perMatch2 : r.perMatch;
      const row: Record<string, number | string> = {
        jugador: r.jugador,
        total: sum(series),
        p1: sum(r.perMatch1),
        p2: sum(r.perMatch2),
        sin: sum(r.perMatchSin),
        completo: sum(r.perMatch),
      };
      series.forEach((v, i) => (row[`m${i}`] = v));
      return row;
    })
    .sort(
      (a, b) =>
        (b.total as number) - (a.total as number) ||
        String(a.jugador).localeCompare(String(b.jugador), "es"),
    );

  // Filtro de jugadores (solo afecta a la gráfica). "Solo con minutos" es dinámico.
  const norm = (n: string) => n.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
  const shown =
    filter.preset === "conMinutos"
      ? data.filter((r) => (r.total as number) > 0)
      : filter.list.length === 0
        ? data
        : data.filter((r) => filter.list.some((p) => norm(p) === norm(String(r.jugador))));
  const allNames = rows.map((r) => r.jugador);
  const pickerValue = filter.preset === "lista" ? filter.list : shown.map((r) => String(r.jugador));

  const byMatch = mode === "partido" && matchLabels.length > 0;
  const height = Math.max(120, shown.length * ROW_PX + 60);
  const anySin = shown.some((r) => (r.sin as number) > 0);
  const title =
    "Minutos acumulados por jugador" +
    (mode === "partes"
      ? " — 1ª vs 2ª parte"
      : parteEf !== "completo"
        ? ` — ${PARTE_LABEL[parteEf]}`
        : "");

  const totalLabel = (
    <LabelList
      content={(p) => (
        <TotalLabel
          index={p.index}
          x={p.x}
          y={p.y}
          width={p.width}
          height={p.height}
          data={shown}
        />
      )}
    />
  );

  return (
    <section id={CHART_ID} className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium" data-chart-title>
            {title}
          </h3>
          <p className="text-[11px] text-muted-foreground">
            Mostrando {shown.length} de {rows.length} jugadores
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PlayerMultiSelect
            players={allNames}
            value={pickerValue}
            onChange={(list) => setFilter({ preset: "lista", list })}
            compact
          />
          <div
            className="inline-flex rounded-md border p-0.5 bg-muted/30 text-xs"
            role="group"
            aria-label="Atajos de jugadores"
          >
            {(
              [
                [
                  "Todos",
                  filter.preset === "lista" && filter.list.length === 0,
                  () => setFilter({ preset: "lista", list: [] }),
                ],
                [
                  "Solo con minutos",
                  filter.preset === "conMinutos",
                  () => setFilter({ preset: "conMinutos", list: [] }),
                ],
              ] as const
            ).map(([label, active, onClick]) => (
              <button
                key={label}
                type="button"
                onClick={onClick}
                aria-pressed={active}
                className={`px-2.5 py-1 rounded font-medium transition-colors ${
                  active
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">Parte</span>
            <select
              aria-label="Parte"
              value={parteEf}
              disabled={mode === "partes"}
              onChange={(e) => setParte(e.target.value as Parte)}
              title={mode === "partes" ? "En 1ª vs 2ª se muestra el partido completo" : undefined}
              className="bg-background border border-border rounded-md px-2 py-1 text-xs disabled:opacity-50"
            >
              {(Object.keys(PARTE_LABEL) as Parte[]).map((p) => (
                <option key={p} value={p}>
                  {PARTE_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
          <div
            className="inline-flex rounded-md border p-0.5 bg-muted/30 text-xs"
            role="group"
            aria-label="Modo de la gráfica"
          >
            {(Object.keys(MODO_LABEL) as Modo[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={`px-3 py-1 rounded font-medium transition-colors ${
                  mode === m
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {MODO_LABEL[m]}
              </button>
            ))}
          </div>
          {copyButton?.(CHART_ID)}
        </div>
      </div>

      {byMatch && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          {matchLabels.map((l, i) => (
            <span key={i} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block size-3 rounded-sm"
                style={{ background: redShade(i, matchLabels.length) }}
              />
              {l}
            </span>
          ))}
        </div>
      )}
      {mode === "partes" && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          {(
            [
              ["1ª parte", C_P1],
              ["2ª parte", C_P2],
              ...(anySin ? [["Sin desglose", C_SIN]] : []),
            ] as [string, string][]
          ).map(([l, c]) => (
            <span key={l} className="inline-flex items-center gap-1.5">
              <span className="inline-block size-3 rounded-sm" style={{ background: c }} />
              {l}
            </span>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <div className="h-28 grid place-items-center text-sm text-muted-foreground border border-dashed rounded-md">
          No hay jugadores seleccionados
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart
            data={shown}
            layout="vertical"
            margin={{ top: 4, right: 56, left: 8, bottom: 4 }}
            barCategoryGap={7}
          >
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
            <XAxis
              type="number"
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              tickFormatter={(v: number) => `${Math.round(v)}′`}
              stroke="var(--border)"
              allowDecimals={false}
            />
            <YAxis
              type="category"
              dataKey="jugador"
              width={190}
              interval={0}
              tickLine={false}
              axisLine={false}
              tick={(props: { x: number; y: number; payload: { value: string } }) => (
                <PlayerTick {...props} />
              )}
            />
            <Tooltip
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0].payload as Record<string, number | string>;
                const f = (k: string) => fmtOrDash(row[k] as number);
                return (
                  <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
                    <div className="font-semibold mb-1">{row.jugador}</div>
                    <div>
                      Total: <b>{f("completo")}</b>
                    </div>
                    <div className="text-muted-foreground mb-1">
                      1ª {f("p1")} · 2ª {f("p2")}
                      {(row.sin as number) > 0 && ` · sin desglose ${f("sin")}`}
                    </div>
                    {mode !== "partes" && (
                      <>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {PARTE_LABEL[parteEf]} por partido
                        </div>
                        {matchLabels.map((l, i) => (
                          <div key={i} className="flex justify-between gap-4 text-muted-foreground">
                            <span>{l}</span>
                            <span className="tabular-nums">{f(`m${i}`)}</span>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                );
              }}
            />
            {mode === "partes" ? (
              (
                [
                  ["p1", "1ª parte", C_P1],
                  ["p2", "2ª parte", C_P2],
                  ["sin", "Sin desglose", C_SIN],
                ] as const
              ).map(([k, name, fill], i, arr) => (
                <Bar
                  key={k}
                  dataKey={k}
                  name={name}
                  stackId="min"
                  fill={fill}
                  barSize={18}
                  isAnimationActive={false}
                  radius={i === arr.length - 1 ? [0, 4, 4, 0] : 0}
                >
                  {i === arr.length - 1 && totalLabel}
                </Bar>
              ))
            ) : byMatch ? (
              matchLabels.map((l, i) => (
                <Bar
                  key={i}
                  dataKey={`m${i}`}
                  name={l}
                  stackId="min"
                  fill={redShade(i, matchLabels.length)}
                  barSize={18}
                  isAnimationActive={false}
                  radius={i === matchLabels.length - 1 ? [0, 4, 4, 0] : 0}
                >
                  {i === matchLabels.length - 1 && totalLabel}
                </Bar>
              ))
            ) : (
              <Bar
                dataKey="total"
                fill={parteEf === "p1" ? C_P1 : parteEf === "p2" ? C_P2 : "#dc2626"}
                barSize={18}
                radius={[0, 4, 4, 0]}
                isAnimationActive={false}
              >
                {totalLabel}
              </Bar>
            )}
          </BarChart>
        </ResponsiveContainer>
      )}
    </section>
  );
}

/** Total (mm:ss) al final de la barra completa */
function TotalLabel(props: {
  index?: number;
  y?: number | string;
  height?: number | string;
  data: Record<string, number | string>[];
  x?: number | string;
  width?: number | string;
}) {
  const row = props.data[props.index ?? -1];
  if (!row || !((row.total as number) > 0)) return null;
  const x = Number(props.x ?? 0) + Number(props.width ?? 0) + 6;
  const y = Number(props.y ?? 0) + Number(props.height ?? 0) / 2;
  return (
    <text
      x={x}
      y={y}
      dominantBaseline="central"
      fill="var(--foreground)"
      fontSize={11}
      fontWeight={600}
    >
      {formatMinutes(row.total as number)}
    </text>
  );
}

/** Etiqueta del eje Y: foto pequeña + nombre */
function PlayerTick({ x, y, payload }: { x: number; y: number; payload: { value: string } }) {
  const name = payload.value;
  const src = getPlayerPhoto(name);
  const id = `clip-${name.replace(/[^a-zA-Z0-9]/g, "")}`;
  const size = 24;
  const left = x - 182;
  return (
    <g>
      <defs>
        <clipPath id={id}>
          <circle cx={left + size / 2} cy={y} r={size / 2} />
        </clipPath>
      </defs>
      <circle
        cx={left + size / 2}
        cy={y}
        r={size / 2 + 1}
        fill="var(--muted)"
        stroke="var(--border)"
      />
      {src ? (
        <image
          href={src}
          x={left}
          y={y - size / 2}
          width={size}
          height={size}
          clipPath={`url(#${id})`}
          preserveAspectRatio="xMidYMid slice"
        />
      ) : (
        <text
          x={left + size / 2}
          y={y}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={9}
          fontWeight={600}
          fill="var(--muted-foreground)"
        >
          {initialsOf(name)}
        </text>
      )}
      <text
        x={left + size + 8}
        y={y}
        dominantBaseline="central"
        fontSize={11}
        fontWeight={600}
        fill="var(--foreground)"
      >
        {name.length > 18 ? `${name.slice(0, 17)}…` : name}
      </text>
    </g>
  );
}
