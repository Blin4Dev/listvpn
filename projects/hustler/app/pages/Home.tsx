import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { activateTrial, fetchConfig, fetchMe, fetchSupport } from "../utils/api";
import { loadReferral, peekReferral } from "../utils/referral";
import { formatDateRu } from "../utils/date";
import { hasEntered, homeIntroPending, markHomeIntroPlayed, signalHomeIntroReady, subscribeEntered } from "../utils/homeIntro";
import { useTgBack } from "../components/noir";
import { BACKDROP, O, OSheet, OSheetRow } from "../components/hustler";

// Hustler: главная (04 — нет подписки, 05 — подписка активна, 34 — меню «Подарки»)

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
  ok: O.text,
  warn: O.text,
  off: O.text,
  danger: O.red,
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


type HomeCache = {
  subscriptionState: SubscriptionState;
  subscriptionUntilText: string;
  trialEnabled: boolean;
  expiringTitle: string;
  blacklisted: boolean;
};

let homeCache: HomeCache | null = null;
let refCountCache: number | null = null;

function snapshotFromMe(me: { subscription_status?: string; subscription_until?: string | null; blacklisted?: boolean; trial_available?: boolean }, trialEnabled: boolean): HomeCache {
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
  const canTrial = trialEnabled && me.trial_available !== false;
  return { subscriptionState, subscriptionUntilText: untilText, trialEnabled: canTrial, expiringTitle, blacklisted };
}


// «Осталось 27 дней» для активной подписки (больше 3 дней)
let cachedDaysTitle = "";
function activeDaysTitle(me: { subscription_until?: string | null }): string {
  const until = String(me.subscription_until || "");
  if (!until) return "";
  const n = Math.ceil((new Date(until).getTime() - Date.now()) / 86_400_000);
  return n > 0 ? daysLeftTitle(n) : "";
}

function Tile({ icon, size, label, count, onClick, disabled, badge, delay, animate }: {
  icon: string; size: number; label: string; count?: string; onClick: () => void; disabled?: boolean; badge?: number; delay: number; animate: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="blin-press"
      style={{
        boxSizing: "border-box",
        WebkitTapHighlightColor: "transparent",
        appearance: "none",
        outline: "none",
        margin: 0,
        fontFamily: O.font,
        position: "relative",
        height: 121.8,
        padding: "0 14px",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "center",
        gap: 4,
        background: O.card,
        border: "none",
        boxShadow: O.ring,
        borderRadius: 21.6,
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        color: O.text,
        textAlign: "left",
        cursor: disabled ? "not-allowed" : "pointer",
        animation: animate ? `blinvpnRise 0.8s var(--ease-out) ${delay}s both` : undefined,
      }}
    >
      {badge ? (
        <span style={{
          position: "absolute", top: 12, right: 12, minWidth: 22, height: 22, padding: "0 7px", borderRadius: 11, boxSizing: "border-box",
          background: O.red, color: O.onRed, fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center",
        }}>{badge > 9 ? "9+" : badge}</span>
      ) : null}
      <img
        src={icon}
        width={size}
        height={size}
        alt=""
        draggable={false}
        style={{ width: size, height: size, objectFit: "contain", display: "block", userSelect: "none", filter: disabled ? "grayscale(1)" : undefined, opacity: disabled ? 0.4 : 1 }}
      />
      <span style={{ fontSize: 18, fontWeight: 800, lineHeight: "22.5px", color: disabled ? O.muted : O.text, whiteSpace: "nowrap" }}>
        {label}{count ? ` ${count}` : ""}
      </span>
    </button>
  );
}

