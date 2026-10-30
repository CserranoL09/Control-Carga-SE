import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  Activity,
  TrendingUp,
  CalendarDays,
  Settings,
  Bell,
  Smartphone,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { ReactNode, useEffect, useState } from "react";

const SIDEBAR_KEY = "sidebar-collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
}

const nav = [
  { to: "/", label: "Convocatorias", icon: CalendarDays },
  // { to: "/jugadores", label: "Jugadores", icon: Users },
  // { to: "/portal", label: "Portal Jugador", icon: Smartphone },
  { to: "/ajustes", label: "Ajustes", icon: Settings },
];

export function AppLayout({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
    } catch {
      /* sin almacenamiento: solo se pierde la preferencia */
    }
    // Las gráficas (ResponsiveContainer) se ajustan al nuevo ancho al terminar la transición
    const t = setTimeout(() => window.dispatchEvent(new Event("resize")), 220);
    return () => clearTimeout(t);
  }, [collapsed]);

  return (
    <div className="flex min-h-screen">
      <aside
        aria-hidden={collapsed}
        className={`shrink-0 overflow-hidden bg-sidebar text-sidebar-foreground transition-all duration-200 ${
          collapsed ? "w-0 border-r-0" : "w-60 border-r border-sidebar-border"
        }`}
      >
        <div className="w-60 h-full flex flex-col">
        <div className="px-5 py-5 flex items-center gap-3 border-b border-sidebar-border">
          <img src="/logo se fs.png" alt="Logo" style={{ width: '70px' }} />
          <div className="leading-tight">
            <div className="text-sm font-semibold">Control de Carga</div>
            <div className="text-[11px] text-muted-foreground">Selección absoluta</div>
          </div>
        </div>
        <nav className="p-3 flex-1 space-y-1">
          {nav.map((n) => {
            const active = n.to === "/" ? loc.pathname === "/" : loc.pathname.startsWith(n.to);
            const Icon = n.icon;
            return (
              <Link
                key={n.to}
                to={n.to}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/60"
                  }`}
              >
                <Icon className="size-4" />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-sidebar-border text-[11px] text-muted-foreground">
          v1.0 · MVP
        </div>
        </div>
      </aside>
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b flex items-center justify-between px-6 bg-background/70 backdrop-blur sticky top-0 z-10">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapsed ? "Mostrar menú" : "Ocultar menú"}
              aria-expanded={!collapsed}
              title={collapsed ? "Mostrar menú" : "Ocultar menú"}
              className="p-1.5 -ml-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            </button>
            <div className="text-sm text-muted-foreground truncate">
              Selección Española de Fútbol Sala · Cuerpo Técnico
            </div>
          </div>

        </header>
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}

export const Icons = { LayoutDashboard, Activity, TrendingUp };
