// FGN сайт: «/download» — установка на любое устройство (как SetupSheet мини-аппа):
// платформа → приложение (FGN для Windows/macOS, если задан установщик; Incy; Happ; другое) → установка → добавить подписку.
// Добавление подписки требует входа (/subscription/applink); без входа — кнопка «Войти» с возвратом сюда.
import React, { useEffect, useState } from "react";
import { ApiError, fetchAppLink, openDeepLink } from "../utils/api";
import { copyText } from "../components/SubLinkBox";
import { APP_META, DEVICE_TITLE, detectDeviceKind, installUrl, type AppKind, type DeviceKind } from "../utils/apps";
import { C } from "../components/fgn";

type Desktop = { windows_url?: string; macos_url?: string; version?: string };
type App = AppKind | "fgn";
type Step = "pick" | "install" | "add" | "link" | "fgn" | "region" | "done";

export const DEVICES: DeviceKind[] = ["ios", "android", "windows", "macos", "linux", "android_tv"];
export const DEVICE_NOTE: Record<DeviceKind, string> = {
  ios: "iPhone и iPad · App Store",
  android: "Смартфоны и планшеты · Google Play",
  windows: "Windows 10/11 · 64-bit",
  macos: "macOS 13+ · Intel и Apple Silicon",
  linux: "Ubuntu, Debian и другие",
  android_tv: "Телевизоры и приставки",
};

