import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { browserLanguages, detectLocale } from "./i18n";
import { ui } from "./state/ui";
import "./styles/fonts.css";
import "./styles/app.css";

ui.set({ locale: detectLocale(browserLanguages()) });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
