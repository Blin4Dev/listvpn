import React, { useEffect, useState } from 'react';
import { Bot, Check, CreditCard, Megaphone, Save, Link as LinkIcon } from 'lucide-react';
import { Spinner } from '../../components/ui';
import { apiFetch, copyToClipboard, parseApiErr } from '../../lib/api';
import { useProject } from '../../lib/project';
import type { ToastType } from '../../lib/types';
import { Section } from './PricesTab';

// настройки открытого проекта сети: бот, канал, ЮKassa, ссылки. Хранятся в базе (секреты — зашифрованы),
// в установщике их больше не спрашиваем.
type Cfg = {
  project: { id: string; name: string };
  bot: { token_set: boolean; token_hint: string; id: string; username: string; source: string };
  channel: { id: string; url: string; source: string };
  yookassa: { shop_id: string; secret_set: boolean; source: string; webhook_url: string };
  support_url: string; miniapp_link: string; vpn_sub_domain: string;
  miniapp_url: string;
  features: Record<string, boolean>;
  growth: { notconn_hours: number; winback_after_days: number; winback_gift_days: number };
  family_max_members: number;
  desktop?: { windows_url: string; macos_url: string; version: string };
};

const SourceNote: React.FC<{ source: string }> = ({ source }) =>
  source === 'env' ? <span className="faint" style={{ fontSize: 12 }}>сейчас из .env — сохраните здесь, чтобы управлять из панели</span> : null;