export const DOWNLOAD_CSS = `
.fs-dlp .fs-wrap { padding-top: 64px; padding-bottom: 72px; position: relative; z-index: 1; }
.fs-dlp-eyebrow { text-align: center; font-size: 12px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; color: rgba(196,196,206,.62); }
.fs-dlp h1 { margin: 22px auto 0; max-width: 620px; text-align: center; font-size: 46px; line-height: 1.12; font-weight: 800; letter-spacing: -.015em; }
.fs-dlp-lead { margin: 18px auto 0; max-width: 560px; text-align: center; font-size: 16px; line-height: 1.6; color: rgba(196,196,206,.8); }
.fs-dlp-grid { margin-top: 52px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.fs-dlp-card { display: flex; flex-direction: column; padding: 24px; border-radius: 22px; border: 1px solid rgba(42,42,48,1); background: #18181B;
  box-sizing: border-box; animation: fsFade .35s ease both; }
.fs-dlp-card.me { border-color: rgba(52,214,124,.45); }
.fs-dlp-card .ic { color: #fff; height: 30px; display: flex; align-items: center; }
.fs-dlp-card b { margin-top: 26px; display: flex; align-items: center; gap: 10px; font-size: 19px; font-weight: 600; line-height: 24px; }
.fs-dlp-card b em { font-style: normal; font-size: 11.5px; font-weight: 600; color: ${C.green}; padding: 3px 8px; border-radius: 8px; background: rgba(52,214,124,.12); }
.fs-dlp-card span { margin-top: 10px; font-size: 13.5px; line-height: 18px; color: rgba(196,196,206,.62); flex: 1; }
.fs-dlp-btn { margin-top: 22px; width: 100%; height: 50px; border-radius: 14px; border: 1px solid rgba(255,255,255,.08); background: #121214;
  color: #fff; font: 600 15.5px ${C.font}; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;
  text-decoration: none; box-sizing: border-box; transition: border-color .15s, opacity .15s; }
.fs-dlp-btn:hover:not(:disabled) { border-color: rgba(255,255,255,.22); }
.fs-dlp-btn.white { background: ${C.btnSoft}; color: ${C.btnText}; border-color: transparent; }
.fs-dlp-btn.white:hover:not(:disabled) { opacity: .9; }
.fs-dlp-btn:disabled { opacity: .55; cursor: default; }
.fs-dlp-foot { margin-top: 28px; text-align: center; font-size: 13.5px; line-height: 1.6; color: rgba(196,196,206,.62); }
.fs-dlp-foot a { color: rgba(230,230,236,.9); text-decoration: underline; text-underline-offset: 3px; }
.fs-dlp-foot a:hover { color: #fff; }

.fs-sheet-bg { position: fixed; inset: 0; z-index: 3000; background: rgba(0,0,0,.66); backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center; padding: 20px; animation: fsFade .2s ease both; }
.fs-sheet { width: 100%; max-width: 460px; max-height: calc(100vh - 40px); overflow-y: auto; box-sizing: border-box; padding: 22px;
  border-radius: 24px; border: 1px solid #2A2A30; background: #141416; color: #F4F4F5; animation: fsPop .28s cubic-bezier(.22,1,.36,1) both; }
@keyframes fsPop { from { opacity: 0; transform: translateY(12px) scale(.98); } to { opacity: 1; transform: none; } }
@keyframes fsSheetUp { from { transform: translateY(100%); } to { transform: none; } }
.fs-sheet-head { display: flex; align-items: center; gap: 12px; min-height: 40px; }
.fs-sheet-head > div { flex: 1; min-width: 0; font-size: 18px; font-weight: 600; line-height: 24px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fs-round { width: 40px; height: 40px; flex-shrink: 0; border-radius: 50%; border: 0; background: #1E1E22; color: #F4F4F5; padding: 0;
  display: flex; align-items: center; justify-content: center; cursor: pointer; }
.fs-round:hover { background: #27272C; }
.fs-sheet-hint { margin-top: 14px; font-size: 14px; line-height: 20px; color: #9B9BA4; }
.fs-sheet-hint a { color: ${C.green}; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
.fs-apps { margin-top: 16px; display: flex; flex-direction: column; gap: 8px; }
.fs-app { width: 100%; min-height: 68px; padding: 0 16px; display: flex; align-items: center; gap: 12px; text-align: left; border-radius: 16px;
  border: 1px solid #2A2A30; background: #070708; color: #F4F4F5; font-family: ${C.font}; cursor: pointer; transition: border-color .15s; }
.fs-app:hover { border-color: rgba(255,255,255,.2); }
.fs-app > span { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.fs-app b { font-size: 16px; font-weight: 500; line-height: 20px; }
.fs-app small { font-size: 13px; line-height: 18px; color: #9B9BA4; }
.fs-app small.g { color: ${C.green}; }
.fs-appic { width: 40px; height: 40px; border-radius: 10px; overflow: hidden; flex-shrink: 0; background: #1E1E22; color: #F4F4F5;
  display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 12px; letter-spacing: .06em; }
.fs-appic img { width: 100%; height: 100%; object-fit: cover; }
.fs-sheet .fs-dlp-btn { margin-top: 18px; height: 52px; border-radius: 16px; font-size: 16px; }
.fs-sheet .fs-dlp-btn + .fs-dlp-btn { margin-top: 8px; }
.fs-sheet .fs-dlp-btn:not(.white) { background: transparent; border-color: #2A2A30; }
.fs-linkbox { margin-top: 16px; padding: 14px 16px; border-radius: 16px; border: 1px solid #2A2A30; background: #070708; font-size: 14px;
  line-height: 20px; word-break: break-all; user-select: all; }
.fs-steps { margin-top: 16px; display: flex; flex-direction: column; gap: 10px; }
.fs-steps > div { display: flex; gap: 12px; align-items: flex-start; font-size: 14px; line-height: 20px; color: #9B9BA4; }
.fs-steps i { width: 24px; height: 24px; border-radius: 12px; background: #1E1E22; color: #F4F4F5; font-style: normal; font-size: 13px; font-weight: 600;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: -2px; }
.fs-region-btn { margin-top: 14px; width: 100%; padding: 12px 14px; display: flex; align-items: center; gap: 12px; text-align: left; border-radius: 14px;
  border: 1px dashed #2A2A30; background: transparent; color: #9B9BA4; font: 13.5px/19px ${C.font}; cursor: pointer; transition: border-color .15s, color .15s; }
.fs-region-btn:hover { border-color: rgba(255,255,255,.22); color: #F4F4F5; }
.fs-region-btn b { color: #F4F4F5; font-weight: 600; }
.fs-region-btn > span { flex: 1; min-width: 0; }
.fs-steps b { color: #F4F4F5; font-weight: 600; }
.fs-addr { margin: 12px 0 2px 36px; border-radius: 14px; border: 1px solid #2A2A30; background: #070708; overflow: hidden; }
.fs-addr button { width: 100%; padding: 10px 14px; display: flex; align-items: center; gap: 10px; border: 0; background: transparent; color: #F4F4F5;
  font: 14px/20px ${C.font}; text-align: left; cursor: pointer; }
.fs-addr button + button { border-top: 1px solid #1F1F24; }
.fs-addr button:hover { background: #111113; }
.fs-addr small { width: 64px; flex-shrink: 0; font-size: 12.5px; color: #6E6E78; }
.fs-addr span { flex: 1; min-width: 0; }
.fs-addr em { font-style: normal; display: flex; color: #6E6E78; }
.fs-addr em.ok { color: ${C.green}; }
.fs-sheet-err { margin-top: 10px; font-size: 13px; line-height: 18px; color: ${C.danger}; text-align: center; }

@media (max-width: 860px) {
  .fs-dlp .fs-wrap { padding-top: 40px; padding-bottom: 56px; }
  .fs-dlp h1 { font-size: 34px; }
  .fs-dlp-lead { font-size: 15px; }
  .fs-dlp-grid { margin-top: 36px; grid-template-columns: repeat(2, 1fr); gap: 10px; }
  .fs-dlp-card { padding: 18px; border-radius: 20px; }
  .fs-dlp-card b { margin-top: 18px; font-size: 17px; }
  .fs-dlp-card span { font-size: 13px; }
  .fs-dlp-btn { margin-top: 16px; height: 46px; font-size: 14.5px; }
}
@media (max-width: 560px) {
  .fs-dlp-grid { grid-template-columns: 1fr; }
  .fs-dlp-card { display: grid; grid-template-columns: 30px 1fr; column-gap: 14px; align-items: center; }
  .fs-dlp-card .ic { grid-row: 1 / 3; align-self: start; padding-top: 1px; }
  .fs-dlp-card b { margin-top: 0; }
  .fs-dlp-card span { margin-top: 4px; }
  .fs-dlp-card .fs-dlp-btn { grid-column: 1 / -1; }
  .fs-sheet-bg { align-items: flex-end; padding: 0; }
  .fs-sheet { max-width: none; max-height: 90vh; border-radius: 24px 24px 0 0; border-bottom: 0; padding: 20px;
    padding-bottom: calc(20px + env(safe-area-inset-bottom, 0px)); animation: fsSheetUp .32s cubic-bezier(.22,1,.36,1) both; }
}
@media (max-width: 420px) { .fs-dlp h1 { font-size: 30px; } }
`;

