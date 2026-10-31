import React, { useEffect, useState } from 'react';
import { AlertTriangle, Ban, Copy, KeyRound, LogOut, Plus, Save, Smartphone } from 'lucide-react';
import { Modal, Spinner, Toggle } from '../../components/ui';
import { apiFetch, copyToClipboard, parseApiErr } from '../../lib/api';
import { fmtDateTime, fmtInt } from '../../lib/format';
import type { ToastType } from '../../lib/types';

// «Приложение (API)» проекта: API v1 для мобильного приложения (src/core/apiv1.py, apiv1_app.py).
// Ключи приложения создаются здесь; сам ключ показывается один раз, в базе — только хеш.

type Toast = (t: string, m: string, ty: ToastType) => void;
type Key = { id: number; name: string; prefix: string; created_at: string; created_by: string | null;
  last_used_at: string | null; revoked_at: string | null; sessions: number };
type Settings = { enabled: boolean; key_required: boolean; return_url: string; invite_url: string; whitelist_included: boolean };
type View = { project: { id: string; name: string }; settings: Settings; keys: Key[]; sessions_active: number;
  base_urls: string[]; webhook_url: string | null };

const F: React.FC<{ label: string; hint?: React.ReactNode; children: React.ReactNode }> = ({ label, hint, children }) => (
  <div><label className="field-label">{label}</label>{children}{hint && <div className="faint" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.5 }}>{hint}</div>}</div>
);

const Row: React.FC<{ title: string; hint: string; on: boolean; onChange: () => void }> = ({ title, hint, on, onChange }) => (
  <div className="flex items-start justify-between gap-4" style={{ padding: '10px 0' }}>
    <div><div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div><div className="faint" style={{ fontSize: 12, marginTop: 2, lineHeight: 1.5 }}>{hint}</div></div>
    <Toggle on={on} onChange={onChange} />
  </div>
);

