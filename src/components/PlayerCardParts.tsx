/**
 * Piezas comunes de las tarjetas por jugador ("Informe jugadores" y "Recuperación").
 */
import { useState } from "react";
import { getPlayerPhoto } from "@/lib/player-photos";

/** Foto pequeña en la tarjeta: permite ver de un vistazo qué jugadores no tienen foto. */
export function CardAvatar({ name }: { name: string }) {
  const src = getPlayerPhoto(name);
  const [failed, setFailed] = useState(false);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  if (!src || failed) {
    return (
      <div
        className="size-9 shrink-0 rounded-full border border-dashed grid place-items-center text-[11px] font-semibold text-muted-foreground"
        title="Sin foto: revisa src/lib/player-photos.ts"
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
      className="size-9 shrink-0 rounded-full object-cover border"
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
