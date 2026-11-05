import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./styles.css";
import { Toaster } from "@/components/ui/sonner";
import { UpdatePrompt } from "@/components/pwa/PwaUi";
import { initPwa } from "@/lib/pwa";

import IndexRoute from "./routes/index";
import AjustesRoute from "./routes/ajustes";
import JugadoresRoute from "./routes/jugadores";
import PortalRoute from "./routes/portal";
import ConvocatoriasIdIndexRoute from "./routes/convocatorias.$id.index";
import ConvocatoriasIdJugadorPlayerIdRoute from "./routes/convocatorias.$id.jugador.$playerId";

const router = createBrowserRouter([
  {
    path: "/",
    element: <IndexRoute />,
  },
  {
    path: "/ajustes",
    element: <AjustesRoute />,
  },
  {
    path: "/jugadores",
    element: <JugadoresRoute />,
  },
  {
    path: "/portal",
    element: <PortalRoute />,
  },
  {
    path: "/convocatorias/:id",
    element: <ConvocatoriasIdIndexRoute />,
  },
  {
    path: "/convocatorias/:id/jugador/:playerId",
    element: <ConvocatoriasIdJugadorPlayerIdRoute />,
  },
]);

// App instalable: escuchar desde el arranque el aviso de instalación del navegador
initPwa();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
    <Toaster />
    <UpdatePrompt />
  </React.StrictMode>,
);
