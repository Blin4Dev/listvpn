import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { activateTrial, appFetch, fetchConfig, fetchMe, fetchSupport } from "../utils/api";
import { formatDateRu } from "../utils/date";
import { hasEntered, homeIntroPending, markHomeIntroPlayed, signalHomeIntroReady, subscribeEntered } from "../utils/homeIntro";
import { MSIcon, btnReset, pageFrame, pageOuter } from "../components/ui";
import { NoirRow, NoirSheet } from "../components/noir";

type SubscriptionState =
  | "active"
  | "never"
  | "expired"
  | "expiring_soon"
  | "had_before"
  | "blocked";

interface StateConfig {
  statusTitle: string;
  statusTone: "ok" | "warn" | "off" | "danger";
  statusSubtitle: string;
  ctaLabel: string;
  ctaPath: string;
  ctaPrice: string;
  ctaPrimary: boolean;
}

// покупка → устройства + оплата → лист настройки
const BUY_PATH = `/tariffs?return=${encodeURIComponent("/subscription?setup=1")}`;

const STATE_CONFIGS: Record<SubscriptionState, StateConfig> = {
  active: {
    statusTitle: "Подписка активна",
    statusTone: "ok",
    statusSubtitle: "",
    ctaLabel: "Управление подпиской",
    ctaPath: "/subscription",
    ctaPrice: "от 99 ₽",
    ctaPrimary: false,
  },
  never: {
    statusTitle: "Нет подписки",
    statusTone: "off",
    statusSubtitle: "И никогда не было",
    ctaLabel: "Попробовать бесплатно",
    ctaPath: "/subscription?setup=1",
    ctaPrice: "0 ₽",
    ctaPrimary: true,
  },
  expired: {
    statusTitle: "Истекла",
    statusTone: "off",
    statusSubtitle: "Продлите, чтобы снова подключиться",
    ctaLabel: "Продлить подписку",
    ctaPath: "/subscription/extend",
    ctaPrice: "от 99 ₽",
    ctaPrimary: true,
  },
  expiring_soon: {
    statusTitle: "Скоро закончится",
    statusTone: "warn",
    statusSubtitle: "",
    ctaLabel: "Управление подпиской",
    ctaPath: "/subscription",
    ctaPrice: "от 99 ₽",
    ctaPrimary: false,
  },
  blocked: {
    statusTitle: "Заблокирована",
    statusTone: "danger",
    statusSubtitle: "Обратитесь в поддержку",
    ctaLabel: "Управление подпиской",
    ctaPath: "/subscription",
    ctaPrice: "от 99 ₽",
    ctaPrimary: false,
  },
  had_before: {
    statusTitle: "Нет подписки",
    statusTone: "off",
    statusSubtitle: "Пора её приобрести",
    ctaLabel: "Купить подписку",
    ctaPath: BUY_PATH,
    ctaPrice: "от 99 ₽",
    ctaPrimary: true,
  },
};

// цвет заголовка статуса по тону
const TONE: Record<StateConfig["statusTone"], string> = {
  ok: "#FFFFFF",
  warn: "#FFB23F",
  off: "#FFFFFF",
  danger: "#FF3B3B",
};

// «остался 1 день» / «осталось N дня|дней»
function daysLeftTitle(n: number): string {
  if (n <= 0) return "Заканчивается сегодня";
  const a = n % 100;
  const b = n % 10;
  if (b === 1 && a !== 11) return `Остался ${n} день`;
  if (b >= 2 && b <= 4 && (a < 12 || a > 14)) return `Осталось ${n} дня`;
  return `Осталось ${n} дней`;
}

// палитра новой главной (как экран входа)
const H = {
  font: "'Onest', 'Outfit', system-ui, sans-serif",
  text: "#FFFFFF",
  muted: "rgba(196, 196, 206, 0.66)",
  red: "#E00000",
  tileBg: "rgba(16, 16, 22, 0.9)",
  tileBorder: "rgba(255, 255, 255, 0.11)",
};

// фон главной
const HOME_BG_MP4 = "/assets/home-bg.mp4";
const HOME_BG_WEBM = "/assets/home-bg.webm";
const HOME_BG_POSTER = "/assets/home-bg-poster.jpg";

