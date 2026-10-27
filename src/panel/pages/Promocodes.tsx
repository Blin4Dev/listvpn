import React, { useState, useEffect } from 'react';
import {
  Users, Gift, Percent, Edit2, Trash2,
} from 'lucide-react';
import { Modal, PageHead, Stat } from '../components/ui';
import { apiFetch, parseApiErr } from '../lib/api';
import { useProject } from '../lib/project';
import { dateInputToIso, fmtDateRu, fmtInt, toDateInput } from '../lib/format';
import type { Promo, ToastType } from '../lib/types';

export const PromocodesStats: React.FC<{ promos: Promo[] }> = ({ promos }) => {
  const [stats, setStats] = useState<{ total: number; totalUses: number; activeCount: number } | null>(null);
  useEffect(() => { (async () => { try { const d = await apiFetch('/panel/promocodes/stats'); if (d) setStats(d); } catch (e) { console.error(e); } })(); }, []);
  const disc = promos.filter((p) => p.type !== 'days');
  const avgDiscount = disc.length ? Math.round(disc.reduce((s, p) => s + Number(p.value || 0), 0) / disc.length) : 0;
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Stat title="Активных кодов" value={stats ? stats.activeCount : promos.length} icon={Gift} />
      <Stat title="Активаций" value={stats ? fmtInt(stats.totalUses) : '0'} icon={Users} />
      <Stat title="Средняя скидка" value={`${avgDiscount}%`} icon={Percent} />
    </div>
  );
};