export const AppApiSettingsTab: React.FC<{ onToast: Toast }> = ({ onToast }) => {
  const [v, setV] = useState<View | null>(null);
  const [s, setS] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [created, setCreated] = useState<{ key: string; name: string } | null>(null);
  const [revoking, setRevoking] = useState<Key | null>(null);
  const [killSessions, setKillSessions] = useState(false);
  const [killAll, setKillAll] = useState(false);
  const [confirm, setConfirm] = useState('');

  const apply = (r: View) => { setV(r); setS(r.settings); };
  const load = () => apiFetch('/panel/app-api').then(apply).catch((e) => onToast('Ошибка', parseApiErr(e, 'Не удалось загрузить'), 'error'));
  useEffect(() => { void load(); }, []);
  if (!v || !s) return <div style={{ padding: 40, display: 'flex', justifyContent: 'center' }}><Spinner /></div>;

  const copy = async (text: string, what: string) => {
    if (await copyToClipboard(text)) onToast('Скопировано', what, 'success'); else onToast('Ошибка', 'Не удалось скопировать', 'error');
  };
  const live = v.keys.filter((k) => !k.revoked_at);

  const save = async (patch: Partial<Settings>, msg = 'Настройки сохранены') => {
    setBusy(true);
    try { apply(await apiFetch('/panel/app-api', { method: 'PUT', body: JSON.stringify(patch) })); onToast('Готово', msg, 'success'); }
    catch (e) { onToast('Ошибка', parseApiErr(e, 'Не удалось сохранить'), 'error'); }
    finally { setBusy(false); }
  };

  const createKey = async () => {
    setBusy(true);
    try {
      const r = await apiFetch('/panel/app-api/keys', { method: 'POST', body: JSON.stringify({ name: newName.trim() }) });
      apply(r);
      setCreated({ key: r.key.key, name: r.key.name });
      setNewName('');
    } catch (e) { onToast('Ошибка', parseApiErr(e, 'Не удалось создать ключ'), 'error'); }
    finally { setBusy(false); }
  };

  const revoke = async () => {
    if (!revoking) return;
    setBusy(true);
    try {
      const r = await apiFetch(`/panel/app-api/keys/${revoking.id}?revoke_sessions=${killSessions ? 'true' : 'false'}`, { method: 'DELETE' });
      apply(r);
      onToast('Ключ отозван', killSessions ? `Завершено сессий: ${fmtInt(r.result.sessions_revoked)}` : 'Новые входы с этим ключом не пройдут', 'success');
      setRevoking(null);
    } catch (e) { onToast('Ошибка', parseApiErr(e, 'Не удалось отозвать'), 'error'); }
    finally { setBusy(false); }
  };

  const revokeAll = async () => {
    setBusy(true);
    try {
      const r = await apiFetch('/panel/app-api/sessions/revoke', { method: 'POST', body: JSON.stringify({ confirm: confirm.trim() }) });
      apply(r);
      onToast('Готово', `Завершено сессий: ${fmtInt(r.revoked)}`, 'success');
      setKillAll(false); setConfirm('');
    } catch (e) { onToast('Ошибка', parseApiErr(e, 'Не удалось'), 'error'); }
    finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="card" style={{ padding: 20 }}>
        <div className="flex items-center gap-2" style={{ marginBottom: 6 }}><Smartphone size={18} /><span className="h-sec">Приложение (API) · {v.project.name}</span></div>
        <div className="sub" style={{ fontSize: 13, lineHeight: 1.55, marginBottom: 8 }}>
          API v1 для мобильного приложения: вход (Telegram / почта), подписка и ключ подключения, оплата через ЮKassa, семья, устройства.
          Пользователь получает свои токены сам при входе — их выдавать не нужно. Здесь — ключ самого приложения и настройки.
        </div>
        <Row title="API включено" hint="Выключите — все запросы приложения этого проекта получат 503 api_disabled (вебхуки оплаты продолжают работать)."
          on={s.enabled} onChange={() => void save({ enabled: !s.enabled }, s.enabled ? 'API выключено' : 'API включено')} />
        <Row title="Требовать ключ приложения" hint={`Запросы без заголовка X-App-Key с действующим ключом отклоняются (401 app_key_invalid). Действующих ключей: ${live.length}.`}
          on={s.key_required} onChange={() => void save({ key_required: !s.key_required }, s.key_required ? 'Ключ больше не обязателен' : 'Ключ теперь обязателен')} />
        <Row title="В подписке есть обход белых списков" hint="Влияет только на поле traffic.whitelist_active в ответе подписки (у пробной всегда false)."
          on={s.whitelist_included} onChange={() => void save({ whitelist_included: !s.whitelist_included })} />
      </div>

      <div className="card" style={{ padding: 20 }}>
        <div className="flex items-center gap-2" style={{ marginBottom: 12 }}><KeyRound size={18} /><span className="h-sec">Ключи приложения</span></div>
        <div className="sub" style={{ fontSize: 13, lineHeight: 1.55, marginBottom: 14 }}>
          Ключ вшивается в сборку приложения и отправляется в заголовке <span className="mono">X-App-Key</span>. Это не секрет пользователя:
          его можно достать из приложения, поэтому он защищает от чужих клиентов и ботов, а не заменяет вход. Для новой версии приложения
          создайте новый ключ, а старый отзовите, когда старые версии перестанут быть нужны. Заодно с ключом приложение может обходить капчу входа по почте.
        </div>
        <div className="flex gap-2" style={{ marginBottom: 14 }}>
          <input className="input" style={{ maxWidth: 320 }} maxLength={60} value={newName} placeholder="Название, например «Android 1.0»"
            onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void createKey(); }} />
          <button className="btn solid" disabled={busy} onClick={() => void createKey()}><Plus size={15} /> Создать ключ</button>
        </div>
        {v.keys.length === 0 ? <div className="faint" style={{ fontSize: 13 }}>Ключей пока нет</div> : (
          <div className="tbl-wrap"><div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead><tr><th>Название</th><th>Ключ</th><th>Создан</th><th>Последний запрос</th><th>Сессий</th><th></th></tr></thead>
              <tbody>
                {v.keys.map((k) => (
                  <tr key={k.id} style={{ opacity: k.revoked_at ? 0.5 : 1 }}>
                    <td style={{ fontWeight: 600 }}>{k.name}</td>
                    <td className="mono sub" style={{ fontSize: 12 }}>{k.prefix}…</td>
                    <td className="sub" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmtDateTime(k.created_at).slice(0, 16)}</td>
                    <td className="sub" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{k.last_used_at ? fmtDateTime(k.last_used_at).slice(0, 16) : '—'}</td>
                    <td>{fmtInt(k.sessions)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {k.revoked_at ? <span className="badge line">Отозван</span> : (
                        <button className="btn sm danger" onClick={() => { setKillSessions(false); setRevoking(k); }}><Ban size={14} /> Отозвать</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div></div>
        )}
      </div>

      <div className="card" style={{ padding: 20 }}>
        <div className="h-sec" style={{ marginBottom: 12 }}>Ссылки</div>
        <div className="flex flex-col gap-4">
          <F label="Возврат после оплаты" hint={<>Куда ЮKassa вернёт человека после оплаты из приложения: ссылка приложения (например <span className="mono">fgn://payment?id={'{payment_id}'}</span>) или https. <span className="mono">{'{payment_id}'}</span> заменится на номер покупки. Пусто — на сайт/мини-приложение проекта.</>}>
            <input className="input mono" value={s.return_url} maxLength={320} onChange={(e) => setS({ ...s, return_url: e.target.value })} placeholder="fgn://payment?id={payment_id}" />
          </F>
          <F label="Ссылка-приглашение в семью" hint={<><span className="mono">{'{code}'}</span> заменится на код семьи. Пусто — <span className="mono">{'<сайт проекта>/family?code=…'}</span>.</>}>
            <input className="input mono" value={s.invite_url} maxLength={320} onChange={(e) => setS({ ...s, invite_url: e.target.value })} placeholder="https://fgn.example/invite/{code}" />
          </F>
          <div><button className="btn solid" disabled={busy} onClick={() => void save({ return_url: s.return_url, invite_url: s.invite_url })}>
            {busy ? <Spinner size={15} /> : <Save size={15} />} Сохранить ссылки</button></div>
        </div>
      </div>

      <div className="card" style={{ padding: 20 }}>
        <div className="h-sec" style={{ marginBottom: 12 }}>Для разработчика приложения</div>
        <div className="flex flex-col gap-3" style={{ fontSize: 13 }}>
          {v.base_urls.length === 0 ? <div className="faint">Адрес мини-приложения проекта не настроен</div> : v.base_urls.map((u) => (
            <div key={u} className="flex items-center gap-2"><span className="sub" style={{ minWidth: 110 }}>Адрес API</span>
              <span className="mono">{u}</span><button className="btn ghost sm" onClick={() => void copy(u, 'Адрес API')}><Copy size={13} /></button></div>
          ))}
          <div className="flex items-center gap-2"><span className="sub" style={{ minWidth: 110 }}>Заголовок</span>
            <span className="mono">X-Project: {v.project.id}</span><span className="faint">(нужен на общем домене API)</span></div>
          {v.webhook_url && <div className="flex items-center gap-2"><span className="sub" style={{ minWidth: 110 }}>Вебхук ЮKassa</span>
            <span className="mono">{v.webhook_url}</span><button className="btn ghost sm" onClick={() => void copy(v.webhook_url as string, 'Адрес вебхука')}><Copy size={13} /></button></div>}
          <div className="faint">Документация: docs/API_V1_CLIENT.md в репозитории.</div>
        </div>
      </div>

      <div className="card" style={{ padding: 20 }}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="h-sec">Сессии приложения</div>
            <div className="sub" style={{ fontSize: 13, marginTop: 4 }}>Сейчас вошли: {fmtInt(v.sessions_active)}. При утечке — завершите все: каждому придётся войти заново.</div>
          </div>
          <button className="btn danger" disabled={busy || v.sessions_active === 0} onClick={() => { setConfirm(''); setKillAll(true); }}><LogOut size={15} /> Завершить все</button>
        </div>
      </div>

      {created && (
        <Modal onClose={() => setCreated(null)} title={`Ключ «${created.name}»`} icon={KeyRound} width={560}
          footer={<><button className="btn" onClick={() => void copy(created.key, 'Ключ приложения')}><Copy size={15} /> Скопировать</button>
            <button className="btn solid" onClick={() => setCreated(null)}>Я сохранил ключ</button></>}>
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-2" style={{ fontSize: 13, color: 'var(--muted)' }}>
              <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} /> Ключ показывается один раз — потом его не посмотреть, только создать новый.
            </div>
            <div className="mono card" style={{ padding: 12, wordBreak: 'break-all', fontSize: 13 }}>{created.key}</div>
            <div className="faint" style={{ fontSize: 12 }}>Заголовок запроса: <span className="mono">X-App-Key: {created.key.slice(0, 10)}…</span></div>
          </div>
        </Modal>
      )}

      {revoking && (
        <Modal onClose={() => !busy && setRevoking(null)} title={`Отозвать ключ «${revoking.name}»`} icon={Ban} width={500}
          footer={<><button className="btn" disabled={busy} onClick={() => setRevoking(null)}>Отмена</button>
            <button className="btn danger" disabled={busy} onClick={() => void revoke()}>{busy ? <Spinner size={15} /> : <Ban size={15} />} Отозвать</button></>}>
          <div className="flex flex-col gap-3" style={{ fontSize: 13.5, lineHeight: 1.55 }}>
            <div className="sub">Запросы с этим ключом перестанут приниматься — приложения с ним не смогут войти и работать.</div>
            <label className="flex items-center gap-2" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={killSessions} onChange={(e) => setKillSessions(e.target.checked)} />
              Сразу завершить сессии, выданные с этим ключом ({fmtInt(revoking.sessions)})
            </label>
          </div>
        </Modal>
      )}

      {killAll && (
        <Modal onClose={() => !busy && setKillAll(false)} title="Завершить все сессии приложения" icon={LogOut} width={480}
          footer={<><button className="btn" disabled={busy} onClick={() => setKillAll(false)}>Отмена</button>
            <button className="btn danger" disabled={busy || confirm.trim().toLowerCase() !== v.project.id} onClick={() => void revokeAll()}>
              {busy ? <Spinner size={15} /> : <LogOut size={15} />} Завершить</button></>}>
          <div className="flex flex-col gap-3">
            <div className="sub" style={{ fontSize: 13.5 }}>Все пользователи приложения {v.project.name} выйдут и должны будут войти заново. Мини-приложение и сайт не затрагиваются.</div>
            <div className="sub" style={{ fontSize: 13.5 }}>Для подтверждения введите <b className="mono" style={{ color: 'var(--text)' }}>{v.project.id}</b></div>
            <input className="input mono" autoFocus value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={v.project.id} />
          </div>
        </Modal>
      )}
    </div>
  );
};
