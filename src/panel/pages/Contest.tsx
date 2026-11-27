import React, { useCallback, useEffect, useState } from 'react';
import { Download, RefreshCw, ShoppingBag, Trash2, Trophy, Users, Wallet } from 'lucide-react';
import { PageHead, Spinner, Stat, Toggle } from '../components/ui';
import { apiFetch, parseApiErr } from '../lib/api';
import { fmtDateTime, fmtInt, fmtMoney } from '../lib/format';
import type { ToastType } from '../lib/types';

type Toast = (t: string, m: string, ty: ToastType) => void;
type Entry = {
  id: number; payment_id: string; user_id: number; telegram_id: number | null; username: string | null; first_name: string | null;
  purpose: string; months: number; devices: number | null; amount: number; currency: string; provider: string | null; created_at: string;
};
type Data = {
  enabled: boolean; start_at: string | null; title: string; running: boolean;
  stats: { purchases: number; users: number; amount: number }; items: Entry[];
};

const pad = (n: number) => String(n).padStart(2, '0');
// ISO → значение для <input type="datetime-local"> (местное время браузера)
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
// ближайшие 16:00
const next16 = () => {
  const d = new Date(); d.setSeconds(0, 0);
  if (d.getHours() >= 16) d.setDate(d.getDate() + 1);
  d.setHours(16, 0);
  return toLocalInput(d.toISOString());
};
const purposeRu = (p: string) => (p === 'extend' ? 'Продление' : 'Покупка');
const monthsRu = (m: number) => (m === 1 ? '1 мес.' : `${m} мес.`);

// CSV для Excel: BOM + «;» — открывается двойным кликом с кириллицей
const toCsv = (items: Entry[]) => {
  const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ['№', 'Дата и время', 'Telegram ID', 'Username', 'Имя', 'Тип', 'Срок, мес.', 'Устройств', 'Сумма', 'Валюта', 'Оплата', 'ID в боте', 'Платёж'];
  const rows = [...items].reverse().map((e, i) => [
    i + 1, fmtDateTime(e.created_at), e.telegram_id ?? '', e.username ? `@${e.username}` : '', e.first_name ?? '',
    purposeRu(e.purpose), e.months, e.devices ?? '', String(e.amount).replace('.', ','), e.currency, e.provider ?? '', e.user_id, e.payment_id,
  ]);
  return '﻿' + [head, ...rows].map((r) => r.map(esc).join(';')).join('\r\n');
};

