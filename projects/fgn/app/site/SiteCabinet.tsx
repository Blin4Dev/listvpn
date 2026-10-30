// FGN сайт: личный кабинет.
// /cabinet — главная; /cabinet/subscription — подписка и действия; /cabinet/link — ссылка подписки и локации;
// /cabinet/key — как вставить ключ; /cabinet/devices — устройства; /cabinet/devices/buy — докупить; /cabinet/family — семья.
import React, { useEffect, useMemo, useState } from "react";
import {
  activateTrial, appFetch, fetchAppLink, fetchQuote, fetchTraffic, formatBytesRu, logout, revokeDevice,
  type AppUser, type SubKey, type TrafficInfo,
} from "../utils/api";
import { formatDateRu, formatWhenRu } from "../utils/date";
import { deviceWord } from "../utils/devices";
import { loadReferral, peekReferral } from "../utils/referral";
import { DEVICE_TITLE, type DeviceKind } from "../utils/apps";
import { C } from "../components/fgn";
import { DEVICES, DEVICE_NOTE, DeviceIcon, SetupDialog } from "./SiteDownload";
import {
  CabTop, Ic, Loader, Modal, Note, Tile, daysUntil, daysWord, errText, isAuthErr, periodTitle, plural, rub, subBadge, useCopied, useLoad,
  type CabNav,
} from "./siteKit";

type Desktop = { windows_url?: string; macos_url?: string; version?: string };

export type SubInfo = {
  status?: string;
  until?: string | null;
  key?: SubKey | null;
  trial_available?: boolean;
  family?: { role: string; owner_name?: string } | null;
};
type Device = { id: string; name: string; platform?: string | null; last_seen?: string | null };
type DevicesInfo = {
  devices: Device[];
  used: number;
  limit: number;
  can_buy: boolean;
  extra_device_price?: number;
  device_prices?: number[];
  addon_months?: number[];
};
type FamilyMember = { id: number; name: string; status: "active" | "pending" };
type FamilyState = {
  role: "none" | "owner" | "member";
  code?: string | null;
  members: FamilyMember[];
  can_invite: boolean;
  max_members: number;
  owner_name?: string | null;
};

// локации в подписке (пока статично, как в макете)
const LOCATIONS = [
  { flag: "🇩🇪", name: "Германия" },
  { flag: "🇫🇮", name: "Финляндия" },
  { flag: "🇳🇱", name: "Нидерланды" },
];
const MAX_DEVICES = 20;

