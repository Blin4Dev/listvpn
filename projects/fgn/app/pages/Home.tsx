// FGN: главная (переопределение src/app/pages/Home.tsx).
// Логика та же (статус подписки, триал, интро после экрана входа), дизайн свой:
// сетка с частицами, белый щит, статус, белая кнопка, реферальная карточка, «Подарки», «Настройки» / «Поддержка».
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SUBSCRIPTION_CHANGED_EVENT, activateTrial, fetchConfig, fetchMe, fetchSupport } from "../utils/api";
import { loadReferral, peekReferral, type ReferralData } from "../utils/referral";
import { formatDateRu } from "../utils/date";
import { hasEntered, homeIntroPending, markHomeIntroPlayed, signalHomeIntroReady, subscribeEntered } from "../utils/homeIntro";
import { btnReset, pageFrame, pageOuter } from "../components/ui";
import { C, FgnBackdrop, FgnDialog, FgnIcon, FgnMenuRow, FgnSheet, fgnButton, fgnInput } from "../components/fgn";

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
  // нет активной подписки → показываем «приглашение в семью»
  noSub: boolean;
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
    noSub: false,
  },
  never: {
    statusTitle: "У вас нету подписки",
    statusTone: "off",
    statusSubtitle: "",
    ctaLabel: "Попробовать бесплатно",
    ctaPath: "/subscription?setup=1",
    noSub: true,
  },
  expired: {
    statusTitle: "Подписка истекла",
    statusTone: "off",
    statusSubtitle: "Продлите, чтобы снова подключиться",
    ctaLabel: "Продлить подписку",
    ctaPath: "/subscription/extend",
    noSub: true,
  },
  expiring_soon: {
    statusTitle: "Скоро закончится",
    statusTone: "warn",
    statusSubtitle: "",
    ctaLabel: "Управление подпиской",
    ctaPath: "/subscription",
    noSub: false,
  },
  blocked: {
    statusTitle: "Подписка заблокирована",
    statusTone: "danger",
    statusSubtitle: "Обратитесь в поддержку",
    ctaLabel: "Управление подпиской",
    ctaPath: "/subscription",
    noSub: false,
  },
  had_before: {
    statusTitle: "У вас нету подписки",
    statusTone: "off",
    statusSubtitle: "",
    ctaLabel: "Оформить подписку",
    ctaPath: BUY_PATH,
    noSub: true,
  },
};

const TONE: Record<StateConfig["statusTone"], string> = {
  ok: C.text,
  warn: C.warn,
  off: C.text,
  danger: C.danger,
};

// «Войти в семью»: экран семьи с подставленным кодом (/family?code=…)
const familyJoinPath = (code: string) => `/family?code=${encodeURIComponent(code)}`;

/** лист «Приглашение в семью» (макет 33) */
// приглашение в семью (макет 61): сервер может отдать в /me поле family_invite { code, from_name }.
// «Отклонить» прячет это приглашение на устройстве, «Принять» ведёт на активацию кода.
type FamilyInvite = { code: string; from_name?: string };
const FAMILY_DISMISS_KEY = "fgn.family.dismissed";
function readFamilyInvite(me: unknown): FamilyInvite | null {
  const inv = (me as { family_invite?: Partial<FamilyInvite> | null } | null)?.family_invite;
  if (!inv || typeof inv.code !== "string" || !inv.code) return null;
  try {
    if (localStorage.getItem(FAMILY_DISMISS_KEY) === inv.code) return null;
  } catch { /* без хранилища */ }
  return { code: inv.code, from_name: typeof inv.from_name === "string" ? inv.from_name : "" };
}
function dismissFamilyInvite(code: string) {
  try {
    localStorage.setItem(FAMILY_DISMISS_KEY, code);
  } catch { /* без хранилища */ }
}

