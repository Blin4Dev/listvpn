import React, { useCallback, useEffect, useState } from 'react';
import { Ban, CheckCircle2, Copy, Download, Gift, Link as LinkIcon, Plus, Search, Timer } from 'lucide-react';
import { DotsMenu, Modal, PageHead, Segmented, Spinner, Stat, Toggle } from '../components/ui';
import { apiFetch, copyToClipboard, parseApiErr } from '../lib/api';
import { fmtDateTime, fmtInt } from '../lib/format';
import type { ToastType } from '../lib/types';

type Toast = (t: string, m: string, ty: ToastType) => void;
type Status = 'issued' | 'redeemed' | 'expired' | 'revoked';
type Item = {
  id: number; code: string; link: string; status: Status; months: number; whitelist: boolean; note: string; batch: string;
  one_per_user: boolean; created_at: string; expires_at: string | null; redeemed_at: string | null;
  redeemed_by: number | null; redeemed_username: string | null; redeemed_tg: number | null;
};
type Data = { total: number; stats: Record<Status, number>; items: Item[]; periods: number[]; whitelist_available: boolean };
type Created = { batch: string; months: number; whitelist: boolean; expires_at: string | null; items: { code: string; link: string }[] };

const STATUS_RU: Record<Status, string> = { issued: 'Не активирован', redeemed: 'Активирован', expired: 'Истёк', revoked: 'Отменён' };
const STATUS_CLS: Record<Status, string> = { issued: 'mute', redeemed: 'solid', expired: 'line', revoked: 'danger' };
const monthsRu = (m: number) => (m === 1 ? '1 месяц' : m < 5 ? `${m} месяца` : `${m} месяцев`);
const PAGE = 50;

