import React, { useEffect, useState } from 'react';
import { Copy, Megaphone, Save } from 'lucide-react';
import { DCard, InfoRow } from '../../components/ui';
import { apiFetch, copyToClipboard, parseErr } from '../../lib/api';
import type { ToastType } from '../../lib/types';

export interface AmbassadorInfo {
  active: boolean;
  tg: string | null; tg_mode: 'start' | 'startapp'; tg_link: string | null;
  site: string | null; site_link: string | null; site_base: string;
  rate: number; rate_custom: boolean;
  default_tg_link: string | null; default_site_link: string | null;
  has_site: boolean; bot_username: string;
}

// амбассадор: свои ссылки на бота и сайт вместо стандартных + свой процент; вывод — обычный вывод реф. баланса
export const AmbassadorCard: React.FC<{
  userId: number; info: AmbassadorInfo; canEdit: boolean;
  onSaved: () => void; onToast: (t: string, m: string, ty?: ToastType) => void;
}> = ({ userId, info, canEdit, onSaved, onToast }) => {
  const [tg, setTg] = useState('');
  const [site, setSite] = useState('');
  const [rate, setRate] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTg(info.tg_link || '');
    setSite(info.site_link || info.site || '');
    setRate(info.rate_custom ? String(info.rate) : '');
  }, [info.tg_link, info.site_link, info.site, info.rate, info.rate_custom]);

  const save = async (clear = false) => {
    if (clear && !window.confirm('Убрать свои ссылки амбассадора? Снова будут стандартные ссылки (уже приглашённые останутся).')) return;
    setBusy(true);
    try {
      await apiFetch(`/panel/users/${userId}/ambassador`, {
        method: 'PUT',
        body: JSON.stringify(clear ? { tg: '', site: '' } : { tg, site, rate: rate.trim() === '' ? 0 : Number(rate) }),
      });
      onToast('Готово', clear ? 'Ссылки амбассадора убраны' : 'Амбассадор сохранён', 'success');
      onSaved();
    } catch (e) { onToast('Ошибка', parseErr(e), 'error'); }
    finally { setBusy(false); }
  };

  const copy = async (v: string | null) => { if (v && await copyToClipboard(v)) onToast('Скопировано', v, 'success'); };
  const linkRow = (label: string, v: string | null, def: string | null) => (
    <InfoRow label={label}>
      {v ? <span className="mono" style={{ wordBreak: 'break-all' }}>{v}</span>
        : <span className="faint" style={{ wordBreak: 'break-all' }}>{def ? `стандартная: ${def}` : '—'}</span>}
      {(v || def) && <button className="icon-btn" title="Скопировать" onClick={() => void copy(v || def)}><Copy size={14} /></button>}
    </InfoRow>
  );

  return (
    <DCard title={info.active ? 'Амбассадор' : 'Амбассадор (не назначен)'} icon={Megaphone}>
      {linkRow('Ссылка Telegram', info.tg_link, info.default_tg_link)}
      {info.has_site && linkRow('Ссылка на сайт', info.site_link, info.default_site_link)}
      <InfoRow label="Процент"><span className="mono">{info.rate}%{info.rate_custom ? '' : ' (по уровню)'}</span></InfoRow>
      {canEdit && (
        <div className="flex flex-col gap-2 mt-3">
          <label className="field-label">Ссылка на бота — любая после start=</label>
          <input className="input" placeholder={`t.me/${info.bot_username || 'бот'}?start=blogger`} value={tg} onChange={(e) => setTg(e.target.value)} />
          {info.has_site && (<>
            <label className="field-label">Ссылка на сайт — любой адрес и параметры</label>
            <input className="input" placeholder={`${info.site_base || 'https://сайт'}/blogger`} value={site} onChange={(e) => setSite(e.target.value)} />
          </>)}
          <label className="field-label">Процент с оплат приглашённых (пусто — по уровню)</label>
          <input className="input" type="number" min={0} max={100} placeholder="например, 40" value={rate} onChange={(e) => setRate(e.target.value)} />
          <div className="muted sm">
            Можно вставить всю ссылку или только слово после start=. Telegram пропускает после start= только латиницу, цифры, _ и - (до 64 символов).
            Стандартные ссылки этого пользователя тоже продолжают работать. Вывод — как у всех, с реферального баланса.
          </div>
          <div className="flex gap-2">
            <button className="btn sm solid" disabled={busy} onClick={() => void save()}><Save size={14} /> Сохранить</button>
            {info.active && <button className="btn sm danger" disabled={busy} onClick={() => void save(true)}>Убрать ссылки</button>}
          </div>
        </div>
      )}
    </DCard>
  );
};