function FamilyInviteSheet({ onClose, onJoin }: { onClose: () => void; onJoin: (code: string) => void }) {
  const [code, setCode] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const submit = () => {
    const c = code.trim();
    if (!c) { inputRef.current?.focus(); return; }
    onJoin(c);
  };
  return (
    <FgnSheet title="Приглашение в семью" onClose={onClose}>
      <style>{`.fgn-input::placeholder { color: rgba(196, 196, 206, 0.62); opacity: 1; }`}</style>
      <div style={{ marginTop: 19, fontSize: 14.5, lineHeight: 1.35, color: C.muted }}>
        Вставьте код, который прислал владелец семьи.
      </div>
      <input
        ref={inputRef}
        className="fgn-input"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        placeholder="Код приглашения"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        style={{ ...fgnInput, marginTop: 13 }}
      />
      <button type="button" className="blin-press" onClick={submit} style={{ ...fgnButton, marginTop: 13 }}>
        Войти в семью
      </button>
    </FgnSheet>
  );
}
// максимальная ставка реферальной программы, пока не пришли данные
const REF_RATE_FALLBACK = 50;

// «остался 1 день» / «осталось N дня|дней»
function daysLeftTitle(n: number): string {
  if (n <= 0) return "Заканчивается сегодня";
  const a = n % 100;
  const b = n % 10;
  if (b === 1 && a !== 11) return `Остался ${n} день`;
  if (b >= 2 && b <= 4 && (a < 12 || a > 14)) return `Осталось ${n} дня`;
  return `Осталось ${n} дней`;
}

function maxRefRate(d: ReferralData | null): number | null {
  const rates = (d?.levels || []).map((l) => Number(l.rate) || 0).filter((r) => r > 0);
  return rates.length ? Math.max(...rates) : null;
}

/** белый щит FGN (пропорции по макету главной) */
function HomeShield() {
  return (
    <svg viewBox="0 0 96 114" width={96} height={114} aria-hidden style={{ display: "block" }}>
      <path
        d="M48 0C41 8.5 25 19.5 0 22V50c0 30 20.5 53 48 64 27.5-11 48-34 48-64V22C71 19.5 55 8.5 48 0Z"
        fill={C.btnSoft}
      />
    </svg>
  );
}

const card: React.CSSProperties = {
  background: C.cardBg,
  border: `1px solid ${C.cardBorder}`,
  borderRadius: 26,
  boxSizing: "border-box",
  color: C.text,
};

