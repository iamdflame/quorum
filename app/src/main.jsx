import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App.jsx";
import "./theme.css";

// Nothing may fail silently. The last frontend did, twice.
addEventListener("error", (e) => console.error("[quorum] uncaught", e.error ?? e.message));
addEventListener("unhandledrejection", (e) => console.error("[quorum] rejection", e.reason));

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {/* Hash routing: GitHub Pages serves no rewrites, so a deep link to
        /campaigns would 404 under browser history routing. */}
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
