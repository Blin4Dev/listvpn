// Начальное меню «Проекты»: install.sh ставит только панель, мини-приложения проектов ставятся отсюда —
// каждое на свой сервер и домен (бэкенд: src/core/miniapps.py, агент: src/core/miniapp_agent.py).
// Монохром; оранжевый — только у переключателей, цвет — только у статусов круга установки.
import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Spinner, Toggle } from '../../components/ui';
import { apiFetch, copyToClipboard, parseApiErr } from '../../lib/api';

type Install = {
  project: string; state: 'waiting' | 'installing' | 'done' | 'error' | string; step: string; step_index: number; pct: number;
  label: string; error: string; domain: string; site_domain: string; server_id: number; server_ip: string;
  server_online: boolean; connected: boolean; fresh: boolean; expires_in: number;
  steps: { key: string; label: string }[]; command?: string; panel_url: string;
};
type Proj = {
  id: string; name: string; has_site: boolean; installed: boolean; legacy: boolean; active: boolean;
  domain: string; site_domain: string; server: { id: number; ip: string; online: boolean } | null;
  install: Install | null;
  bot: { token_set: boolean; username: string; token_hint: string };
  squads: { vpn: string[]; trial: string[] };
  pay_mode: 'yk' | 'stars';
  yookassa: { shop_id: string; secret_set: boolean; webhook_url: string };
  channel: { id: string; required: boolean };
  mail_from: string; ready: boolean; missing: string[];
};
type Server = { id: number; ip: string; hostname: string; online: boolean; caddy: string; projects: string[] };
type Data = {
  panel_url: string; panel_host: string; gateway_ready: boolean; remnawave: boolean;
  projects: Proj[]; servers: Server[]; squads: { uuid: string; name: string }[]; admins: string[];
};

