import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowRightLeft, Ban, CheckCircle2, Clock, List, RefreshCw, Search, Users } from 'lucide-react';
import { Modal, PageHead, Segmented, Spinner, Stat } from '../components/ui';
import { apiFetch, parseApiErr } from '../lib/api';
import { fmtDateTime, fmtInt } from '../lib/format';
import type { ToastType } from '../lib/types';

// «Ресейл»: клиенты ресейлеров в Remnawave (dnet_, atom_ …) по группам и перенос группы в FGN.
// Remnawave только читается; старые подписки не меняются. Логика — src/core/resale.py.

type Toast = (t: string, m: string, ty: ToastType) => void;
type Group = {
  prefix: string; known: boolean; subs: number; with_tg: number; no_tg: number; people: number;
  expired_people: number; expired_subs: number; grant_days_total: number; in_fgn: number;
  buckets: { d1_7: number; d8_14: number; d15_30: number; over30: number };
  statuses: Record<string, number>;
  migration: { id: number; old_name: string; status: string } | null;
};
type Scan = { at: string; read: number; total: number | null; groups: Group[] };
type Job = { kind: 'scan' | 'migrate' | null; running: boolean; read: number; total: number | null; started_at: string | null;
  finished_at: string | null; error: string | null; migration_id: number | null };
type Migration = {
  id: number; prefix: string; old_name: string; target_project: string; status: 'running' | 'active' | 'failed' | 'cancelled';
  snapshot_at: string | null; scanned: number; no_tg: number; expired: number; capped: number; skipped_claimed: number;
  people: number; error: string | null; created_by: string | null; created_at: string; finished_at: string | null;
  cancelled_at: string | null; counts: { pending: number; claiming: number; claimed: number; cancelled: number };
};
type Overview = { target: { id: string; name: string }; rules: { max_days: number; min_days: number };
  scan: Scan | null; job: Job; migrations: Migration[] };
type MigUser = { telegram_id: number; usernames: string[]; old_expire_at: string | null; remaining_days: number; grant_days: number;
  status: 'pending' | 'claiming' | 'claimed' | 'cancelled'; claimed_at: string | null; granted_until: string | null; user_id: number | null };

const MIG_STATUS: Record<Migration['status'], { label: string; cls: string }> = {
  running: { label: 'Выполняется', cls: 'mute' }, active: { label: 'Действует', cls: 'solid' },
  failed: { label: 'Ошибка', cls: 'danger' }, cancelled: { label: 'Отменён', cls: 'line' },
};
const USER_STATUS: Record<MigUser['status'], { label: string; cls: string }> = {
  pending: { label: 'Ждёт замены ключа', cls: 'mute' }, claiming: { label: 'Выдаётся', cls: 'mute' },
  claimed: { label: 'Ключ заменён', cls: 'solid' }, cancelled: { label: 'Отменён', cls: 'line' },
};
const plural = (n: number, one: string, few: string, many: string) => {
  const a = Math.abs(n) % 100, b = a % 10;
  return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
};
const people = (n: number) => `${fmtInt(n)} ${plural(n, 'человек', 'человека', 'человек')}`;

const Num: React.FC<{ v: number; dim?: boolean }> = ({ v, dim }) => (
  <span className="tabular-nums" style={{ color: dim && !v ? 'var(--faint)' : undefined }}>{fmtInt(v)}</span>
);