export const CABINET_CSS = `
.fs-home-card { margin-top: 56px; }
.fs-home-card .hd { display: flex; align-items: center; gap: 12px; }
.fs-home-card .hd h3 { flex: 1; }
.fs-home-facts { margin: 22px 0 24px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.fs-home-facts span { display: block; font-size: 14px; color: rgba(196,196,206,.62); }
.fs-home-facts b { display: block; margin-top: 8px; font-size: 16px; font-weight: 500; }
.fs-home-btns { display: flex; gap: 10px; }
.fs-home-btns .fs-cbtn { flex: 1; }
.fs-home-ref { margin-top: 16px; display: flex; align-items: center; gap: 20px; border-left: 3px solid ${C.green}; }
.fs-home-ref > div { flex: 1; min-width: 0; }
.fs-home-ref .k { font-size: 12.5px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: ${C.green}; }
.fs-home-ref .big { margin-top: 8px; font-size: 40px; line-height: 1.05; font-weight: 800; letter-spacing: -.015em; }
.fs-home-ref .big em { font-style: normal; color: ${C.green}; }
.fs-home-ref .s { margin-top: 8px; font-size: 14px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: rgba(196,196,206,.6); }
.fs-home-tiles { margin-top: 16px; }
.fs-home-out { margin-top: 40px; text-align: center; }
.fs-home-out .fs-cab-link { font-size: 16px; }

.fs-sub-stats { margin-top: 24px; }
.fs-sub-stats .fs-cab-card { min-height: 228px; display: flex; flex-direction: column; }
.fs-sub-big { margin-top: 24px; display: flex; align-items: baseline; gap: 10px; }
.fs-sub-big b { font-size: 64px; line-height: 1; font-weight: 800; letter-spacing: -.03em; }
.fs-sub-big b.md { font-size: 40px; letter-spacing: -.02em; }
.fs-sub-big span { font-size: 26px; font-weight: 800; }
.fs-sub-foot { margin-top: auto; padding-top: 18px; font-size: 15px; color: rgba(196,196,206,.75); }
.fs-sub-traf { margin-top: 12px; }

.fs-link-box { margin-top: 18px; padding: 16px; border-radius: 14px; border: 1px solid rgba(255,255,255,.08); background: #0E0F10; font-size: 14.5px;
  line-height: 1.5; word-break: break-all; user-select: all; color: rgba(236,236,240,.92); min-height: 54px; box-sizing: border-box; }
.fs-link-btns { margin-top: 16px; display: flex; gap: 10px; flex-wrap: wrap; }
.fs-link-btns .fs-cbtn { flex: 1; min-width: 180px; }
.fs-link-until { font-size: 22px; font-weight: 700; }
.fs-howto > div { display: flex; gap: 14px; padding: 16px 0; }
.fs-howto > div + div { border-top: 1px solid rgba(255,255,255,.07); }
.fs-howto i { width: 28px; height: 28px; flex-shrink: 0; border-radius: 9px; background: #222326; font-style: normal; font-size: 14px; font-weight: 700;
  display: flex; align-items: center; justify-content: center; }
.fs-howto b { display: block; font-size: 16px; font-weight: 600; line-height: 22px; }
.fs-howto span { display: block; margin-top: 4px; font-size: 14px; line-height: 1.5; color: rgba(196,196,206,.68); }
.fs-locs { margin-top: 14px; display: flex; flex-wrap: wrap; gap: 8px; }
.fs-locs span { height: 38px; padding: 0 14px; border-radius: 19px; border: 1px solid rgba(255,255,255,.1); background: #0E0F10; display: inline-flex;
  align-items: center; gap: 8px; font-size: 14.5px; }
.fs-key-step { min-height: 170px; }
.fs-key-step i { width: 34px; height: 34px; border-radius: 10px; background: #222326; font-style: normal; font-size: 15px; font-weight: 700;
  display: flex; align-items: center; justify-content: center; }
.fs-key-step b { display: block; margin-top: 26px; font-size: 19px; font-weight: 700; line-height: 1.3; }
.fs-key-step span { display: block; margin-top: 8px; font-size: 14.5px; line-height: 1.55; color: rgba(196,196,206,.7); }
.fs-key-copy { margin-top: 16px; display: flex; align-items: center; gap: 20px; }
.fs-key-copy > div { flex: 1; min-width: 0; }

.fs-pick { margin-top: 16px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.fs-pick button { min-height: 104px; padding: 14px 10px; border-radius: 16px; border: 1px solid #2A2A30; background: #070708; color: #F4F4F5; cursor: pointer;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; font: 500 14.5px ${C.font}; transition: border-color .15s; }
.fs-pick button:hover { border-color: rgba(255,255,255,.22); }

.fs-dev { display: flex; align-items: center; gap: 14px; }
.fs-dev .ic { width: 46px; height: 46px; flex-shrink: 0; border-radius: 12px; background: #222326; display: flex; align-items: center; justify-content: center; }
.fs-dev > div { flex: 1; min-width: 0; }
.fs-dev b { display: block; font-size: 16.5px; font-weight: 600; line-height: 22px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fs-dev small { display: block; margin-top: 4px; font-size: 13.5px; color: rgba(196,196,206,.62); }
.fs-dev-add { margin-top: 20px; display: flex; gap: 10px; flex-wrap: wrap; }

.fs-buy-step { display: flex; align-items: center; gap: 16px; }
.fs-buy-step > div:first-child { flex: 1; min-width: 0; }
.fs-buy-step b { display: block; font-size: 18px; font-weight: 600; }
.fs-buy-step span { display: block; margin-top: 6px; font-size: 14px; color: rgba(196,196,206,.62); }
.fs-stepper { display: flex; align-items: center; flex-shrink: 0; }
.fs-stepper button { width: 42px; height: 42px; border-radius: 13px; background: #0E0E10; border: 1px solid rgba(255,255,255,.16); color: #fff;
  display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; }
.fs-stepper button:disabled { color: rgba(255,255,255,.28); border-color: rgba(255,255,255,.06); cursor: default; }
.fs-stepper i { width: 50px; text-align: center; font-style: normal; font-size: 21px; font-weight: 700; font-variant-numeric: tabular-nums; }
.fs-per { width: 100%; text-align: left; padding: 20px; border-radius: 16px; border: 1px solid rgba(255,255,255,.07); background: #18191B; color: #fff;
  font: inherit; cursor: pointer; transition: border-color .15s; }
.fs-per:hover { border-color: rgba(255,255,255,.18); }
.fs-per.on { border: 2px solid ${C.green}; padding: 19px; background: #121614; }
.fs-per b { display: block; font-size: 17px; font-weight: 600; }
.fs-per strong { display: block; margin-top: 14px; font-size: 24px; font-weight: 800; font-variant-numeric: tabular-nums; }
.fs-per.on strong { color: ${C.green}; }
.fs-per small { display: block; margin-top: 4px; font-size: 13px; color: rgba(196,196,206,.6); }
.fs-sum .fs-cab-lines { margin-top: 6px; }
.fs-sum .tot { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding-top: 16px; margin-top: 4px;
  border-top: 1px solid rgba(255,255,255,.07); }
.fs-sum .tot span { font-size: 15.5px; color: rgba(196,196,206,.75); }
.fs-sum .tot b { font-size: 28px; font-weight: 800; }
.fs-sum .tot s { margin-right: 8px; font-size: 15px; font-weight: 500; color: rgba(196,196,206,.5); }
.fs-sum .fs-cbtn { margin-top: 20px; }
.fs-sum p { margin: 12px 0 0; font-size: 13px; line-height: 1.5; color: rgba(196,196,206,.58); }

.fs-fam-member { display: flex; align-items: center; gap: 14px; padding: 16px 18px; }
.fs-fam-member > div { flex: 1; min-width: 0; }
.fs-fam-member b { display: block; font-size: 16px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fs-fam-member small { display: block; margin-top: 3px; font-size: 13.5px; color: rgba(196,196,206,.62); }
.fs-fam-member small.g { color: ${C.green}; }
.fs-fam-list { margin-top: 12px; display: flex; flex-direction: column; gap: 10px; }
.fs-fam-code { margin-top: 10px; font-size: 34px; font-weight: 800; letter-spacing: .04em; }
.fs-fam-share p { margin: 12px 0 0; font-size: 14px; line-height: 1.55; color: rgba(196,196,206,.7); }
.fs-fam-share .fs-cbtn { margin-top: 10px; }
.fs-fam-share .fs-cbtn:first-of-type { margin-top: 20px; }

@media (max-width: 860px) {
  .fs-home-card { margin-top: 36px; }
  .fs-home-facts { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .fs-home-ref { flex-direction: column; align-items: stretch; gap: 16px; }
  .fs-home-ref .big { font-size: 32px; }
  .fs-sub-stats .fs-cab-card { min-height: 0; }
  .fs-sub-big b { font-size: 52px; }
  .fs-home-btns { flex-direction: column; }
  .fs-key-step { min-height: 0; }
  .fs-key-step b { margin-top: 16px; }
  .fs-key-copy { flex-direction: column; align-items: stretch; gap: 14px; }
  .fs-fam-code { font-size: 28px; }
}
@media (max-width: 560px) {
  .fs-pick { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .fs-buy-step { flex-direction: column; align-items: flex-start; }
}
`;