export function Svg({ children, size = 30, stroke = 1.6 }: { children: React.ReactNode; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ display: "block", flexShrink: 0 }}>
      {children}
    </svg>
  );
}

export function DeviceIcon({ d }: { d: DeviceKind }) {
  switch (d) {
    case "ios":
    case "android":
      return <Svg><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" /><path d="M10.5 18.5h3" /></Svg>;
    case "windows":
      return <Svg><rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.6" /><rect x="13" y="3.5" width="7.5" height="7.5" rx="1.6" /><rect x="3.5" y="13" width="7.5" height="7.5" rx="1.6" /><rect x="13" y="13" width="7.5" height="7.5" rx="1.6" /></Svg>;
    case "macos":
      return <Svg><rect x="4" y="4.5" width="16" height="11" rx="1.6" /><path d="M2.5 19h19" /></Svg>;
    case "linux":
      return <Svg><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M7 9.5l3 2.5-3 2.5M12.5 15h4.5" /></Svg>;
    default:
      return <Svg><rect x="2.5" y="4" width="19" height="13" rx="2" /><path d="M8 20.5h8M12 17v3.5" /></Svg>;
  }
}

export const IcBack = () => <Svg size={18} stroke={2}><path d="M15 5l-7 7 7 7" /></Svg>;
export const IcClose = () => <Svg size={18} stroke={2}><path d="M6 6l12 12M18 6L6 18" /></Svg>;
export const IcChevron = () => <span style={{ color: "#6E6E78", display: "flex" }}><Svg size={17} stroke={2.2}><path d="M9 5l7 7-7 7" /></Svg></span>;
export const IcDownload = () => <Svg size={18} stroke={2}><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" /></Svg>;
export const IcCopy = () => <Svg size={18} stroke={2}><rect x="8.5" y="8.5" width="11" height="11" rx="2.2" /><path d="M15.5 8.5V6.2a1.7 1.7 0 0 0-1.7-1.7H6.2a1.7 1.7 0 0 0-1.7 1.7v7.6c0 .94.76 1.7 1.7 1.7h2.3" /></Svg>;
const IcLink = () => <Svg size={20} stroke={1.8}><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" /></Svg>;

function AppIc({ app }: { app: App }) {
  if (app === "fgn") return <span className="fs-appic" style={{ background: "#0F1A13", color: C.green }}>FGN</span>;
  const m = APP_META[app];
  return <span className="fs-appic">{m.img ? <img src={m.img} alt="" /> : <IcLink />}</span>;
}