// ── мастер переноса: название → проверка → ввод префикса ──
const MigrateModal: React.FC<{ g: Group; scan: Scan; target: string; rules: Overview['rules']; onClose: () => void;
  onStarted: () => void; onToast: Toast }> = ({ g, scan, target, rules, onClose, onStarted, onToast }) => {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [checked, setChecked] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const clean = name.replace(/\s+/g, ' ').trim();
  const nameOk = clean.length >= 1 && clean.length <= 40 && !/[<>]/.test(clean);
  const confirmOk = confirm.trim() === g.prefix;

  const submit = async () => {
    if (!confirmOk || busy) return;
    if (!window.confirm(`Последнее подтверждение.\n\nПеренести клиентов ${g.prefix} («${clean}») в ${target}?\n` +
      `Людям с Telegram ID из этой группы при входе в ${target} покажется окно «${clean} теперь ${target}».`)) return;
    setBusy(true);
    try {
      await apiFetch('/panel/resale/migrate', { method: 'POST', body: JSON.stringify({ prefix: g.prefix, name: clean, confirm: confirm.trim() }) });
      onToast('Перенос запущен', `Читаем Remnawave и сохраняем группу ${g.prefix} — это займёт до пары минут`, 'success');
      onStarted();
    } catch (e) { onToast('Ошибка', parseApiErr(e, 'Не удалось запустить перенос'), 'error'); } finally { setBusy(false); }
  };

  const footer = step === 1 ? (
    <><button className="btn" onClick={onClose}>Отмена</button>
      <button className="btn solid" disabled={!nameOk} onClick={() => setStep(2)}>Далее</button></>
  ) : step === 2 ? (
    <><button className="btn" onClick={() => setStep(1)}>Назад</button>
      <button className="btn solid" disabled={!checked} onClick={() => setStep(3)}>Всё верно, далее</button></>
  ) : (
    <><button className="btn" disabled={busy} onClick={() => setStep(2)}>Назад</button>
      <button className="btn solid" disabled={!confirmOk || busy} onClick={() => void submit()}>
        {busy ? <Spinner size={15} /> : <ArrowRightLeft size={15} />} Перенести в {target}
      </button></>
  );

  return (
    <Modal onClose={() => !busy && onClose()} title={`Перенос ${g.prefix} в ${target} · шаг ${step} из 3`} icon={ArrowRightLeft} width={560} footer={footer}>
      {step === 1 && (
        <div className="flex flex-col gap-4">
          <div>
            <label className="field-label">Название старого VPN</label>
            <input className="input" autoFocus maxLength={40} value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && nameOk) setStep(2); }} placeholder="Например, DNET VPN" />
            <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>Так его видели клиенты — это название будет в окне при входе</div>
          </div>
          <div className="card" style={{ padding: 16 }}>
            <div className="faint" style={{ fontSize: 12, marginBottom: 8 }}>Клиент увидит при входе в {target}:</div>
            <div style={{ fontSize: 17, fontWeight: 700 }}>{clean || 'Название'} теперь {target}</div>
            <div className="sub" style={{ fontSize: 13.5, marginTop: 6, lineHeight: 1.5 }}>
              Проект {clean || 'Название'} был передан под управление {target}. Старый ключ необходимо заменить на новый кнопкой ниже
            </div>
            <div style={{ marginTop: 12 }}><span className="badge solid">Заменить ключ</span></div>
          </div>
        </div>
      )}
      {step === 2 && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Stat title="Получат срок в FGN" value={people(g.people)} icon={Users} />
            <Stat title="Не переносим (истекли)" value={people(g.expired_people)} icon={Clock} />
          </div>
          <div className="sub" style={{ fontSize: 13.5, lineHeight: 1.6 }}>
            <div>Группа <b style={{ color: 'var(--text)' }}>{g.prefix}</b> · «{clean}» · подписок в Remnawave: {fmtInt(g.subs)}</div>
            <div>Остаток до 7 дней: {fmtInt(g.buckets.d1_7)} · 8–14: {fmtInt(g.buckets.d8_14)} · 15–30: {fmtInt(g.buckets.d15_30)} ·
              больше 30 (получат 30): {fmtInt(g.buckets.over30)}</div>
            {g.no_tg > 0 && <div>Без Telegram ID (их не перенести): {fmtInt(g.no_tg)}</div>}
            {g.in_fgn > 0 && <div>Уже есть аккаунт в {target}: {fmtInt(g.in_fgn)} — им дни прибавятся к подписке</div>}
          </div>
          <div className="card" style={{ padding: 14, fontSize: 13.5, lineHeight: 1.6 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Как будет</div>
            <div className="sub">• Срок считается на момент переноса: оставалось до {rules.max_days} дней — столько же, больше — ровно {rules.max_days}.</div>
            <div className="sub">• Истёкшие и с остатком меньше {rules.min_days} {plural(rules.min_days, 'дня', 'дней', 'дней')} не переносятся, окно им не показывается.</div>
            <div className="sub">• Срок выдаётся, когда человек нажмёт «Заменить ключ» в {target} (мини-приложение или сайт, вход через Telegram).</div>
            <div className="sub">• Подписки {g.prefix} в Remnawave не меняются и не отключаются — их вы отключаете сами.</div>
          </div>
          <div className="flex items-start gap-2" style={{ fontSize: 12.5, color: 'var(--muted)' }}>
            <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>Числа — по чтению Remnawave {fmtDateTime(scan.at).slice(0, 16)}. При переносе Remnawave прочитается заново, итог может немного отличаться.</span>
          </div>
          <label className="flex items-center gap-2" style={{ fontSize: 14, cursor: 'pointer' }}>
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            Проверил группу и название — переносим клиентов {g.prefix} в {target}
          </label>
        </div>
      )}
      {step === 3 && (
        <div className="flex flex-col gap-3">
          <div className="sub" style={{ fontSize: 14, lineHeight: 1.55 }}>
            Чтобы подтвердить, введите префикс группы: <b className="mono" style={{ color: 'var(--text)' }}>{g.prefix}</b>
          </div>
          <input className="input mono" autoFocus value={confirm} onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} placeholder={g.prefix} />
          <div className="faint" style={{ fontSize: 12 }}>
            Ошиблись — перенос можно отменить: окно перестанет показываться тем, кто ещё не заменил ключ. Уже выданные сроки останутся.
          </div>
        </div>
      )}
    </Modal>
  );
};