const CSS = `
.su{max-width:1080px;margin:0 auto;padding:32px 20px 48px}
.su-top{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:24px}
.su h1{font-size:20px;font-weight:600;margin:0 0 4px;letter-spacing:-.01em}
.su .m{color:var(--muted)}.su .f{color:var(--faint)}.su .sm{font-size:12.5px}.su .mono{font-family:var(--mono)}
.su-grid{display:grid;grid-template-columns:270px 1fr;gap:16px;align-items:start}
.su-card{background:var(--surface-2);border:1px solid var(--border);border-radius:12px}
.su-col{display:flex;flex-direction:column;gap:16px}
.su-list{padding:6px}
.su-lt{padding:10px 12px 8px;font-size:11.5px;color:var(--faint);text-transform:uppercase;letter-spacing:.07em;display:flex;justify-content:space-between}
.su-prow{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;cursor:pointer;transition:background .12s}
.su-prow:hover{background:rgba(255,255,255,.03)}
.su-prow.sel{background:var(--surface-hover)}
.su-prow .info{flex:1;min-width:0}
.su-prow .name{font-weight:550}
.su-prow .st{font-size:12px;color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.su-prow .st.ok{color:var(--text)}
.su-prow.off .name{color:var(--muted)}
.su-mark{width:16px;height:16px;border-radius:50%;border:1.5px solid var(--border-strong);flex:none;display:flex;align-items:center;justify-content:center}
.su-mark.ok{background:#fff;border-color:#fff}
.su-mark.ok::after{content:"";width:6px;height:3px;border:solid #000;border-width:0 0 1.6px 1.6px;transform:rotate(-45deg) translate(1px,-1px)}
.su-mark.dash{border-style:dashed}
.su-srow{padding:10px 12px;border-top:1px solid var(--border)}
.su-srow:first-of-type{border-top:0}
.su-srow .ip{font-family:var(--mono);font-size:12.5px;display:flex;align-items:center;gap:8px}
.su-srow .pr{font-size:12px;color:var(--faint);margin-top:2px}
.su-dot{width:6px;height:6px;border-radius:50%;background:var(--faint)}
.su-dot.on{background:#fff}
.su-form{padding:4px 22px 20px}
.su-fhead{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 0 16px;border-bottom:1px solid var(--border)}
.su-fhead .title{font-size:16px;font-weight:600}
.su-sec{display:grid;grid-template-columns:20px 1fr;gap:12px;padding:18px 0;border-bottom:1px solid var(--border)}
.su-sec:last-of-type{border-bottom:0}
.su-sec .su-mark{margin-top:2px}
.su-sname{font-weight:550;margin-bottom:2px;display:flex;align-items:center;gap:8px}
.su-sname .opt{font-weight:400;color:var(--faint);font-size:12px}
.su-desc{font-size:12.5px;color:var(--faint);margin-bottom:10px}
.su label{display:block;font-size:12px;color:var(--muted);margin:0 0 6px}
.su-two{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.su-note{font-size:12.5px;margin-top:8px;color:var(--muted);min-height:18px}
.su-chips{display:flex;flex-wrap:wrap;gap:6px}
.su .chip.on{background:#fff;color:#000;border-color:#fff}
.su-tag{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;border:1px solid var(--border);background:var(--surface-hover);font-size:13px;font-family:var(--mono)}
.su-tag button{background:none;border:0;padding:0;color:var(--faint);font-size:14px;line-height:1;cursor:pointer}
.su-tag button:hover{color:var(--text)}
.su-add{display:flex;gap:8px;margin-top:8px}
.su-add .input{max-width:220px}
.su-kv{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;font-size:13px;margin:8px 0 0}
.su-kv dt{color:var(--faint)}.su-kv dd{margin:0;min-width:0;overflow:hidden;text-overflow:ellipsis}
.su-copy{display:flex;align-items:center;gap:10px;padding:8px 8px 8px 12px;border:1px dashed var(--border-strong);border-radius:8px;min-width:0;margin-top:10px}
.su-copy code{flex:1;font-family:var(--mono);font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.su-actions{display:flex;align-items:center;justify-content:flex-end;gap:12px;padding-top:18px;border-top:1px solid var(--border)}
.su-empty{padding:64px 24px;text-align:center}
.su-foot{margin-top:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px}
.su-link{background:none;border:0;padding:0;color:var(--muted);text-decoration:underline;text-underline-offset:3px;font-size:12.5px;cursor:pointer}
.su-link:hover{color:var(--text)}
.su-warn{border:1px solid var(--border-strong);border-radius:10px;padding:12px 14px;margin-bottom:16px;font-size:13px}
.su-ov{position:fixed;inset:0;background:rgba(0,0,0,.72);backdrop-filter:blur(3px);display:flex;align-items:flex-start;justify-content:center;padding:48px 16px;overflow:auto;z-index:80}
.su-modal{width:100%;max-width:580px;background:var(--surface-2);border:1px solid var(--border-strong);border-radius:14px;overflow:hidden}
.su-mh{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:20px 22px 0}
.su-mh .title{font-size:16px;font-weight:600}
.su-x{background:none;border:0;color:var(--faint);font-size:20px;line-height:1;padding:2px 4px;cursor:pointer}
.su-x:hover{color:var(--text)}
.su-mb{padding:18px 22px 20px}
.su-field{margin-bottom:14px}
.su-hint{font-size:12px;color:var(--faint);margin-top:8px}
.su-srv{display:flex;align-items:center;gap:12px;padding:11px 12px;border:1px solid var(--border);border-radius:10px;margin-bottom:8px;cursor:pointer}
.su-srv:hover{border-color:var(--border-strong)}
.su-srv.on{border-color:#fff}
.su-radio{width:16px;height:16px;border-radius:50%;border:1.5px solid var(--border-strong);flex:none;position:relative}
.su-srv.on .su-radio{border-color:#fff}
.su-srv.on .su-radio::after{content:"";position:absolute;inset:3px;border-radius:50%;background:#fff}
.su-cmd{display:flex;align-items:center;gap:10px;background:#000;border:1px solid var(--border);border-radius:10px;padding:10px 10px 10px 14px}
.su-cmd code{flex:1;font-family:var(--mono);font-size:12.5px;word-break:break-all;line-height:1.5}
.su-cmd code .p{color:var(--faint);user-select:none}
.su-status{display:flex;align-items:center;gap:16px;padding:16px 22px;border-top:1px solid var(--border);background:var(--surface)}
.su-status .txt{flex:1;min-width:0}
.su-status .st1{font-weight:600}
.su-status .st2{font-size:12.5px;color:var(--muted);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.su-ring{width:52px;height:52px;flex:none;position:relative}
.su-ring svg{width:52px;height:52px;transform:rotate(-90deg)}
.su-ring .trk{fill:none;stroke:rgba(255,255,255,.08);stroke-width:4}
.su-ring .arc{fill:none;stroke-width:4;stroke-linecap:round;transition:stroke-dashoffset .5s ease,stroke .3s}
.su-ring.wait svg{animation:su-rot 1.4s linear infinite}
.su-ring .pct{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;font-variant-numeric:tabular-nums}
.su-ring .chk{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
.su-ring .chk::after{content:"";width:14px;height:7px;border:solid #4ade80;border-width:0 0 2.5px 2.5px;transform:rotate(-45deg) translate(1px,-2px)}
.su-ring .err{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#ff6b6b;font-weight:700;font-size:18px}
@keyframes su-rot{to{transform:rotate(360deg)}}
.su-steps{margin:2px 0 0;padding:0;list-style:none}
.su-steps li{display:flex;align-items:center;gap:10px;padding:6px 0;font-size:13px;color:var(--faint)}
.su-steps li .sd{width:14px;height:14px;border-radius:50%;border:1.5px solid var(--border-strong);flex:none;display:flex;align-items:center;justify-content:center}
.su-steps li.now{color:var(--text)}
.su-steps li.now .sd{border-color:#f5c518;border-top-color:transparent;animation:su-rot .8s linear infinite}
.su-steps li.bad{color:var(--text)}
.su-steps li.bad .sd{border-color:#ff6b6b}
.su-steps li.done{color:var(--muted)}
.su-steps li.done .sd{border-color:#4ade80;background:#4ade80}
.su-steps li.done .sd::after{content:"";width:5px;height:2.5px;border:solid #000;border-width:0 0 1.5px 1.5px;transform:rotate(-45deg) translate(.5px,-.5px)}
.su-err{margin-top:12px;font-size:12.5px;border:1px solid var(--border-strong);border-radius:8px;padding:10px 12px;color:var(--text);word-break:break-word}
.su-dns{border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-top:10px}
.su-dns .r{display:grid;grid-template-columns:44px minmax(0,1fr) minmax(0,1.6fr) 24px 24px;gap:10px;align-items:center;padding:8px 10px 8px 12px;border-top:1px solid var(--border);font-size:12px}
.su-dns .r:first-child{border-top:0}
.su-dns .r .ty{font-family:var(--mono);color:var(--faint)}
.su-dns .r code{font-family:var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.su-dns .r button{background:none;border:0;color:var(--faint);padding:2px;font-size:13px;cursor:pointer}
.su-dns .r button:hover{color:var(--text)}
.su-spin{display:inline-block;width:10px;height:10px;border:1.5px solid var(--faint);border-top-color:var(--text);border-radius:50%;animation:su-rot .7s linear infinite;vertical-align:-1px;margin-right:6px}
@media (max-width:760px){.su-grid{grid-template-columns:1fr}.su-two{grid-template-columns:1fr}.su-top{flex-wrap:wrap}.su-dns .r{grid-template-columns:40px 1fr 24px}.su-dns .r code:nth-of-type(2),.su-dns .r .okc{display:none}}
`;

