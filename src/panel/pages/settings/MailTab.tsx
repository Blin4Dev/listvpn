import React, { useEffect, useState } from 'react';
import { Check, Mail, RefreshCw, Send, X } from 'lucide-react';
import { PageHead, Spinner } from '../../components/ui';
import { CopyBtn, Err, HowTo } from '../../components/Steps';
import { apiFetch, parseApiErr } from '../../lib/api';
import type { ToastType } from '../../lib/types';

// почта проекта ставится сама вместе с мини-приложением (Проекты → установка на сервер):
// письма уходят с сервера мини-приложения от no-reply@<его домен>. Здесь — только состояние, проверки и гайд.
type Rec = { type: string; host: string; name?: string; value: string; ok: boolean };
type Cfg = {
  mode: 'off' | 'smtp' | 'direct' | 'agent'; host: string; user: string; domain: string; from: string;
  server_ip: string; server_online?: boolean; records?: Rec[];
};

const Mark: React.FC<{ ok: boolean | null }> = ({ ok }) =>
  ok === null ? <span className="faint" style={{ width: 16, flex: 'none', textAlign: 'center' }}>·</span>
    : ok ? <Check size={16} style={{ color: '#34d399', flex: 'none' }} /> : <X size={16} style={{ color: '#f87171', flex: 'none' }} />;

const Row: React.FC<{ ok: boolean | null; title: React.ReactNode; children?: React.ReactNode; action?: React.ReactNode }> = ({ ok, title, children, action }) => (
  <div className="flex gap-3" style={{ padding: '12px 0', borderTop: '1px solid var(--border)' }}>
    <div style={{ paddingTop: 2 }}><Mark ok={ok} /></div>
    <div className="flex flex-col gap-2" style={{ flex: 1, minWidth: 0 }}>
      <div className="flex items-center gap-3" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600 }}>{title}</span>{action}
      </div>
      {children}
    </div>
  </div>
);

const Port25Help: React.FC<{ ip: string }> = ({ ip }) => (
  <HowTo items={[
    <>Хостинг закрыл исходящий порт 25 — без него письма не уходят. Так по умолчанию делают AWS, Google Cloud, Azure, у Hetzner — на новых аккаунтах.</>,
    <>Напишите в поддержку хостинга: «Откройте, пожалуйста, исходящий порт 25 для сервера {ip}, нужен для писем с кодами входа своим пользователям». В AWS это форма «Request to remove email sending limitations».</>,
    <>Если хостинг отказывает — поставьте мини-приложение на сервер у другого хостинга: «Проекты» → «Перенести на другой сервер».</>,
  ]} />
);