// ───────────────────────── главная кабинета ─────────────────────────
function userName(u: AppUser | null): string {
  if (!u) return "";
  const x = u as AppUser & { first_name?: string | null };
  const n = (x.first_name || "").trim() || (u.username || "").trim() || (u.email || "").split("@")[0] || "";
  return n;
}

function Home({ nav }: { nav: CabNav }) {
  const me = useLoad(async () => (await appFetch<{ user: AppUser }>("/me")).user, nav);
  const sub = useLoad(() => appFetch<SubInfo>("/subscription"), nav);
  const [maxRate, setMaxRate] = useState(() => maxRefRate(peekReferral()?.levels));
  const [leave, setLeave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    loadReferral().then((r) => setMaxRate(maxRefRate(r.levels))).catch(() => { /* по умолчанию 50% */ });
  }, []);

  if (!sub.data && !sub.err) return <Loader />;
  const s = sub.data || {};
  const member = s.family?.role === "member";
  const live = s.status === "active" || s.status === "trial";
  const badge = subBadge(s.status);
  const until = s.until || s.key?.expiry_date || null;
  const left = s.key?.days_left ?? daysUntil(until);
  const name = userName(me.data);

  const trial = async () => {
    setBusy(true);
    setMsg(null);
    const r = await activateTrial();
    setBusy(false);
    if (r.success) {
      setMsg({ kind: "ok", text: "Пробная подписка активирована" });
      void sub.reload();
    } else setMsg({ kind: "err", text: r.message || "Не удалось активировать пробный период" });
  };

  const doLeave = async () => {
    setBusy(true);
    try {
      await appFetch("/family/leave", { method: "POST" });
      setLeave(false);
      setMsg({ kind: "ok", text: "Вы вышли из семьи" });
      void sub.reload();
    } catch (e) {
      if (isAuthErr(e)) nav.expired();
      else setMsg({ kind: "err", text: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await logout();
    nav.go("/");
    nav.expired();
  };

  return (
    <div className="fs-cab-in">
      <div className="fs-cab-hello">
        <div className="fs-cab-eyebrow">Личный кабинет</div>
        <h1>{name ? `Здравствуйте, ${name}` : "Здравствуйте"}</h1>
        <p className="fs-cab-lead">Управление подпиской и данные аккаунта.</p>
      </div>

      <div className="fs-cab-card fs-home-card">
        <div className="hd">
          <h3>{member ? "Семейная подписка" : "Подписка"}</h3>
          <span className={`fs-badge sm ${badge.tone}`}>{badge.text}</span>
        </div>
        <div className="fs-home-facts">
          <div>
            <span>Тариф</span>
            <b>{member ? "Семейная" : s.status === "trial" ? "Пробная" : live ? "FGN · VPN + обход" : "—"}</b>
          </div>
          <div>
            <span>Оплачено до</span>
            <b>{live && until ? formatDateRu(until) : "—"}</b>
          </div>
          <div>
            <span>{member ? "Владелец" : "Осталось"}</span>
            <b>{member ? s.family?.owner_name || "—" : live && left != null ? `${left} ${daysWord(left)}` : "—"}</b>
          </div>
        </div>
        {sub.err ? <Note kind="err">{sub.err}</Note> : null}
        {live ? (
          <button type="button" className="fs-cbtn block" onClick={() => nav.go("/cabinet/subscription")}>
            Управление подпиской
          </button>
        ) : (
          <div className="fs-home-btns">
            <button type="button" className="fs-cbtn" onClick={() => nav.go("/tariffs")}>
              {s.status === "expired" ? "Продлить подписку" : "Оформить подписку"}
            </button>
            {s.trial_available ? (
              <button type="button" className="fs-cbtn dark" disabled={busy} onClick={trial}>
                {busy ? "Активируем…" : "Попробовать бесплатно"}
              </button>
            ) : null}
          </div>
        )}
        {msg ? <Note kind={msg.kind}>{msg.text}</Note> : null}
      </div>

      <div className="fs-cab-card fs-home-ref">
        <div>
          <div className="k">Реферальная программа</div>
          <div className="big">
            До <em>{maxRate}%</em>
          </div>
          <div className="s">с приведённых рефералов</div>
        </div>
        <button type="button" className="fs-cbtn sm" onClick={() => nav.go("/cabinet/referral")}>
          Смотреть
        </button>
      </div>

      <div className="fs-cab-grid c2 fs-home-tiles">
        <Tile icon={Ic.gift()} title="Подарки" sub="Активировать, купить или посмотреть свои" onClick={() => nav.go("/cabinet/gifts")} />
        {member ? (
          <Tile icon={Ic.userPlus()} title="Выйти из семьи" sub="Семейная подписка отключится" onClick={() => setLeave(true)} />
        ) : (
          <Tile icon={Ic.users()} title="Семья" sub="Подключите близких к своей подписке" onClick={() => nav.go("/cabinet/family")} />
        )}
      </div>

      <div className="fs-home-out">
        <button type="button" className="fs-cab-link" onClick={signOut}>
          Выйти из аккаунта
        </button>
      </div>

      {leave ? (
        <Modal title="Выйти из семьи?" onClose={() => setLeave(false)} busy={busy}>
          <div className="fs-sheet-hint">
            Подписка {s.family?.owner_name ? `владельца ${s.family.owner_name}` : "владельца"} перестанет действовать на ваших устройствах.
            Вернуться можно по новому коду приглашения.
          </div>
          <button type="button" className="fs-cbtn block" style={{ marginTop: 18 }} disabled={busy} onClick={doLeave}>
            {busy ? "Выходим…" : "Выйти из семьи"}
          </button>
          <button type="button" className="fs-cbtn dark block" style={{ marginTop: 8 }} disabled={busy} onClick={() => setLeave(false)}>
            Остаться
          </button>
        </Modal>
      ) : null}
    </div>
  );
}

function maxRefRate(levels?: { rate: number }[]): number {
  const m = Math.max(0, ...(levels || []).map((l) => Number(l.rate) || 0));
  return m > 0 ? Math.round(m) : 50;
}

// ───────────────────────── подписка ─────────────────────────
function Subscription({ nav }: { nav: CabNav }) {
  const sub = useLoad(() => appFetch<SubInfo>("/subscription"), nav);
  const dev = useLoad(() => appFetch<DevicesInfo>("/devices"), nav);
  const [traf, setTraf] = useState<TrafficInfo | null>(null);
  useEffect(() => {
    void fetchTraffic().then(setTraf);
  }, []);

  if (!sub.data && !sub.err) return <Loader />;
  const s = sub.data || {};
  const live = s.status === "active" || s.status === "trial";
  const member = s.family?.role === "member";
  const badge = subBadge(s.status);
  const until = s.until || s.key?.expiry_date || null;
  const left = live ? s.key?.days_left ?? daysUntil(until) ?? 0 : 0;
  const d = dev.data;
  const limit = d?.limit ?? s.key?.devices_limit ?? 0;
  const used = d?.used ?? 0;
  const free = Math.max(0, limit - used);
  const tLimit = traf?.available ? Number(traf.limit_bytes || 0) : 0;

  return (
    <div className="fs-cab-in">
      <CabTop title="Подписка" onBack={() => nav.go("/cabinet")} right={<span className={`fs-badge ${badge.tone}`}>{badge.text}</span>} />
      {sub.err ? <Note kind="err">{sub.err}</Note> : null}

      <div className="fs-cab-grid c3 fs-sub-stats">
        <div className="fs-cab-card">
          <div className="fs-cab-k">Осталось</div>
          <div className="fs-sub-big">
            <b>{left}</b>
            <span>{daysWord(left)}</span>
          </div>
          <div className="fs-sub-foot">{live && until ? `до ${formatDateRu(until)} г.` : "Подписка не оформлена"}</div>
        </div>
        <div className="fs-cab-card">
          <div className="fs-cab-k">Устройства</div>
          <div className="fs-sub-big">
            <b className="md">{d ? `${used} из ${limit}` : "…"}</b>
          </div>
          <div className="fs-cab-muted" style={{ marginTop: 6 }}>свободно {free}</div>
          <div className="fs-cab-muted" style={{ marginTop: 10 }}>
            {limit} {deviceWord(limit)} {plural(limit, "входит", "входят", "входят")} в подписку.
            {d?.can_buy ? " Дальше можно докупить." : ""}
          </div>
        </div>
        <div className="fs-cab-card">
          <div className="fs-cab-k">Трафик</div>
          <div className="fs-cab-lines fs-sub-traf">
            <div>
              <span>Основной</span>
              <b>{tLimit > 0 ? `${formatBytesRu(Number(traf?.used_bytes || 0))} из ${formatBytesRu(tLimit)}` : "без лимита"}</b>
            </div>
            <div>
              <span>Белые списки</span>
              <b>{live ? "включены" : "—"}</b>
            </div>
          </div>
        </div>
      </div>

      <div className="fs-cab-label">Действия</div>
      <div className="fs-cab-grid c3">
        <Tile tone="red" icon={Ic.download()} title="Добавить подписку" onClick={() => nav.go("/cabinet/link")} />
        {member ? (
          <Tile tone="green" icon={Ic.users()} title="Семейная подписка" sub={s.family?.owner_name ? `Владелец: ${s.family.owner_name}` : undefined} onClick={() => nav.go("/cabinet/family")} />
        ) : (
          <Tile tone="green" icon={Ic.bag()} title={live ? "Продлить подписку" : "Купить подписку"} onClick={() => nav.go("/tariffs")} />
        )}
        <Tile tone="yellow" icon={Ic.users()} title={member ? "Моя семья" : "Добавить в семью"} onClick={() => nav.go("/cabinet/family")} />
      </div>
      <div className="fs-cab-grid c2">
        <Tile
          icon={Ic.phone()}
          title="Купить устройства"
          sub={d && !d.can_buy ? (member ? "Докупает владелец подписки" : "Доступно с платной подпиской") : undefined}
          disabled={!!d && !d.can_buy}
          onClick={() => nav.go("/cabinet/devices/buy")}
        />
        <Tile icon={Ic.monitor()} title="Управление устройствами" sub={d ? `${used} подключено` : undefined} onClick={() => nav.go("/cabinet/devices")} />
      </div>
    </div>
  );
}

// ───────────────────────── ссылка подписки ─────────────────────────
function useSubLink(nav: CabNav) {
  const [link, setLink] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => {
    fetchAppLink("other")
      .then((r) => setLink(r.link || ""))
      .catch((e) => {
        if (isAuthErr(e)) nav.expired();
        else setErr(errText(e, "Нет активной подписки — оформите её на странице «Тарифы»"));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { link, err };
}

function DevicePicker({ desktop, onClose }: { desktop: Desktop; onClose: () => void }) {
  const [dev, setDev] = useState<DeviceKind | null>(null);
  const fgnUrl = (d: DeviceKind) => ((d === "windows" ? desktop.windows_url : d === "macos" ? desktop.macos_url : "") || "").trim();
  if (dev) return <SetupDialog device={dev} fgnUrl={fgnUrl(dev)} authed onLogin={onClose} onClose={onClose} />;
  return (
    <Modal title="Куда добавить" onClose={onClose}>
      <div className="fs-sheet-hint">На каком устройстве будете пользоваться?</div>
      <div className="fs-pick">
        {DEVICES.map((d) => (
          <button key={d} type="button" title={DEVICE_NOTE[d]} onClick={() => setDev(d)}>
            <DeviceIcon d={d} />
            {DEVICE_TITLE[d]}
          </button>
        ))}
      </div>
    </Modal>
  );
}

function SubLink({ nav, desktop }: { nav: CabNav; desktop: Desktop }) {
  const sub = useLoad(() => appFetch<SubInfo>("/subscription"), nav);
  const { link, err } = useSubLink(nav);
  const [copied, copy] = useCopied();
  const [pick, setPick] = useState(false);
  const s = sub.data || {};
  const live = s.status === "active" || s.status === "trial";
  const until = s.until || s.key?.expiry_date || null;
  const left = live ? s.key?.days_left ?? daysUntil(until) : null;

  return (
    <div className="fs-cab-in">
      <CabTop
        title="Подписка"
        onBack={() => nav.go("/cabinet/subscription")}
        right={left != null ? <span className="fs-badge">{left} {daysWord(left)}</span> : undefined}
      />
      <div className="fs-cab-split wide" style={{ marginTop: 24 }}>
        <div className="fs-cab-card">
          <div className="fs-cab-k">Ссылка подписки</div>
          <div className="fs-link-until" style={{ marginTop: 14 }}>{live && until ? `до ${formatDateRu(until)} г.` : sub.data ? "Подписка не активна" : "…"}</div>
          {err ? (
            <>
              <Note kind="info">{err}</Note>
              <div className="fs-link-btns">
                <button type="button" className="fs-cbtn" onClick={() => nav.go("/tariffs")}>Выбрать тариф</button>
              </div>
            </>
          ) : (
            <>
              <div className="fs-link-box">{link || "Загружаем ссылку…"}</div>
              <div className="fs-link-btns">
                <button type="button" className="fs-cbtn" disabled={!link} onClick={() => copy(link)}>
                  {copied ? Ic.check(18) : Ic.copy()}
                  {copied ? "Скопировано" : "Скопировать"}
                </button>
                <button type="button" className="fs-cbtn dark" disabled={!link} onClick={() => setPick(true)}>
                  Добавить на устройство
                </button>
              </div>
              <p className="fs-cab-muted" style={{ margin: "14px 0 0" }}>
                Не передавайте ссылку другим: по ней подключаются ваши устройства.
              </p>
            </>
          )}
        </div>

        <div className="fs-cab-card">
          <div className="fs-cab-k">Как вставить</div>
          <div className="fs-howto" style={{ marginTop: 4 }}>
            <div>
              <i>1</i>
              <div><b>Откройте хаб</b><span>Happ, Hiddify, Streisand или v2rayNG.</span></div>
            </div>
            <div>
              <i>2</i>
              <div><b>Добавьте подписку</b><span>Пункт «Добавить из буфера» или вставка ссылки.</span></div>
            </div>
            <div>
              <i>3</i>
              <div><b>Вставьте ссылку</b><span>Дальше соединение включается уже в хабе.</span></div>
            </div>
          </div>
          <button type="button" className="fs-cab-link g" style={{ fontSize: 14.5 }} onClick={() => nav.go("/cabinet/key")}>
            Подробная инструкция →
          </button>
          <div className="fs-cab-k" style={{ marginTop: 26 }}>Локации в подписке</div>
          <div className="fs-locs">
            {LOCATIONS.map((l) => (
              <span key={l.name}>{l.flag} {l.name}</span>
            ))}
          </div>
        </div>
      </div>
      {pick ? <DevicePicker desktop={desktop} onClose={() => setPick(false)} /> : null}
    </div>
  );
}

// ───────────────────────── как вставить ключ ─────────────────────────
const KEY_STEPS = [
  { t: "Откройте приложение", s: "Happ, Hiddify, Streisand, v2rayNG или другое." },
  { t: "Найдите «Добавить подписку»", s: "Обычно в меню или по кнопке плюс." },
  { t: "Вставьте ссылку", s: "Скопируйте её в разделе «Ссылка» и вставьте в приложение." },
  { t: "Включите", s: "Выберите локацию и подключитесь уже там." },
];

function KeyHelp({ nav }: { nav: CabNav }) {
  const { link, err } = useSubLink(nav);
  const [copied, copy] = useCopied();
  return (
    <div className="fs-cab-in">
      <CabTop title="Как вставить ключ" onBack={() => nav.go("/cabinet/link")} />
      <div className="fs-cab-grid c2" style={{ marginTop: 24 }}>
        {KEY_STEPS.map((k, i) => (
          <div key={k.t} className="fs-cab-card fs-key-step">
            <i>{i + 1}</i>
            <b>{k.t}</b>
            <span>{k.s}</span>
          </div>
        ))}
      </div>
      <div className="fs-cab-card fs-key-copy">
        <div>
          <h3>Скопируйте ссылку</h3>
          <div className="fs-cab-muted" style={{ marginTop: 6 }}>
            {err || "Ссылка подписки — одна для всех ваших устройств."}
          </div>
        </div>
        {err ? (
          <button type="button" className="fs-cbtn" onClick={() => nav.go("/tariffs")}>Выбрать тариф</button>
        ) : (
          <button type="button" className="fs-cbtn" disabled={!link} onClick={() => copy(link)}>
            {copied ? Ic.check(18) : Ic.copy()}
            {copied ? "Скопировано" : "Скопировать ссылку"}
          </button>
        )}
      </div>
    </div>
  );
}

// ───────────────────────── устройства ─────────────────────────
function deviceKind(p?: string | null): string {
  const x = (p || "").toLowerCase();
  if (/ios|iphone|android/.test(x)) return "Телефон";
  if (/ipad|tablet/.test(x)) return "Планшет";
  if (/windows|mac|darwin|linux/.test(x)) return "Компьютер";
  if (/tv/.test(x)) return "Телевизор";
  return p || "Устройство";
}

function Devices({ nav }: { nav: CabNav }) {
  const dev = useLoad(() => appFetch<DevicesInfo>("/devices"), nav);
  const sub = useLoad(() => appFetch<SubInfo>("/subscription"), nav);
  const [busy, setBusy] = useState("");
  const [ask, setAsk] = useState<Device | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  if (!dev.data && !dev.err) return <Loader />;
  const d = dev.data;
  const member = sub.data?.family?.role === "member";
  const used = d?.used ?? 0;
  const limit = d?.limit ?? 0;

  const revoke = async (x: Device) => {
    setBusy(x.id);
    setMsg(null);
    const ok = await revokeDevice(x.id);
    setBusy("");
    setAsk(null);
    if (ok) {
      setMsg({ kind: "ok", text: `«${x.name}» отвязано` });
      void dev.reload();
    } else setMsg({ kind: "err", text: "Не удалось отвязать устройство. Попробуйте позже." });
  };

  return (
    <div className="fs-cab-in">
      <CabTop
        title="Устройства"
        onBack={() => nav.go("/cabinet/subscription")}
        sub={d ? `Подключено ${used} из ${limit}, свободно ${Math.max(0, limit - used)}.${member ? " Отвязывает устройства владелец семьи." : ""}` : undefined}
      />
      {dev.err ? <Note kind="err">{dev.err}</Note> : null}
      {msg ? <Note kind={msg.kind}>{msg.text}</Note> : null}
      {d && d.devices.length === 0 ? (
        <div className="fs-cab-card fs-cab-empty" style={{ marginTop: 24 }}>
          Устройств пока нет. Они появятся здесь после первого подключения.
        </div>
      ) : (
        <div className="fs-cab-grid c2" style={{ marginTop: 24 }}>
          {(d?.devices || []).map((x) => (
            <div key={x.id} className="fs-cab-card fs-dev">
              <span className="ic">{/ios|iphone|android/i.test(x.platform || "") ? Ic.phone() : Ic.monitor()}</span>
              <div>
                <b title={x.name}>{x.name}</b>
                <small>
                  {deviceKind(x.platform)}
                  {x.last_seen ? ` · ${formatWhenRu(x.last_seen)}` : ""}
                </small>
              </div>
              {!member ? (
                <button type="button" className="fs-cbtn danger" disabled={!!busy} onClick={() => setAsk(x)}>
                  {busy === x.id ? "…" : "Отвязать"}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
      <div className="fs-dev-add">
        {d?.can_buy ? (
          <button type="button" className="fs-cbtn" onClick={() => nav.go("/cabinet/devices/buy")}>
            {Ic.plus()}
            Добавить слот
          </button>
        ) : null}
        <button type="button" className="fs-cbtn dark" onClick={() => nav.go("/cabinet/link")}>
          Подключить устройство
        </button>
      </div>
      {ask ? (
        <Modal title="Отвязать устройство?" onClose={() => setAsk(null)} busy={!!busy}>
          <div className="fs-sheet-hint">
            «{ask.name}» отключится от VPN и освободит место. Чтобы вернуть его, снова добавьте подписку в приложении.
          </div>
          <button type="button" className="fs-cbtn block" style={{ marginTop: 18 }} disabled={!!busy} onClick={() => revoke(ask)}>
            {busy ? "Отвязываем…" : "Отвязать"}
          </button>
          <button type="button" className="fs-cbtn dark block" style={{ marginTop: 8 }} disabled={!!busy} onClick={() => setAsk(null)}>
            Отмена
          </button>
        </Modal>
      ) : null}
    </div>
  );
}

// ───────────────────────── докупить устройства ─────────────────────────
function DevicesBuy({ nav }: { nav: CabNav }) {
  const dev = useLoad(() => appFetch<DevicesInfo>("/devices"), nav);
  const sub = useLoad(() => appFetch<SubInfo>("/subscription"), nav);
  const [add, setAdd] = useState(1);
  const [months, setMonths] = useState(1);
  const [quote, setQuote] = useState<{ price: number; full: number; discount: number } | null>(null);

  const d = dev.data;
  const s = sub.data;
  const current = Math.max(1, Number(d?.limit || s?.key?.devices_limit || 1));
  const base = Number(d?.extra_device_price || 49);
  const table = (d?.device_prices || []).map(Number);
  const periods = d?.addon_months?.length ? d.addon_months : [1, 3, 6, 12];
  const subId = s?.key?.id ? Number(s.key.id) : null;
  const isTrial = s?.key?.type === "trial" || s?.status === "trial";
  const maxAdd = Math.max(0, MAX_DEVICES - current);
  const count = Math.min(Math.max(1, add), Math.max(1, maxAdd));
  const priceOf = (n: number) => (table.length ? Number(table[Math.min(n, table.length) - 1] ?? base) : base);
  const perMonth = useMemo(() => {
    let x = 0;
    for (let n = current + 1; n <= current + count; n++) x += priceOf(n);
    return x;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, count, table.join(","), base]);
  const nextPrice = Math.round(priceOf(current + 1));
  const flat = perMonth === nextPrice * count;
  const ready = !!d && !!s;
  const blocked = ready && (!d!.can_buy || isTrial || maxAdd <= 0);

  useEffect(() => {
    if (!ready || blocked) return;
    let alive = true;
    setQuote(null);
    const t = window.setTimeout(() => {
      void fetchQuote({ plan_devices: 1, months, method: "sbp", extra_devices: count, purpose: "devices", subscription_id: subId, use_referral_balance: false })
        .then((q) => {
          if (alive) setQuote(q ? { price: Math.round(q.price), full: Math.round(q.full_price ?? q.price), discount: Number(q.discount_percent || 0) } : null);
        });
    }, 180);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [ready, blocked, months, count, subId]);

  if (!ready && !dev.err && !sub.err) return <Loader />;
  const total = quote ? quote.price : perMonth * months;
  const disc = !!quote && quote.discount > 0 && quote.full > quote.price;
  const pay = () => nav.go(`/checkout?type=devices&count=${count}&months=${months}${subId ? `&sub=${subId}` : ""}`);

  return (
    <div className="fs-cab-in">
      <CabTop
        title="Добавить устройства"
        onBack={() => nav.go("/cabinet/subscription")}
        sub={`Сейчас ${current} ${deviceWord(current)}. Одно дополнительное устройство стоит ${rub(nextPrice)} в месяц.`}
      />
      {dev.err || sub.err ? <Note kind="err">{dev.err || sub.err}</Note> : null}
      {blocked ? (
        <Note kind="info">
          {isTrial
            ? "В пробной подписке докупать устройства нельзя. Оформите подписку — и сможете добавить сколько нужно."
            : maxAdd <= 0
              ? `Достигнут максимум — ${MAX_DEVICES} устройств.`
              : s?.family?.role === "member"
                ? "Устройства докупает владелец семейной подписки."
                : "Докупить устройства можно к активной платной подписке."}
        </Note>
      ) : null}

      <div className="fs-cab-split wide" style={{ marginTop: 24 }}>
        <div>
          <div className="fs-cab-card fs-buy-step">
            <div>
              <b>Сколько добавить</b>
              <span>Будет {current + count} {deviceWord(current + count)}</span>
            </div>
            <div className="fs-stepper">
              <button type="button" aria-label="Меньше" disabled={count <= 1 || blocked} onClick={() => setAdd(count - 1)}>{Ic.minus()}</button>
              <i>{count}</i>
              <button type="button" aria-label="Больше" disabled={count >= maxAdd || blocked} onClick={() => setAdd(count + 1)}>{Ic.plus()}</button>
            </div>
          </div>
          <div className="fs-cab-label">Срок</div>
          <div className="fs-cab-grid c2">
            {periods.map((m) => (
              <button key={m} type="button" className={`fs-per${m === months ? " on" : ""}`} disabled={blocked} onClick={() => setMonths(m)}>
                <b>{periodTitle(m)}</b>
                <strong>{rub(perMonth * m)}</strong>
                <small>{rub(perMonth)} в месяц</small>
              </button>
            ))}
          </div>
        </div>

        <div className="fs-cab-card fs-sum">
          <h3>Итого</h3>
          <div className="fs-cab-lines">
            <div><span>Устройства</span><b>+{count}</b></div>
            <div><span>Срок</span><b>{periodTitle(months)}</b></div>
            <div><span>Расчёт</span><b>{flat ? `${rub(nextPrice)} × ${count} × ${months}` : `${rub(perMonth)} × ${months}`}</b></div>
            {disc ? <div><span>Скидка</span><b>−{Math.round(quote!.discount)}%</b></div> : null}
          </div>
          <div className="tot">
            <span>К оплате</span>
            <b>{disc ? <s>{rub(quote!.full)}</s> : null}{rub(total)}</b>
          </div>
          <button type="button" className="fs-cbtn block" disabled={blocked || !ready} onClick={pay}>
            Оплатить {rub(total)}
          </button>
          <p>Устройства добавятся сразу после оплаты на {periodTitle(months)}, но не дольше срока подписки.</p>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── семья ─────────────────────────
function Family({ nav }: { nav: CabNav }) {
  const fam = useLoad(() => appFetch<FamilyState>("/family"), nav);
  const [query, setQuery] = useState("");
  const [join, setJoin] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [copied, copy] = useCopied();

  if (!fam.data && !fam.err) return <Loader />;
  const f = fam.data;

  const run = async (key: string, fn: () => Promise<FamilyState | null>, ok?: string) => {
    setBusy(key);
    setMsg(null);
    try {
      const r = await fn();
      if (r) fam.setData(r);
      if (ok) setMsg({ kind: "ok", text: ok });
      return true;
    } catch (e) {
      if (isAuthErr(e)) nav.expired();
      else setMsg({ kind: "err", text: errText(e) });
      return false;
    } finally {
      setBusy("");
    }
  };

  const invite = async () => {
    const q = query.trim();
    if (!q) return;
    if (await run("add", () => appFetch<FamilyState>("/family/members", { method: "POST", body: JSON.stringify({ query: q }) }), "Приглашение отправлено")) setQuery("");
  };
  const remove = (m: FamilyMember) =>
    run(`del${m.id}`, () => appFetch<FamilyState>(`/family/members/${m.id}`, { method: "DELETE" }), m.status === "active" ? `${m.name} больше не в семье` : "Приглашение отменено");
  const rotate = () => run("code", () => appFetch<FamilyState>("/family/code", { method: "POST" }), "Код заменён — старый больше не работает");
  const doJoin = async () => {
    const code = join.trim().toUpperCase().replace(/\s+/g, "");
    if (!code) return;
    await run("join", async () => {
      const r = await appFetch<{ owner_name?: string }>("/family/join", { method: "POST", body: JSON.stringify({ code }) });
      setJoin("");
      const st = await appFetch<FamilyState>("/family");
      setMsg({ kind: "ok", text: `Вы в семье ${r.owner_name || ""}`.trim() });
      return st;
    });
  };
  const leave = () => run("leave", async () => {
    await appFetch("/family/leave", { method: "POST" });
    return appFetch<FamilyState>("/family");
  }, "Вы вышли из семьи");

  const joinBlock = (
    <>
      <div className="fs-cab-label">Вставить код</div>
      <div className="fs-cab-row">
        <input className="fs-cinput" placeholder="Код приглашения" value={join} maxLength={40}
          onChange={(e) => setJoin(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doJoin()} />
        <button type="button" className="fs-cbtn" disabled={!join.trim() || !!busy} onClick={doJoin}>
          {busy === "join" ? "Входим…" : "Войти в семью"}
        </button>
      </div>
    </>
  );

  const seats = f ? f.members.length : 0;
  return (
    <div className="fs-cab-in">
      <CabTop
        title={f?.role === "member" ? "Семейная подписка" : "Добавить в семью"}
        onBack={() => nav.go("/cabinet")}
        right={f?.role === "owner" ? <span className="fs-badge grey">{seats} из {f.max_members}</span> : undefined}
        sub={f?.role === "member" ? "Вы пользуетесь подпиской владельца семьи." : "Владелец подписки добавляет и удаляет людей. Участник может выйти сам."}
      />
      {fam.err ? <Note kind="err">{fam.err}</Note> : null}
      {msg ? <Note kind={msg.kind}>{msg.text}</Note> : null}

      {f?.role === "member" ? (
        <div className="fs-cab-card" style={{ marginTop: 24, maxWidth: 560 }}>
          <div className="fs-cab-k">Владелец</div>
          <div className="fs-fam-code" style={{ letterSpacing: 0 }}>{f.owner_name || "—"}</div>
          <p className="fs-cab-muted" style={{ margin: "12px 0 0" }}>Если выйти, подписка перестанет действовать на ваших устройствах.</p>
          <button type="button" className="fs-cbtn danger" style={{ marginTop: 18 }} disabled={!!busy} onClick={leave}>
            {busy === "leave" ? "Выходим…" : "Выйти из семьи"}
          </button>
        </div>
      ) : f?.role === "owner" ? (
        <div className="fs-cab-split" style={{ marginTop: 8 }}>
          <div>
            <div className="fs-cab-label">По нику пользователя</div>
            <div className="fs-cab-row">
              <input className="fs-cinput" placeholder="Ник или юзернейм Telegram" value={query} maxLength={120}
                disabled={!f.can_invite} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && invite()} />
              <button type="button" className="fs-cbtn" disabled={!f.can_invite || !query.trim() || !!busy} onClick={invite}>
                {busy === "add" ? "…" : "Добавить"}
              </button>
            </div>
            {!f.can_invite ? <Note kind="info">Приглашать можно, пока у вас активна платная подписка.</Note> : null}
            <div className="fs-fam-list">
              {f.members.length === 0 ? (
                <div className="fs-cab-card fs-cab-empty">В семье пока никого. Пригласите по нику или отправьте код.</div>
              ) : (
                f.members.map((m) => (
                  <div key={m.id} className="fs-cab-card fs-fam-member">
                    <div>
                      <b>{m.name}</b>
                      <small className={m.status === "active" ? "g" : undefined}>{m.status === "active" ? "В семье" : "Приглашение отправлено"}</small>
                    </div>
                    <button type="button" className="fs-cbtn danger" disabled={!!busy} onClick={() => remove(m)}>
                      {busy === `del${m.id}` ? "…" : m.status === "active" ? "Удалить" : "Отменить"}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
          <div>
            <div className="fs-cab-label">Поделиться семьёй</div>
            <div className="fs-cab-card fs-fam-share">
              <div className="fs-cab-k">Код приглашения</div>
              <div className="fs-fam-code">{f.code || "—"}</div>
              <p>Скопируйте код. Человек вставляет его у себя в кабинете и заходит в вашу семью.</p>
              <button type="button" className="fs-cbtn block" disabled={!f.code} onClick={() => copy(f.code || "")}>
                {copied ? Ic.check(18) : Ic.copy()}
                {copied ? "Скопировано" : "Скопировать код"}
              </button>
              <button type="button" className="fs-cbtn dark block" disabled={!f.can_invite || !!busy} onClick={rotate}>
                {busy === "code" ? "Меняем…" : "Заменить код семьи"}
              </button>
            </div>
            {f.members.length === 0 ? joinBlock : null}
          </div>
        </div>
      ) : (
        <div className="fs-cab-split" style={{ marginTop: 8 }}>
          <div>
            <div className="fs-cab-label">Своя семья</div>
            <div className="fs-cab-card">
              <h3>Подключите близких</h3>
              <p className="fs-cab-muted" style={{ margin: "8px 0 0" }}>
                С платной подпиской можно пригласить {f ? `до ${f.max_members} ${plural(f.max_members, "человека", "человек", "человек")}` : "близких"} — они будут пользоваться вашей подпиской.
              </p>
              <button type="button" className="fs-cbtn" style={{ marginTop: 18 }} onClick={() => nav.go("/tariffs")}>
                Оформить подписку
              </button>
            </div>
          </div>
          <div>{joinBlock}</div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── маршруты ─────────────────────────
export default function SiteCabinet({ path, nav, desktop }: { path: string; nav: CabNav; desktop: Desktop }) {
  const page =
    path === "/cabinet/subscription" ? <Subscription nav={nav} />
      : path === "/cabinet/link" ? <SubLink nav={nav} desktop={desktop} />
        : path === "/cabinet/key" ? <KeyHelp nav={nav} />
          : path === "/cabinet/devices" ? <Devices nav={nav} />
            : path === "/cabinet/devices/buy" ? <DevicesBuy nav={nav} />
              : path === "/cabinet/family" ? <Family nav={nav} />
                : <Home nav={nav} />;
  return (
    <main className="fs-cab">
      <div className="fs-wrap" key={path}>
        {page}
      </div>
    </main>
  );
}