const isIp = (v: string) => /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(v);
const isDomain = (v: string) => /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/i.test(v);
const normDomain = (v: string) => v.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').split('/')[0].replace(/\.$/, '');

function statusOf(p: Proj): { t: string; ok?: boolean } {
  const inst = p.install;
  if (inst && (inst.state === 'waiting' || inst.state === 'installing')) return { t: inst.state === 'waiting' ? 'Ждём сервер…' : 'Установка…' };
  if (!p.installed) return { t: inst?.state === 'error' ? 'Ошибка установки' : 'Не установлен' };
  if (!p.active) return { t: 'Выключен' };
  if (p.ready) return { t: 'Работает', ok: true };
  return { t: p.missing.length ? `Нужно: ${p.missing.join(', ')}` : 'Не сохранён' };
}

// ───────────────────────── страница ─────────────────────────

export function SetupPage({ onDone, onToast }: { onDone: () => void; onToast: (t: string, m: string, type?: 'success' | 'error') => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState('');
  const [modal, setModal] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d: Data = await apiFetch('/panel/setup');
      setData(d); setErr('');
      setSel((s) => s || d.projects[0]?.id || '');
    } catch (e) { setErr(parseApiErr(e, 'Не удалось загрузить проекты')); }
  }, []);
  useEffect(() => { load(); }, [load]);
  // фоновые установки (окно закрыто) — обновлять список
  const busy = !!data?.projects.some((p) => p.install && (p.install.state === 'waiting' || p.install.state === 'installing'));
  useEffect(() => {
    if (!busy || modal) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [busy, modal, load]);

  if (!data) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    {err ? <div className="sub">{err} <button className="btn sm" onClick={load}>Повторить</button></div> : <Spinner size={32} />}
  </div>;

  const cur = data.projects.find((p) => p.id === sel) || data.projects[0];
  const ready = data.projects.filter((p) => p.ready);
  const canGo = ready.length > 0;
  const inst = data.projects.filter((p) => p.installed).length;

  const toggle = async (p: Proj) => {
    setSel(p.id);
    if (!p.installed) { setModal(p.id); return; }
    try {
      await apiFetch(`/panel/setup/project/${p.id}`, { method: 'PUT', body: JSON.stringify({ active: !p.active }) });
      await load();
    } catch (e) { onToast('Проект', parseApiErr(e, 'Не удалось'), 'error'); }
  };

  return (
    <div className="su">
      <style>{CSS}</style>
      <div className="su-top">
        <div>
          <h1>Проекты</h1>
          <div className="m sm">
            Панель установлена на <span className="mono">{data.panel_host || '—'}</span>
            {data.remnawave ? ', Remnawave подключена.' : ', Remnawave не подключена (REMWAVE_API_KEY в .env).'}{' '}
            Включите проект — панель поставит его мини-приложение на сервер.
          </div>
        </div>
        <button className={`btn ${canGo ? 'solid' : ''}`} disabled={!canGo} onClick={onDone}
          title={canGo ? '' : 'Сначала запустите хотя бы один проект'}>{canGo ? 'Перейти в панель →' : 'Пропустить'}</button>
      </div>

      {(!data.panel_url || !data.gateway_ready) && <div className="su-warn">
        Главный сервер ещё не готов принимать мини-приложения: в .env нет {!data.panel_url ? 'PANEL_URL' : 'MINIAPP_GATEWAY_SECRET'}.
        Запустите на нём <span className="mono">sudo bash install.sh</span> → «Обновить код».
      </div>}

      <div className="su-grid">
        <div className="su-col">
          <div className="su-card su-list">
            <div className="su-lt"><span>Проекты</span></div>
            {data.projects.map((p) => {
              const st = statusOf(p);
              return <div key={p.id} className={`su-prow ${p.id === cur?.id ? 'sel' : ''} ${p.active && p.installed ? '' : 'off'}`} onClick={() => setSel(p.id)}>
                <span className={`su-mark ${st.ok ? 'ok' : ''} ${p.installed ? '' : 'dash'}`} />
                <div className="info"><div className="name">{p.name}</div><div className={`st ${st.ok ? 'ok' : ''}`}>{st.t}</div></div>
                <span onClick={(e) => e.stopPropagation()}><Toggle on={p.installed && p.active} onChange={() => toggle(p)} /></span>
              </div>;
            })}
          </div>
          <div className="su-card su-list">
            <div className="su-lt"><span>Серверы мини-приложений</span><span>{data.servers.length || ''}</span></div>
            {data.servers.length ? data.servers.map((s) => (
              <div className="su-srow" key={s.id}>
                <div className="ip"><span className={`su-dot ${s.online ? 'on' : ''}`} title={s.online ? 'на связи' : 'не на связи'} />{s.ip}</div>
                <div className="pr">{s.projects.map((id) => data.projects.find((p) => p.id === id)?.name || id).join(' · ') || 'без проектов'}
                  {!s.online && ' · не на связи'}</div>
              </div>
            )) : <div className="su-srow f sm" style={{ padding: '4px 12px 12px' }}>Появятся после первой установки</div>}
          </div>
        </div>
        <div className="su-card">
          {cur && <ProjectPane key={cur.id} p={cur} data={data} onInstall={() => setModal(cur.id)} onReload={load} onToast={onToast} />}
        </div>
      </div>

      <div className="su-card su-foot">
        <div className="m sm">{canGo
          ? `Работает ${ready.length} из ${data.projects.length}. Остальные можно поставить позже — это меню всегда открывается из панели (Проекты).`
          : inst ? 'Осталось заполнить настройки и сохранить — после этого можно перейти в панель.'
            : 'Все проекты выключены. Включите хотя бы один — откроется установка мини-приложения.'}</div>
      </div>

      {modal && <InstallModal p={data.projects.find((x) => x.id === modal)!} data={data}
        onClose={() => { setModal(null); load(); }} onFinish={() => { setSel(modal); setModal(null); load(); onToast('Готово', 'Мини-приложение установлено'); }} />}
    </div>
  );
}

