/**
 * Piezas comunes de las tarjetas por jugador ("Informe jugadores" y "Recuperación").
 */
import { getPlayerPhoto } from "@/lib/player-photos";
import { PlayerAvatar } from "@/components/PlayerAvatar";

/** Foto pequeña en la tarjeta: permite ver de un vistazo qué jugadores no tienen foto. */
export function CardAvatar({ name }: { name: string }) {
  const hasPhoto = !!getPlayerPhoto(name);
  return (
    <PlayerAvatar
      name={name}
      size={36}
      title={hasPhoto ? name : "Sin foto: revisa src/lib/player-photos.ts"}
    />
  );
}

export function MiniStat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums" style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  );
}