// смена региона App Store на США — Incy/Happ нет в российском App Store
export const US_ADDRESS: [string, string][] = [
  ["Улица", "1 Apple Park Way"],
  ["Город", "Cupertino"],
  ["Штат", "California"],
  ["Индекс", "95014"],
  ["Телефон", "408 996 1010"],
];
const IcCheck = () => <Svg size={16} stroke={2.2}><path d="M5 12.5l4.5 4.5L19 7.5" /></Svg>;
const IcGlobe = () => <Svg size={20} stroke={1.7}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" /></Svg>;

export function RegionSteps() {
  const [copied, setCopied] = useState("");
  const copy = async (v: string) => {
    if (await copyText(v)) {
      setCopied(v);
      window.setTimeout(() => setCopied((c) => (c === v ? "" : c)), 1400);
    }
  };
  const steps: React.ReactNode[] = [
    <>Настройки → нажмите на <b>своё имя</b> вверху</>,
    <><b>Информация об аккаунте</b>, платежи и настройки</>,
    <><b>Страна или регион</b> → Изменить страну или регион</>,
    <>Выберите <b>Соединённые Штаты</b> → примите условия</>,
    <>Способ оплаты — <b>«Нет»</b></>,
    <>Адрес — любой из США, например (нажмите, чтобы скопировать):</>,
    <>Нажмите <b>«Далее»</b> — готово!</>,
  ];
  return (
    <>
      <div className="fs-sheet-hint">Если приложения нет в App Store — смените регион Apple ID на США. Подписки и покупки останутся.</div>
      <div className="fs-steps">
        {steps.map((t, i) => (
          <React.Fragment key={i}>
            <div><i>{i + 1}</i><span>{t}</span></div>
            {i === 5 ? (
              <div className="fs-addr" style={{ display: "block", marginTop: -2 }}>
                {US_ADDRESS.map(([k, v]) => (
                  <button key={k} type="button" onClick={() => void copy(v)}>
                    <small>{k}</small>
                    <span>{v}</span>
                    <em className={copied === v ? "ok" : undefined}>{copied === v ? <IcCheck /> : <IcCopy />}</em>
                  </button>
                ))}
              </div>
            ) : null}
          </React.Fragment>
        ))}
      </div>
    </>
  );
}

const appTitle = (a: App) => (a === "fgn" ? "FGN" : APP_META[a].title);