export const PromocodesPage: React.FC<{ onToast: (t: string, m: string, ty: ToastType) => void }> = ({ onToast }) => {
  const [promos, setPromos] = useState<Promo[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Promo | null>(null);
  // у проекта с фишкой promo_days — два вида: скидка при оплате и дни к подписке («Забрать»)
  const project = useProject();
  const withDays = !!project?.features?.promo_days;
  const [form, setForm] = useState<{ type: 'discount' | 'days'; code: string; name: string; value: string; limit: string; expires: string }>({ type: 'discount', code: '', name: '', value: '', limit: '', expires: '' });
  const valueOk = (t: string | undefined, v: number) => (t === 'days' ? Number.isInteger(v) && v >= 1 && v <= 365 : v > 0 && v <= 100);
  const valueErr = (t: string | undefined) => (t === 'days' ? 'Укажите код и число дней 1–365' : 'Укажите код и скидку 1–100%');

  const load = async () => {
    setLoading(true);
    try {
      const data = await apiFetch('/panel/promocodes');
      setPromos(Array.isArray(data) ? data.map((p: any) => ({ id: p.id, code: p.code, name: String(p.name || ''), value: String(p.value ?? ''), uses: Number(p.uses_count || 0), limit: Number(p.uses_limit || 0), expires: String(p.expires_at || ''), type: p.type === 'days' ? 'days' : 'discount' })) : []);
    } catch { onToast('Ошибка', 'Не удалось загрузить промокоды', 'error'); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    const value = Number(form.value);
    if (!form.code || !form.value || isNaN(value) || !valueOk(form.type, value)) { onToast('Ошибка', valueErr(form.type), 'error'); return; }
    try {
      await apiFetch('/panel/promocodes', { method: 'POST', body: JSON.stringify({ type: form.type, code: form.code.toUpperCase(), name: form.name || null, value, uses_limit: form.limit ? Number(form.limit) : null, expires_at: dateInputToIso(form.expires), is_active: 1 }) });
      onToast('Готово', 'Промокод создан', 'success');
      setForm({ type: form.type, code: '', name: '', value: '', limit: '', expires: '' }); load();
    } catch (e) { onToast('Ошибка', parseApiErr(e, 'Не удалось создать'), 'error'); }
  };
  const remove = async (id: number) => { if (!confirm('Удалить промокод?')) return; try { await apiFetch(`/panel/promocodes/${id}`, { method: 'DELETE' }); onToast('Готово', 'Промокод удалён', 'success'); load(); } catch { onToast('Ошибка', 'Не удалось удалить', 'error'); } };
  const save = async () => {
    if (!editing) return;
    const value = Number(editing.value);
    if (!editing.code || isNaN(value) || !valueOk(editing.type, value)) { onToast('Ошибка', valueErr(editing.type), 'error'); return; }
    try {
      await apiFetch(`/panel/promocodes/${editing.id}`, { method: 'PUT', body: JSON.stringify({ type: editing.type || 'discount', code: editing.code, name: editing.name || null, value, uses_limit: editing.limit || null, expires_at: editing.expires ? (editing.expires.length <= 10 ? dateInputToIso(editing.expires) : editing.expires) : null }) });
      onToast('Готово', 'Промокод обновлён', 'success'); setEditing(null); load();
    } catch (e) { onToast('Ошибка', parseApiErr(e, 'Не удалось обновить'), 'error'); }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHead title="Промокоды" sub={withDays
        ? 'Скидка — применяется при оплате (90 дней). Дни — «Вы получили N дней к подписке» с кнопкой «Забрать». Каждый код — один раз на человека.'
        : 'Скидочные коды. Активированный промокод действует 90 дней и только один раз.'} />
      <PromocodesStats promos={promos} />

      <div className="card" style={{ padding: 24 }}>
        <h3 className="h-sec mb-4">Новый промокод</h3>
        {withDays && (
          <div className="flex gap-2 mb-3">
            <button type="button" className={`chip ${form.type === 'discount' ? 'on' : ''}`} onClick={() => setForm({ ...form, type: 'discount' })}>Скидка при оплате</button>
            <button type="button" className={`chip ${form.type === 'days' ? 'on' : ''}`} onClick={() => setForm({ ...form, type: 'days' })}>Дни к подписке</button>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div><label className="field-label">Код</label><input className="input mono" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="НАПРИМЕР SALE20" /></div>
          <div><label className="field-label">Название</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Осенняя распродажа" /></div>
          <div><label className="field-label">{form.type === 'days' ? 'Дней к подписке' : 'Скидка, %'}</label><input className="input" type="number" min={1} max={form.type === 'days' ? 365 : 100} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder={form.type === 'days' ? '3' : '20'} /></div>
          <div><label className="field-label">Активен до</label><input className="input" type="date" value={form.expires} onChange={(e) => setForm({ ...form, expires: e.target.value })} /></div>
          <div><label className="field-label">Лимит активаций <span className="faint">(необязательно)</span></label><input className="input" type="number" value={form.limit} onChange={(e) => setForm({ ...form, limit: e.target.value })} placeholder="∞" /></div>
        </div>
        <button className="btn solid mt-4" onClick={create}>Создать</button>
      </div>

      <div className="tbl-wrap">
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}><h3 className="h-sec">Список промокодов</h3></div>
        {loading ? <div className="sub" style={{ padding: 32, textAlign: 'center' }}>Загрузка…</div>
          : promos.length === 0 ? <div className="sub" style={{ padding: 32, textAlign: 'center' }}>Промокодов пока нет</div>
          : <div style={{ overflowX: 'auto' }}><table className="tbl">
              <thead><tr><th>Код</th><th>Название</th><th>{withDays ? 'Даёт' : 'Скидка'}</th><th>Активаций</th><th>Лимит</th><th>Активен до</th><th style={{ textAlign: 'right' }}>Действия</th></tr></thead>
              <tbody>{promos.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{p.code}</td><td className="muted">{p.name || '—'}</td><td style={{ fontWeight: 600 }}>{p.type === 'days' ? `+${p.value} дн.` : `${p.value}%`}</td>
                  <td className="muted">{p.uses}</td><td className="muted">{p.limit || '∞'}</td><td className="muted">{fmtDateRu(p.expires)}</td>
                  <td style={{ textAlign: 'right' }}><span className="inline-flex gap-2"><button className="icon-btn" onClick={() => setEditing({ ...p })}><Edit2 size={14} /></button><button className="icon-btn danger" onClick={() => remove(p.id)}><Trash2 size={14} /></button></span></td>
                </tr>
              ))}</tbody>
            </table></div>}
      </div>

      {editing && (
        <Modal onClose={() => setEditing(null)} title="Редактировать промокод" width={440}
          footer={<><button className="btn block" onClick={() => setEditing(null)}>Отмена</button><button className="btn solid block" onClick={save}>Сохранить</button></>}>
          <div className="flex flex-col gap-3">
            <div><label className="field-label">Код</label><input className="input mono" value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })} placeholder="Код" /></div>
            <div><label className="field-label">Название</label><input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Название" /></div>
            <div><label className="field-label">{editing.type === 'days' ? 'Дней к подписке' : 'Скидка, %'}</label><input className="input" type="number" min={1} max={editing.type === 'days' ? 365 : 100} value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} placeholder={editing.type === 'days' ? '3' : '20'} /></div>
            <div><label className="field-label">Активен до</label><input className="input" type="date" value={toDateInput(editing.expires)} onChange={(e) => setEditing({ ...editing, expires: e.target.value })} /></div>
            <div><label className="field-label">Лимит активаций</label><input className="input" type="number" value={editing.limit || ''} onChange={(e) => setEditing({ ...editing, limit: Number(e.target.value || 0) })} placeholder="∞" /></div>
          </div>
        </Modal>
      )}
    </div>
  );
};