export const MailSettingsTab: React.FC<{ onToast: (t: string, m: string, ty: ToastType) => void }> = ({ onToast }) => {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [port25, setPort25] = useState<boolean | null | undefined>(undefined); // undefined — не проверяли, null — сервер не ответил
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  const load = () => apiFetch('/panel/mail').then((c: Cfg) => setCfg(c))
    .catch((e) => onToast('Ошибка', parseApiErr(e, 'Не удалось загрузить'), 'error'));
  const checkPort = () => call('p25', async () => { const r = await apiFetch('/panel/mail/port25', { method: 'POST' }); setPort25(r.open); });
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (cfg?.mode === 'agent' && cfg.server_online && port25 === undefined) void checkPort(); }, [cfg?.mode, cfg?.server_online]);

  async function call(key: string, fn: () => Promise<void>) {
    setBusy(key); setErr('');
    try { await fn(); } catch (e) { setErr(parseApiErr(e, 'Не получилось')); } finally { setBusy(''); }
  }
  const spin = (k: string) => (busy === k ? <Spinner size={15} /> : null);

  if (!cfg) return <div style={{ padding: 40, display: 'flex', justifyContent: 'center' }}><Spinner /></div>;

  const works = cfg.mode !== 'off';
  const recs = cfg.records || [];
  const dnsOk = recs.length > 0 && recs.every((r) => r.ok);

  const testRow = (
    <Row ok={null} title="Тестовое письмо">
      <div className="flex gap-2" style={{ maxWidth: 480 }}>
        <input className="input" type="email" placeholder="you@example.com" value={to} onChange={(e) => setTo(e.target.value.trim())} />
        <button className="btn" disabled={!!busy || !to} onClick={() => void call('send', async () => {
          await apiFetch('/panel/mail/send-test', { method: 'POST', body: JSON.stringify({ to }) });
          onToast('Письмо отправлено', `${to} — если его нет во «Входящих», загляните в «Спам»`, 'success');
        })}>{spin('send') || <Send size={15} />} Отправить</button>
      </div>
    </Row>
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHead title="Почта">
        <span className={`badge ${works ? 'solid' : 'line'}`}>{works ? 'Настроена' : 'Не настроена'}</span>
      </PageHead>

      {cfg.mode === 'agent' ? (
        <div className="card flex flex-col" style={{ padding: 20 }}>
          <div className="flex items-center gap-3" style={{ paddingBottom: 12 }}>
            <Mail size={18} className="faint" />
            <div><div style={{ fontWeight: 600 }}>{cfg.from}</div>
              <div className="sub" style={{ fontSize: 13 }}>Письма уходят с сервера мини-приложения <span className="mono">{cfg.server_ip}</span>. Настроено при установке — менять здесь нечего.</div></div>
          </div>

          <Row ok={!!cfg.server_online} title="Сервер мини-приложения на связи">
            {!cfg.server_online && <HowTo items={[
              <>На сервере {cfg.server_ip} проверьте службу: <span className="mono">systemctl status blin-agent</span></>,
              <>Перезапустите её: <span className="mono">systemctl restart blin-agent</span> — и обновите эту страницу.</>,
            ]} />}
          </Row>

          <Row ok={port25 === undefined || busy === 'p25' ? null : port25} title="Исходящий порт 25"
            action={<button className="btn sm" disabled={!!busy || !cfg.server_online} onClick={() => void checkPort()}>{spin('p25') || <RefreshCw size={14} />} Проверить</button>}>
            {busy === 'p25' ? <span className="sub" style={{ fontSize: 13 }}>Проверяем с сервера {cfg.server_ip}…</span>
              : port25 === false ? <Port25Help ip={cfg.server_ip} />
              : port25 === null ? <span className="sub" style={{ fontSize: 13 }}>Сервер не ответил на проверку. Агент обновляется сам в течение минуты — нажмите «Проверить» ещё раз.</span>
              : port25 ? <span className="sub" style={{ fontSize: 13 }}>Открыт — письма уходят.</span> : null}
          </Row>

          <Row ok={recs.length ? dnsOk : null} title="DNS-записи домена"
            action={<button className="btn sm" disabled={!!busy} onClick={() => void call('dns', load)}>{spin('dns') || <RefreshCw size={14} />} Проверить записи</button>}>
            {!dnsOk && <HowTo items={[
              <>Откройте управление DNS домена {cfg.domain} у регистратора или в Cloudflare.</>,
              <>Добавьте TXT-записи ниже (имя и значение — кнопками «Скопировать»). Без них письма попадают в «Спам» или не доходят.</>,
              <>Попросите хостинг сервера сделать обратную запись (PTR): {cfg.server_ip} → {cfg.domain}.</>,
              <>Через 5–30 минут нажмите «Проверить записи».</>,
            ]} />}
            <div className="flex flex-col gap-2">
              {recs.map((r) => (
                <div key={r.host} className="inset flex items-center gap-3" style={{ padding: '8px 10px' }}>
                  <Mark ok={r.ok} />
                  <span className="mono" style={{ width: 190, flex: 'none', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.name}>{r.type} {r.name || r.host}</span>
                  <span className="mono faint" style={{ flex: 1, minWidth: 0, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.value}>{r.value}</span>
                  <CopyBtn text={r.name || r.host} label="Имя" /><CopyBtn text={r.value} label="Значение" />
                </div>
              ))}
            </div>
          </Row>

          {testRow}
        </div>
      ) : works ? (
        <div className="card flex flex-col" style={{ padding: 20 }}>
          <div className="flex items-center gap-3" style={{ paddingBottom: 12 }}>
            <Mail size={18} className="faint" />
            <div><div style={{ fontWeight: 600 }}>{cfg.mode === 'smtp' ? `${cfg.user} · через ${cfg.host}` : `${cfg.from} · с главного сервера`}</div>
              <div className="sub" style={{ fontSize: 13 }}>Старые настройки почты. Когда мини-приложение проекта будет на своём сервере («Проекты»), письма пойдут с его домена.</div></div>
          </div>
          {testRow}
        </div>
      ) : (
        <div className="card flex flex-col gap-3" style={{ padding: 20 }}>
          <div className="flex items-center gap-3"><Mail size={18} className="faint" /><span style={{ fontWeight: 600 }}>Почта появится вместе с мини-приложением</span></div>
          <div className="sub" style={{ fontSize: 14 }}>Письма — коды входа на сайт и в мини-приложение — уходят с сервера мини-приложения проекта от адреса no-reply@&lt;домен мини-приложения&gt;. Отдельно настраивать ничего не нужно.</div>
          <HowTo items={[
            <>Откройте «Проекты» и установите мини-приложение этого проекта на свой сервер: IP, домен, команда в терминале сервера.</>,
            <>Выбирайте хостинг с открытым исходящим портом 25. AWS, Google Cloud, Azure и новые аккаунты Hetzner его закрывают — откроют только по запросу в поддержку.</>,
            <>После установки вернитесь сюда: панель проверит порт 25 и покажет DNS-записи (SPF, DKIM, DMARC) — их нужно добавить у регистратора домена.</>,
            <>Отправьте тестовое письмо себе — оно должно прийти во «Входящие», не в «Спам».</>,
          ]} />
          <div><a className="btn solid" href="/setup">Открыть «Проекты»</a></div>
        </div>
      )}
      {err && <Err>{err}</Err>}
    </div>
  );
};
