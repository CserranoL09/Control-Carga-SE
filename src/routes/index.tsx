import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { ArrowRight, Calendar, MapPin, RefreshCw, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveCallUp, deleteCallUp, updateCallUp, type StoredCallUp } from "@/lib/store";
import { useCallUps } from "@/hooks/useLoadData";
import { useConnection, OFFLINE_SAVE_MSG } from "@/lib/offline";

export default function Convocatorias() {
  useEffect(() => {
    document.title = "Convocatorias · SE-FS Load";
  }, []);

  const { callUps, loading, refresh } = useCallUps();

  return (
    <AppLayout>
      <div className="px-8 py-8">
        <div className="flex items-end justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Convocatorias</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Selecciona una concentración para acceder a su dashboard de carga.
            </p>
          </div>
          <NuevaConvocatoriaDialog onCreated={refresh} />
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
            <div className="relative size-12">
              <div className="absolute inset-0 rounded-full border-4 border-muted" />
              <div className="absolute inset-0 rounded-full border-4 border-primary border-t-transparent animate-spin" />
            </div>
            <div>
              <p className="text-sm font-medium">Sincronizando con Google Sheets…</p>
              <p className="text-xs text-muted-foreground mt-1">
                Cargando convocatorias y sesiones.
              </p>
            </div>
          </div>
        ) : callUps.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground text-sm">
            No hay convocatorias. Crea una con el botón superior.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {callUps.map((c) => (
              <CallUpCard key={c.id} callUp={c} onDeleted={refresh} onUpdated={refresh} />
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

// ─── Call-up card ─────────────────────────────────────────────────────────────

function CallUpCard({
  callUp,
  onDeleted,
  onUpdated,
}: {
  callUp: StoredCallUp;
  onDeleted: () => void;
  onUpdated: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    if (!confirm(`¿Eliminar la convocatoria "${callUp.name}"?`)) return;
    setBusy(true);
    try {
      await deleteCallUp(callUp.id);
      onDeleted();
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus(e: React.MouseEvent) {
    e.preventDefault();
    const next: StoredCallUp["status"] = callUp.status === "En curso" ? "Finalizada" : "En curso";
    setBusy(true);
    try {
      await updateCallUp(callUp.id, { status: next }, callUp);
      onUpdated();
    } finally {
      setBusy(false);
    }
  }

  const days =
    Math.round(
      (new Date(callUp.endDate).getTime() - new Date(callUp.startDate).getTime()) / 86400000,
    ) + 1;

  return (
    <div className="rounded-lg border bg-card p-5 hover:border-primary/60 transition-colors group relative">
      <div className="flex items-center justify-between">
        <button
          onClick={toggleStatus}
          className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full transition-colors ${
            callUp.status === "En curso"
              ? "bg-[color:var(--success)]/15 text-[color:var(--success)] hover:bg-[color:var(--success)]/25"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
          title="Clic para cambiar estado"
        >
          {callUp.status}
        </button>
        <div className="flex items-center gap-1">
          <button
            onClick={handleDelete}
            disabled={busy}
            className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/10 hover:text-destructive transition-all disabled:opacity-40"
            title="Eliminar convocatoria"
          >
            <Trash2 className="size-3.5" />
          </button>
          <Link to={`/convocatorias/${callUp.id}`}>
            <ArrowRight className="size-4 text-muted-foreground group-hover:text-primary transition-colors" />
          </Link>
        </div>
      </div>
      <Link to={`/convocatorias/${callUp.id}`} className="block">
        <h3 className="mt-3 text-lg font-semibold">{callUp.name}</h3>
        <div className="mt-2 text-sm text-muted-foreground space-y-1">
          <div className="flex items-center gap-2">
            <Calendar className="size-3.5" />
            {callUp.startDate} → {callUp.endDate}
          </div>
          <div className="flex items-center gap-2">
            <MapPin className="size-3.5" /> {callUp.location}
          </div>
        </div>
        <div className="mt-4 pt-4 border-t grid grid-cols-2 gap-3 text-xs">
          <div>
            <div className="text-muted-foreground">Duración</div>
            <div className="text-base font-semibold tabular-nums">{days} días</div>
          </div>
          <div>
            <div className="text-muted-foreground">Datos</div>
            <div className="text-base font-semibold">Desde Sheets ↗</div>
          </div>
        </div>
      </Link>
    </div>
  );
}

// ─── New call-up dialog ───────────────────────────────────────────────────────

function NuevaConvocatoriaDialog({ onCreated }: { onCreated: () => void }) {
  const { online } = useConnection();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [location, setLocation] = useState("");
  const [tipo, setTipo] = useState("");
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!name || !startDate || !endDate) return;
    setSaving(true);
    try {
      await saveCallUp({
        name: tipo ? `${name} — ${tipo}` : name,
        startDate,
        endDate,
        location,
        status: "En curso",
        notes,
      });
      setOpen(false);
      setName("");
      setStartDate("");
      setEndDate("");
      setLocation("");
      setTipo("");
      setNotes("");
      onCreated();
    } finally {
      setSaving(false);
    }
  }

  const valid = !!name && !!startDate && !!endDate;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="px-3 py-2 text-sm rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90 flex items-center gap-1.5">
          <Plus className="size-3.5" /> Nueva convocatoria
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nueva convocatoria</DialogTitle>
          <DialogDescription>
            Define los datos de la concentración. Los jugadores se detectan automáticamente desde
            las respuestas del formulario en ese rango de fechas.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 py-2">
          <div className="grid gap-2">
            <Label htmlFor="nc-name">Nombre *</Label>
            <Input
              id="nc-name"
              placeholder="Ej. Ventana Mundial — Junio 26"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="nc-start">Fecha inicio *</Label>
              <Input
                id="nc-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="nc-end">Fecha fin *</Label>
              <Input
                id="nc-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="nc-location">Sede</Label>
              <Input
                id="nc-location"
                placeholder="Ej. CAR Las Rozas"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="nc-type">Tipo</Label>
              <Select value={tipo} onValueChange={setTipo}>
                <SelectTrigger id="nc-type">
                  <SelectValue placeholder="Selecciona tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Competición oficial">Competición oficial</SelectItem>
                  <SelectItem value="Amistosos">Amistosos</SelectItem>
                  <SelectItem value="Preparación">Preparación</SelectItem>
                  <SelectItem value="Clasificación">Clasificación</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="nc-notes">Observaciones</Label>
            <Textarea
              id="nc-notes"
              placeholder="Notas internas, objetivos de la concentración..."
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <RefreshCw className="size-3" />
              Los jugadores de la convocatoria se determinan automáticamente a partir de las
              respuestas del formulario Google entre las fechas seleccionadas.
            </div>
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancelar</Button>
          </DialogClose>
          <Button
            type="button"
            onClick={handleCreate}
            disabled={!valid || saving || !online}
            title={online ? undefined : OFFLINE_SAVE_MSG}
          >
            {saving ? "Guardando…" : "Crear convocatoria"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
