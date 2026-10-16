import React, { useEffect, useState } from 'react';
import { Save, TimerReset } from 'lucide-react';
import { Spinner, Toggle } from '../../components/ui';
import { apiFetch, parseApiErr } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import type { ToastType } from '../../lib/types';
import { money } from './common';

type Recent = { id: number; staff_name: string; amount: number; fine_id: number | null; reason: string; cancelled: boolean; created_at: string };
type Cfg = { enabled: boolean; minutes: number; hours: number; pool: boolean; warn: boolean; recent: Recent[] };

// автоштрафы за обращения без ответа (только владелец)
export const AutofineCard: React.FC<{ onToast: (t: string, m: string, ty: ToastType) => void; onChanged?: () => void }> = ({ onToast, onChanged }) => {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [minutes, setMinutes] = useState('15');
  const [hours, setHours] = useState('1');
  const [busy, setBusy] = useState(false);
  const [showLog, setShowLog] = useState(false);

  const apply = (r: Cfg) => { setCfg(r); setMinutes(String(r.minutes)); setHours(String(r.hours)); };
  useEffect(() => { apiFetch('/panel/staff-autofine').then(apply).catch((e) => onToast('Ошибка', parseApiErr(e, 'Не удалось загрузить автоштрафы'), 'error')); }, []);
  if (!cfg) return <div className="card" style={{ padding: 20, display: 'flex', justifyContent: 'center' }}><Spinner /></div>;

  const save = async (patch: Partial<Cfg>, msg?: string) => {
    setBusy(true);
    try {
      const r = await apiFetch('/panel/staff-autofine', { method: 'PUT', body: JSON.stringify(patch) });
      apply(r);
      onToast('Сохранено', msg || 'Настройки автоштрафов обновлены', 'success');
      onChanged?.();
    } catch (e) {
      onToast('Ошибка', parseApiErr(e, 'Не удалось сохранить'), 'error');
    } finally { setBusy(false); }
  };
  const dirty = String(cfg.minutes) !== minutes || String(cfg.hours) !== hours;

  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2"><TimerReset size={18} /><span className="h-sec">Автоштрафы</span></div>
        <div className="flex items-center gap-2">
          <span className="sub" style={{ fontSize: 13 }}>{cfg.enabled ? 'Включены' : 'Выключены'}</span>
          {busy ? <Spinner size={16} /> : <Toggle on={cfg.enabled} onChange={() => void save({ enabled: !cfg.enabled }, cfg.enabled ? 'Автоштрафы выключены' : 'Автоштрафы включены')} />}
        </div>
      </div>
      <div className="sub" style={{ fontSize: 13, lineHeight: 1.5, marginTop: 6 }}>
        Клиент ждёт ответа в обращении {cfg.minutes} мин рабочего времени — сотруднику, который ведёт обращение, автоматически
        выписывается штраф {cfg.hours} раб. ч (оплата дня ÷ часы смены). Считаются только минуты по графику; заметки — не ответ;
        кнопка «Ожидание» в чате снимает текущий штраф без сообщения пользователю. Один штраф на одно ожидание.
        Обращения у вас и переданные вам не штрафуются. Отменить автоштраф можно в карточке сотрудника.
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4" style={{ marginTop: 14 }}>
        <div>
          <label className="field-label">Без ответа, минут</label>
          <input className="input" type="number" min={5} max={240} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </div>
        <div>
          <label className="field-label">Штраф, рабочих часов</label>
          <input className="input" type="number" min={0.25} max={8} step={0.25} value={hours} onChange={(e) => setHours(e.target.value)} />
        </div>
      </div>
      <div className="flex flex-col gap-3" style={{ marginTop: 14 }}>
        <label className="flex items-center justify-between gap-3">
          <span><span style={{ fontWeight: 600, fontSize: 14 }}>Предупреждать за 5 минут</span><br />
            <span className="faint" style={{ fontSize: 12 }}>Сообщение сотруднику в Telegram до штрафа</span></span>
          <Toggle on={cfg.warn} onChange={() => void save({ warn: !cfg.warn })} />
        </label>
        <label className="flex items-center justify-between gap-3">
          <span><span style={{ fontWeight: 600, fontSize: 14 }}>Штрафовать за общую очередь</span><br />
            <span className="faint" style={{ fontSize: 12 }}>Если обращение никто не взял — штраф всем операторам на смене</span></span>
          <Toggle on={cfg.pool} onChange={() => void save({ pool: !cfg.pool })} />
        </label>
      </div>
      <div className="flex gap-2 items-center" style={{ marginTop: 14 }}>
        <button className="btn solid" disabled={busy || !dirty} onClick={() => void save({ minutes: Number(minutes), hours: Number(hours) })}>
          {busy ? <Spinner size={15} /> : <Save size={15} />} Сохранить
        </button>
        {cfg.recent.length > 0 && <button className="btn" onClick={() => setShowLog(!showLog)}>{showLog ? 'Скрыть' : 'Последние автоштрафы'} ({cfg.recent.length})</button>}
      </div>
      {showLog && (
        <div className="flex flex-col gap-2" style={{ marginTop: 12 }}>
          {cfg.recent.map((r) => (
            <div key={r.id} className="flex justify-between gap-3" style={{ fontSize: 13, opacity: r.cancelled ? 0.5 : 1 }}>
              <div>
                <div><b>{r.staff_name}</b> · {r.fine_id ? r.reason.replace(/^Автоштраф: /, '') : 'нет оплаты за день — не начислен'}</div>
                <div className="faint" style={{ fontSize: 12 }}>{fmtDateTime(r.created_at).slice(0, 16)}{r.cancelled ? ' · отменён' : ''}</div>
              </div>
              <div className="mono" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{r.fine_id ? money(r.amount) : '—'}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