// ───────────────────────── правая часть: проект ─────────────────────────

function ProjectPane({ p, data, onInstall, onReload, onToast }: {
  p: Proj; data: Data; onInstall: () => void; onReload: () => Promise<void>; onToast: (t: string, m: string, type?: 'success' | 'error') => void;
}) {
  const [token, setToken] = useState('');
  const [admins, setAdmins] = useState<string[]>(data.admins);
  const [adminIn, setAdminIn] = useState('');
  const [adminNote, setAdminNote] = useState('');
  const [vpn, setVpn] = useState<string[]>(p.squads.vpn);
  const [trial, setTrial] = useState<string[]>(p.squads.trial);
  const [pay, setPay] = useState<'yk' | 'stars'>(p.pay_mode);
  const [shop, setShop] = useState(p.yookassa.shop_id);
  const [secret, setSecret] = useState('');
  const [channel, setChannel] = useState(p.channel.id);
  const [chanReq, setChanReq] = useState(p.channel.required);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const [dirty, setDirty] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const touch = () => { setDirty(true); setSaveErr(''); };

  const inst = p.install;
  if (!p.installed) {
    const running = inst && (inst.state === 'waiting' || inst.state === 'installing');
    return <div className="su-empty">
      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>{p.name} не установлен</div>
      <div className="m sm" style={{ margin: '0 auto 18px', maxWidth: 400 }}>
        {running ? `Идёт установка на ${inst!.server_ip} (${inst!.domain}).`
          : inst?.state === 'error' ? `Установка на ${inst.server_ip} не удалась: ${inst.error}`
            : 'Мини-приложение проекта ставится на отдельный сервер со своим доменом. С этого же сервера уходят письма пользователям.'}
      </div>
      <button className="btn solid" onClick={onInstall}>{running ? 'Открыть установку' : inst?.state === 'error' ? 'Повторить' : 'Установить'}</button>
    </div>;
  }
  if (!p.active) {
    return <div className="su-empty">
      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>{p.name} выключен</div>
      <div className="m sm" style={{ margin: '0 auto 18px', maxWidth: 400 }}>Бот не отвечает. Мини-приложение <span className="mono">{p.domain}</span>, настройки и пользователи сохранены.</div>
      <button className="btn solid" onClick={async () => {
        try { await apiFetch(`/panel/setup/project/${p.id}`, { method: 'PUT', body: JSON.stringify({ active: true }) }); await onReload(); }
        catch (e) { onToast('Проект', parseApiErr(e, 'Не удалось'), 'error'); }
      }}>Включить</button>
    </div>;
  }

  const tokenOk = p.bot.token_set || /^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token.trim());
  const shopOk = /^\d{3,}$/.test(shop.trim());
  const secretOk = p.yookassa.secret_set || /^(live|test)_.{6,}/.test(secret.trim());
  const s = { bot: tokenOk, admins: admins.length > 0, pay: pay === 'stars' || (shopOk && secretOk) };
  const labels: Record<string, string> = { bot: 'бот', admins: 'админы', pay: 'оплата' };
  const missing = Object.entries(s).filter(([, v]) => !v).map(([k]) => labels[k]);
  const complete = missing.length === 0;
  const url = `https://${p.domain}`;
  const hook = p.yookassa.webhook_url || `${url}/yookassa`;
  const squadName = (u: string) => data.squads.find((q) => q.uuid === u)?.name || u.slice(0, 8);
  const allSquads = [...data.squads.map((q) => q.uuid), ...[...vpn, ...trial].filter((u) => !data.squads.some((q) => q.uuid === u))];

  const addAdmin = () => {
    const v = adminIn.trim();
    if (!/^\d{5,}$/.test(v)) { setAdminNote('Нужен числовой Telegram ID — его покажет @userinfobot'); return; }
    if (admins.includes(v)) { setAdminNote('Уже добавлен'); return; }
    setAdmins([...admins, v]); setAdminIn(''); setAdminNote(''); touch();
  };
  const flip = (list: string[], set: (v: string[]) => void, u: string) => { set(list.includes(u) ? list.filter((x) => x !== u) : [...list, u]); touch(); };

  const save = async () => {
    setSaving(true); setSaveErr('');
    const body: any = { admins, squads_vpn: vpn, squads_trial: trial, channel_id: String(channel || '').trim(), channel_required: !!chanReq };
    if (pay === 'yk' || pay === 'stars') body.pay_mode = pay;
    if (token.trim()) body.bot_token = token.trim();
    if (pay === 'yk') { body.yookassa_shop_id = String(shop || '').trim(); if (String(secret || '').trim()) body.yookassa_secret_key = String(secret).trim(); }
    try {
      await apiFetch(`/panel/setup/project/${p.id}`, { method: 'PUT', body: JSON.stringify(body) });
      setToken(''); setSecret(''); setDirty(false);
      await onReload();
      onToast(p.name, 'Сохранено');
    } catch (e) { setSaveErr(parseApiErr(e, 'Не удалось сохранить')); }
    setSaving(false);
  };
  const syncSquads = async () => {
    setSyncing(true);
    try { await apiFetch('/panel/squads/sync', { method: 'POST' }); await onReload(); }
    catch (e) { onToast('Сквады', parseApiErr(e, 'Remnawave не ответила'), 'error'); }
    setSyncing(false);
  };

  const tokNote = token.trim()
    ? (/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token.trim()) ? 'Проверим в Telegram при сохранении и пропишем кнопку мини-приложения' : 'Токен выглядит так: 1234567890:AAH… (из @BotFather)')
    : p.bot.token_set ? <>Бот <b>@{p.bot.username || '—'}</b> подключён · кнопка мини-приложения → {url}</> : '';

  return (
    <div className="su-form">
      <div className="su-fhead">
        <div><div className="title">{p.name}</div><div className="f sm mono">{url}</div></div>
        <span className="f sm">{Object.values(s).filter(Boolean).length} из {Object.keys(s).length}</span>
      </div>

      <div className="su-sec"><span className="su-mark ok" /><div>
        <div className="su-sname">Мини-приложение и почта</div>
        <dl className="su-kv">
          <dt>Сервер</dt><dd className="mono">{p.legacy ? 'главный (старая установка)' : p.server ? `${p.server.ip}${p.server.online ? '' : ' · не на связи'}` : '—'}</dd>
          <dt>Домен</dt><dd className="mono">{p.domain}{p.site_domain ? `, ${p.site_domain}` : ''}</dd>
          <dt>Письма</dt><dd>{p.mail_from ? <><span className="mono">{p.mail_from}</span> <MailDns pid={p.id} /></> : <span className="f">как в Настройки → Почта</span>}</dd>
        </dl>
        <div style={{ marginTop: 10 }}><button className="su-link" onClick={onInstall}>{p.legacy ? 'Перенести на свой сервер' : 'Перенести на другой сервер'}</button></div>
      </div></div>

      <div className="su-sec"><span className={`su-mark ${s.bot ? 'ok' : ''}`} /><div>
        <div className="su-sname">Telegram-бот</div>
        <div className="su-desc">Токен от @BotFather. Проверим его и сами пропишем кнопку мини-приложения.</div>
        <input className="input mono" style={{ width: '100%' }} placeholder={p.bot.token_set ? `••••${p.bot.token_hint} — вставьте новый, чтобы заменить` : '123456789:AA…'}
          value={token} onChange={(e) => { setToken(e.target.value); touch(); }} autoComplete="off" spellCheck={false} />
        <div className="su-note">{tokNote}</div>
      </div></div>

      <div className="su-sec"><span className={`su-mark ${s.admins ? 'ok' : ''}`} /><div>
        <div className="su-sname">Администраторы</div>
        <div className="su-desc">Telegram ID тех, кому бот шлёт уведомления и коды входа в панель. Общие для всей сети.</div>
        <div className="su-chips">{admins.length ? admins.map((a) => (
          <span className="su-tag" key={a}>{a}<button onClick={() => { setAdmins(admins.filter((x) => x !== a)); touch(); }} aria-label="Убрать">×</button></span>
        )) : <span className="f sm">Пока никого</span>}</div>
        <div className="su-add">
          <input className="input mono" placeholder="Telegram ID" inputMode="numeric" value={adminIn}
            onChange={(e) => setAdminIn(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addAdmin(); }} />
          <button className="btn sm" onClick={addAdmin}>Добавить</button>
        </div>
        <div className="su-note">{adminNote}</div>
      </div></div>

      <div className="su-sec"><span className={`su-mark ${vpn.length ? 'ok' : 'dash'}`} /><div>
        <div className="su-sname">Сквады Remnawave <span className="f sm">— необязательно</span></div>
        <div className="su-desc">Какие ноды получает пользователь. Не выберете — будут общие сети. {data.squads.length ? 'Список загружен из Remnawave.' : 'Список пуст — загрузите его из Remnawave.'}
          {' '}<button className="su-link" onClick={syncSquads} disabled={syncing}>{syncing ? 'загружаем…' : 'обновить'}</button></div>
        <label>Платная подписка</label>
        <div className="su-chips">{allSquads.map((u) => <button key={u} className={`chip ${vpn.includes(u) ? 'on' : ''}`} onClick={() => flip(vpn, setVpn, u)}>{squadName(u)}</button>)}</div>
        <label style={{ marginTop: 14 }}>Пробный период <span className="f">— если не выбрать, пробного не будет</span></label>
        <div className="su-chips">{allSquads.map((u) => <button key={u} className={`chip ${trial.includes(u) ? 'on' : ''}`} onClick={() => flip(trial, setTrial, u)}>{squadName(u)}</button>)}</div>
      </div></div>

      <div className="su-sec"><span className={`su-mark ${s.pay ? 'ok' : ''}`} /><div>
        <div className="su-sname">Оплата</div>
        <div className="su-desc">Звёзды Telegram работают всегда. ЮKassa добавляет оплату картой и СБП.</div>
        <div className="seg" style={{ marginBottom: 12 }}>
          <button className={`seg-item ${pay === 'yk' ? 'on' : ''}`} onClick={() => { setPay('yk'); touch(); }}>ЮKassa + Stars</button>
          <button className={`seg-item ${pay === 'stars' ? 'on' : ''}`} onClick={() => { setPay('stars'); touch(); }}>Только Stars</button>
        </div>
        {pay === 'yk' && <>
          <div className="su-two">
            <div><label>shopId</label><input className="input mono" style={{ width: '100%' }} placeholder="123456" value={shop} onChange={(e) => { setShop(e.target.value); touch(); }} /></div>
            <div><label>Секретный ключ</label><input className="input mono" style={{ width: '100%' }} placeholder={p.yookassa.secret_set ? 'сохранён — вставьте новый, чтобы заменить' : 'live_…'}
              value={secret} onChange={(e) => { setSecret(e.target.value); touch(); }} autoComplete="off" /></div>
          </div>
          <div className="su-copy"><span className="f sm">URL уведомлений</span><code>{hook}</code>
            <button className="btn sm" onClick={async () => { await copyToClipboard(hook); onToast('Скопировано', hook); }}>Копировать</button></div>
        </>}
      </div></div>

      <div className="su-sec"><span className={`su-mark ${channel.trim() ? 'ok' : ''}`} /><div>
        <div className="su-sname">Канал <span className="opt">необязательно</span></div>
        <div className="su-desc">Ссылка в боте и, если включить, обязательная подписка перед пробным периодом.</div>
        <div className="su-two" style={{ alignItems: 'end' }}>
          <div><input className="input" style={{ width: '100%' }} placeholder="@channel" value={channel} onChange={(e) => { setChannel(e.target.value); touch(); }} /></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 8 }}>
            <Toggle on={chanReq} onChange={() => { setChanReq(!chanReq); touch(); }} /><span className="m sm">Требовать подписку</span>
          </div>
        </div>
      </div></div>

      {saveErr && <div className="su-err" style={{ marginBottom: 12 }}>{saveErr}</div>}
      <div className="su-actions">
        <span className="f sm">{!dirty && p.ready ? 'Сохранено · проект работает' : complete ? (dirty ? 'Всё заполнено' : 'Сохраните, чтобы применить') : `Не хватает: ${missing.join(', ')}`}</span>
        <button className="btn solid" disabled={!complete || saving || (!dirty && p.ready)} onClick={save}>{saving ? 'Сохраняем…' : 'Сохранить'}</button>
      </div>
    </div>
  );
}

