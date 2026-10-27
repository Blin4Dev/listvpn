// данные экрана «Реферальная программа»: один запрос на всё приложение, кэш в памяти и на устройстве.
// Экран открывается сразу с последними данными, свежие подтягиваются фоном (stale-while-revalidate).
import { appFetch, getAppToken } from "./api";

export type RefLevel = { key: string; name: string; min: number; rate: number; gifts: number; self_free_from: number };
export type RefGift = { code: string; status: string; created_at: string; redeemed_at?: string | null };

export type ReferralData = {
  code?: string;
  link?: string;
  partner_balance?: number;
  referrals_count?: number;
  active_count?: number;
  friends?: { name: string; active: boolean }[];
  earned_total?: number;
  earned_month?: number;
  min_withdraw?: number;
  level?: { key: string; name: string; rate: number; level_rate: number; custom_rate: boolean };
  next_level?: { key: string; name: string; need: number; rate: number } | null;
  levels?: RefLevel[];
  rewards?: {
    self: { eligible: boolean; available: boolean; need_active: number; next_at: string | null };
    gifts: { per_month: number; left: number; next_at: string | null; items: RefGift[] };
  };
};

type Entry = { who: string; at: number; data: ReferralData };

const STORE_KEY = "blin.referral.v1";
const FRESH_MS = 30_000; // моложе — повторно не запрашиваем
const MAX_AGE_MS = 7 * 24 * 3600_000; // старше — не показываем

let mem: Entry | null = null;
let inflight: { who: string; p: Promise<ReferralData> } | null = null;

/** чей кэш: telegram id или хвост сессии (вход по почте) — чужие данные не покажем */
function who(): string {
  try {
    const id = (window as unknown as { Telegram?: { WebApp?: { initDataUnsafe?: { user?: { id?: number } } } } })
      .Telegram?.WebApp?.initDataUnsafe?.user?.id;
    if (id) return `tg:${id}`;
  } catch { /* ignore */ }
  const t = getAppToken();
  return t ? `s:${t.slice(-12)}` : "anon";
}

function readStore(w: string): Entry | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const e = JSON.parse(raw) as Entry;
    if (!e || e.who !== w || typeof e.at !== "number" || Date.now() - e.at > MAX_AGE_MS) return null;
    return e;
  } catch {
    return null;
  }
}

function save(e: Entry): void {
  mem = e;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(e)); } catch { /* приватный режим / нет места */ }
}

/** последние известные данные (мгновенно, без сети) */
export function peekReferral(): ReferralData | null {
  const w = who();
  if (mem && mem.who === w) return mem.data;
  const e = readStore(w);
  if (e) mem = e;
  return e ? e.data : null;
}

/** данные с сервера; одновременные вызовы делят один запрос. force — не брать свежий кэш */
export function loadReferral(force = false): Promise<ReferralData> {
  const w = who();
  if (!force && mem && mem.who === w && Date.now() - mem.at < FRESH_MS) return Promise.resolve(mem.data);
  if (inflight && inflight.who === w) return inflight.p;
  const p = appFetch<ReferralData>("/referral")
    .then((data) => { save({ who: w, at: Date.now(), data }); return data; })
    .finally(() => { if (inflight?.p === p) inflight = null; });
  inflight = { who: w, p };
  return p;
}

/** подогреть заранее (главная, нажатие на плитку) */
export function prefetchReferral(): void {
  void loadReferral().catch(() => { /* экран сам повторит */ });
}

/** локально поправить кэш (после вывода средств и т.п.) */
export function patchReferral(patch: Partial<ReferralData>): void {
  const w = who();
  if (mem && mem.who === w) save({ ...mem, data: { ...mem.data, ...patch } });
}
