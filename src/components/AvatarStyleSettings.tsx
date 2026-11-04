/**
 * Ajustes → "Fotos de los jugadores": estilo (A–F), encuadre, tamaño y estilo del PDF,
 * con vista previa en vivo.
 */
import {
  AVATAR_STYLES,
  FRAME_LABEL,
  PlayerAvatar,
  PlayerAvatarSvg,
  SCALE_LABEL,
  useAvatarSize,
  usePlayerAvatarStyle,
  type AvatarFrame,
  type AvatarScale,
  type AvatarStyle,
} from "@/components/PlayerAvatar";

/** Jugadores con foto y uno sin foto (sale la silueta con iniciales) */
const SIN_FOTO = "JUGADOR NUEVO";

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div
        className="inline-flex rounded-md border p-0.5 bg-muted/30 text-xs"
        role="group"
        aria-label={label}
      >
        {options.map(([v, l]) => (
          <button
            key={v}
            type="button"
            aria-pressed={value === v}
            onClick={() => onChange(v)}
            className={`px-3 py-1 rounded font-medium transition-colors ${
              value === v
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AvatarStyleSettings() {
  const { style, setStyle, pdfStyle, setPdfStyle, frame, setFrame, scale, setScale } =
    usePlayerAvatarStyle();

  return (
    <div className="rounded-lg border bg-card p-5 space-y-5" data-testid="avatar-settings">
      <div>
        <h3 className="text-sm font-medium">Fotos de los jugadores</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Las fotos se muestran recortadas, sin recuadro. Elige el estilo, el encuadre y el tamaño:
          se aplica al momento en tablas, gráficas, tarjetas, selector y PDF.
        </p>
      </div>

      {(["Con busto", "Sin busto"] as const).map((group) => (
        <div key={group} className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {group}
          </div>
          <div className="grid sm:grid-cols-3 gap-3" role="radiogroup" aria-label={group}>
            {AVATAR_STYLES.filter((s) => s.group === group).map((s) => {
              const active = s.id === style;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setStyle(s.id)}
                  data-style={s.id}
                  className={`text-left rounded-lg border-2 p-3 transition-colors ${
                    active
                      ? "border-[#c8102e] bg-[#c8102e]/5"
                      : "border-border hover:border-muted-foreground/50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-semibold leading-tight">
                      {s.letter} · {s.label}
                    </span>
                    <span
                      className={`mt-0.5 size-4 shrink-0 rounded-full border-2 grid place-items-center ${
                        active ? "border-[#c8102e]" : "border-muted-foreground/50"
                      }`}
                    >
                      {active && <span className="size-2 rounded-full bg-[#c8102e]" />}
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-foreground mb-2">{s.hint}</div>
                  <div className="flex items-end gap-2.5">
                    <PlayerAvatar name={SIN_FOTO} size={28} variant={s.id} exact />
                    <PlayerAvatar name="SANTA CRUZ" size={48} variant={s.id} exact />
                    <PlayerAvatar name="DÍDAC" size={96} variant={s.id} exact />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <Segmented<AvatarFrame>
          label="Encuadre"
          value={frame}
          options={(Object.keys(FRAME_LABEL) as AvatarFrame[]).map((f) => [f, FRAME_LABEL[f]])}
          onChange={setFrame}
        />
        <Segmented<AvatarScale>
          label="Tamaño"
          value={scale}
          options={(Object.keys(SCALE_LABEL) as AvatarScale[]).map((z) => [z, SCALE_LABEL[z]])}
          onChange={setScale}
        />
      </div>

      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Vista previa
        </div>
        <Preview style={style} />
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>Estilo para el informe PDF</span>
        <select
          aria-label="Estilo para el informe PDF"
          value={pdfStyle}
          onChange={(e) => setPdfStyle(e.target.value as AvatarStyle | "app")}
          className="bg-background border border-border rounded-md px-2 py-1.5 text-sm"
        >
          <option value="app">El mismo que en la app</option>
          {AVATAR_STYLES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.letter} · {s.label}
            </option>
          ))}
        </select>
        <span
          className="ml-auto flex items-end gap-3 rounded-md px-4 py-3"
          style={{ background: "#001b36" }}
        >
          <PlayerAvatar name="DÍDAC" size={64} forPdf theme="pdf" />
          <span className="text-white text-sm font-bold pb-2">DÍDAC</span>
        </span>
      </div>
    </div>
  );
}

function Preview({ style }: { style: AvatarStyle }) {
  const rowH = 30;
  const bar = useAvatarSize(24, 30);
  const rows: [string, string][] = [
    ["RICARDO", "17:14"],
    ["DANI ZURDO", "17:14"],
    ["RAYA", "12:56"],
  ];
  return (
    <div className="space-y-3" data-testid="avatar-preview" data-style={style}>
      <div className="grid md:grid-cols-[1fr_1fr] gap-3">
        {/* Filas de tabla */}
        <div className="rounded-md border text-[13px]">
          {rows.map(([j, v], i) => (
            <div
              key={j}
              className={`flex items-center gap-2 px-2 ${i ? "border-t" : ""}`}
              style={{ height: rowH }}
            >
              <PlayerAvatar name={j} size={rowH - 6} max={rowH - 2} />
              <span className="font-semibold flex-1">{j}</span>
              <span className="tabular-nums font-semibold">{v}</span>
            </div>
          ))}
        </div>

        {/* Tarjeta */}
        <div className="rounded-lg border p-3">
          <div className="flex items-center gap-2.5 mb-2">
            <PlayerAvatar name="PABLO MUÑOZ" size={36} />
            <div>
              <div className="text-sm font-medium">PABLO MUÑOZ</div>
              <div className="text-[11px] text-muted-foreground">11 respuestas</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1 text-xs">
            <div>
              <div className="text-muted-foreground">Fatiga media</div>
              <div className="font-semibold">5.9</div>
            </div>
            <div>
              <div className="text-muted-foreground">Minutos</div>
              <div className="font-semibold">12:35</div>
            </div>
          </div>
        </div>
      </div>

      {/* Barras de la gráfica */}
      <div className="rounded-lg border p-3">
        <svg width="100%" height="118" viewBox="0 0 560 118">
          {[
            ["DÍDAC", 300, "40:00"],
            ["RICARDO", 129, "17:14"],
            ["RAYA", 97, "12:56"],
          ].map(([j, w, v], i) => {
            const y = 20 + i * 38;
            return (
              <g key={String(j)}>
                <PlayerAvatarSvg name={String(j)} x={4} y={y - bar / 2} size={bar} />
                <text
                  x={4 + bar + 8}
                  y={y}
                  dominantBaseline="central"
                  fontSize={11}
                  fontWeight={600}
                  fill="var(--foreground)"
                >
                  {j}
                </text>
                <rect x={150} y={y - 9} width={Number(w)} height={18} rx={3} fill="#dc2626" />
                <text
                  x={156 + Number(w)}
                  y={y}
                  dominantBaseline="central"
                  fontSize={11}
                  fontWeight={600}
                  fill="var(--foreground)"
                >
                  {v}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
