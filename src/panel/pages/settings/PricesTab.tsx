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
  // тарифы по периодам (₽ и ⭐) и отдельные тарифы с белыми списками (анти-ключ FURK, как в старом боте)
  const PERIODS = ['1', '3', '6', '12'] as const;
  const PERIOD_TITLE: Record<string, string> = { '1': '1 месяц', '3': '3 месяца', '6': '6 месяцев', '12': '1 год' };
  const [periodPrices, setPeriodPrices] = useState<Record<string, string>>({ '1': '180', '3': '470', '6': '900', '12': '1600' });
  const [periodStars, setPeriodStars] = useState<Record<string, string>>({ '1': '200', '3': '540', '6': '1000', '12': '2000' });
  const [wlPrices, setWlPrices] = useState<Record<string, string>>({ '1': '399', '3': '1488', '6': '2222', '12': '0' });
  const [wlStars, setWlStars] = useState<Record<string, string>>({ '1': '600', '3': '1800', '6': '2500', '12': '0' });
  const [wlDevices, setWlDevices] = useState<Record<string, string>>({ '1': '2', '3': '5', '6': '5', '12': '5' });
  const [tariffDevices, setTariffDevices] = useState('3');
  const [wlConfigured, setWlConfigured] = useState(false);
  const [wlError, setWlError] = useState('');
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
        const toStr = (o: Record<string, number> | undefined, fb: Record<string, string>) =>
          Object.fromEntries(PERIODS.map((k) => [k, o && o[k] != null ? String(o[k]) : fb[k]]));
        setPeriodPrices((p) => toStr(m.period_prices, p));
        setPeriodStars((p) => toStr(m.period_stars, p));
        setWlPrices((p) => toStr(m.whitelist_prices, p));
        setWlStars((p) => toStr(m.whitelist_stars, p));
        setWlDevices((p) => toStr(m.whitelist_devices, p));
        setTariffDevices(String(m.tariff_devices ?? 3));
        setWlConfigured(!!m.whitelist_configured);
        setWlError(String(m.whitelist_error || ''));
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
          trial_traffic_gb: Number(f.trialGb), trial_devices: Number(f.trialDevices),
          period_prices: Object.fromEntries(PERIODS.map((k) => [k, Number(periodPrices[k])])),
          period_stars: Object.fromEntries(PERIODS.map((k) => [k, Number(periodStars[k])])),
          whitelist_prices: Object.fromEntries(PERIODS.map((k) => [k, Number(wlPrices[k])])),
          whitelist_stars: Object.fromEntries(PERIODS.map((k) => [k, Number(wlStars[k])])),
          whitelist_devices: Object.fromEntries(PERIODS.map((k) => [k, Number(wlDevices[k])])),
          tariff_devices: Number(tariffDevices),
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
            </div>
          </Section>

          <Section
            title="Белые списки"
            sub="Отдельные тарифы, как в старом боте: полная цена (ВПН + анти-ключ FURK на 500 ГБ). Покупка продлевает основную подписку на тот же срок и выдаёт/продлевает анти-ключ. Цена 0 — срок недоступен."
          >
            <div className="inset" style={{ padding: '10px 14px', fontSize: 13.5 }}>
              {wlConfigured
                ? 'FURK API подключён — белые списки доступны в мини-приложении.'
                : `FURK API не подключён — опция скрыта. Нужны FURK_API_KEY и FURK_BASE_URL в .env и файл src/api/furk_api.py из старого бота.${wlError ? ` (${wlError})` : ''}`}
            </div>
            <div className="flex flex-col gap-3">
              <div className="grid gap-3" style={{ gridTemplateColumns: '1.1fr 1fr 1fr 0.8fr' }}>
                <div className="sub">Период</div><div className="sub">Цена, ₽</div><div className="sub">Цена, ⭐</div><div className="sub">Устройств</div>
              </div>
              {PERIODS.map((k) => (
                <div key={k} className="grid gap-3 items-center" style={{ gridTemplateColumns: '1.1fr 1fr 1fr 0.8fr' }}>
                  <div style={{ fontWeight: 500 }}>{PERIOD_TITLE[k]}</div>
                  <input className="input" type="number" min={0} value={wlPrices[k]} onChange={(e) => setWlPrices((p) => ({ ...p, [k]: e.target.value }))} />
                  <input className="input" type="number" min={0} value={wlStars[k]} onChange={(e) => setWlStars((p) => ({ ...p, [k]: e.target.value }))} />
                  <input className="input" type="number" min={1} max={50} value={wlDevices[k]} onChange={(e) => setWlDevices((p) => ({ ...p, [k]: e.target.value }))} />
                </div>
              ))}
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
              <div><label className="field-label">Цена доп. устройства, ₽/мес</label><input className="input" type="number" min={0} value={f.extra} onChange={set('extra')} /></div>
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