function IconBox({ name, size }: { name: string; size: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.32),
        background: C.iconBg,
        border: `1px solid ${C.cardBorder}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        boxSizing: "border-box",
      }}
    >
      <FgnIcon name={name} size={Math.round(size * 0.55)} />
    </span>
  );
}

/** маленькая плитка «Настройки» / «Поддержка» */
function SmallTile({
  icon,
  label,
  onClick,
  disabled,
  badge,
  anim,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  badge?: number;
  anim?: string;
}) {
  return (
    <button
      type="button"
      className="blin-press"
      onClick={onClick}
      disabled={disabled}
      style={{
        ...btnReset,
        ...card,
        fontFamily: C.font,
        height: 62,
        padding: "0 12px",
        display: "flex",
        alignItems: "center",
        gap: 13,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        position: "relative",
        textAlign: "left",
        animation: anim,
      }}
    >
      <IconBox name={icon} size={36} />
      <span style={{ fontSize: 16, fontWeight: 500, letterSpacing: "-0.01em" }}>{label}</span>
      {badge ? (
        <span
          style={{
            position: "absolute",
            top: 10,
            right: 12,
            minWidth: 20,
            height: 20,
            padding: "0 6px",
            borderRadius: 10,
            background: C.green,
            color: "#04240F",
            fontSize: 12,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxSizing: "border-box",
          }}
        >
          {badge > 9 ? "9+" : badge}
        </span>
      ) : null}
    </button>
  );
}

/** плитка главной с подпиской (макет 64): 169×98, радиус 20, иконка 28 сверху, подпись 16.5/500 снизу */
function HomeTile({
  icon,
  label,
  count,
  onClick,
  disabled,
  badge,
  anim,
}: {
  icon: string;
  label: string;
  count?: number | null;
  onClick: () => void;
  disabled?: boolean;
  badge?: number;
  anim?: string;
}) {
  return (
    <button
      type="button"
      className="blin-press"
      onClick={onClick}
      disabled={disabled}
      style={{
        ...btnReset,
        background: C.cardBg,
        border: `1px solid ${C.cardBorder}`,
        borderRadius: 20,
        boxSizing: "border-box",
        color: C.text,
        fontFamily: C.font,
        minWidth: 0,
        height: 98,
        padding: "16px 16px 0",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        textAlign: "left",
        position: "relative",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        animation: anim,
      }}
    >
      <FgnIcon name={icon} size={28} stroke={2} />
      <span style={{ marginTop: 13.5, display: "flex", alignItems: "baseline", fontSize: 16.5, fontWeight: 500, lineHeight: "20px", letterSpacing: "-0.01em", whiteSpace: "nowrap" }}>
        {label}
        {count != null ? (
          <span style={{ marginLeft: 10, fontSize: 15, fontWeight: 400, color: C.muted }}>{count}</span>
        ) : null}
      </span>
      {badge ? (
        <span
          style={{
            position: "absolute",
            top: 14,
            right: 14,
            minWidth: 20,
            height: 20,
            padding: "0 6px",
            borderRadius: 10,
            background: C.green,
            color: "#04240F",
            fontSize: 12,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxSizing: "border-box",
          }}
        >
          {badge > 9 ? "9+" : badge}
        </span>
      ) : null}
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
    // «Осталось N дней» — и для активной, и для заканчивающейся (макет 34)
    if (Number.isFinite(daysLeft)) expiringTitle = daysLeftTitle(daysLeft);
    else expiringTitle = "Подписка активна";
    subscriptionState = daysLeft <= 3 ? "expiring_soon" : "active";
  } else if (st === "expired") {
    subscriptionState = "expired";
  } else if (st === "lapsed") {
    subscriptionState = "had_before";
  }
  const canTrial = trialEnabled && me.trial_available !== false;
  return { subscriptionState, subscriptionUntilText: untilText, trialEnabled: canTrial, expiringTitle, blacklisted };
}

export default function HomePage() {
  const navigate = useNavigate();
  // интро только при входе / перезагрузке, не при «назад»
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
  const [familySheet, setFamilySheet] = useState(false);
  const [familyInvite, setFamilyInvite] = useState<FamilyInvite | null>(null);
  // «До N%» — максимальная ставка из уровней реферальной программы
  const [refRate, setRefRate] = useState<number | null>(() => maxRefRate(peekReferral()));
  // «Рефералы 18» на плитке главной с подпиской
  const [refCount, setRefCount] = useState<number | null>(() => peekReferral()?.referrals_count ?? null);
  useEffect(() => {
    loadReferral()
      .then((r) => {
        const v = maxRefRate(r);
        if (v !== null) setRefRate(v);
        if (typeof r.referrals_count === "number") setRefCount(r.referrals_count);
      })
      .catch(() => { /* нет данных */ });
  }, []);
  useEffect(() => {
    fetchSupport(1e12).then((st) => setSupportUnread(st.chat?.unread || 0)).catch(() => { /* нет чата */ });
  }, []);
  const [expiringTitle, setExpiringTitle] = useState(cached?.expiringTitle ?? "Скоро закончится");
  const [blacklisted, setBlacklisted] = useState(cached?.blacklisted ?? false);
  const [entered, setEntered] = useState(hasEntered);
  useEffect(() => {
    if (entered) return;
    return subscribeEntered(() => setEntered(true));
  }, [entered]);

  useEffect(() => {
    if (!playIntro || !entered) return;
    const t = window.setTimeout(() => setSlow(true), 3000);
    return () => window.clearTimeout(t);
  }, [playIntro, entered]);

  // после касания экрана входа даём ему начать растворяться, потом раскрываем главную
  const AFTER_ENTER_MS = 180;
  // карточки поднимаются ~1.1s — модалки после этого
  const INTRO_REVEAL_MS = 1150;
  useEffect(() => {
    if (!playIntro) {
      signalHomeIntroReady();
      return;
    }
    if (!dataReady || !entered) return;
    let revealTimer = 0;
    const splashTimer = window.setTimeout(() => {
      setShowUi(true);
      markHomeIntroPlayed();
      revealTimer = window.setTimeout(() => signalHomeIntroReady(), INTRO_REVEAL_MS);
    }, AFTER_ENTER_MS);
    return () => {
      window.clearTimeout(splashTimer);
      window.clearTimeout(revealTimer);
    };
  }, [dataReady, entered, playIntro]);

  const cfg = STATE_CONFIGS[subscriptionState];
  // с подпиской — крупный заголовок «Осталось N дней» и тёмная кнопка управления (макет 34)
  const hasSub = subscriptionState === "active" || subscriptionState === "expiring_soon";
  const statusTitle = hasSub ? expiringTitle : cfg.statusTitle;
  const tone = TONE[cfg.statusTone];
  const blocked = subscriptionState === "blocked";
  const trialOff = subscriptionState === "never" && !trialEnabled;
  const ctaLabel = trialOff ? "Оформить подписку" : cfg.ctaLabel;
  const ctaPath = trialOff ? BUY_PATH : cfg.ctaPath;
  const isTrialCta = subscriptionState === "never" && trialEnabled;
  // назад без кэша: не светить дефолт «нет подписки» / триал
  const paintUi = playIntro ? showUi : showUi && (dataReady || Boolean(cached));
  const rise = (delay: number) =>
    playIntro && paintUi ? `fgnRise 0.75s cubic-bezier(0.22, 1, 0.36, 1) ${delay}s both` : undefined;

  const handleCta = async () => {
    if (blocked) return;
    if (isTrialCta) {
      setTrialBusy(true);
      const res = await activateTrial();
      setTrialBusy(false);
      if (res.success) {
        navigate("/subscription?setup=1");
        return;
      }
      if (res.code === "trial_used") {
        navigate(BUY_PATH);
        return;
      }
      return;
    }
    navigate(ctaPath);
  };

  useEffect(() => {
    const load = async () => {
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
          setSubscriptionUntilText(snap.subscriptionUntilText);
          setExpiringTitle(snap.expiringTitle);
          setBlacklisted(snap.blacklisted);
          setSubscriptionState(snap.subscriptionState);
          setTrialEnabled(snap.trialEnabled);
          setFamilyInvite(readFamilyInvite(me));
        } catch { /* safe default */ }
      } finally {
        setDataReady(true);
      }
    };
    void load();
    // подписка выдана из окна (перенос из старого VPN) — перечитать
    const onChanged = () => { void load(); };
    window.addEventListener(SUBSCRIPTION_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(SUBSCRIPTION_CHANGED_EVENT, onChanged);
  }, []);

  const subtitle =
    subscriptionUntilText && (subscriptionState === "active" || subscriptionState === "expiring_soon")
      ? `до ${subscriptionUntilText} г.`
      : blacklisted
        ? "Вы в черном списке проекта"
        : cfg.statusSubtitle;

  return (
    <div style={pageOuter({ background: C.bg })}>
      <div style={pageFrame({ background: C.bg, fontFamily: C.font, color: C.text })}>
        <FgnBackdrop />

        <div
          className="blin-scroll"
          style={{
            position: "relative",
            zIndex: 1,
            height: "100%",
            overflowY: "auto",
            padding: "0 20px",
            paddingTop: "calc(28px + var(--blin-tg-pad-top, 0px) / var(--blin-scale))",
            paddingBottom: "calc(28px + var(--blin-tg-pad-bottom, 0px) / var(--blin-scale))",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* щит */}
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              filter: "drop-shadow(0 0 28px rgba(255,255,255,0.08))",
              opacity: paintUi ? 1 : 0,
              transform: paintUi ? "none" : "scale(0.9)",
              transition: playIntro ? "opacity 0.6s ease, transform 0.8s cubic-bezier(0.22, 1, 0.36, 1)" : "none",
            }}
          >
            <HomeShield />
          </div>

          <div
            style={{
              opacity: paintUi ? 1 : 0,
              pointerEvents: paintUi ? "auto" : "none",
              transition: playIntro ? "opacity 0.3s ease" : "none",
            }}
          >
            {/* статус */}
            <div style={{ marginTop: hasSub ? 30 : 22, marginBottom: hasSub ? 33 : 20, animation: rise(0.05) }}>
              <div
                style={
                  hasSub
                    ? { fontSize: 36, fontWeight: 600, lineHeight: 1.15, letterSpacing: "-0.02em", color: tone, whiteSpace: "nowrap" }
                    : { fontSize: 19, fontWeight: 500, lineHeight: 1.2, letterSpacing: "-0.01em", color: tone }
                }
              >
                {statusTitle}
              </div>
              {subtitle ? (
                <div style={{ marginTop: hasSub ? 8 : 4, fontSize: 14.5, lineHeight: 1.35, color: hasSub ? "rgba(196,196,206,0.6)" : C.muted }}>{subtitle}</div>
              ) : null}
            </div>

            {/* главная кнопка */}
            <button
              type="button"
              className="blin-press"
              disabled={blocked || trialBusy}
              onClick={() => { if (!blocked && !trialBusy) void handleCta(); }}
              style={{
                ...btnReset,
                fontFamily: C.font,
                width: "100%",
                height: 52,
                borderRadius: 24,
                border: "none",
                background: blocked ? C.btnOff : C.btnSoft,
                color: C.btnText,
                fontSize: 17,
                ...(hasSub ? { ...card, height: 57, borderRadius: 29, fontSize: 18 } : null),
                fontWeight: 500,
                letterSpacing: "-0.01em",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 11,
                cursor: blocked ? "not-allowed" : "pointer",
                animation: rise(0.12),
              }}
            >
              {hasSub ? null : <FgnIcon name={cfg.noSub || trialOff ? "leaf" : "sliders"} size={21} stroke={1.6} />}
              <span>{trialBusy ? "Активация…" : ctaLabel}</span>
            </button>

            {/* приглашение в семью — только без подписки */}
            {cfg.noSub ? (
              <button
                type="button"
                className="blin-press"
                onClick={() => setFamilySheet(true)}
                style={{
                  ...btnReset,
                  ...card,
                  fontFamily: C.font,
                  width: "100%",
                  height: 53,
                  marginTop: 9,
                  fontSize: 17,
                  fontWeight: 500,
                  letterSpacing: "-0.01em",
                  cursor: "pointer",
                  animation: rise(0.18),
                }}
              >
                У меня есть приглашение в семью
              </button>
            ) : null}

            {/* с подпиской — сетка 2×2 (макет 64) */}
            {hasSub ? (
              <div style={{ marginTop: 32, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <HomeTile
                  icon="users"
                  label="Рефералы"
                  count={refCount}
                  disabled={blocked}
                  anim={rise(0.24)}
                  onClick={() => { if (!blocked) navigate("/referral"); }}
                />
                <HomeTile
                  icon="gift"
                  label="Подарки"
                  disabled={blocked}
                  anim={rise(0.28)}
                  onClick={() => { if (!blocked) setGiftsMenu(true); }}
                />
                <HomeTile
                  icon="settings"
                  label="Настройки"
                  disabled={blocked}
                  anim={rise(0.32)}
                  onClick={() => { if (!blocked) navigate("/settings"); }}
                />
                <HomeTile
                  icon="chat"
                  label="Поддержка"
                  disabled={blacklisted}
                  badge={supportUnread}
                  anim={rise(0.36)}
                  onClick={() => { if (!blacklisted) navigate("/support"); }}
                />
              </div>
            ) : null}

            {/* реферальная программа */}
            {!hasSub ? (<>
            <div
              role="button"
              tabIndex={0}
              className="blin-press"
              onClick={() => { if (!blocked) navigate("/referral"); }}
              onKeyDown={(e) => { if (!blocked && (e.key === "Enter" || e.key === " ")) navigate("/referral"); }}
              style={{
                ...card,
                position: "relative",
                marginTop: hasSub ? 32 : 13,
                height: 104,
                padding: "0 16px 0 20px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                overflow: "hidden",
                cursor: blocked ? "not-allowed" : "pointer",
                opacity: blocked ? 0.4 : 1,
                animation: rise(0.24),
              }}
            >
              <span
                aria-hidden
                style={{ position: "absolute", left: 0, top: 16, bottom: 16, width: 4, borderRadius: 2, background: C.green }}
              />
              <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.03em", textTransform: "uppercase", color: C.green }}>
                  Реферальная программа
                </span>
                <span style={{ marginTop: 4, fontSize: 31, fontWeight: 700, lineHeight: 1.05, letterSpacing: "-0.02em", color: C.green }}>
                  До {refRate ?? REF_RATE_FALLBACK}%
                </span>
                <span style={{ marginTop: 6, fontSize: 11, letterSpacing: "0.02em", textTransform: "uppercase", color: "rgba(196,196,206,0.6)" }}>
                  С приведённых рефералов
                </span>
              </span>
              <span
                style={{
                  flexShrink: 0,
                  height: 40,
                  padding: "0 16px",
                  borderRadius: 20,
                  background: C.btnSoft,
                  color: C.btnText,
                  fontSize: 15,
                  fontWeight: 500,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                Смотреть
              </span>
            </div>

            {/* подарки */}
            <button
              type="button"
              className="blin-press"
              disabled={blocked}
              onClick={() => { if (!blocked) setGiftsMenu(true); }}
              style={{
                ...btnReset,
                ...card,
                fontFamily: C.font,
                width: "100%",
                marginTop: 13,
                minHeight: 94,
                padding: "12px 18px 12px 17px",
                display: "flex",
                alignItems: "center",
                gap: 13,
                textAlign: "left",
                cursor: blocked ? "not-allowed" : "pointer",
                opacity: blocked ? 0.4 : 1,
                animation: rise(0.3),
              }}
            >
              <IconBox name="gift" size={44} />
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: 16.5, fontWeight: 500, letterSpacing: "-0.01em" }}>Подарки</span>
                <span style={{ fontSize: 14, lineHeight: 1.35, color: C.muted, maxWidth: 190 }}>
                  Активировать, купить или посмотреть свои
                </span>
              </span>
              <FgnIcon name="chevron" size={18} stroke={1.8} style={{ color: "rgba(255,255,255,0.7)" }} />
            </button>

            {/* настройки / поддержка */}
            <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 13 }}>
              <SmallTile
                icon="settings"
                label="Настройки"
                disabled={blocked}
                anim={rise(0.36)}
                onClick={() => { if (!blocked) navigate("/settings"); }}
              />
              <SmallTile
                icon="chat"
                label="Поддержка"
                disabled={blacklisted}
                badge={supportUnread}
                anim={rise(0.4)}
                onClick={() => { if (!blacklisted) navigate("/support"); }}
              />
            </div>
            </>) : null}
          </div>

          {/* данные идут дольше 3 с — только на интро входа */}
          {playIntro && !dataReady && slow ? (
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: "calc(28px + var(--blin-tg-pad-bottom, 0px) / var(--blin-scale))",
                textAlign: "center",
                fontSize: 14,
                color: C.muted,
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
      {familyInvite && paintUi && !familySheet ? (
        <FgnDialog
          title="Семейная подписка"
          text={familyInvite.from_name
            ? `Пользователь ${familyInvite.from_name} пригласил вас в семью, принять приглашение?`
            : "Вас пригласили в семью, принять приглашение?"}
          primary="Принять"
          onPrimary={() => {
            const code = familyInvite.code;
            setFamilyInvite(null);
            navigate(familyJoinPath(code));
          }}
          secondary="Отклонить"
          onClose={() => {
            dismissFamilyInvite(familyInvite.code);
            setFamilyInvite(null);
          }}
        />
      ) : null}
      {familySheet ? (
        <FamilyInviteSheet onClose={() => setFamilySheet(false)} onJoin={(c) => navigate(familyJoinPath(c))} />
      ) : null}
      {giftsMenu ? (
        <FgnSheet title="Подарки" onClose={() => setGiftsMenu(false)}>
          <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 9 }}>
            <FgnMenuRow icon="gift" title="Активировать подарок" onClick={() => navigate("/gift/activate")} />
            <FgnMenuRow icon="bag" title="Купить подарок" onClick={() => navigate("/gift/buy")} />
            <FgnMenuRow icon="gift" title="Мои подарки" onClick={() => navigate("/gifts")} />
            <FgnMenuRow icon="ticket" title="Ввести промокод" subtitle="Промокод на дни к подписке" onClick={() => navigate("/promocode")} />
          </div>
        </FgnSheet>
      ) : null}
    </div>
  );
}
