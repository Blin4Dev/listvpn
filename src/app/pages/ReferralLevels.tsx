import React, { useEffect, useState } from "react";
import { useSmartBack } from "../utils/navigation";
import { appFetch } from "../utils/api";
import { btnReset } from "../components/ui";
import { N, NoirBack, NoirCard, NoirScreen } from "../components/noir";

type Level = { key: string; name: string; min: number; rate: number; gifts: number; self_free_from: number };

// на случай, если сервер не ответил
const FALLBACK: Level[] = [
  { key: "starter", name: "Starter", min: 0, rate: 20, gifts: 0, self_free_from: 5 },
  { key: "spreader", name: "Spreader", min: 30, rate: 25, gifts: 1, self_free_from: 0 },
  { key: "special", name: "Special", min: 50, rate: 30, gifts: 2, self_free_from: 0 },
  { key: "greater", name: "Greater", min: 100, rate: 35, gifts: 3, self_free_from: 0 },
  { key: "gen_s", name: "Gen S", min: 1000, rate: 50, gifts: 10, self_free_from: 0 },
];

function plural(n: number, one: string, few: string, many: string) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}

// «1–29 активных», «30–49», «от 1000»
function rangeLabel(levels: Level[], i: number): string {
  const lv = levels[i];
  const next = levels[i + 1];
  const from = i === 0 ? 1 : lv.min;
  if (!next) return `от ${lv.min}`;
  const range = `${from}–${next.min - 1}`;
  return i === 0 ? `${range} активных` : range;
}

function condition(lv: Level, i: number): string {
  if (i === 0) return "уровень с самого начала.";
  return `${lv.min} ${plural(lv.min, "активный друг", "активных друга", "активных друзей")}.`;
}

function bonus(lv: Level): string {
  const self = "своя подписка бесплатно, вместе с белыми списками";
  if (lv.self_free_from && !lv.gifts) {
    return `С ${lv.self_free_from === 5 ? "пяти" : lv.self_free_from} активных друзей ${self}.`;
  }
  const gifts = lv.gifts === 1
    ? "Раз в месяц можно подарить другу месяц подписки с белыми списками"
    : `Каждый месяц ${lv.gifts} ${plural(lv.gifts, "подарок", "подарка", "подарков")} друзьям — месяц подписки с белыми списками`;
  return `${gifts}. И ${self}.`;
}

export default function ReferralLevels() {
  const goBack = useSmartBack("/referral");
  const [levels, setLevels] = useState<Level[]>(FALLBACK);
  const [current, setCurrent] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>("starter");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    appFetch<{ levels?: Level[]; level?: { key: string } }>("/referral")
      .then((d) => {
        if (Array.isArray(d.levels) && d.levels.length) setLevels(d.levels);
        if (d.level?.key) {
          setCurrent(d.level.key);
          setSelected(d.level.key);
        }
      })
      .catch(() => { /* запасные уровни */ })
      .finally(() => setLoaded(true));
  }, []);

  const selIdx = Math.max(0, levels.findIndex((l) => l.key === selected));
  const sel = levels[selIdx];

  const rise = (i: number): React.CSSProperties => ({
    animation: loaded ? `blinvpnRise 0.55s var(--ease-out) ${0.04 * i}s both` : undefined,
    opacity: loaded ? undefined : 0,
  });

  return (
    <NoirScreen>
      <div style={{ paddingTop: 20, marginBottom: 22 }}>
        <NoirBack onClick={goBack} />
      </div>
      <div style={{ fontSize: 32, fontWeight: 500, letterSpacing: "-0.025em", lineHeight: 1.15, color: N.text }}>Уровни</div>
      <div style={{ marginTop: 12, fontSize: 15.5, lineHeight: 1.45, color: N.muted }}>
        Процент капает с каждой оплаты приглашённых друзей.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 20 }}>
        {levels.map((lv, i) => {
          const on = lv.key === selected;
          const mine = lv.key === current;
          return (
            <button
              key={lv.key}
              type="button"
              onClick={() => setSelected(lv.key)}
              className="blin-press"
              aria-pressed={on}
              style={{
                ...btnReset,
                ...rise(i),
                fontFamily: N.font,
                minHeight: 134,
                padding: "16px 16px",
                textAlign: "left",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                borderRadius: 26,
                border: `1.5px solid ${on ? "rgba(255,255,255,0.85)" : N.cardBorder}`,
                background: on ? "rgba(16, 16, 22, 0.55)" : N.card,
                backdropFilter: "blur(10px)",
                WebkitBackdropFilter: "blur(10px)",
                color: N.text,
                cursor: "pointer",
                transition: "border-color 0.18s ease, background 0.18s ease",
              }}
            >
              <span style={{ fontSize: 32, fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1.1 }}>{lv.rate}%</span>
              <span style={{ marginTop: 8, fontSize: 15.5, fontWeight: 500, letterSpacing: "0.03em" }}>{lv.name.toUpperCase()}</span>
              <span style={{ marginTop: 6, fontSize: 14.5, color: N.muted }}>{rangeLabel(levels, i)}</span>
              {mine ? <span style={{ marginTop: 10, fontSize: 14.5, color: N.redText }}>Ваш уровень</span> : null}
            </button>
          );
        })}
      </div>

      {sel ? (
        <NoirCard key={sel.key} style={{ marginTop: 14, padding: "18px 18px 20px", animation: "blinvpnFadeIn 0.25s ease both" }}>
          <div style={{ fontSize: 16.5, lineHeight: 1.5, color: N.text }}>
            <b style={{ fontWeight: 600 }}>Условие:</b> {condition(sel, selIdx)}
          </div>
          <div style={{ marginTop: 10, fontSize: 16.5, lineHeight: 1.5, color: N.text }}>
            <b style={{ fontWeight: 600 }}>Бонус:</b> {bonus(sel)}
          </div>
        </NoirCard>
      ) : null}
    </NoirScreen>
  );
}