const CancelModal: React.FC<{ m: Migration; onClose: () => void; onDone: () => void; onToast: Toast }> = ({ m, onClose, onDone, onToast }) => {
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = confirm.trim() === m.prefix;
  const submit = async () => {
    if (!ok || busy) return;
    setBusy(true);
    try {
      const r = await apiFetch(`/panel/resale/migrations/${m.id}/cancel`, { method: 'POST', body: JSON.stringify({ confirm: confirm.trim() }) });
      onToast('Перенос отменён', `Окно больше не покажется ${people(Number(r?.cancelled || 0))}`, 'success');
      onDone();
    } catch (e) { onToast('Ошибка', parseApiErr(e, 'Не удалось отменить'), 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={() => !busy && onClose()} title={`Отменить перенос «${m.old_name}»`} icon={Ban} width={500} footer={
      <><button className="btn" onClick={onClose} disabled={busy}>Не отменять</button>
        <button className="btn danger" disabled={!ok || busy} onClick={() => void submit()}>{busy ? <Spinner size={15} /> : <Ban size={15} />} Отменить перенос</button></>
    }>
      <div className="flex flex-col gap-3">
        <div className="sub" style={{ fontSize: 14, lineHeight: 1.55 }}>
          {m.counts.pending > 0 ? `${people(m.counts.pending)} ещё не заменили ключ — окно им больше не покажется.` : 'Все уже заменили ключ.'}{' '}
          {m.counts.claimed > 0 ? `Выданные сроки (${people(m.counts.claimed)}) останутся.` : ''}
        </div>
        <div className="sub" style={{ fontSize: 14 }}>Для подтверждения введите <b className="mono" style={{ color: 'var(--text)' }}>{m.prefix}</b></div>
        <input className="input mono" autoFocus value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={m.prefix} />
      </div>
    </Modal>
  );
};

const UsersModal: React.FC<{ m: Migration; onClose: () => void; onOpenUser: (id: number) => void; onToast: Toast }> = ({ m, onClose, onOpenUser, onToast }) => {
  const [status, setStatus] = useState<'' | MigUser['status']>('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ total: number; items: MigUser[] } | null>(null);
  const PAGE = 50;
  const toast = useRef(onToast);
  toast.current = onToast;
  useEffect(() => { const t = setTimeout(() => { setPage(0); setQuery(q.trim()); }, 350); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    const p = new URLSearchParams({ status, q: query, limit: String(PAGE), offset: String(page * PAGE) });
    apiFetch(`/panel/resale/migrations/${m.id}/users?${p}`).then(setData).catch((e) => toast.current('Ошибка', parseApiErr(e, 'Не удалось загрузить'), 'error'));
  }, [m.id, status, query, page]);
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;
  return (
    <Modal onClose={onClose} title={`«${m.old_name}» · ${m.prefix}`} icon={List} width={900}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col md:flex-row gap-3 md:items-center justify-between">
          <Segmented value={status} onChange={(v) => { setPage(0); setStatus(v); }} options={[
            { value: '', label: 'Все' }, { value: 'pending', label: 'Ждут' }, { value: 'claimed', label: 'Заменили' }, { value: 'cancelled', label: 'Отменены' },
          ]} />
          <div style={{ position: 'relative', minWidth: 240 }}>
            <Search size={15} className="faint" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
            <input className="input" style={{ paddingLeft: 32 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Telegram ID или имя в Remnawave" />
          </div>
        </div>
        {!data ? <div style={{ padding: 30, display: 'flex', justifyContent: 'center' }}><Spinner /></div> : (
          <div className="tbl-wrap"><div style={{ overflowX: 'auto', maxHeight: 460 }}>
            <table className="tbl">
              <thead><tr><th>Telegram ID</th><th>В Remnawave</th><th>Было до</th><th>Выдаём</th><th>Статус</th><th>FGN</th></tr></thead>
              <tbody>
                {data.items.length === 0 ? <tr className="empty-row"><td colSpan={6}>Никого</td></tr> : data.items.map((u) => (
                  <tr key={u.telegram_id}>
                    <td className="mono">{u.telegram_id}</td>
                    <td className="mono sub" style={{ fontSize: 12 }}>{u.usernames.join(', ')}</td>
                    <td className="sub" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmtDateTime(u.old_expire_at).slice(0, 16)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{String(u.grant_days).replace('.', ',')} дн.
                      {u.remaining_days > u.grant_days && <div className="faint" style={{ fontSize: 11 }}>было {Math.floor(u.remaining_days)}</div>}</td>
                    <td><span className={`badge ${USER_STATUS[u.status].cls}`}>{USER_STATUS[u.status].label}</span>
                      {u.status === 'claimed' && u.granted_until && <div className="faint" style={{ fontSize: 11, marginTop: 2 }}>до {fmtDateTime(u.granted_until).slice(0, 10)}</div>}</td>
                    <td>{u.user_id ? <button className="btn ghost sm" style={{ padding: 0, color: 'var(--text)' }} onClick={() => onOpenUser(u.user_id as number)}>#{u.user_id}</button>
                      : <span className="faint" style={{ fontSize: 12 }}>ещё не заходил</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div></div>
        )}
        {data && pages > 1 && (
          <div className="flex gap-2 items-center justify-end">
            <button className="btn sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Назад</button>
            <span className="sub" style={{ fontSize: 13 }}>{page + 1} / {pages}</span>
            <button className="btn sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Дальше</button>
          </div>
        )}
      </div>
    </Modal>
  );
};

export const ResalePage: React.FC<{ onToast: Toast; onOpenUser: (id: number) => void }> = ({ onToast, onOpenUser }) => {
  const [data, setData] = useState<Overview | null>(null);
  const [migrating, setMigrating] = useState<Group | null>(null);
  const [cancelling, setCancelling] = useState<Migration | null>(null);
  const [viewing, setViewing] = useState<Migration | null>(null);
  const autoScan = useRef(false);
  const wasRunning = useRef(false);
  // onToast из App пересоздаётся на каждый рендер — держим в ref, чтобы не перезапрашивать
  const toast = useRef(onToast);
  toast.current = onToast;

  const load = useCallback(() => apiFetch('/panel/resale').then((r: Overview) => {
    setData(r);
    // задача закончилась — сообщить итог
    if (wasRunning.current && !r.job.running) {
      if (r.job.error) toast.current('Ошибка', r.job.error, 'error');
      else if (r.job.kind === 'migrate') {
        const m = r.migrations.find((x) => x.id === r.job.migration_id);
        if (m && m.status === 'active') toast.current('Перенос готов', `«${m.old_name}»: ${people(m.people)} получат срок при входе`, 'success');
      }
    }
    wasRunning.current = r.job.running;
    return r;
  }).catch((e) => { toast.current('Ошибка', parseApiErr(e, 'Не удалось загрузить'), 'error'); return null; }), []);

  const scan = useCallback(async () => {
    try { await apiFetch('/panel/resale/scan', { method: 'POST' }); wasRunning.current = true; await load(); }
    catch (e) { toast.current('Ошибка', parseApiErr(e, 'Не удалось запустить'), 'error'); }
  }, [load]);

  useEffect(() => {
    void load().then((r) => {
      // первый вход: данных ещё нет — прочитать Remnawave
      if (r && !r.scan && !r.job.running && !autoScan.current) { autoScan.current = true; void scan(); }
    });
  }, [load, scan]);

  const running = !!data?.job.running;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => { void load(); }, 1500);
    return () => clearInterval(t);
  }, [running, load]);

  if (!data) return <div style={{ padding: 40, display: 'flex', justifyContent: 'center' }}><Spinner /></div>;
  const { scan: sc, job, target } = data;
  const groups = sc?.groups || [];
  const pct = job.total ? Math.min(100, Math.round((job.read / job.total) * 100)) : 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHead title="Ресейл" sub={`Клиенты ресейлеров в Remnawave по группам и перенос группы в ${target.name}`}>
        <button className="btn" disabled={running} onClick={() => void scan()}>
          {running && job.kind === 'scan' ? <Spinner size={15} /> : <RefreshCw size={15} />} Обновить данные
        </button>
      </PageHead>

      {running && (
        <div className="card" style={{ padding: 16 }}>
          <div className="flex items-center gap-2" style={{ fontSize: 14, fontWeight: 600 }}>
            <Spinner size={15} /> {job.kind === 'migrate' ? 'Перенос: читаем Remnawave и сохраняем группу…' : 'Читаем пользователей Remnawave…'}
          </div>
          <div className="meter" style={{ marginTop: 10 }}><i style={{ width: `${job.total ? pct : 5}%` }} /></div>
          <div className="sub" style={{ fontSize: 12.5, marginTop: 6 }}>{fmtInt(job.read)}{job.total ? ` из ${fmtInt(job.total)}` : ''} пользователей</div>
        </div>
      )}
      {!running && job.error && (
        <div className="card flex items-start gap-2" style={{ padding: 14, borderColor: 'var(--danger-line)', color: 'var(--danger)', fontSize: 13.5 }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} /> {job.error}
        </div>
      )}

      {sc ? (
        <>
          <div className="sub" style={{ fontSize: 12.5 }}>
            Данные на {fmtDateTime(sc.at).slice(0, 16)} · прочитано пользователей Remnawave: {fmtInt(sc.read)}
            {sc.total != null && sc.total !== sc.read ? ` (в панели ${fmtInt(sc.total)})` : ''}
          </div>
          <div className="tbl-wrap"><div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>Группа</th><th>Подписок</th><th>С Telegram ID</th><th title="Уникальные Telegram ID с остатком от 1 дня">Перенесём</th>
                <th>Истекли</th><th>Без TG</th><th title="Оставалось больше 30 дней — получат 30">&gt;30 дн.</th><th title={`Уже есть аккаунт в ${target.name}`}>Уже в {target.name}</th><th></th>
              </tr></thead>
              <tbody>
                {groups.length === 0 ? <tr className="empty-row"><td colSpan={9}>Ресейлеров в Remnawave не найдено</td></tr> : groups.map((g) => (
                  <tr key={g.prefix} style={{ opacity: g.subs ? 1 : 0.5 }}>
                    <td className="mono" style={{ fontWeight: 600 }}>{g.prefix}</td>
                    <td><Num v={g.subs} /></td>
                    <td><Num v={g.with_tg} dim /></td>
                    <td style={{ fontWeight: 600 }}><Num v={g.people} dim /></td>
                    <td><Num v={g.expired_people} dim /></td>
                    <td><Num v={g.no_tg} dim /></td>
                    <td><Num v={g.buckets.over30} dim /></td>
                    <td><Num v={g.in_fgn} dim /></td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {g.migration ? (
                        <span className={`badge ${g.migration.status === 'active' ? 'solid' : 'mute'}`} title={`«${g.migration.old_name}»`}>
                          {g.migration.status === 'active' ? <CheckCircle2 size={12} /> : <Spinner size={12} />} {g.migration.status === 'active' ? 'Перенесена' : 'Переносится'}
                        </span>
                      ) : (
                        <button className="btn sm" disabled={running || g.people === 0} onClick={() => setMigrating(g)}
                          title={g.people === 0 ? 'Переносить некого' : undefined}>
                          <ArrowRightLeft size={14} /> Перенести в {target.name}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div></div>
        </>
      ) : !running && (
        <div className="card flex flex-col items-center sub" style={{ padding: 40, gap: 10, textAlign: 'center' }}>
          <Users size={30} className="faint" />
          <div>Данных ещё нет — нажмите «Обновить данные»</div>
        </div>
      )}

      <div>
        <div className="h-sec" style={{ marginBottom: 10 }}>Переносы</div>
        {data.migrations.length === 0 ? (
          <div className="card sub" style={{ padding: 20, fontSize: 13.5 }}>Переносов ещё не было</div>
        ) : (
          <div className="tbl-wrap"><div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead><tr><th>Старый VPN</th><th>Статус</th><th>Перенесено</th><th>Заменили ключ</th><th>Ждут</th><th>Когда</th><th></th></tr></thead>
              <tbody>
                {data.migrations.map((m) => (
                  <tr key={m.id} style={{ opacity: m.status === 'cancelled' || m.status === 'failed' ? 0.6 : 1 }}>
                    <td><div style={{ fontWeight: 600 }}>{m.old_name}</div><div className="mono faint" style={{ fontSize: 12 }}>{m.prefix}</div></td>
                    <td><span className={`badge ${MIG_STATUS[m.status].cls}`}>{MIG_STATUS[m.status].label}</span>
                      {m.error && <div className="faint" style={{ fontSize: 11, marginTop: 2, maxWidth: 260 }}>{m.error}</div>}</td>
                    <td>{m.status === 'running' ? '—' : <>{people(m.people)}
                      <div className="faint" style={{ fontSize: 11 }}>
                        из {fmtInt(m.scanned)} подписок{m.capped ? ` · ${fmtInt(m.capped)} урезано до 30 дн.` : ''}{m.skipped_claimed ? ` · ${fmtInt(m.skipped_claimed)} уже получали` : ''}
                      </div></>}</td>
                    <td><Num v={m.counts.claimed} dim /></td>
                    <td><Num v={m.counts.pending + m.counts.claiming} dim /></td>
                    <td className="sub" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmtDateTime(m.snapshot_at || m.created_at).slice(0, 16)}
                      {m.cancelled_at && <div className="faint">отменён {fmtDateTime(m.cancelled_at).slice(0, 16)}</div>}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {m.status !== 'running' && m.people > 0 && <button className="btn sm ghost" onClick={() => setViewing(m)}><List size={14} /> Список</button>}
                      {(m.status === 'active' || m.status === 'failed') && <button className="btn sm danger" style={{ marginLeft: 6 }} onClick={() => setCancelling(m)}><Ban size={14} /> Отменить</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div></div>
        )}
      </div>

      {migrating && sc && <MigrateModal g={migrating} scan={sc} target={target.name} rules={data.rules} onToast={onToast}
        onClose={() => setMigrating(null)} onStarted={() => { setMigrating(null); wasRunning.current = true; void load(); }} />}
      {cancelling && <CancelModal m={cancelling} onToast={onToast} onClose={() => setCancelling(null)} onDone={() => { setCancelling(null); void load(); }} />}
      {viewing && <UsersModal m={viewing} onToast={onToast} onClose={() => setViewing(null)} onOpenUser={(id) => { setViewing(null); onOpenUser(id); }} />}
    </div>
  );
};
