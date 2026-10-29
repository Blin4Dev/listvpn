import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Site from "./site/Site";
import "./global.css";
import { initTelegramViewport, initStageScale, isTelegramClient } from "./utils/telegram";
import { captureWebRef } from "./utils/api";
import { hasFeature } from "./utils/brand";

// в Telegram — мини-приложение; в браузере у проекта с features.site — его сайт
const SITE = hasFeature("site") && !isTelegramClient();

if (SITE) {
  document.documentElement.classList.add("blin-site");
} else {
  initStageScale();
  initTelegramViewport();
}
// запомнить ?ref= до регистрации
captureWebRef();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {SITE ? <Site /> : <App />}
  </React.StrictMode>
);

// убрать спиннер после первой отрисовки
requestAnimationFrame(() => {
  const boot = document.getElementById("blin-boot");
  if (boot) boot.remove();
});

