import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { NONE, PlayerMultiSelect } from "@/components/dashboard/PlayerMultiSelect";
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

const cellKey = (sessionId: string, jugador: string) =>
  `${sessionId}|${jugador.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase()}`;

// Tabla: medidas (px)
const ROW_MIN = 26;
const ROW_MAX = 40;
const COL_JUGADOR = 220;
const COL_JUGADOR_MIN = 190;
const COL_TOTAL = 84;
const COL_MATCH_MIN = 84;
const COL_MATCH_MAX = 160;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Anchos de columna para ocupar todo el ancho disponible */
function columnWidths(available: number, nMatches: number) {
  const fixed = COL_TOTAL * 2;
  if (nMatches === 0) return { jugador: Math.max(COL_JUGADOR_MIN, available - fixed), match: 0 };
  let match = (available - COL_JUGADOR - fixed) / nMatches;
  if (match > COL_MATCH_MAX) {
    // Sobra espacio: se lo queda la columna Jugador
    return { jugador: available - fixed - COL_MATCH_MAX * nMatches, match: COL_MATCH_MAX };
  }
  if (match >= COL_MATCH_MIN) return { jugador: COL_JUGADOR, match };
  // Falta espacio: primero se estrecha Jugador hasta su mínimo
  match = (available - COL_JUGADOR_MIN - fixed) / nMatches;
  if (match >= COL_MATCH_MIN) return { jugador: COL_JUGADOR_MIN, match };
  // Ni así cabe: anchos mínimos y scroll horizontal
  return { jugador: COL_JUGADOR_MIN, match: COL_MATCH_MIN };
}

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
  copyButton,
  selectedPlayers = [],
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
  // "Solo con minutos" usa lo guardado, para que la fila no desaparezca mientras se escribe
  const hasSavedMinutes = (j: string) =>
    matches.some((s) => {
      const v = parseMinutesInput(saved[cellKey(s.id, j)] ?? "");
      return v !== null && !Number.isNaN(v) && v > 0;
    });
  const tableRows = roster.filter(
    (j) =>
      (tableFilter.list.length === 0 || tableFilter.list.some((x) => samePlayer(x, j))) &&
      (!tableFilter.soloConMinutos || hasSavedMinutes(j)),
  );
  const filterActive = tableFilter.list.length > 0 || tableFilter.soloConMinutos;

  // ── Ajuste automático de la tabla a la pantalla ──
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
      setRowH(clamp(Math.floor(free / n), ROW_MIN, ROW_MAX));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [roster.length, tableRows.length, matches.length]);

  const cols = columnWidths(wrapW || 1000, matches.length);
  const tableW = cols.jugador + cols.match * matches.length + COL_TOTAL * 2;

  // Con scroll horizontal, al abrir se ve el último partido
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || scrolledToEnd.current || !wrapW) return;
    if (wrap.scrollWidth > wrap.clientWidth) wrap.scrollLeft = wrap.scrollWidth;
    scrolledToEnd.current = true;
  }, [wrapW]);

  const big = rowH >= 30;
  const photoPx = clamp(rowH - 6, 20, 32);
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

  // Datos en vivo para la gráfica (mismos valores que la columna "Total")
  const chartRows = roster.map((j) => ({
    jugador: j,
    perMatch: matches.map((m) => valueOf(m.id, j)),
  }));
  const matchLabels = matches.map(
    (m) => formatDateShortES(m.date) + (m.dayLabel ? ` ${m.dayLabel}` : ""),
  );

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="px-4 py-2 border-b flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Timer className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-medium">Minutos de juego</h3>
            <span className="text-[11px] text-muted-foreground">Formato: 25 · 25,5 · 25:30</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PlayerMultiSelect
              players={roster}
              value={tableFilter.list}
              onChange={(list) => setTableFilter({ ...tableFilter, list })}
              compact
            />
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={tableFilter.soloConMinutos}
                onChange={(e) =>
                  setTableFilter({ ...tableFilter, soloConMinutos: e.target.checked })
                }
              />
              Solo con minutos
            </label>
            {filterActive && (
              <span className="text-[11px] text-muted-foreground" data-testid="minutos-mostrando">
                Mostrando {tableRows.length} de {roster.length}
                <button
                  type="button"
                  onClick={() => setTableFilter({ list: [], soloConMinutos: false })}
                  className="ml-1.5 text-primary hover:underline"
                >
                  Quitar filtro
                </button>
              </span>
            )}
            <span className="w-px h-5 bg-border mx-1" aria-hidden />
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
                className="h-8 text-xs md:text-xs w-40"
              />
              <button
                type="submit"
                className="size-8 grid place-items-center rounded-md border hover:bg-accent text-muted-foreground"
                title="Añadir jugador a la lista"
              >
                <Plus className="size-3.5" />
              </button>
            </form>
            {dirtyKeys.length > 0 && (
              <button
                onClick={() => setDraft(saved)}
                disabled={saving}
                className="h-8 text-xs flex items-center gap-1.5 px-3 rounded-md border hover:bg-accent disabled:opacity-50"
              >
                <Undo2 className="size-3.5" /> Descartar
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={saving || dirtyKeys.length === 0}
              className="h-8 text-xs flex items-center gap-1.5 px-3 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90 disabled:opacity-50"
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
          <div ref={wrapRef} className="overflow-x-auto overflow-y-hidden">
            <table className="table-fixed text-[13px] border-collapse" style={{ width: tableW }}>
              <colgroup>
                <col style={{ width: cols.jugador }} />
                {matches.map((s) => (
                  <col key={s.id} style={{ width: cols.match }} />
                ))}
                <col style={{ width: COL_TOTAL }} />
                <col style={{ width: COL_TOTAL }} />
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
                      <div className="text-[10px] font-normal">{s.type}</div>
                    </th>
                  ))}
                  <th
                    className={`text-right text-xs font-medium px-2 py-1.5 z-20 right-[84px] ${stickyTotal}`}
                  >
                    Total
                  </th>
                  <th
                    className={`text-right text-xs font-medium px-2 py-1.5 z-20 right-0 ${stickyTotal}`}
                  >
                    Media
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
                  const values = matches.map((s) => valueOf(s.id, j));
                  const played = values.filter((v) => v > 0);
                  const total = played.reduce((a, b) => a + b, 0);
                  return (
                    <tr key={j} className="border-t" style={{ height: rowH }}>
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
                      {matches.map((s) => {
                        const k = cellKey(s.id, j);
                        const isDirty = dirtyKeys.includes(k);
                        const isInvalid = invalidKeys.has(k);
                        return (
                          <td key={s.id} className="px-2 py-0">
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
                              style={{ height: rowH - 4 }}
                              className={`w-full max-w-[110px] mx-auto py-0 px-1 text-center tabular-nums ${big ? "text-[14px] md:text-[14px]" : "text-[13px] md:text-[13px]"} ${isInvalid ? "border-destructive" : isDirty ? "border-primary" : ""}`}
                            />
                          </td>
                        );
                      })}
                      <td
                        className={`px-2 py-0 text-right tabular-nums font-semibold text-[14px] z-10 right-[84px] ${stickyTotal}`}
                      >
                        {total > 0 ? formatMinutes(total) : "—"}
                      </td>
                      <td
                        className={`px-2 py-0 text-right tabular-nums text-[13px] text-muted-foreground z-10 right-0 ${stickyTotal}`}
                      >
                        {played.length > 0 ? formatMinutes(total / played.length) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot ref={tfootRef} className="text-[13px] text-muted-foreground border-t">
                <tr>
                  <td className={`px-2 py-1.5 z-10 ${stickyLeft}`}>
                    {filterActive
                      ? `Total filtrado (${tableRows.length} ${tableRows.length === 1 ? "jugador" : "jugadores"})`
                      : "Total equipo"}
                  </td>
                  {matches.map((s) => {
                    const sum = tableRows.reduce((a, j) => a + valueOf(s.id, j), 0);
                    return (
                      <td key={s.id} className="px-2 py-1.5 text-center tabular-nums">
                        {sum > 0 ? formatMinutes(sum) : "—"}
                      </td>
                    );
                  })}
                  <td className={`z-10 right-[84px] ${stickyTotal}`} />
                  <td className={`z-10 right-0 ${stickyTotal}`} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
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

function MinutosAcumuladosChart({
  rows,
  matchLabels,
  copyButton,
  storageKey,
  initialPlayers,
}: {
  rows: { jugador: string; perMatch: number[] }[];
  matchLabels: string[];
  copyButton?: (targetId: string) => ReactNode;
  storageKey: string;
  initialPlayers: string[];
}) {
  const [mode, setMode] = useState<"total" | "partido">("total");
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

  // Ordenadas de más a menos minutos; los que no han jugado, al final
  const data = rows
    .map((r) => {
      const total = r.perMatch.reduce((a, b) => a + b, 0);
      const row: Record<string, number | string> = { jugador: r.jugador, total };
      r.perMatch.forEach((v, i) => (row[`m${i}`] = v));
      return row;
    })
    .sort(
      (a, b) =>
        (b.total as number) - (a.total as number) ||
        String(a.jugador).localeCompare(String(b.jugador), "es"),
    );

  // Filtro de jugadores (solo afecta a la gráfica). "Solo con minutos" es dinámico.
  const norm = (n: string) =>
    n
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toUpperCase();
  const shown =
    filter.preset === "conMinutos"
      ? data.filter((r) => (r.total as number) > 0)
      : filter.list.length === 0
        ? data
        : data.filter((r) => filter.list.some((p) => norm(p) === norm(String(r.jugador))));
  const allNames = rows.map((r) => r.jugador);
  const pickerValue = filter.preset === "lista" ? filter.list : shown.map((r) => String(r.jugador));

  const stacked = mode === "partido" && matchLabels.length > 0;
  const height = Math.max(120, shown.length * ROW_PX + 60);
  const lastKey = stacked ? `m${matchLabels.length - 1}` : "total";

  return (
    <section id={CHART_ID} className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Minutos acumulados por jugador</h3>
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
          <div
            className="inline-flex rounded-md border p-0.5 bg-muted/30 text-xs"
            role="group"
            aria-label="Modo de la gráfica"
          >
            {(["total", "partido"] as const).map((m) => (
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
                {m === "total" ? "Total" : "Por partido"}
              </button>
            ))}
          </div>
          {copyButton?.(CHART_ID)}
        </div>
      </div>

      {stacked && (
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
                return (
                  <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
                    <div className="font-semibold mb-1">{row.jugador}</div>
                    <div className="mb-1">
                      Total:{" "}
                      <b>{(row.total as number) > 0 ? formatMinutes(row.total as number) : "—"}</b>
                    </div>
                    {matchLabels.map((l, i) => (
                      <div key={i} className="flex justify-between gap-4 text-muted-foreground">
                        <span>{l}</span>
                        <span className="tabular-nums">
                          {(row[`m${i}`] as number) > 0
                            ? formatMinutes(row[`m${i}`] as number)
                            : "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            {stacked ? (
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
                  {`m${i}` === lastKey && (
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
                  )}
                </Bar>
              ))
            ) : (
              <Bar
                dataKey="total"
                fill="#dc2626"
                barSize={18}
                radius={[0, 4, 4, 0]}
                isAnimationActive={false}
              >
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