export function SetupDialog({
  device, fgnUrl, authed, onLogin, onClose, onBack,
}: {
  device: DeviceKind;
  fgnUrl: string;
  authed: boolean | null;
  onLogin: () => void;
  onClose: () => void;
  // назад к выбору устройства («Куда добавить»), как в мини-аппе
  onBack?: () => void;
}) {
  const isTv = device === "android_tv";
  const [step, setStep] = useState<Step>(isTv ? "install" : "pick");
  const [app, setApp] = useState<App | null>(isTv ? "happ" : null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [link, setLink] = useState("");
  const [linkLoading, setLinkLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  // на этом же устройстве — открываем приложение ссылкой, на другом — удобнее скопировать ссылку
  const here = detectDeviceKind() === device;

  const apps: App[] = [...(fgnUrl ? (["fgn"] as App[]) : []), "incy", "happ", "other"];

  const needLink = authed === true && (step === "link" || (step === "install" && isTv));
  useEffect(() => {
    if (!needLink || link) return;
    let alive = true;
    setLinkLoading(true);
    setErr("");
    void fetchAppLink("other")
      .then((r) => { if (alive) setLink(r.link); })
      .catch((e) => { if (alive) setErr(errText(e)); })
      .finally(() => { if (alive) setLinkLoading(false); });
    return () => { alive = false; };
  }, [needLink, link]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [busy, onClose]);

  const pick = (a: App) => {
    setApp(a);
    setErr("");
    setStep(a === "other" ? "link" : a === "fgn" ? "fgn" : "install");
  };

  const download = () => {
    const url = app === "fgn" ? fgnUrl : app ? installUrl(app, device) : null;
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  const add = async () => {
    if (!app || app === "fgn" || busy) return;
    setBusy(true);
    setErr("");
    try {
      openDeepLink(await fetchAppLink(app));
      setStep("done");
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    let l = link;
    if (!l) {
      try {
        setBusy(true);
        l = (await fetchAppLink("other")).link;
        setLink(l);
      } catch (e) {
        setErr(errText(e));
        return;
      } finally {
        setBusy(false);
      }
    }
    if (await copyText(l)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  };

  const atStart = isTv ? step === "install" : step === "pick";
  const canBack = step !== "done" && (!atStart || !!onBack);
  const goBack = () => {
    setErr("");
    if (atStart) onBack?.();
    else if (step === "add" || step === "region") setStep("install");
    else setStep("pick");
  };

  const title = step === "pick" ? DEVICE_TITLE[device]
    : step === "link" ? "Ссылка на подписку"
    : step === "done" ? "Подписка добавлена"
    : step === "region" ? "Регион App Store"
    : appTitle(app || "happ");

  const loginNote = (
    <div className="fs-sheet-hint">
      Чтобы добавить подписку, <a onClick={onLogin}>войдите в аккаунт</a> — через почту или Telegram.
    </div>
  );

  const linkBox = <div className="fs-linkbox" style={err && !link ? { color: C.danger } : undefined}>{linkLoading ? "Загрузка…" : link || err || "—"}</div>;

  return (
    <div className="fs-sheet-bg" onClick={() => !busy && onClose()}>
      <div className="fs-sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="fs-sheet-head">
          {canBack ? <button type="button" className="fs-round" aria-label="Назад" onClick={goBack}><IcBack /></button> : null}
          {(step === "install" || step === "add" || step === "fgn") && app ? <AppIc app={app} /> : null}
          <div>{title}</div>
          <button type="button" className="fs-round" aria-label="Закрыть" onClick={() => !busy && onClose()}><IcClose /></button>
        </div>

        {step === "pick" && (
          <>
            <div className="fs-sheet-hint">Выберите приложение для {DEVICE_TITLE[device]}.</div>
            <div className="fs-apps">
              {apps.map((a) => (
                <button key={a} type="button" className="fs-app" onClick={() => pick(a)}>
                  <AppIc app={a} />
                  <span>
                    <b>{a === "fgn" ? `FGN для ${DEVICE_TITLE[device]}` : APP_META[a].title}</b>
                    {a === "fgn" ? <small className="g">Наше приложение</small>
                      : <small className={APP_META[a].recommended && !fgnUrl ? "g" : undefined}>{APP_META[a].sub}</small>}
                  </span>
                  <IcChevron />
                </button>
              ))}
            </div>
          </>
        )}

        {step === "fgn" && (
          <>
            <div className="fs-sheet-hint">
              Скачайте и установите FGN, затем войдите в приложении тем же аккаунтом — через почту или Telegram. Подписка подхватится автоматически.
            </div>
            <button type="button" className="fs-dlp-btn white" onClick={download}><IcDownload /> Скачать FGN</button>
          </>
        )}

        {step === "install" && isTv && (
          <>
            <div className="fs-steps">
              <div><i>1</i><span>На телевизоре откройте Google Play и установите Happ.</span></div>
              <div><i>2</i><span>В Happ добавьте подписку вручную (кнопка «+») и введите ссылку:</span></div>
            </div>
            {authed ? (
              <>
                {linkBox}
                <div className="fs-sheet-hint" style={{ fontSize: 13, textAlign: "center", marginTop: 10 }}>
                  Вводите внимательно: важны заглавные и строчные буквы.
                </div>
                <button type="button" className="fs-dlp-btn" disabled={!link || busy} onClick={() => void copy()}>
                  <IcCopy /> {copied ? "Скопировано" : "Скопировать ссылку"}
                </button>
              </>
            ) : loginNote}
          </>
        )}

        {step === "install" && !isTv && app && app !== "fgn" && (
          <>
            <div className="fs-sheet-hint">Скачайте и установите {APP_META[app].title} на {DEVICE_TITLE[device]}.</div>
            <button type="button" className="fs-dlp-btn white" onClick={download}><IcDownload /> Скачать {APP_META[app].title}</button>
            <button type="button" className="fs-dlp-btn" onClick={() => { setErr(""); setStep("add"); }}>Уже установлено — далее</button>
            {device === "ios" ? (
              <button type="button" className="fs-region-btn" onClick={() => setStep("region")}>
                <IcGlobe />
                <span><b>Нет в App Store?</b> Как сменить регион на США</span>
                <IcChevron />
              </button>
            ) : null}
          </>
        )}

        {step === "add" && app && app !== "fgn" && (
          authed ? (
            <>
              <div className="fs-sheet-hint">
                {here
                  ? `Нажмите кнопку — подписка сама добавится в ${APP_META[app].title}. После этого откройте приложение и подключитесь.`
                  : `Откройте эту страницу на устройстве ${DEVICE_TITLE[device]} и нажмите «Добавить подписку» — или скопируйте ссылку и добавьте её в ${APP_META[app].title} вручную.`}
              </div>
              <button type="button" className={`fs-dlp-btn${here ? " white" : ""}`} disabled={busy} onClick={() => void add()}>
                {busy ? "Открываем…" : "Добавить подписку"}
              </button>
              <button type="button" className={`fs-dlp-btn${here ? "" : " white"}`} disabled={busy} onClick={() => void copy()}>
                <IcCopy /> {copied ? "Скопировано" : "Скопировать ссылку"}
              </button>
              {err ? <div className="fs-sheet-err">{err}</div> : null}
            </>
          ) : loginNote
        )}

        {step === "region" && (
          <>
            <RegionSteps />
            <button type="button" className="fs-dlp-btn white" onClick={() => setStep("install")}>Регион сменил — к установке</button>
          </>
        )}

        {step === "link" && (
          authed ? (
            <>
              <div className="fs-sheet-hint">Скопируйте ссылку и добавьте её в своё VPN-приложение как подписку.</div>
              {linkBox}
              <button type="button" className="fs-dlp-btn white" disabled={!link || busy} onClick={() => void copy()}>
                <IcCopy /> {copied ? "Скопировано" : "Скопировать ссылку"}
              </button>
            </>
          ) : loginNote
        )}

        {step === "done" && app && app !== "fgn" && (
          <>
            <div className="fs-sheet-hint">Откройте {APP_META[app].title} и нажмите «Подключиться».</div>
            <button type="button" className="fs-dlp-btn white" onClick={onClose}>Готово</button>
            <button type="button" className="fs-dlp-btn" onClick={() => void add()}>Не добавилась? Ещё раз</button>
          </>
        )}
      </div>
    </div>
  );
}

function errText(e: unknown): string {
  if (e instanceof ApiError && (e.status === 404 || e.status === 400)) {
    return e.message || "Нет активной подписки — оформите её на странице «Тарифы»";
  }
  return e instanceof Error ? e.message : "Не удалось получить ссылку";
}

export default function SiteDownload({
  desktop, authed, email, onLogin,
}: {
  desktop: Desktop;
  authed: boolean | null;
  email: string;
  onLogin: () => void;
}) {
  const [open, setOpen] = useState<DeviceKind | null>(null);
  const mine = detectDeviceKind();
  // своё устройство — первым
  const list = [mine, ...DEVICES.filter((d) => d !== mine)];
  const version = (desktop.version || "").trim();
  const fgnUrl = (d: DeviceKind) => ((d === "windows" ? desktop.windows_url : d === "macos" ? desktop.macos_url : "") || "").trim();

  return (
    <section className="fs-dlp">
      <div className="fs-wrap">
        <div className="fs-dlp-eyebrow">Скачать приложение</div>
        <h1>Выберите свою платформу</h1>
        <p className="fs-dlp-lead">
          {version && (fgnUrl("windows") || fgnUrl("macos")) ? `Версия ${version} · ` : ""}
          Телефон, компьютер или телевизор — одна подписка на всех устройствах. Установка займёт меньше минуты.
        </p>

        <div className="fs-dlp-grid">
          {list.map((d, i) => (
            <div key={d} className={`fs-dlp-card${d === mine ? " me" : ""}`} style={{ animationDelay: `${0.04 * i}s` }}>
              <div className="ic"><DeviceIcon d={d} /></div>
              <b>
                {DEVICE_TITLE[d]}
                {d === mine ? <em>Это устройство</em> : null}
              </b>
              <span>{DEVICE_NOTE[d]}</span>
              <button type="button" className={`fs-dlp-btn${d === mine ? " white" : ""}`} onClick={() => setOpen(d)}>
                {d === mine ? <IcDownload /> : null}
                Установить на {DEVICE_TITLE[d]}
              </button>
            </div>
          ))}
        </div>

        <div className="fs-dlp-foot">
          Не получается подключиться — напишите в <a href="/support" onClick={(e) => { e.preventDefault(); window.history.pushState(null, "", "/support"); window.dispatchEvent(new PopStateEvent("popstate")); }}>поддержку</a>{" "}
          или на <a href={`mailto:${email}`}>{email}</a>.
        </div>
      </div>

      {open ? (
        <SetupDialog
          device={open}
          fgnUrl={fgnUrl(open)}
          authed={authed}
          onLogin={() => { setOpen(null); onLogin(); }}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </section>
  );
}