function ActionTile({
  icon,
  label,
  sub,
  onClick,
  disabled,
  delay,
  badge,
  animate,
}: {
  icon: string;
  label: string;
  sub?: string;
  onClick: () => void;
  disabled?: boolean;
  delay: number;
  badge?: number;
  animate: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="blin-press"
      style={{
        ...btnReset,
        fontFamily: H.font,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "space-between",
        height: 160,
        padding: "16px 17px 18px",
        background: H.tileBg,
        border: `1px solid ${H.tileBorder}`,
        borderRadius: 26,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        cursor: disabled ? "not-allowed" : "pointer",
        animation: animate ? `blinvpnRise 0.85s var(--ease-out) ${delay}s both` : undefined,
        position: "relative",
        textAlign: "left",
        color: H.text,
      }}
    >
      {badge ? (
        <span style={{
          position: "absolute", top: 14, right: 14, minWidth: 22, height: 22, padding: "0 7px", borderRadius: 11,
          background: H.red, color: "#fff", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 4px 14px -4px rgba(224, 0, 0, 0.7)",
        }}>{badge > 9 ? "9+" : badge}</span>
      ) : null}
      <img
        src={icon}
        width={44}
        height={44}
        alt=""
        draggable={false}
        style={{
          width: 44,
          height: 44,
          objectFit: "contain",
          display: "block",
          filter: disabled ? "grayscale(1)" : undefined,
          opacity: disabled ? 0.4 : 1,
          userSelect: "none",
        }}
      />
      <span style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontWeight: 500, fontSize: 18, lineHeight: 1.15, letterSpacing: "-0.01em", color: disabled ? "rgba(255,255,255,0.35)" : H.text }}>
          {label}
        </span>
        {sub !== undefined ? (
          <span style={{ fontSize: 14.5, lineHeight: 1.1, color: H.muted, minHeight: 16 }}>{sub}</span>
        ) : null}
      </span>
    </button>
  );
}

type HomeCache = {
  subscriptionState: SubscriptionState;
  subscriptionUntilText: string;
  trialEnabled: boolean;
  expiringTitle: string;
  blacklisted: boolean;
};

let homeCache: HomeCache | null = null;
let refCountCache: number | null = null;

function snapshotFromMe(me: { subscription_status?: string; subscription_until?: string | null; blacklisted?: boolean }, trialEnabled: boolean): HomeCache {
  const st = String(me.subscription_status || "");
  const until = String(me.subscription_until || "");
  const untilText = until ? formatDateRu(until) : "";
  let subscriptionState: SubscriptionState = "never";
  let expiringTitle = "Скоро закончится";
  let blacklisted = false;
  if (st === "blocked" || st === "banned") {
    subscriptionState = "blocked";
    blacklisted = !!me.blacklisted;
  } else if (st === "active" || st === "trial") {
    const daysLeft = until
      ? Math.ceil((new Date(until).getTime() - Date.now()) / 86_400_000)
      : Infinity;
    if (daysLeft <= 3) {
      expiringTitle = daysLeftTitle(daysLeft);
      subscriptionState = "expiring_soon";
    } else {
      subscriptionState = "active";
    }
  } else if (st === "expired") {
    subscriptionState = "expired";
  } else if (st === "lapsed") {
    subscriptionState = "had_before";
  }
  return { subscriptionState, subscriptionUntilText: untilText, trialEnabled, expiringTitle, blacklisted };
}