function MailDns({ pid }: { pid: string }) {
  const [st, setSt] = useState<'' | 'checking' | 'ok' | 'bad'>('');
  const [open, setOpen] = useState(false);
  const check = async () => {
    setSt('checking');
    try {
      const r = await apiFetch(`/panel/setup/mail/${pid}`);
      const ok = (r?.records || []).length > 0 && r.records.every((x: any) => x.ok);
      setSt(ok ? 'ok' : 'bad'); if (!ok) setOpen(true);
    } catch { setSt('bad'); }
  };
  useEffect(() => { check(); }, [pid]);  // eslint-disable-line react-hooks/exhaustive-deps
  return <span className="f">· DNS почты: {st === 'checking' || st === '' ? <><span className="su-spin" />проверяем</>
    : st === 'ok' ? 'в порядке' : <button className="su-link" onClick={() => setOpen(true)}>не настроены</button>}
    {open && createPortal(<div className="su-ov" onClick={() => setOpen(false)}><div className="su-modal" onClick={(e) => e.stopPropagation()}>
      <style>{CSS}</style>
      <div className="su-mh"><div><div className="title">DNS почты</div><div className="f sm">Чтобы письма не попадали в спам, добавьте записи в DNS домена.</div></div>
        <button className="su-x" onClick={() => setOpen(false)}>×</button></div>
      <div className="su-mb"><MailRecords pid={pid} /><div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        <button className="btn sm" onClick={() => { setOpen(false); check(); }}>Проверить ещё раз</button></div></div>
    </div></div>, document.body)}</span>;
}

