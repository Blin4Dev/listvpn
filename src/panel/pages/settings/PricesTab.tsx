import React, { useState, useEffect } from 'react';
import {
  Save,
} from 'lucide-react';
import { Spinner, Toggle } from '../../components/ui';
import { apiFetch, parseApiErr } from '../../lib/api';
import type { ToastType } from '../../lib/types';

export const Section: React.FC<{ title: string; sub?: string; children: React.ReactNode }> = ({ title, sub, children }) => (
  <div className="flex flex-col gap-4" style={{ paddingTop: 20, borderTop: '1px solid var(--border)' }}>
    <div><div style={{ fontWeight: 600 }}>{title}</div>{sub && <div className="sub mt-0.5">{sub}</div>}</div>
    {children}
  </div>
);

export const PricesSettingsTab: React.FC<{ onToast: (t: string, m: string, ty: ToastType) => void }> = ({ onToast }) => {
  const [f, setF] = useState({
    base: '99', extra: '40', paidGb: '100', trafficReset: '0',
    trialDays: '3', trialGb: '5', trialDevices: '1',
  });
  const [trialEnabled, setTrialEnabled] = useState(true);
  // пробный отдельно: в мини-приложении (Telegram) и на сайте
  const [trialMiniapp, setTrialMiniapp] = useState(true);
  const [trialWeb, setTrialWeb] = useState(true);
  // тарифы по периодам (₽ и ⭐) и отдельные тарифы с белыми списками (анти-ключ FURK, как в старом боте)
  const PERIODS = ['1', '3', '6', '12'] as const;
  const PERIOD_TITLE: Record<string, string> = { '1': '1 месяц', '3': '3 месяца', '6': '6 месяцев', '12': '1 год' };
  const [periodPrices, setPeriodPrices] = useState<Record<string, string>>({ '1': '180', '3': '470', '6': '900', '12': '1600' });
  const [periodStars, setPeriodStars] = useState<Record<string, string>>({ '1': '200', '3': '540', '6': '1000', '12': '2000' });
  const [wlPrices, setWlPrices] = useState<Record<string, string>>({ '1': '399', '3': '1488', '6': '2222', '12': '0' });
  const [wlStars, setWlStars] = useState<Record<string, string>>({ '1': '600', '3': '1800', '6': '2500', '12': '0' });
  const [wlDevices, setWlDevices] = useState<Record<string, string>>({ '1': '2', '3': '5', '6': '5', '12': '5' });
  const [tariffDevices, setTariffDevices] = useState('2');
  // своя цена для каждого доп. устройства (по номеру), ₽/мес; пусто — как у предыдущего
  const [devPrices, setDevPrices] = useState<Record<string, string>>({});
  const [devStars, setDevStars] = useState<Record<string, string>>({});
  const [extraStars, setExtraStars] = useState('40');
  const [wlConfigured, setWlConfigured] = useState(false);
  const [wlError, setWlError] = useState('');
  const [furk, setFurk] = useState<{ configured?: boolean; ok?: boolean; balance?: number; credit?: number; error?: string } | null>(null);
  // способы оплаты: вкл/выкл и комиссия
  const [payMethods, setPayMethods] = useState<{ id: string; title: string; enabled: boolean }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  const load = async () => {
    setLoading(true);
    try {
      const m = await apiFetch('/panel/plans/meta');
      if (m) {
        setF({
          base: String(m.base_price ?? 99), extra: String(m.extra_device_price ?? 40),
          paidGb: String(m.paid_traffic_gb ?? 100), trafficReset: String(m.traffic_reset_price ?? 0),
          trialDays: String(m.trial_days ?? 3), trialGb: String(m.trial_traffic_gb ?? 5), trialDevices: String(m.trial_devices ?? 1),
        });
        setTrialEnabled(m.trial_enabled !== false);
        setTrialMiniapp(m.trial_miniapp_enabled !== false);
        setTrialWeb(m.trial_web_enabled !== false);
        const toStr = (o: Record<string, number> | undefined, fb: Record<string, string>) =>
          Object.fromEntries(PERIODS.map((k) => [k, o && o[k] != null ? String(o[k]) : fb[k]]));
        setPeriodPrices((p) => toStr(m.period_prices, p));
        setPeriodStars((p) => toStr(m.period_stars, p));
        setWlPrices((p) => toStr(m.whitelist_prices, p));
        setWlStars((p) => toStr(m.whitelist_stars, p));
        setWlDevices((p) => toStr(m.whitelist_devices, p));
        setTariffDevices(String(m.tariff_devices ?? 2));
        setDevPrices(Object.fromEntries(Object.entries(m.device_prices || {}).map(([k, v]) => [k, String(v)])));
        setDevStars(Object.fromEntries(Object.entries(m.device_stars || {}).map(([k, v]) => [k, String(v)])));
        setExtraStars(String(m.extra_device_stars ?? m.extra_device_price ?? 40));
        setWlConfigured(!!m.whitelist_configured);
        setWlError(String(m.whitelist_error || ''));
        try { setFurk(await apiFetch('/panel/furk/status')); } catch { setFurk(null); }
        if (Array.isArray(m.pay_methods)) {
          setPayMethods(m.pay_methods.map((x: any) => ({ id: x.id, title: x.title, enabled: !!x.enabled })));
        }
      }
    } catch { onToast('Ошибка', 'Не удалось загрузить настройки', 'error'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      await apiFetch('/panel/plans', {
        method: 'PUT',
        body: JSON.stringify({
          base_price: Number(f.base), extra_device_price: Number(f.extra),
          paid_traffic_gb: Number(f.paidGb), traffic_reset_price: Number(f.trafficReset),
          trial_enabled: trialEnabled, trial_days: Number(f.trialDays),
          trial_miniapp_enabled: trialMiniapp, trial_web_enabled: trialWeb,
          trial_traffic_gb: Number(f.trialGb), trial_devices: Number(f.trialDevices),
          period_prices: Object.fromEntries(PERIODS.map((k) => [k, Number(periodPrices[k])])),
          period_stars: Object.fromEntries(PERIODS.map((k) => [k, Number(periodStars[k])])),
          whitelist_prices: Object.fromEntries(PERIODS.map((k) => [k, Number(wlPrices[k])])),
          whitelist_stars: Object.fromEntries(PERIODS.map((k) => [k, Number(wlStars[k])])),
          whitelist_devices: Object.fromEntries(PERIODS.map((k) => [k, Number(wlDevices[k])])),
          tariff_devices: Number(tariffDevices),
          device_prices: Object.fromEntries(
            Object.entries(devPrices).filter(([, v]) => String(v).trim() !== '').map(([k, v]) => [k, Number(v)])),
          extra_device_stars: Number(extraStars),
          device_stars: Object.fromEntries(
            Object.entries(devStars).filter(([, v]) => String(v).trim() !== '').map(([k, v]) => [k, Number(v)])),
          pay_methods: Object.fromEntries(payMethods.map((x) => [x.id, { enabled: x.enabled }])),
        }),
      });
      onToast('Готово', 'Сохранено — мини-приложение подхватит сразу', 'success');
      load();
    } catch (e: any) { onToast('Ошибка', parseApiErr(e, 'Не удалось сохранить'), 'error'); }
    finally { setSaving(false); }
  };


  return (
    <div className="card" style={{ padding: 24 }}>
      <h3 className="h-sec" style={{ paddingBottom: 16, marginBottom: 4 }}>Цены и подписки</h3>
      {loading ? <div className="sub">Загрузка…</div> : (
        <div className="flex flex-col gap-6">
          <Section title="Тарифы" sub="Цена за весь срок, отдельно в рублях и в звёздах.">
            <div className="flex flex-col gap-3">
              <div className="grid gap-3" style={{ gridTemplateColumns: '1.1fr 1fr 1fr' }}>
                <div className="sub">Период</div><div className="sub">Цена, ₽</div><div className="sub">Цена, ⭐</div>
              </div>
              {PERIODS.map((k) => (
                <div key={k} className="grid gap-3 items-center" style={{ gridTemplateColumns: '1.1fr 1fr 1fr' }}>
                  <div style={{ fontWeight: 500 }}>{PERIOD_TITLE[k]}</div>
                  <input className="input" type="number" min={1} value={periodPrices[k]} onChange={(e) => setPeriodPrices((p) => ({ ...p, [k]: e.target.value }))} />
                  <input className="input" type="number" min={1} value={periodStars[k]} onChange={(e) => setPeriodStars((p) => ({ ...p, [k]: e.target.value }))} />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><label className="field-label">Устройств в тарифе</label><input className="input" type="number" min={1} max={20} value={tariffDevices} onChange={(e) => setTariffDevices(e.target.value)} /></div>
              <div><label className="field-label">Доп. устройство по умолчанию, ₽/мес</label><input className="input" type="number" min={0} value={f.extra} onChange={set('extra')} /></div>
              <div><label className="field-label">Доп. устройство по умолчанию, ⭐/мес</label><input className="input" type="number" min={0} value={extraStars} onChange={(e) => setExtraStars(e.target.value)} /></div>
            </div>
          </Section>

          <Section
            title="Цены доп. устройств"
            sub="Своя цена за каждое устройство сверх тарифа — в рублях и в звёздах, за месяц (умножается на срок). Пустое поле — как у предыдущего устройства."
          >
            {(() => {
              const plan = Math.max(1, Math.min(20, Number(tariffDevices) || 2));
              const filled = (x: string | undefined) => x != null && String(x).trim() !== '';
              // цена n-го устройства с учётом «пусто — как у предыдущего»
              const tierOf = (vals: Record<string, string>, base: number) => {
                const out: number[] = []; let cur = base;
                for (let i = 1; i <= 20; i++) { if (filled(vals[String(i)])) cur = Number(vals[String(i)]) || 0; out.push(cur); }
                return out;
              };
              const rub = tierOf(devPrices, Number(f.extra) || 0);
              const st = tierOf(devStars, Number(extraStars) || 0);
              const cols = '120px 1fr 1fr 1.3fr';
              const rows: React.ReactNode[] = [
                <div key="h" className="grid gap-3" style={{ gridTemplateColumns: cols }}>
                  <div className="sub">Устройство</div><div className="sub">₽/мес</div><div className="sub">⭐/мес</div><div className="sub">Итого к тарифу</div>
                </div>,
              ];
              let sumR = 0, sumS = 0;
              for (let n = plan + 1; n <= 20; n++) {
                const k = String(n);
                sumR += rub[n - 1]; sumS += st[n - 1];
                rows.push(
                  <div key={k} className="grid gap-3 items-center" style={{ gridTemplateColumns: cols }}>
                    <div style={{ fontWeight: 500 }}>{n}-е</div>
                    <input className="input" type="number" min={0} placeholder={String(n > 1 ? rub[n - 2] : rub[0])} value={devPrices[k] ?? ''}
                      onChange={(e) => setDevPrices((p) => ({ ...p, [k]: e.target.value }))} />
                    <input className="input" type="number" min={0} placeholder={String(n > 1 ? st[n - 2] : st[0])} value={devStars[k] ?? ''}
                      onChange={(e) => setDevStars((p) => ({ ...p, [k]: e.target.value }))} />
                    <div className="faint" style={{ fontSize: 12 }}>{n} устр.: +{Math.round(sumR * 100) / 100} ₽ · +{Math.round(sumS)} ⭐ /мес</div>
                  </div>,
                );
              }
              return <div className="flex flex-col gap-2">{rows}</div>;
            })()}
          </Section>

          <Section
            title="Белые списки"
            sub="Единый тариф: каждая покупка, продление и подарок — ВПН + анти-ключ FURK (500 ГБ) на тот же срок, по цене периода выше. Отдельных цен для белых списков больше нет."
          >
            <div className="inset" style={{ padding: '10px 14px', fontSize: 13.5 }}>
              {!wlConfigured
                ? `FurkVPN API не подключён — подписки выдаются без белых списков. Добавьте FURK_API_KEY в .env (ключ из @VPNpartenrsbot).${wlError ? ` (${wlError})` : ''}`
                : furk && furk.ok === false
                  ? `FurkVPN API не отвечает или ключ неверный (${furk.error || 'ошибка'}).`
                  : `FurkVPN API подключён${furk?.balance != null ? ` · баланс ${furk.balance} ₽${furk.credit ? ` (+ кредит ${furk.credit} ₽)` : ''}` : ''}. При нулевом балансе ключи не выдаются — админу придёт алерт.`}
            </div>
          </Section>

          <Section title="Способы оплаты" sub="Без комиссии. Выключенный способ виден в мини-приложении как «пока недоступно».">
            <div className="flex flex-col gap-3">
              {payMethods.map((x, i) => (
                <div key={x.id} className="inset flex items-center gap-3" style={{ padding: '10px 14px' }}>
                  <div style={{ flex: 1, fontWeight: 500 }}>{x.title}</div>
                  <Toggle on={x.enabled} onChange={() => setPayMethods((p) => p.map((y, j) => (j === i ? { ...y, enabled: !y.enabled } : y)))} />
                </div>
              ))}
            </div>
          </Section>

          <Section title="Платная подписка">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><label className="field-label">Трафик в месяц, ГБ (0 = без лимита)</label><input className="input" type="number" min={0} value={f.paidGb} onChange={set('paidGb')} /></div>
              <div><label className="field-label">Досрочный сброс трафика, ₽ (0 = выкл.)</label><input className="input" type="number" min={0} value={f.trafficReset} onChange={set('trafficReset')} /></div>
            </div>
          </Section>

          <Section title="Пробная подписка">
            <div className="inset flex items-center justify-between gap-3" style={{ padding: 14 }}>
              <div style={{ fontWeight: 500 }}>Пробный период включён</div>
              <Toggle on={trialEnabled} onChange={() => setTrialEnabled(!trialEnabled)} />
            </div>
            {trialEnabled && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="inset flex items-center justify-between gap-3" style={{ padding: 14 }}>
                  <div>
                    <div style={{ fontWeight: 500 }}>В мини-приложении</div>
                    <div className="faint" style={{ fontSize: 12 }}>Telegram Mini App</div>
                  </div>
                  <Toggle on={trialMiniapp} onChange={() => setTrialMiniapp(!trialMiniapp)} />
                </div>
                <div className="inset flex items-center justify-between gap-3" style={{ padding: 14 }}>
                  <div>
                    <div style={{ fontWeight: 500 }}>На сайте</div>
                    <div className="faint" style={{ fontSize: 12 }}>Вход через браузер (почта / Telegram)</div>
                  </div>
                  <Toggle on={trialWeb} onChange={() => setTrialWeb(!trialWeb)} />
                </div>
              </div>
            )}
            {trialEnabled && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div><label className="field-label">Срок, дней</label><input className="input" type="number" min={1} max={365} value={f.trialDays} onChange={set('trialDays')} /></div>
                <div><label className="field-label">Трафик, ГБ (0 = без лимита)</label><input className="input" type="number" min={0} value={f.trialGb} onChange={set('trialGb')} /></div>
                <div><label className="field-label">Устройств</label><input className="input" type="number" min={1} max={20} value={f.trialDevices} onChange={set('trialDevices')} /></div>
              </div>
            )}
          </Section>

          <div><button className="btn solid" onClick={save} disabled={saving}>{saving ? <Spinner size={16} /> : <Save size={16} />} Сохранить</button></div>
        </div>
      )}
    </div>
  );
};
