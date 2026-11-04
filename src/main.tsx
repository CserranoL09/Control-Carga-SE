import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./styles.css";
import { Toaster } from "@/components/ui/sonner";

import IndexRoute from "./routes/index";
import AjustesRoute from "./routes/ajustes";
import JugadoresRoute from "./routes/jugadores";
import PortalRoute from "./routes/portal";
import ConvocatoriasIdIndexRoute from "./routes/convocatorias.$id.index";
import ConvocatoriasIdJugadorPlayerIdRoute from "./routes/convocatorias.$id.jugador.$playerId";
import { PlayerAvatarStyleProvider } from "@/components/PlayerAvatar";

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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PlayerAvatarStyleProvider>
      <RouterProvider router={router} />
    </PlayerAvatarStyleProvider>
    <Toaster />
  </React.StrictMode>,
);
