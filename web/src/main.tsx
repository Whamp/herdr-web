import "@fontsource-variable/geist/wght.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { BridgeProvider } from "./bridge";
import { MobileModifierInputPrototype } from "./MobileModifierInputPrototype";
import { startNativeControls } from "./native";
import "./styles.css";

startNativeControls();

const root = document.getElementById("root");

if (!root) {
  throw new Error("missing root element");
}

const isDevelopmentBuild = (import.meta as ImportMeta & { env: { DEV: boolean } }).env.DEV;
const prototypeName = isDevelopmentBuild
  ? new URLSearchParams(window.location.search).get("prototype")
  : null;

createRoot(root).render(
  <StrictMode>
    {prototypeName === "mobile-modifier-input" ? (
      <MobileModifierInputPrototype />
    ) : (
      <BridgeProvider>
        <App />
      </BridgeProvider>
    )}
  </StrictMode>,
);