const download = (name: string, text: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const CreateModal: React.FC<{ data: Data; onClose: () => void; onCreated: (c: Created) => void; onToast: Toast }> = ({ data, onClose, onCreated, onToast }) => {
  const [count, setCount] = useState('1');
  const [months, setMonths] = useState(data.periods[0] || 1);
  const [whitelist, setWhitelist] = useState(false);
  const [note, setNote] = useState('');
  const [limited, setLimited] = useState(false);
  const [days, setDays] = useState('30');
  const [onePer, setOnePer] = useState(true);
  const [busy, setBusy] = useState(false);
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const submit = async () => {
    if (n < 1 || n > 500) { onToast('Ошибка', 'Количество: от 1 до 500', 'error'); return; }
    if (limited && !(Number(days) >= 1 && Number(days) <= 3650)) { onToast('Ошибка', 'Срок действия кода: от 1 до 3650 дней', 'error'); return; }
    setBusy(true);
    try {
      const r = await apiFetch('/panel/gifts', { method: 'POST', body: JSON.stringify({
        count: n, months, whitelist, note: note.trim() || null, valid_days: limited ? Math.floor(Number(days)) : null, one_per_user: onePer,
      }) });
      onCreated(r);
    } catch (e) { onToast('Ошибка', parseApiErr(e, 'Не удалось создать'), 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} title="Подарочная подписка" icon={Gift} width={520} footer={
      <><button className="btn" onClick={onClose}>Отмена</button>
        <button className="btn solid" disabled={busy || n < 1} onClick={() => void submit()}>{busy ? <Spinner size={15} /> : <Plus size={15} />} Создать {n > 1 ? `${n} кодов` : 'код'}</button></>
    }>
      <div className="flex flex-col gap-4">
        <div>
          <label className="field-label">Срок подписки</label>
          <div className="flex flex-wrap gap-2">
            {data.periods.map((m) => <button key={m} className={`chip ${months === m ? 'on' : ''}`} onClick={() => setMonths(m)}>{monthsRu(m)}</button>)}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="field-label">Количество кодов</label>
            <input className="input" type="number" min={1} max={500} value={count} onChange={(e) => setCount(e.target.value)} />
            <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>Каждый код одноразовый</div>
          </div>
          <div>
            <label className="field-label">Заметка (видна только в панели)</label>
            <input className="input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Розыгрыш в канале" />
          </div>
        </div>
        <label className="flex items-center justify-between gap-3">
          <span><span style={{ fontWeight: 600, fontSize: 14 }}>С белыми списками</span><br />
            <span className="faint" style={{ fontSize: 12 }}>{data.whitelist_available ? 'Как анти-тариф: VPN + белые списки (FurkVPN)' : 'Белые списки не настроены — нет FURK_API_KEY'}</span></span>
          <Toggle on={whitelist && data.whitelist_available} onChange={() => data.whitelist_available && setWhitelist(!whitelist)} />
        </label>
        <label className="flex items-center justify-between gap-3">
          <span><span style={{ fontWeight: 600, fontSize: 14 }}>Ограничить срок действия кода</span><br />
            <span className="faint" style={{ fontSize: 12 }}>Не успели активировать — код сгорает</span></span>
          <Toggle on={limited} onChange={() => setLimited(!limited)} />
        </label>
        {limited && (
          <div style={{ maxWidth: 220 }}>
            <label className="field-label">Действует, дней</label>
            <input className="input" type="number" min={1} max={3650} value={days} onChange={(e) => setDays(e.target.value)} />
          </div>
        )}
        {n > 1 && (
          <label className="flex items-center justify-between gap-3">
            <span><span style={{ fontWeight: 600, fontSize: 14 }}>Один код на человека</span><br />
              <span className="faint" style={{ fontSize: 12 }}>Один пользователь не активирует два кода из этой пачки</span></span>
            <Toggle on={onePer} onChange={() => setOnePer(!onePer)} />
          </label>
        )}
        <div className="sub" style={{ fontSize: 13, lineHeight: 1.5 }}>
          Код активируется в приложении: «Активировать подарок» или по ссылке на бота. Подписка добавляется к текущей
          (продлевается), устройства — по тарифу.
        </div>
      </div>
    </Modal>
  );
};

const CreatedModal: React.FC<{ c: Created; onClose: () => void; onToast: Toast }> = ({ c, onClose, onToast }) => {
  const codes = c.items.map((i) => i.code).join('\n');
  const links = c.items.map((i) => i.link).join('\n');
  const copy = async (t: string, what: string) => { if (await copyToClipboard(t)) onToast('Скопировано', what, 'success'); };
  return (
    <Modal onClose={onClose} title={`Готово: ${c.items.length} ${c.items.length === 1 ? 'код' : 'кодов'}`} icon={CheckCircle2} width={560} footer={
      <><button className="btn" onClick={() => download(`gifts-${c.batch}.txt`, c.items.map((i) => `${i.code}\t${i.link}`).join('\n') + '\n')}><Download size={15} /> Скачать</button>
        <button className="btn" onClick={() => void copy(links, 'Ссылки')}><LinkIcon size={15} /> Ссылки</button>
        <button className="btn solid" onClick={() => void copy(codes, 'Коды')}><Copy size={15} /> Коды</button></>
    }>
      <div className="sub" style={{ fontSize: 13, marginBottom: 10 }}>
        {monthsRu(c.months)}{c.whitelist ? ' + белые списки' : ''}{c.expires_at ? ` · действует до ${fmtDateTime(c.expires_at).slice(0, 16)}` : ''}
      </div>
      <div className="mono" style={{ maxHeight: 320, overflow: 'auto', fontSize: 13, lineHeight: 1.7, padding: 12, borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}>
        {c.items.map((i) => (
          <div key={i.code} className="flex justify-between gap-3">
            <span style={{ userSelect: 'all' }}>{i.code}</span>
            <button className="icon-btn" title="Скопировать ссылку" onClick={() => void copy(i.link, i.code)}><LinkIcon size={14} /></button>
          </div>
        ))}
      </div>
    </Modal>
  );
};

export const GiftsPage: React.FC<{ onToast: Toast; onOpenUser: (id: number) => void }> = ({ onToast, onOpenUser }) => {
  const [data, setData] = useState<Data | null>(null);
  const [status, setStatus] = useState<'' | Status>('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const p = new URLSearchParams({ status, q: query, limit: String(PAGE), offset: String(page * PAGE) });
    apiFetch(`/panel/gifts?${p}`).then(setData).catch((e) => onToast('Ошибка', parseApiErr(e, 'Не удалось загрузить подарки'), 'error')).finally(() => setLoading(false));
  }, [status, query, page, onToast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setTimeout(() => { setPage(0); setQuery(q.trim()); }, 350); return () => clearTimeout(t); }, [q]);

  const revoke = async (ids: number[], what: string) => {
    if (!window.confirm(`Отменить ${what}? Активировать ${ids.length > 1 ? 'их' : 'его'} будет нельзя. Уже активированные не затронутся.`)) return;
    try { const r = await apiFetch('/panel/gifts/revoke', { method: 'POST', body: JSON.stringify({ ids }) }); onToast('Готово', `Отменено: ${r.revoked}`, 'success'); load(); }
    catch (e) { onToast('Ошибка', parseApiErr(e, 'Не удалось'), 'error'); }
  };
  const copy = async (t: string, what: string) => { if (await copyToClipboard(t)) onToast('Скопировано', what, 'success'); };

  if (!data) return <div style={{ padding: 40, display: 'flex', justifyContent: 'center' }}><Spinner /></div>;
  const pages = Math.max(1, Math.ceil(data.total / PAGE));
  const issuedHere = data.items.filter((i) => i.status === 'issued');

  return (
    <div className="flex flex-col gap-5">
      <PageHead title="Подарки" sub="Подарочные подписки: одноразовые коды и ссылки, которые можно раздать кому угодно">
        <button className="btn solid" onClick={() => setCreating(true)}><Plus size={15} /> Создать</button>
      </PageHead>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat title="Не активированы" value={fmtInt(data.stats.issued)} icon={Gift} />
        <Stat title="Активированы" value={fmtInt(data.stats.redeemed)} icon={CheckCircle2} />
        <Stat title="Истекли" value={fmtInt(data.stats.expired)} icon={Timer} />
        <Stat title="Отменены" value={fmtInt(data.stats.revoked)} icon={Ban} />
      </div>
      <div className="flex flex-col md:flex-row gap-3 md:items-center justify-between">
        <Segmented value={status} onChange={(v) => { setPage(0); setStatus(v); }} options={[
          { value: '', label: 'Все' }, { value: 'issued', label: 'Свободные' }, { value: 'redeemed', label: 'Активированные' },
          { value: 'expired', label: 'Истёкшие' }, { value: 'revoked', label: 'Отменённые' },
        ]} />
        <div className="flex gap-2 items-center">
          <div style={{ position: 'relative', minWidth: 240 }}>
            <Search size={15} className="faint" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
            <input className="input" style={{ paddingLeft: 32 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Код, заметка, ID или @username" />
          </div>
          {loading && <Spinner size={16} />}
        </div>
      </div>
      {data.items.length === 0 ? (
        <div className="card flex flex-col items-center sub" style={{ padding: 40, gap: 10, textAlign: 'center' }}>
          <Gift size={30} className="faint" />
          <div>{query || status ? 'Ничего не найдено' : 'Подарков пока нет'}</div>
          {!query && !status && <div style={{ fontSize: 13, maxWidth: 440 }}>Создайте код на 1–12 месяцев и отправьте ссылку человеку — подписка начислится при активации.</div>}
        </div>
      ) : (
        <div className="tbl-wrap"><div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead><tr><th>Код</th><th>Подписка</th><th>Статус</th><th>Кто активировал</th><th>Создан</th><th>Заметка</th><th></th></tr></thead>
            <tbody>
              {data.items.map((it) => (
                <tr key={it.id} style={{ opacity: it.status === 'revoked' || it.status === 'expired' ? 0.55 : 1 }}>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>{it.code}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{monthsRu(it.months)}{it.whitelist && <span className="badge mute" style={{ marginLeft: 6 }}>+ БС</span>}</td>
                  <td><span className={`badge ${STATUS_CLS[it.status]}`}>{STATUS_RU[it.status]}</span>
                    {it.status === 'issued' && it.expires_at && <div className="faint" style={{ fontSize: 11, marginTop: 2 }}>до {fmtDateTime(it.expires_at).slice(0, 10)}</div>}</td>
                  <td>{it.redeemed_by ? (
                    <button className="btn ghost sm" style={{ padding: 0, color: 'var(--text)', textAlign: 'left', display: 'block' }} onClick={() => onOpenUser(it.redeemed_by as number)}>
                      {it.redeemed_username ? `@${it.redeemed_username}` : `#${it.redeemed_by}`}
                      <div className="faint" style={{ fontSize: 11 }}>{it.redeemed_at ? fmtDateTime(it.redeemed_at).slice(0, 16) : ''}</div>
                    </button>) : <span className="faint">—</span>}</td>
                  <td className="sub" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmtDateTime(it.created_at).slice(0, 16)}</td>
                  <td className="sub" style={{ fontSize: 12, maxWidth: 220 }}>{it.note || '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <DotsMenu items={[
                      { label: 'Скопировать код', icon: Copy, onClick: () => void copy(it.code, it.code) },
                      { label: 'Скопировать ссылку', icon: LinkIcon, onClick: () => void copy(it.link, 'Ссылка на подарок') },
                      it.batch && { label: 'Показать всю пачку', icon: Search, onClick: () => { setStatus(''); setPage(0); setQ(it.batch); } },
                      it.status === 'issued' && { label: 'Отменить', icon: Ban, danger: true, onClick: () => void revoke([it.id], `код ${it.code}`) },
                    ]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
      )}
      <div className="flex items-center justify-between gap-3" style={{ flexWrap: 'wrap' }}>
        <div className="flex gap-2">
          {issuedHere.length > 0 && <button className="btn" onClick={() => download('gifts.txt', issuedHere.map((i) => `${i.code}\t${i.link}`).join('\n') + '\n')}><Download size={15} /> Свободные на странице</button>}
          {issuedHere.length > 1 && <button className="btn danger" onClick={() => void revoke(issuedHere.map((i) => i.id), `${issuedHere.length} свободных кодов на странице`)}><Ban size={15} /> Отменить свободные</button>}
        </div>
        {pages > 1 && (
          <div className="flex gap-2 items-center">
            <button className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>Назад</button>
            <span className="sub" style={{ fontSize: 13 }}>{page + 1} / {pages}</span>
            <button className="btn" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Дальше</button>
          </div>
        )}
      </div>
      {creating && <CreateModal data={data} onClose={() => setCreating(false)} onToast={onToast} onCreated={(c) => { setCreating(false); setCreated(c); setPage(0); load(); }} />}
      {created && <CreatedModal c={created} onClose={() => setCreated(null)} onToast={onToast} />}
    </div>
  );
};
