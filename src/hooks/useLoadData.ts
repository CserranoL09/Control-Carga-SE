/**
 * useLoadData — main data hook
 * Todos los datos vienen del Apps Script en UNA petición por convocatoria (respuestas
 * incluidas; el CSV publicado solo se usa con un Apps Script antiguo). Se guarda una
 * copia en este navegador para mostrar la convocatoria al instante al abrirla.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { fetchFormResponses, filterByDateRange, type FormResponse } from "@/lib/sheets-service";
import {
  fetchAllData,
  type StoredCallUp,
  type StoredSession,
  type StoredMinutes,
  type StoredRecovery,
  type StoredNote,
} from "@/lib/store";
import {
  calcSessionMetrics,
  calcACWRSeries,
  calcPlayerCallUpMetrics,
  type SessionMetrics,
  type PlayerCallUpMetrics,
} from "@/lib/metrics";

// ─── Hook: lista de convocatorias ─────────────────────────────────────────────

export function useCallUps() {
  const [callUps, setCallUps] = useState<StoredCallUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { callUps: data } = await fetchAllData();
      setCallUps(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { callUps, loading, error, refresh };
}

// ─── Hook: dashboard de una convocatoria ──────────────────────────────────────

export interface SyncInfo {
  /** Momento de la última sincronización (ms) */
  at: number;
  /** Duración en el navegador */
  ms: number;
  fromCache: boolean;
  /** Datos guardados en este navegador (aún sin actualizar) */
  local?: boolean;
  serverTimes?: Record<string, number>;
}

interface Snapshot {
  at: number;
  callUp: StoredCallUp;
  sessions: StoredSession[];
  responses: FormResponse[];
  minutes: StoredMinutes[];
  minutesSupported: boolean;
  recovery: StoredRecovery[];
  recoverySupported: boolean;
  notes: StoredNote[];
  notesSupported: boolean;
}

const SNAP_KEY = (id: string) => `convocatoria-datos:${id}`;

function readSnapshot(id: string): Snapshot | null {
  try {
    const raw = localStorage.getItem(SNAP_KEY(id));
    const snap = raw ? (JSON.parse(raw) as Snapshot) : null;
    return snap && snap.callUp && Array.isArray(snap.responses) ? snap : null;
  } catch {
    return null;
  }
}

function writeSnapshot(id: string, snap: Snapshot) {
  try {
    localStorage.setItem(SNAP_KEY(id), JSON.stringify(snap));
  } catch {
    /* sin espacio o sin almacenamiento: no pasa nada */
  }
}

export interface CallUpDashboard {
  callUp: StoredCallUp | undefined;
  sessions: StoredSession[];
  responses: FormResponse[];
  sessionMetrics: SessionMetrics[];
  acwrSeries: ReturnType<typeof calcACWRSeries>;
  acwrSeriesRpe: ReturnType<typeof calcACWRSeries>;
  players: string[];
  playerMetrics: PlayerCallUpMetrics[];
  minutes: StoredMinutes[];
  minutesSupported: boolean;
  recovery: StoredRecovery[];
  recoverySupported: boolean;
  notes: StoredNote[];
  notesSupported: boolean;
  loading: boolean;
  error: string | null;
  /** "Sincronizar": vuelve a leer la hoja (sin caché) */
  refresh: () => void;
  /** Actualiza en segundo plano tras guardar algo (puede usar la caché, que ya se invalidó) */
  refreshQuiet: () => void;
  syncing: boolean;
  lastSync: SyncInfo | null;
  applyServerResponses: (all: FormResponse[]) => void;
  updateResponseLocally: (
    jugador: string,
    fecha: string,
    fatigue: number | null,
    rpe: number | null,
  ) => void;
  updateSessionLocally: (sessionId: string, duration: number) => void;
}

