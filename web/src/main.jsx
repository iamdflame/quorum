import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import "./style.css";

// Surface anything that escapes React, so a failure is never silent.
addEventListener("error", (e) => console.error("[shoal] uncaught", e.error ?? e.message));
addEventListener("unhandledrejection", (e) => console.error("[shoal] unhandled rejection", e.reason));

createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
