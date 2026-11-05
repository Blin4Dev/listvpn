import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Site from "./site/Site";
import "./global.css";
import { initTelegramViewport, initStageScale, isTelegramClient, isTelegramUserAgent } from "./utils/telegram";
import { captureWebRef } from "./utils/api";
import { hasFeature, PROJECT_ID } from "./utils/brand";

// в Telegram Mini App — приложение; в обычном браузере у проекта с features.site — сайт.
// Иногда Telegram открывает https-домен как сайт в in-app browser: тогда кидаем в t.me/?startapp.

function applyChrome(site: boolean) {
  if (site) {
    document.documentElement.classList.add("blin-site");
    return;
  }
  document.documentElement.classList.remove("blin-site");
  initStageScale();
  initTelegramViewport();
}

function startappFromLocation(): string {
  try {
    const path = window.location.pathname.replace(/\/+$/, "") || "/";
    const q = new URLSearchParams(window.location.search);
    if (path === "/support") return "support";
    if (path === "/gifts" || q.get("gifts") === "1") return "gifts";
    if (q.get("migrate") === "1") return "migrate";
    if (path === "/payment/return") {
      const id = q.get("payment_id") || "";
      if (/^[a-f0-9]{16,64}$/.test(id)) {
        return `${q.get("result") === "fail" ? "payfail" : "pay"}_${id}`.slice(0, 64);
      }
    }
  } catch {
    /* noop */
  }
  return "";
}

function bounceToMiniApp(botUsername: string, miniappLink: string): boolean {
  try {
    if (sessionStorage.getItem("blin_tg_bounce") === "1") return false;
    sessionStorage.setItem("blin_tg_bounce", "1");
  } catch {
    /* noop */
  }
  const start = startappFromLocation();
  const link = (miniappLink || "").trim().replace(/\/$/, "");
  let href = "";
  if (/^https:\/\/t\.me\/[A-Za-z0-9_]{4,32}\/[A-Za-z0-9_]{3,64}$/.test(link)) {
    href = start ? `${link}?startapp=${encodeURIComponent(start)}` : `${link}?startapp`;
  } else {
    const bot = botUsername.replace(/^@/, "");
    if (!bot) return false;
    href = start ? `https://t.me/${bot}?startapp=${encodeURIComponent(start)}` : `https://t.me/${bot}?startapp`;
  }
  window.location.replace(href);
  return true;
}

async function resolveSite(): Promise<boolean> {
  if (!hasFeature("site")) return false;
  if (isTelegramClient()) return false;
  const host = (window.location.hostname || "").replace(/^www\./i, "").toLowerCase();
  let bot = "";
  let mlink = "";
  let siteDom = "";
  let miniDom = "";
  try {
    const r = await fetch(`${window.location.origin}/api/app/config`, { headers: { "X-Project": PROJECT_ID } });
    if (r.ok) {
      const c = (await r.json()) as Record<string, unknown>;
      bot = String(c.botUsername || "");
      mlink = String(c.miniappLink || "");
      siteDom = String(c.siteDomain || "").replace(/^www\./, "").toLowerCase();
      miniDom = String(c.miniappDomain || "").replace(/^www\./, "").toLowerCase();
    }
  } catch {
    /* noop */
  }
  if (miniDom && siteDom && miniDom !== siteDom) {
    if (host === miniDom) {
      if (isTelegramUserAgent() && bounceToMiniApp(bot, mlink)) return false;
      return false;
    }
    if (host === siteDom && !isTelegramUserAgent()) return true;
  }
  if (isTelegramUserAgent()) {
    if (bounceToMiniApp(bot, mlink)) return false;
    return false;
  }
  return true;
}

function Root() {
  const [site, setSite] = useState<boolean | null>(() => {
    if (!hasFeature("site")) return false;
    if (isTelegramClient()) return false;
    return null;
  });

  useEffect(() => {
    if (site !== null) return;
    let alive = true;
    void resolveSite().then((v) => {
      if (alive) setSite(v);
    });
    return () => {
      alive = false;
    };
  }, [site]);

  useEffect(() => {
    if (site === null) return;
    applyChrome(site);
    captureWebRef();
    requestAnimationFrame(() => document.getElementById("blin-boot")?.remove());
  }, [site]);

  if (site === null) return null;
  return site ? <Site /> : <App />;
}

if (!hasFeature("site") || isTelegramClient()) {
  applyChrome(false);
  captureWebRef();
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);

if (!hasFeature("site") || isTelegramClient()) {
  requestAnimationFrame(() => document.getElementById("blin-boot")?.remove());
}