export function useCallUpDashboard(callUpId: string | undefined): CallUpDashboard {
  const [callUp, setCallUp] = useState<StoredCallUp | undefined>();
  const [sessions, setSessions] = useState<StoredSession[]>([]);
  const [responses, setResponses] = useState<FormResponse[]>([]);
  const [minutes, setMinutes] = useState<StoredMinutes[]>([]);
  const [minutesSupported, setMinutesSupported] = useState(true);
  const [recovery, setRecovery] = useState<StoredRecovery[]>([]);
  const [recoverySupported, setRecoverySupported] = useState(true);
  const [notes, setNotes] = useState<StoredNote[]>([]);
  const [notesSupported, setNotesSupported] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<SyncInfo | null>(null);
  const seq = useRef(0);
  const hasData = useRef(false);

  /** Solo las respuestas de las fechas de la convocatoria */
  const prepareResponses = useCallback(
    (all: FormResponse[], cu: StoredCallUp | undefined) =>
      cu ? filterByDateRange(all, cu.startDate, cu.endDate) : all,
    [],
  );

  /**
   * Carga los datos de la convocatoria en UNA petición al Apps Script.
   * - fresh: lee la hoja aunque haya copia en caché (botón "Sincronizar").
   * Si ya hay datos en pantalla no se vuelve a mostrar la carga: se actualiza en segundo plano.
   */
  const load = useCallback(
    async ({ fresh = false }: { fresh?: boolean } = {}) => {
      const my = ++seq.current;
      if (!hasData.current) setLoading(true);
      setSyncing(true);
      setError(null);
      const t0 = performance.now();
      try {
        const data = await fetchAllData({ callUpId, fresh });
        // Respuestas en la misma petición; con un Apps Script antiguo, CSV publicado
        const allResponses = data.responses ?? (await fetchFormResponses(true));
        if (my !== seq.current) return; // ya hay una carga más reciente

        const cu = callUpId ? data.callUps.find((c) => c.id === callUpId) : undefined;
        setCallUp(cu);

        const sess = data.sessions
          .filter((s) => s.callUpId === callUpId)
          .sort((a, b) => a.date.localeCompare(b.date) || a.dayLabel.localeCompare(b.dayLabel));
        setSessions(sess);

        // Minutos de juego: solo los de sesiones de esta convocatoria
        const sessIds = new Set(sess.map((s) => s.id));
        setMinutes(data.minutes.filter((m) => sessIds.has(m.sessionId)));
        setMinutesSupported(data.minutesSupported);

        // Recuperación: solo los días de la convocatoria
        setRecovery(cu ? data.recovery.filter((r) => r.fecha >= cu.startDate && r.fecha <= cu.endDate) : data.recovery);
        setRecoverySupported(data.recoverySupported);

        // Notas del cuerpo técnico de esta convocatoria
        setNotes(data.notes.filter((n) => n.callUpId === callUpId));
        setNotesSupported(data.notesSupported);

        setResponses(prepareResponses(allResponses, cu));
        hasData.current = true;
        const ms = Math.round(performance.now() - t0);
        setLastSync({ at: Date.now(), ms, fromCache: data.fromCache, serverTimes: data.serverTimes });
        console.info(`[sync] convocatoria cargada en ${ms} ms${data.fromCache ? " (caché del Apps Script)" : ""}`);
      } catch (e) {
        if (my !== seq.current) return;
        // Con datos en pantalla se mantienen y se avisa; sin datos, error
        if (hasData.current) setError(`No se pudo sincronizar: ${e}`);
        else setError(String(e));
      } finally {
        if (my === seq.current) {
          setLoading(false);
          setSyncing(false);
        }
      }
    },
    [callUpId, prepareResponses],
  );

  // Al abrir: últimos datos guardados en este navegador al instante y actualización detrás
  useEffect(() => {
    hasData.current = false;
    const snap = callUpId ? readSnapshot(callUpId) : null;
    if (snap) {
      setCallUp(snap.callUp);
      setSessions(snap.sessions);
      setResponses(snap.responses);
      setMinutes(snap.minutes);
      setMinutesSupported(snap.minutesSupported);
      setRecovery(snap.recovery);
      setRecoverySupported(snap.recoverySupported);
      setNotes(snap.notes);
      setNotesSupported(snap.notesSupported);
      setLastSync({ at: snap.at, ms: 0, fromCache: true, local: true });
      hasData.current = true;
      setLoading(false);
    }
    load();
  }, [callUpId, load]);

  // Guardar una copia local tras cada cambio (para la próxima apertura)
  useEffect(() => {
    if (!callUpId || !hasData.current || !callUp) return;
    writeSnapshot(callUpId, {
      at: lastSync?.at ?? Date.now(),
      callUp,
      sessions,
      responses,
      minutes,
      minutesSupported,
      recovery,
      recoverySupported,
      notes,
      notesSupported,
    });
  }, [callUpId, callUp, sessions, responses, minutes, minutesSupported, recovery, recoverySupported, notes, notesSupported, lastSync]);

  /** Sustituye las respuestas por las que devuelve el Apps Script tras guardar en bloque */
  const applyServerResponses = useCallback(
    (all: FormResponse[]) => setResponses(prepareResponses(all, callUp)),
    [prepareResponses, callUp],
  );

  // Métricas derivadas
  const sessionMetrics = calcSessionMetrics(sessions, responses);

  const teamUASeries = sessionMetrics.map((sm) => ({ date: sm.date, ua: sm.fatigaXTiempo }));
  const acwrSeries = calcACWRSeries(teamUASeries);

  const teamRpeUASeries = sessionMetrics.map((sm) => ({ date: sm.date, ua: sm.rpeXTiempo }));
  const acwrSeriesRpe = calcACWRSeries(teamRpeUASeries);

  const uniquePlayers = Array.from(new Set(responses.map((r) => r.jugador))).sort();
  const playerMetrics = uniquePlayers.map((jugador) =>
    calcPlayerCallUpMetrics(jugador, sessions, responses),
  );

  const updateResponseLocally = useCallback((jugador: string, fecha: string, fatigue: number | null, rpe: number | null) => {
    setResponses((prev) => {
      const idx = prev.findIndex((r) => r.jugador.trim().toUpperCase() === jugador.trim().toUpperCase() && r.fecha === fecha);
      if (fatigue === null || rpe === null) {
        if (idx !== -1) {
          return prev.filter((_, i) => i !== idx);
        }
        return prev;
      } else {
        if (idx !== -1) {
          return prev.map((r, i) => i === idx ? { ...r, fatigue, rpe } : r);
        } else {
          return [...prev, { timestamp: new Date().toISOString(), jugador, fatigue, rpe, fecha }];
        }
      }
    });
  }, []);

  const updateSessionLocally = useCallback((sessionId: string, duration: number) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, duration } : s))
    );
  }, []);

  return {
    callUp,
    sessions,
    responses,
    sessionMetrics,
    acwrSeries,
    acwrSeriesRpe,
    players: uniquePlayers,
    playerMetrics,
    minutes,
    minutesSupported,
    recovery,
    recoverySupported,
    notes,
    notesSupported,
    loading,
    error,
    refresh: () => load({ fresh: true }),
    refreshQuiet: () => load(),
    syncing,
    lastSync,
    applyServerResponses,
    updateResponseLocally,
    updateSessionLocally,
  };
}