export default function HomePage() {
  const navigate = useNavigate();
  const playIntro = useRef(homeIntroPending()).current;
  const cached = useRef(homeCache).current;
  const [dataReady, setDataReady] = useState(false);
  const [showUi, setShowUi] = useState(!playIntro);
  const [slow, setSlow] = useState(false);
  const [subscriptionState, setSubscriptionState] = useState<SubscriptionState>(cached?.subscriptionState ?? "never");
  const [subscriptionUntilText, setSubscriptionUntilText] = useState(cached?.subscriptionUntilText ?? "");
  const [trialEnabled, setTrialEnabled] = useState(cached?.trialEnabled ?? true);
  const [trialBusy, setTrialBusy] = useState(false);
  const [supportUnread, setSupportUnread] = useState(0);
  const [giftsMenu, setGiftsMenu] = useState(false);
  const [refCount, setRefCount] = useState<number | null>(() => {
    const c = peekReferral();
    return c ? Number(c.referrals_count || 0) : refCountCache;
  });
  const [expiringTitle, setExpiringTitle] = useState(cached?.expiringTitle ?? "Скоро закончится");
  const [daysTitle, setDaysTitle] = useState(cached ? cachedDaysTitle : "");
  const [blacklisted, setBlacklisted] = useState(cached?.blacklisted ?? false);
  const [entered, setEntered] = useState(hasEntered);

  useEffect(() => {
    loadReferral()
      .then((r) => { refCountCache = Number(r?.referrals_count || 0); setRefCount(refCountCache); })
      .catch(() => { /* нет данных */ });
  }, []);
  useEffect(() => {
    fetchSupport(1e12).then((st) => setSupportUnread(st.chat?.unread || 0)).catch(() => { /* нет чата */ });
  }, []);
  useEffect(() => {
    if (entered) return;
    return subscribeEntered(() => setEntered(true));
  }, [entered]);
  useEffect(() => {
    if (!playIntro || !entered) return;
    const t = window.setTimeout(() => setSlow(true), 3000);
    return () => window.clearTimeout(t);
  }, [playIntro, entered]);

  useEffect(() => {
    if (!playIntro) {
      signalHomeIntroReady();
      return;
    }
    if (!dataReady || !entered) return;
    let revealTimer = 0;
    const t = window.setTimeout(() => {
      setShowUi(true);
      markHomeIntroPlayed();
      revealTimer = window.setTimeout(() => signalHomeIntroReady(), 900);
    }, 180);
    return () => { window.clearTimeout(t); window.clearTimeout(revealTimer); };
  }, [dataReady, entered, playIntro]);

  useEffect(() => {
    void (async () => {
      let trial = homeCache?.trialEnabled ?? true;
      try {
        try {
          const conf = await fetchConfig();
          if (conf && typeof conf.trialEnabled === "boolean") trial = conf.trialEnabled;
        } catch { /* defaults */ }
        try {
          const me = await fetchMe();
          if (!me) return;
          const snap = snapshotFromMe(me, trial);
          homeCache = snap;
          cachedDaysTitle = activeDaysTitle(me);
          setDaysTitle(cachedDaysTitle);
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

  const cfg = STATE_CONFIGS[subscriptionState];
  // по макету активная подписка — «Осталось N дней»
  const statusTitle = subscriptionState === "expiring_soon"
    ? expiringTitle
    : subscriptionState === "active" && daysTitle ? daysTitle : cfg.statusTitle;
  const blocked = subscriptionState === "blocked";
  const trialOff = subscriptionState === "never" && !trialEnabled;
  const ctaLabel = trialOff ? "Оформить подписку" : cfg.ctaLabel;
  const ctaPath = trialOff ? BUY_PATH : cfg.ctaPath;
  const isTrialCta = subscriptionState === "never" && trialEnabled;
  // нет подписки → кремовая кнопка, есть → тёмная «Управление подпиской»
  const ctaCream = trialOff ? true : cfg.ctaPrimary;
  const paintUi = playIntro ? showUi : showUi && (dataReady || Boolean(cached));
  const rise = (delay: number) => (playIntro && paintUi ? `blinvpnRise 0.8s var(--ease-out) ${delay}s both` : undefined);

  const handleCta = async () => {
    if (blocked) return;
    if (isTrialCta) {
      setTrialBusy(true);
      const res = await activateTrial();
      setTrialBusy(false);
      if (res.success) { navigate("/subscription?setup=1"); return; }
      if (res.code === "trial_used") { navigate(BUY_PATH); return; }
      return;
    }
    navigate(ctaPath);
  };

  const subtitle =
    subscriptionUntilText && (subscriptionState === "active" || subscriptionState === "expiring_soon")
      ? `до ${subscriptionUntilText}${/г\.?$/.test(subscriptionUntilText) ? "" : " г."}`
      : blacklisted
        ? "Вы в черном списке проекта"
        : cfg.statusSubtitle;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", background: O.bg, fontFamily: O.font, color: O.text }}>
      <div aria-hidden style={{ position: "absolute", inset: 0, background: BACKDROP, opacity: paintUi ? 1 : 0, transition: playIntro ? "opacity 0.9s ease" : "none" }} />
      <div
        className="blin-scroll blin-tg-safe"
        style={{
          position: "relative",
          zIndex: 1,
          height: "100%",
          padding: "40px 16px 16px",
          // отступ под кнопки Telegram в полноэкранном режиме (стиль элемента перебивает .blin-tg-safe)
          paddingTop: `calc(40px + var(--blin-tg-pad-top, 0px) / var(--blin-scale))`,
          paddingBottom: "calc(24px + var(--blin-tg-pad-bottom, 0px) / var(--blin-scale))",
          boxSizing: "border-box",
          opacity: paintUi ? 1 : 0,
          pointerEvents: paintUi ? "auto" : "none",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", animation: rise(0.05) }}>
          <div style={{ position: "relative", width: 144, height: 160 }}>
            <div aria-hidden style={{ position: "absolute", left: 24, top: 24, width: 96, height: 112, borderRadius: "50%", background: "rgba(225, 6, 0, 0.3)", filter: "blur(40px)" }} />
            <img src="/assets/home-logo.png" alt="Hustler" draggable={false} style={{ position: "absolute", left: 8, top: 8, width: 128, height: 144, objectFit: "contain", userSelect: "none" }} />
          </div>
        </div>

        <div style={{ paddingTop: 20, textAlign: "center", animation: rise(0.1) }}>
          <div style={{ fontSize: 30, fontWeight: 800, lineHeight: "36px", color: TONE[cfg.statusTone] }}>{statusTitle}</div>
          {subtitle ? <div style={{ paddingTop: 4, fontSize: 16, lineHeight: "24px", color: O.muted }}>{subtitle}</div> : null}
        </div>

        <div style={{ paddingTop: 20, animation: rise(0.2) }}>
          <button
            type="button"
            className="blin-press"
            disabled={blocked || trialBusy}
            onClick={() => { if (!blocked && !trialBusy) void handleCta(); }}
            style={{
              boxSizing: "border-box",
              WebkitTapHighlightColor: "transparent",
              appearance: "none",
              outline: "none",
              margin: 0,
              fontFamily: O.font,
              width: "100%",
              height: 56,
              padding: "0 16px",
              borderRadius: 18.4,
              border: "none",
              boxShadow: ctaCream && !blocked ? "none" : O.ring,
              background: blocked ? O.off : ctaCream ? O.red : "rgba(20, 20, 20, 0.9)",
              color: blocked ? O.muted : ctaCream ? O.onRed : O.text,
              fontSize: 18,
              fontWeight: 700,
              lineHeight: "28px",
              cursor: blocked ? "not-allowed" : "pointer",
            }}
          >
            {trialBusy ? "Активация…" : ctaLabel}
          </button>
        </div>

        <div style={{ paddingTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Tile icon="/assets/ic-referrals.png" size={56} label="Рефералы" count={refCount === null ? "" : String(refCount)} disabled={blocked}
            delay={0.28} animate={playIntro && paintUi} onClick={() => { if (!blocked) navigate("/referral"); }} />
          <Tile icon="/assets/ic-gifts.png" size={48} label="Подарки" disabled={blocked}
            delay={0.34} animate={playIntro && paintUi} onClick={() => { if (!blocked) setGiftsMenu(true); }} />
          <Tile icon="/assets/ic-settings.png" size={48} label="Настройки" disabled={blocked}
            delay={0.4} animate={playIntro && paintUi} onClick={() => { if (!blocked) navigate("/settings"); }} />
          <Tile icon="/assets/ic-support.png" size={56} label="Поддержка" disabled={blacklisted} badge={supportUnread}
            delay={0.46} animate={playIntro && paintUi} onClick={() => { if (!blacklisted) navigate("/support"); }} />
        </div>
      </div>

      {playIntro && !dataReady && slow ? (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: "calc(28px + var(--blin-tg-pad-bottom, 0px) / var(--blin-scale))", textAlign: "center", fontSize: 14, color: O.muted, animation: "blinvpnFadeIn 0.6s ease both", pointerEvents: "none" }}>
          Загрузка...
        </div>
      ) : null}

      {giftsMenu ? <GiftsMenu onClose={() => setGiftsMenu(false)} go={(p) => navigate(p)} /> : null}
    </div>
  );
}

// 34 — «Подарки»: активировать / купить / мои
function GiftsMenu({ onClose, go }: { onClose: () => void; go: (path: string) => void }) {
  useTgBack(onClose);
  return (
    <OSheet title="Подарки" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 16 }}>
        <OSheetRow icon="gift" title="Активировать подарок" onClick={() => go("/gift/activate")} />
        <OSheetRow icon="shopping-bag" title="Купить подарок" onClick={() => go("/gift/buy")} />
        <OSheetRow icon="gift" title="Мои подарки" onClick={() => go("/gifts")} />
      </div>
    </OSheet>
  );
}
