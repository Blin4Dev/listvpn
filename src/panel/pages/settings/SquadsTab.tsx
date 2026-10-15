import React, { useState, useEffect } from 'react';
import {
  Zap, RefreshCw,
} from 'lucide-react';
import { PageHead, Spinner, Toggle } from '../../components/ui';
import { apiFetch, parseApiErr } from '../../lib/api';
import type { ToastType } from '../../lib/types';

export interface SquadConfig {
  id: number; squad_uuid: string; squad_name: string; squad_type: string;
  max_users: number; current_users: number; inbounds_count?: number; is_active: boolean; priority: number;
}

export const SquadsPage: React.FC<{ onToast: (t: string, m: string, ty: ToastType) => void }> = ({ onToast }) => {
  const [squads, setSquads] = useState<SquadConfig[]>([]);
  const [mapping, setMapping] = useState<{ vpn: string[]; trial: string[] }>({ vpn: [], trial: [] });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const load = async () => {
    try { const d = await apiFetch('/panel/squads'); if (d) { setSquads(d.squads || []); setMapping({ vpn: d.mapping?.vpn || [], trial: d.mapping?.trial || [] }); } }
    catch { onToast('Ошибка', 'Не удалось загрузить сквады', 'error'); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const sync = async () => {
    setSyncing(true);
    try { const r = await apiFetch('/panel/squads/sync', { method: 'POST' }); if (r?.success) { onToast('Готово', `Синхронизировано ${r.count} сквадов`, 'success'); load(); } else onToast('Ошибка', r?.error || 'Ошибка синхронизации', 'error'); }
    catch { onToast('Ошибка', 'Не удалось синхронизировать', 'error'); } finally { setSyncing(false); }
  };
  const saveMapping = async () => { try { const r = await apiFetch('/panel/squads/mapping', { method: 'PUT', body: JSON.stringify(mapping) }); if (r?.success) onToast('Готово', 'Привязки сохранены', 'success'); } catch { onToast('Ошибка', 'Не удалось сохранить привязки', 'error'); } };
  const toggleMapping = (type: 'vpn' | 'trial', uuid: string) => setMapping((prev) => { const cur = prev[type] || []; return { ...prev, [type]: cur.includes(uuid) ? cur.filter((u) => u !== uuid) : [...cur, uuid] }; });

  if (loading) return <div className="flex items-center justify-center" style={{ height: 240 }}><Spinner size={28} /></div>;

  return (
    <div className="flex flex-col gap-6">
      <PageHead title="Сквады">
        <button className="btn solid" onClick={sync} disabled={syncing}>{syncing ? <Spinner size={16} /> : <RefreshCw size={16} />} Синхронизировать</button>
      </PageHead>

      {squads.length === 0 && (
        <div className="card" style={{ padding: 32, textAlign: 'center' }}>
          <Zap size={40} className="faint" style={{ margin: '0 auto 12px' }} />
          <h3 className="h-sec mb-2">Нет сквадов</h3>
          <p className="sub mb-4">Синхронизируйте сквады с Remnawave</p>
          <button className="btn solid" onClick={sync} style={{ margin: '0 auto' }}>Синхронизировать</button>
        </div>
      )}

      {squads.length > 0 && (
        <div className="card" style={{ padding: 24 }}>
          <h3 className="h-sec mb-2">Внутренние сквады</h3>
          <p className="sub">Какие внутренние сквады получает подписка и пробный период</p>
          <div className="mb-4" />
          <div className="flex flex-col gap-5">
            {(['vpn', 'trial'] as const).map((type) => (
              <div key={type}>
                <h4 className="mb-3" style={{ fontWeight: 500 }}>{type === 'vpn' ? 'Подписка (VPN + обход блокировок)' : 'Пробный период'}</h4>
                <div className="flex flex-wrap gap-2">
                  {squads.filter((s) => s.is_active).map((sq) => (
                    <button key={sq.squad_uuid} className={`chip ${mapping[type]?.includes(sq.squad_uuid) ? 'on' : ''}`} onClick={() => toggleMapping(type, sq.squad_uuid)}>{sq.squad_name}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <button className="btn solid mt-6" onClick={saveMapping}>Сохранить привязки</button>
        </div>
      )}

      <ExternalSquadCard onToast={onToast} />

      {squads.length > 0 && <GraceCard squads={squads} onToast={onToast} />}

    </div>
  );
};

type Grace = { enabled: boolean; squads: string[]; traffic_gb: number; trial: boolean; days: number };

// grace: после окончания подписки, пока не удалена, резервный сквад
const GraceCard: React.FC<{ squads: SquadConfig[]; onToast: (t: string, m: string, ty: ToastType) => void }> = ({ squads, onToast }) => {
  const [g, setG] = useState<Grace | null>(null);
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const apply = (d: Grace) => { setG(d); setSaved(JSON.stringify(d)); };
  useEffect(() => { apiFetch('/panel/grace').then(apply).catch(() => onToast('Ошибка', 'Не удалось загрузить grace-доступ', 'error')); }, []);
  if (!g) return null;
  const dirty = JSON.stringify(g) !== saved;
  const save = async () => {
    setBusy(true);
    try { apply(await apiFetch('/panel/grace', { method: 'PUT', body: JSON.stringify({ enabled: g.enabled, squads: g.squads, traffic_gb: g.traffic_gb, trial: g.trial }) })); onToast('Готово', 'Grace-доступ сохранён', 'success'); }
    catch (e) { onToast('Не сохранено', parseApiErr(e, 'Ошибка'), 'error'); } finally { setBusy(false); }
  };
  const toggle = (u: string) => setG({ ...g, squads: g.squads.includes(u) ? g.squads.filter((x) => x !== u) : [...g.squads, u] });
  return (
    <div className="card" style={{ padding: 24 }}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="h-sec mb-2">Grace-доступ</h3>
          <p className="sub" style={{ maxWidth: 620 }}>
            Кончился срок или трафик — резервный сквад с небольшим лимитом. Продлил — всё возвращается.
          </p>
        </div>
        <Toggle on={g.enabled} onChange={() => setG({ ...g, enabled: !g.enabled })} />
      </div>
      {g.enabled && (
        <div className="flex flex-col gap-5" style={{ marginTop: 20 }}>
          <div>
            <h4 className="mb-3" style={{ fontWeight: 500 }}>Резервный сквад</h4>
            <div className="flex flex-wrap gap-2">
              {squads.filter((sq) => sq.is_active || g.squads.includes(sq.squad_uuid)).map((sq) => (
                <button key={sq.squad_uuid} className={`chip ${g.squads.includes(sq.squad_uuid) ? 'on' : ''}`} onClick={() => toggle(sq.squad_uuid)}>{sq.squad_name}</button>
              ))}
            </div>
                      </div>
          <div style={{ maxWidth: 260 }}>
            <label className="field-label">Трафик, ГБ (0 — без лимита)</label>
            <input className="input" type="number" min={0} max={1000} value={g.traffic_gb}
              onChange={(e) => setG({ ...g, traffic_gb: Math.max(0, Math.min(1000, parseInt(e.target.value) || 0)) })} />
          </div>
          <label className="flex items-center justify-between gap-4" style={{ cursor: 'pointer', maxWidth: 620 }}>
            <span>
              <span style={{ display: 'block', fontWeight: 500 }}>Для пробных подписок</span>
            </span>
            <Toggle on={g.trial} onChange={() => setG({ ...g, trial: !g.trial })} />
          </label>
        </div>
      )}
      <div className="flex items-center gap-4 mt-6" style={{ flexWrap: 'wrap' }}>
        <button className="btn solid" disabled={!dirty || busy} onClick={() => void save()}>{busy ? <Spinner size={15} /> : null} Сохранить</button>
      </div>
    </div>
  );
};

type ExtSquad = { uuid: string; name: string; members: number | null };
type ExtState = { selected: string | null; squads: ExtSquad[]; error: string | null };

// внешний сквад Remnawave: необязательный, один на всех пользователей
const ExternalSquadCard: React.FC<{ onToast: (t: string, m: string, ty: ToastType) => void }> = ({ onToast }) => {
  const [st, setSt] = useState<ExtState | null>(null);
  const [pick, setPick] = useState<string>('');
  const [busy, setBusy] = useState<'' | 'load' | 'save' | 'apply'>('load');
  const apply = (d: ExtState) => { setSt(d); setPick(d.selected || ''); };
  const load = () => { setBusy('load'); apiFetch('/panel/squads/external').then(apply).catch((e) => onToast('Ошибка', parseApiErr(e, 'Не удалось загрузить внешние сквады'), 'error')).finally(() => setBusy('')); };
  useEffect(() => { load(); }, []);
  if (!st) return null;
  const dirty = (st.selected || '') !== pick;
  const save = async () => {
    setBusy('save');
    try {
      apply(await apiFetch('/panel/squads/external', { method: 'PUT', body: JSON.stringify({ uuid: pick || null }) }));
      onToast('Готово', pick ? 'Внешний сквад будет назначаться всем пользователям' : 'Внешний сквад не назначается', 'success');
    } catch (e) { onToast('Не сохранено', parseApiErr(e, 'Ошибка'), 'error'); } finally { setBusy(''); }
  };
  const applyAll = async () => {
    const name = st.squads.find((x) => x.uuid === st.selected)?.name || 'выбранный сквад';
    if (!window.confirm(`Назначить «${name}» всем пользователям в Remnawave прямо сейчас? Это затронет всех пользователей панели Remnawave, включая созданных не ботом.`)) return;
    setBusy('apply');
    try { await apiFetch('/panel/squads/external/apply', { method: 'POST' }); onToast('Готово', 'Remnawave назначает сквад всем пользователям', 'success'); load(); }
    catch (e) { onToast('Ошибка', parseApiErr(e, 'Не удалось'), 'error'); } finally { setBusy(''); }
  };
  const missing = st.selected && !st.squads.some((x) => x.uuid === st.selected) && !st.error;
  return (
    <div className="card" style={{ padding: 24 }}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="h-sec mb-2">Внешний сквад</h3>
          <p className="sub" style={{ maxWidth: 620 }}>
            Необязательно. Выбранный внешний сквад получают все новые пользователи и все, кто продлевает или покупает подписку.
            «Не назначать» — бот не трогает внешний сквад пользователей в Remnawave.
          </p>
        </div>
        <button className="btn" onClick={load} disabled={!!busy} title="Обновить список">{busy === 'load' ? <Spinner size={15} /> : <RefreshCw size={15} />}</button>
      </div>
      {st.error && <div className="badge danger" style={{ whiteSpace: 'normal', marginTop: 12 }}>{st.error}</div>}
      {missing && <div className="badge danger" style={{ whiteSpace: 'normal', marginTop: 12 }}>Выбранного сквада больше нет в Remnawave — выберите другой или «Не назначать».</div>}
      <div className="flex flex-wrap gap-2" style={{ marginTop: 16 }}>
        <button className={`chip ${pick === '' ? 'on' : ''}`} onClick={() => setPick('')}>Не назначать</button>
        {st.squads.map((sq) => (
          <button key={sq.uuid} className={`chip ${pick === sq.uuid ? 'on' : ''}`} onClick={() => setPick(sq.uuid)}>
            {sq.name}{sq.members != null ? <span className="faint" style={{ marginLeft: 6 }}>{sq.members}</span> : null}
          </button>
        ))}
      </div>
      {!st.error && st.squads.length === 0 && <p className="sub" style={{ marginTop: 10, fontSize: 13 }}>В Remnawave нет внешних сквадов — создайте их в панели Remnawave и обновите список.</p>}
      <div className="flex items-center gap-3 mt-6" style={{ flexWrap: 'wrap' }}>
        <button className="btn solid" disabled={!dirty || !!busy} onClick={() => void save()}>{busy === 'save' ? <Spinner size={15} /> : null} Сохранить</button>
        {st.selected && !dirty && !missing && (
          <button className="btn" disabled={!!busy} onClick={() => void applyAll()}>{busy === 'apply' ? <Spinner size={15} /> : null} Назначить всем существующим</button>
        )}
      </div>
    </div>
  );
};
