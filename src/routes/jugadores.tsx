import { useEffect, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { getPlayerPhoto } from "@/lib/player-photos";
import { players } from "@/lib/mock-data";
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
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function Jugadores() {
  useEffect(() => {
    document.title = "Jugadores · SE-FS Load";
  }, []);

  return (
    <AppLayout>
      <div className="px-8 py-8">
        <div className="flex items-end justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Jugadores</h1>
            <p className="text-sm text-muted-foreground mt-1">Plantilla actual de la Selección.</p>
          </div>
          <NuevoJugadorDialog />
        </div>
        <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {players.map((p) => (
            <div key={p.id} className="rounded-lg border bg-card p-4 flex items-center gap-3">
                 {getPlayerPhoto(p.name) ? (
                   <img
                     src={getPlayerPhoto(p.name)}
                     alt={p.name}
                     className="size-10 rounded-full object-cover border-2 border-border"
                   />
                 ) : (
                   <div className="size-10 rounded-full bg-accent grid place-items-center font-semibold">
                     {p.number}
                   </div>
                 )}
              <div>
                <div className="text-sm font-medium">{p.name}</div>
                <div className="text-xs text-muted-foreground">{p.position}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}

function NuevoJugadorDialog() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="px-3 py-2 text-sm rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90">
          + Añadir jugador
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Añadir jugador</DialogTitle>
          <DialogDescription>
            Introduce los datos del nuevo jugador para añadirlo a la plantilla.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 py-2">
          <div className="grid gap-2">
            <Label htmlFor="nj-name">Nombre completo</Label>
            <Input id="nj-name" placeholder="Ej. Miguel Andrés" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="nj-number">Dorsal</Label>
              <Input id="nj-number" type="number" min={1} max={99} placeholder="Ej. 15" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="nj-position">Posición</Label>
              <Select>
                <SelectTrigger id="nj-position">
                  <SelectValue placeholder="Selecciona" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Portero">Portero</SelectItem>
                  <SelectItem value="Cierre">Cierre</SelectItem>
                  <SelectItem value="Ala">Ala</SelectItem>
                  <SelectItem value="Pívot">Pívot</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancelar</Button>
          </DialogClose>
          <Button type="button">Añadir jugador</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