export const ProjectSettingsTab: React.FC<{ onToast: (t: string, m: string, ty: ToastType) => void }> = ({ onToast }) => {
  const project = useProject();
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [token, setToken] = useState('');
  const [channel, setChannel] = useState('');
  const [channelUrl, setChannelUrl] = useState('');
  const [shop, setShop] = useState('');
  const [secret, setSecret] = useState('');
  const [support, setSupport] = useState('');
  const [mlink, setMlink] = useState('');
  const [vpnDom, setVpnDom] = useState('');
  const [busy, setBusy] = useState('');
  const [growth, setGrowth] = useState({ notconn_hours: '3', winback_after_days: '14', winback_gift_days: '3' });
  const [familyMax, setFamilyMax] = useState('5');
  const [desk, setDesk] = useState({ windows_url: '', macos_url: '', version: '' });

  const fill = (d: Cfg) => {
    setCfg(d); setToken(''); setSecret('');
    setChannel(d.channel.id || ''); setChannelUrl(d.channel.url || ''); setShop(d.yookassa.shop_id || '');
    if (d.growth) setGrowth({ notconn_hours: String(d.growth.notconn_hours), winback_after_days: String(d.growth.winback_after_days),
      winback_gift_days: String(d.growth.winback_gift_days) });
    if (d.family_max_members) setFamilyMax(String(d.family_max_members));
    if (d.desktop) setDesk({ windows_url: d.desktop.windows_url || '', macos_url: d.desktop.macos_url || '', version: d.desktop.version || '' });
    setSupport(d.support_url || ''); setMlink(d.miniapp_link || ''); setVpnDom(d.vpn_sub_domain || '');
  };
  useEffect(() => {
    apiFetch('/panel/project/config').then(fill).catch((e) => onToast('Ошибка', parseApiErr(e, 'Не удалось загрузить настройки проекта'), 'error'));
  }, []);

  const save = async (what: string, body: Record<string, string | number>, ok: string) => {
    setBusy(what);
    try {
      fill(await apiFetch('/panel/project/config', { method: 'PUT', body: JSON.stringify(body) }));
      onToast('Готово', ok, 'success');
    } catch (e) { onToast('Ошибка', parseApiErr(e, 'Не удалось сохранить'), 'error'); }
    finally { setBusy(''); }
  };

  if (!cfg) return <div className="card" style={{ padding: 24 }}><Spinner size={24} /></div>;
  const name = project?.name || cfg.project.name;
  const btn = (id: string, onClick: () => void, label = 'Сохранить', disabled = false) => (
    <button className="btn solid" style={{ alignSelf: 'flex-start' }} onClick={onClick} disabled={!!busy || disabled}>
      {busy === id ? <Spinner size={16} /> : <Save size={16} />} {label}
    </button>
  );

  return (
    <div className="card" style={{ padding: 24 }}>
      <h3 className="h-sec">Проект {name}</h3>
      <div className="sub mt-1" style={{ marginBottom: 4 }}>
        Бот, канал и оплата этого проекта. У каждого проекта сети — свои; переключить проект — в меню слева.
        {cfg.miniapp_url && <> Мини-приложение: <span className="mono">{cfg.miniapp_url}</span>.</>}
      </div>

      <div className="flex flex-col gap-6" style={{ marginTop: 16 }}>
        <Section title="Telegram-бот" sub="Токен выдаёт @BotFather. Имя бота подставится само, бот подключится в течение ~10 секунд — перезапуск не нужен.">
          {cfg.bot.token_set ? (
            <div className="inset flex items-center gap-3" style={{ padding: 12 }}>
              <Bot size={18} className="faint" />
              <div className="flex-1">
                <div style={{ fontWeight: 600 }}>{cfg.bot.username ? `@${cfg.bot.username}` : `бот ${cfg.bot.id}`}</div>
                <div className="faint mono" style={{ fontSize: 12 }}>{cfg.bot.id}:{cfg.bot.token_hint}</div>
              </div>
              <SourceNote source={cfg.bot.source} />
            </div>
          ) : <div className="sub" style={{ fontSize: 13 }}>Бот не подключён — проект не отвечает в Telegram.</div>}
          <div className="flex gap-2 flex-wrap">
            <input className="input mono" style={{ flex: 1, minWidth: 260 }} value={token} onChange={(e) => setToken(e.target.value.trim())}
              placeholder={cfg.bot.token_set ? 'Новый токен (чтобы заменить бота)' : '1234567890:AAH…'} autoComplete="off" />
            {btn('bot', () => save('bot', { bot_token: token }, 'Бот подключён'), cfg.bot.token_set ? 'Заменить' : 'Подключить', !token)}
          </div>
          {cfg.miniapp_url && (
            <div className="faint" style={{ fontSize: 12.5 }}>
              В @BotFather → Bot Settings → Menu Button укажите <button className="mono" style={{ background: "none", border: 0, padding: 0, color: "var(--text)", textDecoration: "underline", cursor: "pointer" }} onClick={() => copyToClipboard(cfg.miniapp_url).then(() => onToast('Скопировано', cfg.miniapp_url, 'success'))}>{cfg.miniapp_url}</button>
            </div>
          )}
        </Section>

        <Section title="Канал" sub="Новости проекта; можно сделать подписку обязательной (Настройки → Цены). Бот проекта должен быть админом канала.">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><label className="field-label"><Megaphone size={13} /> Канал (@username или -100…)</label>
              <input className="input mono" value={channel} onChange={(e) => setChannel(e.target.value.trim())} placeholder="@channel" /></div>
            <div><label className="field-label"><LinkIcon size={13} /> Ссылка (для закрытого канала)</label>
              <input className="input mono" value={channelUrl} onChange={(e) => setChannelUrl(e.target.value.trim())} placeholder="https://t.me/…" /></div>
          </div>
          {btn('channel', () => save('channel', { channel_id: channel, channel_url: channelUrl }, 'Канал сохранён'))}
        </Section>

        <Section title="ЮKassa" sub="Свой магазин у каждого проекта: Интеграция → Ключи API.">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><label className="field-label"><CreditCard size={13} /> shopId</label>
              <input className="input mono" value={shop} onChange={(e) => setShop(e.target.value.trim())} placeholder="123456" /></div>
            <div><label className="field-label">Секретный ключ {cfg.yookassa.secret_set && <span className="faint"><Check size={12} /> задан</span>}</label>
              <input className="input mono" type="password" value={secret} onChange={(e) => setSecret(e.target.value.trim())}
                placeholder={cfg.yookassa.secret_set ? 'оставьте пустым, чтобы не менять' : 'live_…'} autoComplete="new-password" /></div>
          </div>
          <SourceNote source={cfg.yookassa.source} />
          {cfg.yookassa.webhook_url && <div className="faint" style={{ fontSize: 12.5 }}>
            HTTP-уведомления в ЮKassa: <span className="mono">{cfg.yookassa.webhook_url}</span> (payment.succeeded, payment.canceled)
          </div>}
          {btn('yk', () => save('yk', { yookassa_shop_id: shop, ...(secret ? { yookassa_secret_key: secret } : {}) }, 'ЮKassa сохранена'))}
        </Section>

        <Section title="Ссылки и домены" sub="Необязательно. Домен подписки — свой домен в ссылках подписки этого проекта (путь из Remnawave сохраняется).">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><label className="field-label">Поддержка (если нет мини-приложения)</label>
              <input className="input mono" value={support} onChange={(e) => setSupport(e.target.value.trim())} placeholder="https://t.me/…" /></div>
            <div><label className="field-label">Ссылка Mini App (t.me/бот/app)</label>
              <input className="input mono" value={mlink} onChange={(e) => setMlink(e.target.value.trim())} placeholder="https://t.me/bot/app" /></div>
            <div><label className="field-label">Домен подписки VPN</label>
              <input className="input mono" value={vpnDom} onChange={(e) => setVpnDom(e.target.value.trim())} placeholder="sub.example.com" /></div>
          </div>
          {btn('links', () => save('links', { support_url: support, miniapp_link: mlink, vpn_sub_domain: vpnDom }, 'Сохранено'))}
        </Section>

        {(cfg.features?.notify_not_connected || cfg.features?.winback_gift) && (
          <Section title="Напоминания и подарки" sub="Сообщения от бота проекта. Каждое — один раз на подписку / на перерыв в оплате.">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {cfg.features?.notify_not_connected && (
                <div><label className="field-label">«Не подключил подписку» — через, ч</label>
                  <input className="input" type="number" min={1} max={168} value={growth.notconn_hours}
                    onChange={(e) => setGrowth({ ...growth, notconn_hours: e.target.value })} /></div>
              )}
              {cfg.features?.winback_gift && (<>
                <div><label className="field-label">«Давно не оплачивал» — через, дней</label>
                  <input className="input" type="number" min={1} max={365} value={growth.winback_after_days}
                    onChange={(e) => setGrowth({ ...growth, winback_after_days: e.target.value })} /></div>
                <div><label className="field-label">Дарим дней</label>
                  <input className="input" type="number" min={1} max={30} value={growth.winback_gift_days}
                    onChange={(e) => setGrowth({ ...growth, winback_gift_days: e.target.value })} /></div>
              </>)}
            </div>
            {btn('growth', () => save('growth', Object.fromEntries(Object.entries(growth)
              .filter(([k]) => (k === 'notconn_hours' ? cfg.features?.notify_not_connected : cfg.features?.winback_gift))
              .map(([k, v]) => [k, Number(v)])), 'Сохранено'))}
          </Section>
        )}

        {cfg.features?.site && (
          <Section title="Сайт: приложения для компьютера" sub="Сайт проекта открывается вместо мини-приложения, когда домен открыт в браузере. Кнопки «Скачать для Windows / macOS» ведут сюда; пока ссылки нет — в Telegram-бота.">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><label className="field-label">Установщик для Windows</label>
                <input className="input mono" value={desk.windows_url} onChange={(e) => setDesk({ ...desk, windows_url: e.target.value.trim() })} placeholder="https://…/FGN-Setup.exe" /></div>
              <div><label className="field-label">Установщик для macOS</label>
                <input className="input mono" value={desk.macos_url} onChange={(e) => setDesk({ ...desk, macos_url: e.target.value.trim() })} placeholder="https://…/FGN.dmg" /></div>
              <div><label className="field-label">Версия (подпись под кнопками)</label>
                <input className="input mono" value={desk.version} onChange={(e) => setDesk({ ...desk, version: e.target.value.trim() })} placeholder="1.0" /></div>
            </div>
            {btn('desktop', () => save('desktop', { desktop_windows_url: desk.windows_url, desktop_macos_url: desk.macos_url, desktop_version: desk.version }, 'Сохранено'))}
          </Section>
        )}

        <Section title="Семья" sub="Семейная подписка: владелец с активной подпиской делится ключом с участниками. Здесь — сколько человек всего, включая владельца.">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div><label className="field-label">Человек в семье, включая владельца</label>
              <input className="input" type="number" min={2} max={20} value={familyMax}
                onChange={(e) => setFamilyMax(e.target.value)} /></div>
          </div>
          <div className="faint" style={{ fontSize: 12.5 }}>По умолчанию 5. Изменение не выкидывает уже вошедших — оно влияет на новые входы.</div>
          {btn('family', () => save('family', { family_max_members: Number(familyMax) }, 'Сохранено'),
            'Сохранить', !familyMax || Number(familyMax) < 2 || Number(familyMax) > 20)}
        </Section>
      </div>
    </div>
  );
};