function MailRecords({ pid }: { pid: string }) {
  const [recs, setRecs] = useState<any[] | null>(null);
  const [from, setFrom] = useState('');
  useEffect(() => {
    apiFetch(`/panel/setup/mail/${pid}`).then((r) => { setRecs(r?.records || []); setFrom(r?.from || ''); }).catch(() => setRecs([]));
  }, [pid]);
  if (!recs) return <div className="f sm"><span className="su-spin" />Загружаем записи…</div>;
  if (!recs.length) return <div className="f sm">Записи появятся, когда сервер мини-приложения будет на связи.</div>;
  return <>
    {from && <div className="f sm">Письма уходят с <span className="mono">{from}</span> через сервер мини-приложения.</div>}
    <div className="su-dns">{recs.map((r) => (
      <div className="r" key={r.name}>
        <span className="ty">{r.type}</span>
        <code title={r.name}>{r.name}</code>
        <code className="m" title={r.value}>{r.value}</code>
        <span className="okc" title={r.ok ? 'запись найдена' : 'не найдена'} style={{ color: r.ok ? '#4ade80' : 'var(--faint)' }}>{r.ok ? '✓' : '—'}</span>
        <button onClick={() => copyToClipboard(r.value)} title="Копировать">⧉</button>
      </div>
    ))}</div>
  </>;
}

// ───────────────────────── окно установки ─────────────────────────

function Ring({ phase, pct }: { phase: 'wait' | 'run' | 'done' | 'error'; pct: number }) {
  const C = 2 * Math.PI * 22;
  let color = 'rgba(255,255,255,.35)', off = C * 0.75, inner: React.ReactNode = null;
  if (phase === 'run') { color = '#f5c518'; off = C * (1 - pct / 100); inner = <div className="pct">{pct}%</div>; }
  if (phase === 'done') { color = '#4ade80'; off = 0; inner = <div className="chk" />; }
  if (phase === 'error') { color = '#ff6b6b'; off = C * (1 - Math.max(pct, 8) / 100); inner = <div className="err">!</div>; }
  return <div className={`su-ring ${phase === 'wait' ? 'wait' : ''}`}>
    <svg viewBox="0 0 52 52"><circle className="trk" cx="26" cy="26" r="22" />
      <circle className="arc" cx="26" cy="26" r="22" stroke={color} strokeDasharray={C} strokeDashoffset={off} /></svg>{inner}
  </div>;
}