export default function HomePage() {
  const navigate = useNavigate();
  // интро только при входе / перезагрузке, не при «назад»
  const playIntro = useRef(homeIntroPending()).current;
  const cached = useRef(homeCache).current;
  // данные пришли → layout готов к reveal
  const [dataReady, setDataReady] = useState(false);
  // при возврате назад UI сразу, без сплэша
  const [showUi, setShowUi] = useState(!playIntro);
  // дольше 3 с без данных — подпись снизу (только на интро)
  const [slow, setSlow] = useState(false);
  const [subscriptionState, setSubscriptionState] = useState<SubscriptionState>(cached?.subscriptionState ?? "never");
  const [subscriptionUntilText, setSubscriptionUntilText] = useState(cached?.subscriptionUntilText ?? "");
  const [trialEnabled, setTrialEnabled] = useState(cached?.trialEnabled ?? true);
  const [trialBusy, setTrialBusy] = useState(false);
  // непрочитанные ответы поддержки → бейдж на плитке
  const [supportUnread, setSupportUnread] = useState(0);
  // «Подарки»: активировать / купить / мои
  const [giftsMenu, setGiftsMenu] = useState(false);
  // сколько приглашено — подпись на плитке «Рефералы»
  const [refCount, setRefCount] = useState<number | null>(refCountCache);
  useEffect(() => {
    appFetch<{ referrals_count?: number }>("/referral")
      .then((r) => { refCountCache = Number(r?.referrals_count || 0); setRefCount(refCountCache); })
      .catch(() => { /* нет данных */ });
  }, []);
  // фоновое видео: muted + playsInline выставляем явно (iOS / Telegram WebView)
  const bgRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = bgRef.current;
    if (!v) return;
    v.muted = true;
    v.defaultMuted = true;
    v.setAttribute("muted", "");
    v.setAttribute("playsinline", "");
    v.setAttribute("webkit-playsinline", "");
    const p = v.play();
    if (p && typeof p.catch === "function") p.catch(() => { /* остаётся постер */ });
  }, []);
  useEffect(() => {
    fetchSupport(1e12).then((st) => setSupportUnread(st.chat?.unread || 0)).catch(() => { /* нет чата */ });
  }, []);
  const [expiringTitle, setExpiringTitle] = useState(cached?.expiringTitle ?? "Скоро закончится");
  // чёрный список: заблокирован + только поддержка
  const [blacklisted, setBlacklisted] = useState(cached?.blacklisted ?? false);
  // пользователь коснулся экрана входа
  const [entered, setEntered] = useState(hasEntered);
  useEffect(() => {
    if (entered) return;
    return subscribeEntered(() => setEntered(true));
  }, [entered]);

  useEffect(() => {
    if (!playIntro) return;
    if (!entered) return;
    // «Загрузка...» считаем с момента касания, а не с открытия
    const t = window.setTimeout(() => setSlow(true), 3000);
    return () => window.clearTimeout(t);
  }, [playIntro, entered]);

  // после касания: даём экрану входа начать растворяться, потом раскрываем главную
  const AFTER_ENTER_MS = 180;
  // низ главной выезжает ~1.35s — модалки после этого
  const INTRO_REVEAL_MS = 1450;
  useEffect(() => {
    if (!playIntro) {
      signalHomeIntroReady();
      return;
    }
    // ждём и данные, и касание экрана входа
    if (!dataReady || !entered) return;
    const wait = AFTER_ENTER_MS;
    let revealTimer = 0;
    const splashTimer = window.setTimeout(() => {
      setShowUi(true);
      markHomeIntroPlayed();
      revealTimer = window.setTimeout(() => signalHomeIntroReady(), INTRO_REVEAL_MS);
    }, wait);
    return () => {
      window.clearTimeout(splashTimer);
      window.clearTimeout(revealTimer);
    };
  }, [dataReady, entered, playIntro]);

  const cfg = STATE_CONFIGS[subscriptionState];
  const statusTitle = subscriptionState === "expiring_soon" ? expiringTitle : cfg.statusTitle;
  const tone = TONE[cfg.statusTone];
  const blocked = subscriptionState === "blocked";
  const trialOff = subscriptionState === "never" && !trialEnabled;
  const ctaLabel = trialOff ? "Оформить подписку" : cfg.ctaLabel;
  const ctaPath = trialOff ? BUY_PATH : cfg.ctaPath;
  const isTrialCta = subscriptionState === "never" && trialEnabled;
  const ctaPrimary = trialOff ? true : cfg.ctaPrimary;
  const glowOn = subscriptionState === "active" || subscriptionState === "expiring_soon";
  const ease = playIntro ? "cubic-bezier(0.33, 1, 0.32, 1)" : "linear";
  const tAmb = playIntro ? `opacity 1.4s ${ease} 0.35s` : "none";
  const tGlow = playIntro ? `opacity 1.5s ${ease} 0.45s` : "none";
  const tBottom = playIntro ? `max-height 1.35s ${ease}, opacity 1s ${ease} 0.2s` : "none";
  // назад без кэша: не светить дефолт «нет подписки» / триал
  const paintUi = playIntro ? showUi : showUi && (dataReady || Boolean(cached));
  const rise = (delay: number) => (playIntro && paintUi ? `blinvpnRise 0.85s var(--ease-out) ${delay}s both` : undefined);

  const handleCta = async () => {
    if (blocked) return;
    if (isTrialCta) {
      setTrialBusy(true);
      const res = await activateTrial();
      setTrialBusy(false);
      if (!res.success && res.message) {
        navigate(BUY_PATH);
        return;
      }
    }
    navigate(ctaPath);
  };

  useEffect(() => {
    void (async () => {
      let trial = homeCache?.trialEnabled ?? true;
      try {
        try {
          const conf = await fetchConfig();
          if (conf && typeof conf.trialEnabled === "boolean") {
            trial = conf.trialEnabled;
          }
        } catch { /* defaults */ }
        try {
          const me = await fetchMe();
          if (!me) return;
          const snap = snapshotFromMe(me, trial);
          homeCache = snap;
          setSubscriptionUntilText(snap.subscriptionUntilText);
          setExpiringTitle(snap.expiringTitle);
          setBlacklisted(snap.blacklisted);
          setSubscriptionState(snap.subscriptionState);
          setTrialEnabled(snap.trialEnabled);
        } catch { /* safe default */ }
      } finally {
        setDataReady(true);
      }
    })();
  }, []);

  const subtitle =
    subscriptionUntilText && (subscriptionState === "active" || subscriptionState === "expiring_soon")
      ? `до ${subscriptionUntilText}`
      : blacklisted
        ? "Вы в черном списке проекта"
        : cfg.statusSubtitle;

  return (
    <div style={pageOuter({ background: "#05050A" })}>
      <div style={pageFrame({ background: "#05050A", fontFamily: H.font })}>
        {/* фон: видео + затемнение */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 0,
            background: `#07070D url(${HOME_BG_POSTER}) center / cover no-repeat`,
            opacity: paintUi ? 1 : 0,
            transition: tAmb,
          }}
        >
          <video
            ref={bgRef}
            poster={HOME_BG_POSTER}
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            disablePictureInPicture
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          >
            <source src={HOME_BG_MP4} type="video/mp4" />
            <source src={HOME_BG_WEBM} type="video/webm" />
          </video>
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(to bottom, rgba(5,5,10,0.18) 0%, rgba(5,5,10,0.05) 22%, rgba(5,5,10,0.25) 45%, rgba(5,5,10,0.7) 72%, rgba(5,5,10,0.92) 100%)",
            }}
          />
        </div>

        <div
          style={{
            position: "relative",
            zIndex: 1,
            height: "100%",
            paddingLeft: 20,
            paddingRight: 20,
            paddingTop: paintUi ? "calc(var(--blin-tg-pad-top, 0px) / var(--blin-scale))" : 0,
            display: "flex",
            flexDirection: "column",
            boxSizing: "border-box",
            transition: playIntro && paintUi ? `padding-top 1.35s ${ease}` : "none",
          }}
        >
          {/* логотип: при загрузке по центру; после данных зона сжимается — логотип уезжает вверх */}
          <div
            style={{
              flex: "1 1 auto",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 0,
            }}
          >
            <img
              src="/assets/home-logo.png"
              width={134}
              height={88}
              alt="Логотип"
              draggable={false}
              style={{
                width: "min(134px, 30vw)",
                height: "auto",
                display: "block",
                userSelect: "none",
                filter: "drop-shadow(0 6px 24px rgba(0,0,0,0.45))",
                transform: "translateZ(0)",
                animation: paintUi && glowOn ? `blinvpnBreathe 4.5s ease-in-out ${playIntro ? "1.2s" : "0s"} infinite` : undefined,
                opacity: paintUi ? 1 : 0.9,
                transition: tGlow,
              }}
            />
          </div>

          {/* низ: появляется после данных, сдвигая логотип на место */}
          <div
            style={{
              flexShrink: 0,
              maxHeight: paintUi ? 640 : 0,
              opacity: paintUi ? 1 : 0,
              overflow: "hidden",
              transition: tBottom,
              pointerEvents: paintUi ? "auto" : "none",
              paddingBottom: "calc(32px + var(--blin-tg-pad-bottom, 0px) / var(--blin-scale))",
            }}
          >
            <div style={{ marginBottom: 22, animation: rise(0.28) }}>
              <div
                style={{
                  fontWeight: 500,
                  fontSize: 32,
                  lineHeight: 1.15,
                  letterSpacing: "-0.025em",
                  color: tone,
                  marginBottom: subtitle ? 6 : 0,
                }}
              >
                {statusTitle}
              </div>
              {subtitle ? (
                <div style={{ fontSize: 15.5, color: H.muted, fontWeight: 400, lineHeight: 1.35 }}>
                  {subtitle}
                </div>
              ) : null}
            </div>

            <div style={{ animation: rise(0.4) }}>
              <button
                type="button"
                className="blin-press"
                disabled={blocked || trialBusy}
                onClick={() => { if (!blocked && !trialBusy) void handleCta(); }}
                style={{
                  ...btnReset,
                  fontFamily: H.font,
                  width: "100%",
                  height: 56,
                  borderRadius: 18,
                  border: ctaPrimary ? "none" : `1px solid ${H.tileBorder}`,
                  background: blocked ? "rgba(60, 10, 12, 0.85)" : ctaPrimary ? H.red : H.tileBg,
                  backdropFilter: ctaPrimary ? undefined : "blur(8px)",
                  WebkitBackdropFilter: ctaPrimary ? undefined : "blur(8px)",
                  color: blocked ? "rgba(170,160,160,0.75)" : "#FFFFFF",
                  fontSize: 17,
                  fontWeight: 500,
                  letterSpacing: "-0.01em",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  cursor: blocked ? "not-allowed" : "pointer",
                  boxShadow: ctaPrimary && !blocked ? "0 14px 38px -12px rgba(224, 0, 0, 0.75)" : "none",
                }}
              >
                <MSIcon name={ctaPrimary ? "bolt" : "tune"} style={{ fontSize: 22, color: "inherit", fontVariationSettings: "'wght' 300" }} />
                <span>{trialBusy ? "Активация…" : ctaLabel}</span>
              </button>
            </div>

            <div style={{ height: 16 }} />

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              <ActionTile
                icon="/assets/ic-referrals.png"
                label="Рефералы"
                sub={refCount === null ? "" : String(refCount)}
                disabled={blocked}
                delay={0.5}
                animate={playIntro && paintUi}
                onClick={() => { if (!blocked) navigate("/referral"); }}
              />
              <ActionTile
                icon="/assets/ic-gifts.png"
                label="Подарки"
                disabled={blocked}
                delay={0.57}
                animate={playIntro && paintUi}
                onClick={() => { if (!blocked) setGiftsMenu(true); }}
              />
              <ActionTile
                icon="/assets/ic-settings.png"
                label="Настройки"
                disabled={blocked}
                delay={0.64}
                animate={playIntro && paintUi}
                onClick={() => { if (!blocked) navigate("/settings"); }}
              />
              <ActionTile
                icon="/assets/ic-support.png"
                label="Поддержка"
                delay={0.71}
                animate={playIntro && paintUi}
                disabled={blacklisted}
                badge={supportUnread}
                onClick={() => { if (!blacklisted) navigate("/support"); }}
              />
            </div>
          </div>

          {/* если данные идут дольше 3 с — только на интро входа */}
          {playIntro && !dataReady && slow ? (
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: "calc(28px + var(--blin-tg-pad-bottom, 0px) / var(--blin-scale))",
                textAlign: "center",
                fontSize: 14,
                fontWeight: 400,
                color: H.muted,
                letterSpacing: "0.02em",
                animation: "blinvpnFadeIn 0.6s ease both",
                pointerEvents: "none",
              }}
            >
              Загрузка...
            </div>
          ) : null}
        </div>
      </div>
      {giftsMenu ? (
        <NoirSheet title="Подарки" onClose={() => setGiftsMenu(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <NoirRow icon="redeem" title="Активировать подарок" onClick={() => navigate("/gift/activate")} />
            <NoirRow icon="shopping_bag" title="Купить подарок" onClick={() => navigate("/gift/buy")} />
            <NoirRow icon="card_giftcard" title="Мои подарки" onClick={() => navigate("/gifts")} />
          </div>
        </NoirSheet>
      ) : null}
    </div>
  );
}
