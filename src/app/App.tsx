import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import Home from "./pages/Home";
import DevicesLists from "./pages/DevicesLists";
import ExtendSubscription from "./pages/ExtendSubscription";
import History from "./pages/History";
import IncreaseDevices from "./pages/IncreaseDevices";
import ManageSubscription from "./pages/ManageSubscription";
import Payment from "./pages/Payment";
import Promocode from "./pages/Promocode";
import Referral from "./pages/Referral";
import Settings from "./pages/Settings";
import Security from "./pages/Security";
import LegalDocument from "./pages/LegalDocument";
import Authentication from "./pages/Authentication";
import ChannelGate from "./pages/ChannelGate";
import SetupPrompt from "./components/SetupPrompt";
import EnterScreen, { type EnterTerms } from "./components/EnterScreen";
import { AppErrorProvider } from "./components/ErrorModal";
import Support from "./pages/Support";
import Tariffs from "./pages/Tariffs";
import ReferralLevels from "./pages/ReferralLevels";
import GiftBuy from "./pages/GiftBuy";
import MyGifts from "./pages/MyGifts";
import Family from "./pages/Family";
import { checkAuth, fetchMe, fetchMembership, fetchSetupStatus, type Membership } from "./utils/api";
import { homeIntroPending, subscribeHomeIntroReady } from "./utils/homeIntro";
import { trackRoute } from "./utils/navigation";
import DayGiftPrompt from "./components/DayGiftSheet";
import PaymentResume from "./components/PaymentResume";

// подсказка настройки: раз за сессию
const SETUP_PROMPT_DISMISSED_KEY = "blinvpn_setup_prompt_dismissed";

function useHomeIntroReady() {
  const [ready, setReady] = useState(() => !homeIntroPending());
  useEffect(() => {
    if (ready) return;
    return subscribeHomeIntroReady(() => setReady(true));
  }, [ready]);
  return ready;
}

// при заблокированном ключе доступны только главная, поддержка и юр. документы
// (бэкенд для них тоже открыт: _BANNED_ALLOWED_PATHS в core.py)
const BLOCKED_ALLOWED = /^\/(?:support\/?|legal\/[^/]+\/?)?$/;

function AnimatedLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const navType = useNavigationType();
  const skipEnterAnimation = useRef(true);
  const introReady = useHomeIntroReady();
  // ключ заблокирован: только главная
  const [blocked, setBlocked] = useState(false);
  const [showSetup, setShowSetup] = useState(false);

  useLayoutEffect(() => {
    skipEnterAnimation.current = false;
  }, []);

  useEffect(() => {
    let mounted = true;
    void fetchMe()
      .then((me) => { if (mounted) setBlocked(me?.subscription_status === "blocked" || me?.subscription_status === "banned"); })
      .catch(() => { /* ignore */ });
    return () => { mounted = false; };
  }, []);

  // подписка есть, но ни разу не подключался
  useEffect(() => {
    let mounted = true;
    let dismissed = false;
    try { dismissed = sessionStorage.getItem(SETUP_PROMPT_DISMISSED_KEY) === "1"; } catch { /* ignore */ }
    if (dismissed) return;
    void fetchSetupStatus()
      .then((s) => { if (mounted) setShowSetup(!!s.show_setup_prompt); })
      .catch(() => { /* ignore */ });
    return () => { mounted = false; };
  }, []);

  const dismissSetup = () => {
    setShowSetup(false);
    try { sessionStorage.setItem(SETUP_PROMPT_DISMISSED_KEY, "1"); } catch { /* ignore */ }
  };
  const continueSetup = () => {
    dismissSetup();
    navigate("/subscription?setup=1");
  };

  // ключ заблокирован: любой deep link → на главную (кроме поддержки и документов)
  useEffect(() => {
    if (blocked && !BLOCKED_ALLOWED.test(location.pathname)) {
      navigate("/", { replace: true });
    }
  }, [blocked, location.pathname, navigate]);

  const fromBack = navType === "POP";
  const animate = !skipEnterAnimation.current;
  const animation = animate
    ? `${fromBack ? "blinvpnPageInBackward" : "blinvpnPageInForward"} 0.42s cubic-bezier(0.22, 1, 0.36, 1) both`
    : "none";

  useEffect(() => {
    trackRoute(`${location.pathname}${location.search}`, navType === "REPLACE");
  }, [location.pathname, location.search, navType]);

  return (
    <div
      style={{
        height: "100%",
        overflow: "clip",
        background: "#14110E",
        isolation: "isolate",
      }}
    >
      <div
        key={location.pathname}
        style={{
          height: "100%",
          animation,
          backfaceVisibility: "hidden",
          ...(animate ? { willChange: "opacity, transform" } : {}),
        }}
      >
        <Outlet />
      </div>
      {introReady && showSetup && !blocked && (
        <SetupPrompt onContinue={continueSetup} onClose={dismissSetup} />
      )}
      {introReady && !blocked && <PaymentResume />}
      {introReady && !blocked && <DayGiftPrompt />}
    </div>
  );
}