export const ContestPage: React.FC<{ onToast: Toast; onOpenUser?: (id: number) => void; readOnly?: boolean }> = ({ onToast, onOpenUser, readOnly }) => {
  const [data, setData] = useState<Data | null>(null);
  const [start, setStart] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d: Data = await apiFetch('/panel/contest');
      setData(d);
      setStart(d.start_at ? toLocalInput(d.start_at) : next16());
      setTitle(d.title || '');
    } catch (e) { onToast('Ошибка', parseApiErr(e, 'Не удалось загрузить конкурс'), 'error'); }
  }, [onToast]);
  useEffect(() => { void load(); }, [load]);
  // пока конкурс идёт — список обновляется сам
  useEffect(() => {
    if (!data?.enabled) return;
    const t = setInterval(() => { void load(); }, 30000);
    return () => clearInterval(t);
  }, [data?.enabled, load]);

  const save = async (patch: Partial<{ enabled: boolean; start_at: string; title: string }>, okMsg: string) => {
    setBusy(true);
    try {
      await apiFetch('/panel/contest', { method: 'PUT', body: JSON.stringify(patch) });
      onToast('Конкурс', okMsg, 'success');
      await load();
    } catch (e) { onToast('Ошибка', parseApiErr(e, 'Не удалось сохранить'), 'error'); } finally { setBusy(false); }
  };

  const startIso = () => (start ? new Date(start).toISOString() : '');
  const toggle = () => {
    if (!data) return;
    if (data.enabled) {
      if (!confirm('Выключить конкурс?\n\nНовые покупки перестанут попадать в таблицу. Уже записанные останутся.')) return;
      void save({ enabled: false }, 'Выключен — новые покупки больше не записываются');
    } else {
      const when = start ? new Date(start) : null;
      const msg = when && when > new Date() ? `Покупки начнут записываться с ${when.toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}` : 'Покупки записываются с этого момента';
      void save({ enabled: true, start_at: startIso(), title }, msg);
    }
  };
  const clear = async () => {
    if (!data?.stats.purchases) return;
    if (!confirm(`Очистить таблицу?\n\nБудет удалено ${fmtInt(data.stats.purchases)} записей. Скачайте таблицу заранее, если она нужна.`)) return;
    setBusy(true);
    try { await apiFetch('/panel/contest/entries', { method: 'DELETE' }); onToast('Конкурс', 'Таблица очищена', 'success'); await load(); }
    catch (e) { onToast('Ошибка', parseApiErr(e, 'Не удалось очистить'), 'error'); } finally { setBusy(false); }
  };
  const download = () => {
    if (!data) return;
    const d = new Date();
    const name = `konkurs-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.csv`;
    const url = URL.createObjectURL(new Blob([toCsv(data.items)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (!data) return <div className="flex justify-center" style={{ padding: 60 }}><Spinner size={24} /></div>;

  const waiting = data.enabled && !data.running;
  const status = !data.enabled
    ? { cls: 'line', label: 'Выключен' }
    : waiting ? { cls: 'mute', label: `Старт ${fmtDateTime(data.start_at)}` } : { cls: 'solid', label: 'Идёт — покупки записываются' };

  return (
    <div className="flex flex-col gap-6">
      <PageHead title="Конкурс" sub="Все, кто купил или продлил подписку после старта, попадают в отдельную таблицу">
        <button className="btn" onClick={() => void load()}><RefreshCw size={15} /> Обновить</button>
      </PageHead>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Stat title="Покупок" value={fmtInt(data.stats.purchases)} icon={ShoppingBag} />
        <Stat title="Участников" value={fmtInt(data.stats.users)} icon={Users} sub="уникальных пользователей" />
        <Stat title="Сумма" value={fmtMoney(data.stats.amount)} icon={Wallet} />
      </div>

      <div className="card" style={{ padding: 24 }}>
        <div className="flex flex-col md:flex-row md:items-end gap-4">
          <div style={{ flex: 1 }}>
            <label className="field-label">Название (для себя)</label>
            <input className="input" value={title} disabled={readOnly} onChange={(e) => setTitle(e.target.value)} placeholder="Например: Розыгрыш 25 ноября" />
          </div>
          <div>
            <label className="field-label">Старт</label>
            <input className="input" type="datetime-local" value={start} disabled={readOnly || data.enabled} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="flex items-center gap-3" style={{ paddingBottom: 6 }}>
            <Toggle on={data.enabled} onChange={() => { if (!readOnly && !busy) toggle(); }} />
            <span className={`badge ${status.cls}`}>{status.label}</span>
          </div>
        </div>
        <div className="faint mt-3" style={{ fontSize: 12 }}>
          Время — по часам этого компьютера. Записываются оплаченные покупки и продления подписки (докупка устройств и подарки — нет).
          Выключение останавливает запись, таблица при этом сохраняется. Чтобы поменять время старта — выключите конкурс.
          {data.enabled && title !== (data.title || '') && !readOnly ? <> <button className="btn sm" style={{ marginLeft: 6 }} disabled={busy} onClick={() => void save({ title }, 'Название сохранено')}>Сохранить название</button></> : null}
        </div>
      </div>

      <div className="tbl-wrap">
        <div className="flex items-center justify-between gap-2" style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <h3 className="h-sec flex items-center gap-2"><Trophy size={16} /> Участники</h3>
          <span className="inline-flex gap-2">
            <button className="btn sm" disabled={!data.items.length} onClick={download}><Download size={14} /> Скачать (Excel)</button>
            {!readOnly && <button className="btn sm danger" disabled={busy || !data.items.length} onClick={() => void clear()}><Trash2 size={14} /> Очистить</button>}
          </span>
        </div>
        {data.items.length === 0
          ? <div className="sub" style={{ padding: 24, textAlign: 'center' }}>{data.enabled ? (waiting ? 'Конкурс ещё не начался' : 'Пока никто не купил') : 'Включите конкурс — сюда начнут попадать покупки'}</div>
          : <div style={{ overflowX: 'auto' }}><table className="tbl">
              <thead><tr><th>№</th><th>Когда</th><th>Пользователь</th><th>Telegram ID</th><th>Тип</th><th>Срок</th><th>Устр.</th><th style={{ textAlign: 'right' }}>Сумма</th></tr></thead>
              <tbody>{data.items.map((e, i) => (
                <tr key={e.id}>
                  <td className="muted">{data.items.length - i}</td>
                  <td className="muted" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(e.created_at)}</td>
                  <td>
                    <button className="link" style={{ background: 'none', border: 'none', padding: 0, cursor: onOpenUser ? 'pointer' : 'default', color: 'inherit', textAlign: 'left' }}
                      onClick={() => onOpenUser?.(e.user_id)}>
                      {e.username ? `@${e.username}` : e.first_name || `id${e.user_id}`}
                    </button>
                    {e.username && e.first_name ? <span className="faint" style={{ marginLeft: 6 }}>{e.first_name}</span> : null}
                  </td>
                  <td className="mono muted">{e.telegram_id ?? '—'}</td>
                  <td><span className={`badge ${e.purpose === 'extend' ? 'line' : 'solid'}`}>{purposeRu(e.purpose)}</span></td>
                  <td className="muted">{monthsRu(e.months)}</td>
                  <td className="muted">{e.devices ?? '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>{e.currency === 'RUB' ? fmtMoney(e.amount) : `${fmtInt(e.amount)} ${e.currency === 'XTR' ? '⭐' : e.currency}`}</td>
                </tr>
              ))}</tbody>
            </table></div>}
      </div>
    </div>
  );
};
