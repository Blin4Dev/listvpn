const HOME_INTRO_READY = "blinvpn-home-intro-ready";

/** живёт только в этой загрузке JS: reload снова играет интро, «назад» — нет */
let introPlayed = false;

/** интро только при входе / перезагрузке, не при «назад» */
export function homeIntroPending(): boolean {
  return !introPlayed;
}

export function markHomeIntroPlayed(): void {
  introPlayed = true;
}

/** шиты и модалки можно показывать поверх главной */
export function signalHomeIntroReady(): void {
  markHomeIntroPlayed();
  try {
    window.dispatchEvent(new Event(HOME_INTRO_READY));
  } catch { /* ignore */ }
}

export function subscribeHomeIntroReady(cb: () => void): () => void {
  if (!homeIntroPending()) {
    cb();
    return () => {};
  }
  const onReady = () => cb();
  window.addEventListener(HOME_INTRO_READY, onReady);
  return () => window.removeEventListener(HOME_INTRO_READY, onReady);
}

// ── экран входа (видео + «Коснитесь, чтобы войти») ──
const ENTERED_EVENT = "blinvpn-entered";
/** тоже живёт только в этой загрузке JS */
let entered = false;

export function hasEntered(): boolean {
  return entered;
}

export function markEntered(): void {
  if (entered) return;
  entered = true;
  try {
    window.dispatchEvent(new Event(ENTERED_EVENT));
  } catch { /* ignore */ }
}

export function subscribeEntered(cb: () => void): () => void {
  if (entered) {
    cb();
    return () => {};
  }
  const onEnter = () => cb();
  window.addEventListener(ENTERED_EVENT, onEnter);
  return () => window.removeEventListener(ENTERED_EVENT, onEnter);
}