// «Пропустить» подписку на канал: не спрашиваем снова 7 дней (на этом устройстве)
const CHANNEL_SKIP_KEY = "blinvpn_channel_skip";
const CHANNEL_SKIP_MS = 7 * 86_400_000;
function channelSkipped(): boolean {
  try {
    const t = Number(localStorage.getItem(CHANNEL_SKIP_KEY) || 0);
    return t > 0 && Date.now() - t < CHANNEL_SKIP_MS;
  } catch {
    return false;
  }
}
function rememberChannelSkip(): void {
  try { localStorage.setItem(CHANNEL_SKIP_KEY, String(Date.now())); } catch { /* приватный режим */ }
}

export default function App() {
  const [auth, setAuth] = useState<"checking" | "authed" | "anon">("checking");
  const [gate, setGate] = useState<"checking" | "open" | "blocked">("checking");
  const [membership, setMembership] = useState<Membership | null>(null);
  // оферта при первом входе
  const [terms, setTerms] = useState<"checking" | "ok" | "need">("checking");
  const introReady = useHomeIntroReady();

  useEffect(() => {
    let mounted = true;
    void checkAuth()
      .then((ok) => mounted && setAuth(ok ? "authed" : "anon"))
      .catch(() => mounted && setAuth("anon"));
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (auth !== "authed") return;
    let mounted = true;
    void fetchMe()
      .then((me) => { if (mounted) setTerms(me && me.terms_accepted === false ? "need" : "ok"); })
      .catch(() => mounted && setTerms("ok"));
    return () => { mounted = false; };
  }, [auth]);

  // подписка на канал только для входа через telegram
  useEffect(() => {
    if (auth !== "authed") return;
    let mounted = true;
    // всегда проверяем; для email сервер вернёт required=false
    void fetchMembership()
      .then((m) => {
        if (!mounted) return;
        setMembership(m);
        if (m.subscribed) setGate("open");
        // обязательна — без подписки дальше нельзя; необязательна — предлагаем, можно пропустить
        else if (m.required) setGate("blocked");
        else setGate(channelSkipped() ? "open" : "blocked");
      })
      .catch(() => mounted && setGate("open"));
    return () => {
      mounted = false;
    };
  }, [auth]);

  // экран входа с видео — один экземпляр поверх всего, пока под ним грузится приложение
  let content: React.ReactNode = null;
  if (auth === "anon") {
    content = <Authentication onAuthed={() => setAuth("authed")} />;
  } else if (auth === "authed") {
    // рисуем приложение; канал — оверлей
    content = (
      <>
        <RoutedApp />
        {/* оферта теперь на экране входа (EnterScreen) */}
        {introReady && terms === "ok" && gate === "blocked" && membership ? (
          <ChannelGate
            membership={membership}
            onPassed={() => setGate("open")}
            onSkip={membership.required ? undefined : () => { rememberChannelSkip(); setGate("open"); }}
          />
        ) : null}
      </>
    );
  }

  const enterTerms: EnterTerms =
    auth === "checking" ? "checking" : auth === "anon" ? "anon" : terms;

  return (
    <>
      {content}
      <EnterScreen terms={enterTerms} onAccepted={() => setTerms("ok")} />
    </>
  );
}

function RoutedApp() {
  return (
    <AppErrorProvider>
    <BrowserRouter>
      <Routes>
        <Route element={<AnimatedLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/history" element={<History />} />
          <Route path="/subscription" element={<ManageSubscription />} />
          <Route path="/subscription/start" element={<Navigate to="/subscription?setup=1" replace />} />
          <Route path="/tariffs" element={<Tariffs />} />
          <Route path="/payment" element={<Payment />} />
          <Route path="/payment/return" element={<Navigate to="/" replace />} />
          <Route path="/promocode" element={<Promocode />} />
          <Route path="/referral" element={<Referral />} />
          <Route path="/referral/levels" element={<ReferralLevels />} />
          <Route path="/gift/buy" element={<GiftBuy />} />
          <Route path="/gift/activate" element={<Promocode />} />
          <Route path="/gifts" element={<MyGifts />} />
          <Route path="/family" element={<Family />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/security" element={<Security />} />
          <Route path="/support" element={<Support />} />
          <Route path="/subscription/devices" element={<DevicesLists />} />
          <Route path="/subscription/extend" element={<ExtendSubscription />} />
          <Route path="/subscription/increase" element={<IncreaseDevices />} />
          <Route path="/legal/:kind" element={<LegalDocument />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
    </AppErrorProvider>
  );
}