function InstallModal({ p, data, onClose, onFinish }: { p: Proj; data: Data; onClose: () => void; onFinish: () => void }) {
  const moving = p.installed;
  const otherServers = data.servers.filter((s) => s.online);
  const pending = p.install && (p.install.state === 'waiting' || p.install.state === 'installing' || p.install.state === 'error') ? p.install : null;
  const [inst, setInst] = useState<Install | null>(pending);
  const [command, setCommand] = useState('');
  const [mode, setMode] = useState<'new' | 'existing'>(otherServers.length ? 'existing' : 'new');
  const [ip, setIp] = useState('');
  const [srv, setSrv] = useState<number | null>(otherServers[0]?.id ?? null);
  const [domain, setDomain] = useState(moving ? p.domain : '');
  const [site, setSite] = useState(p.site_domain || '');
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');

  const dom = normDomain(domain);
  const siteDom = normDomain(site);

  // ход установки
  useEffect(() => {
    if (!inst || inst.state === 'done') return;
    const t = window.setInterval(async () => {
      try {
        const r = await apiFetch(`/panel/setup/install/${p.id}`);
        if (r?.install) setInst((old) => ({ ...r.install, command: old?.command }));
      } catch { /* сеть */ }
    }, 1500);
    return () => window.clearInterval(t);
  }, [inst?.state, p.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  const ipBusy = mode === 'new' && data.servers.some((s) => s.ip === ip.trim());
  const siteBad = !!site.trim() && (!isDomain(siteDom) || siteDom === dom);
  const valid = isDomain(dom) && !siteBad && (mode === 'new' ? isIp(ip.trim()) && !ipBusy : !!srv);

  const go = async () => {
    if (!valid || busy) return;
    setBusy(true); setFormErr('');
    try {
      const body: any = { project: p.id, domain: dom, site_domain: siteDom };
      if (mode === 'new') body.ip = ip.trim(); else body.server_id = srv;
      const r = await apiFetch('/panel/setup/install', { method: 'POST', body: JSON.stringify(body) });
      setCommand(r?.install?.command || '');
      setInst(r?.install || null);
    } catch (e) { setFormErr(parseApiErr(e, 'Не удалось начать установку')); }
    setBusy(false);
  };
  const cancel = async () => {
    try { await apiFetch(`/panel/setup/install/${p.id}/cancel`, { method: 'POST' }); } catch { /* */ }
    setInst(null); setCommand('');
  };
  const retry = async () => {
    try { const r = await apiFetch(`/panel/setup/install/${p.id}/retry`, { method: 'POST' }); setInst(r?.install || null); }
    catch (e) { setFormErr(parseApiErr(e, 'Не удалось')); }
  };
  const close = () => { if (inst?.state === 'installing') return; onClose(); };
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });

  const phase: 'form' | 'wait' | 'run' | 'done' | 'error' = !inst ? 'form'
    : inst.state === 'done' ? 'done' : inst.state === 'error' ? 'error'
      : inst.state === 'waiting' || (inst.state === 'installing' && inst.step_index < 0) ? 'wait' : 'run';
  const title = moving ? `Перенос ${p.name}` : `Установка ${p.name}`;
  const cmd = command || inst?.command || '';
  const stepLabel = inst && inst.step_index >= 0 ? (inst.label || inst.steps[inst.step_index]?.label || '') : '';
  const [st1, st2] = phase === 'wait' ? ['Подключение…', inst?.connected ? `Сервер на связи, передаём домен ${inst?.domain}` : `Ждём, когда на ${inst?.server_ip} запустят команду`]
    : phase === 'run' ? ['Установка', stepLabel]
      : phase === 'done' ? ['Готово', `${p.name} работает на https://${inst?.domain}`]
        : phase === 'error' ? ['Ошибка', inst?.error || 'Установка не удалась'] : ['', ''];

  return createPortal(
    <div className="su-ov" onClick={close}>
      <style>{CSS}</style>
      <div className="su-modal" onClick={(e) => e.stopPropagation()}>
        <div className="su-mh">
          <div><div className="title">{title}</div>
            <div className="f sm">{phase === 'form'
              ? (moving ? 'Мини-приложение переедет на другой сервер, старый сайт отключится после проверки.' : 'Мини-приложение проекта будет работать на своём сервере и домене.')
              : 'Панель сама настроит сервер: Caddy, сертификат, мини-приложение и почту.'}</div></div>
          <button className="su-x" onClick={close} aria-label="Закрыть" title={inst?.state === 'installing' ? 'Дождитесь окончания установки' : 'Закрыть'}>×</button>
        </div>
        <div className="su-mb">
          {phase === 'form' ? <>
            <div className="seg" style={{ marginBottom: 16 }}>
              <button className={`seg-item ${mode === 'new' ? 'on' : ''}`} onClick={() => setMode('new')}>Новый сервер</button>
              <button className={`seg-item ${mode === 'existing' ? 'on' : ''}`} disabled={!otherServers.length} style={otherServers.length ? undefined : { opacity: 0.35, cursor: 'not-allowed' }}
                title={otherServers.length ? '' : 'Пока нет подключённых серверов'} onClick={() => otherServers.length && setMode('existing')}>
                Подключённый сервер{otherServers.length ? ` · ${otherServers.length}` : ''}</button>
            </div>
            {mode === 'new' ? <div className="su-field">
              <label>IP сервера мини-приложения</label>
              <input className="input mono" style={{ width: '100%' }} placeholder="203.0.113.10" value={ip} inputMode="decimal" onChange={(e) => setIp(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
              {ipBusy && <div className="su-note">Этот сервер уже подключён — выберите его во вкладке «Подключённый сервер»</div>}
              <div className="su-hint">Чистый Ubuntu 22.04+ или Debian 12, открыты порты 80 и 443.</div>
            </div> : <div className="su-field">
              <label>Сервер</label>
              {otherServers.map((s) => (
                <div key={s.id} className={`su-srv ${srv === s.id ? 'on' : ''}`} onClick={() => setSrv(s.id)}>
                  <span className="su-radio" />
                  <div style={{ flex: 1, minWidth: 0 }}><div className="mono" style={{ fontSize: 13 }}>{s.ip}</div>
                    <div className="f sm">{s.projects.map((id) => { const x = data.projects.find((q) => q.id === id); return x ? `${x.name} · ${x.domain}` : id; }).join(', ') || s.hostname}</div></div>
                  <span className="f sm">на связи</span>
                </div>
              ))}
              <div className="su-hint">Проект встанет рядом с остальными: отдельный сайт в Caddy, свой сертификат и DKIM-ключ. Команда на сервере не нужна.</div>
            </div>}
            <div className="su-field" style={{ marginBottom: p.has_site ? 14 : 0 }}>
              <label>Домен мини-приложения</label>
              <input className="input mono" style={{ width: '100%' }} placeholder={`app.${p.id}.ru`} value={domain} autoCapitalize="off" spellCheck={false}
                onChange={(e) => setDomain(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
              {dom && !isDomain(dom) && <div className="su-note">Похоже на опечатку в домене</div>}
              <div className="su-hint">С этого домена бот открывает мини-приложение, а пользователям приходят письма. A-запись должна указывать на IP сервера — иначе сертификат не выпустится.</div>
            </div>
            {p.has_site && <div className="su-field" style={{ marginBottom: 0 }}>
              <label>Домен сайта <span className="f">— необязательно: сайт в браузере вместо мини-приложения</span></label>
              <input className="input mono" style={{ width: '100%' }} placeholder={`${p.id}.ru`} value={site} autoCapitalize="off" spellCheck={false} onChange={(e) => setSite(e.target.value)} />
              <div className="su-hint">{siteBad ? 'Домен сайта должен отличаться от домена мини-приложения' : 'A-запись — на тот же IP. Без него сайт открывается на домене мини-приложения.'}</div>
            </div>}
            {formErr && <div className="su-err">{formErr}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
              <button className="btn ghost" onClick={onClose}>Отмена</button>
              <button className="btn solid" disabled={!valid || busy} onClick={go}>{busy ? 'Минутку…' : mode === 'new' ? 'Получить команду' : 'Установить'}</button>
            </div>
          </> : <>
            <dl className="su-kv" style={{ margin: '0 0 16px' }}>
              <dt>Сервер</dt><dd className="mono">{inst!.server_ip}</dd>
              <dt>Домен</dt><dd className="mono">{inst!.domain}{inst!.site_domain ? `, ${inst!.site_domain}` : ''}</dd>
            </dl>
            {phase === 'wait' && !inst!.connected && <>
              <label>Выполните на сервере от root</label>
              {cmd ? <div className="su-cmd"><code><span className="p">$ </span>{cmd}</code>
                <button className="btn sm" onClick={() => copyToClipboard(cmd)}>Копировать</button></div>
                : <div className="su-note">Команда показывается один раз. Закрыли окно — <button className="su-link" onClick={cancel}>получите новую</button>.</div>}
              <div className="su-hint">Команда одноразовая и действует {Math.max(1, Math.round((inst!.expires_in || 0) / 60))} мин. На сервере появится «Ожидание панели…», дальше всё пойдёт само.</div>
            </>}
            {(phase === 'run' || phase === 'done' || phase === 'error' || inst!.connected) && (
              <ul className="su-steps" style={{ marginTop: phase === 'wait' ? 0 : 4 }}>{inst!.steps.map((s, i) => {
                const cls = phase === 'done' || i < inst!.step_index ? 'done'
                  : i === inst!.step_index ? (phase === 'error' ? 'bad' : 'now') : '';
                return <li key={s.key} className={cls}><span className="sd" />{i === inst!.step_index && inst!.label && phase !== 'done' ? inst!.label : s.label}</li>;
              })}</ul>
            )}
            {phase === 'error' && <div className="su-err">{inst!.error}</div>}
            {phase === 'done' && <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 550 }}>Почта</div>
              <div className="f sm" style={{ margin: '2px 0 0' }}>Письма будут уходить через этот сервер. Чтобы они не попадали в спам, добавьте записи в DNS домена — можно позже.</div>
              <MailRecords pid={p.id} />
            </div>}
          </>}
        </div>
        {phase !== 'form' && <div className="su-status">
          <Ring phase={phase === 'wait' ? 'wait' : phase === 'run' ? 'run' : phase === 'done' ? 'done' : 'error'} pct={inst?.pct || 0} />
          <div className="txt"><div className="st1">{st1}</div><div className="st2" title={st2}>{st2}</div></div>
          {phase === 'done' && <button className="btn solid" onClick={onFinish}>Настроить проект →</button>}
          {phase === 'error' && <>
            {inst?.server_online && <button className="btn solid" onClick={retry}>Повторить</button>}
            <button className="btn" onClick={cancel}>Изменить</button>
          </>}
          {phase === 'wait' && !inst?.connected && <button className="btn ghost" onClick={cancel}>Отменить</button>}
        </div>}
      </div>
    </div>, document.body);
}
