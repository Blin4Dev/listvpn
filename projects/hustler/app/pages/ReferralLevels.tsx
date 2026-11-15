import React, { useEffect, useState } from "react";
import { useSmartBack } from "../utils/navigation";
import { loadReferral, peekReferral } from "../utils/referral";
import { btnReset } from "../components/ui";
import { N, NoirBack, NoirCard, NoirScreen } from "../components/noir";
import { O } from "../components/hustler";
import { levelName } from "../utils/brand";

// Hustler: 18 «Уровни» — общий экран в стиле Hustler (компоненты noir → дизайн Hustler)

type Level = { key: string; name: string; min: number; rate: number; gifts: number; self_free_from: number };

// на случай, если сервер не ответил
const FALLBACK: Level[] = [
  { key: "starter", name: levelName("starter", "Starter"), min: 0, rate: 20, gifts: 0, self_free_from: 5 },
  { key: "spreader", name: levelName("spreader", "Spreader"), min: 30, rate: 25, gifts: 1, self_free_from: 0 },
  { key: "special", name: levelName("special", "Special"), min: 50, rate: 30, gifts: 2, self_free_from: 0 },
  { key: "greater", name: levelName("greater", "Greater"), min: 100, rate: 35, gifts: 3, self_free_from: 0 },
  { key: "gen_s", name: levelName("gen_s", "Gen S"), min: 1000, rate: 50, gifts: 10, self_free_from: 0 },
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
  const self = "своя подписка бесплатно";
  if (lv.self_free_from && !lv.gifts) {
    return `С ${lv.self_free_from === 5 ? "пяти" : lv.self_free_from} активных друзей ${self}.`;
  }
  const gifts = lv.gifts === 1
    ? "Раз в месяц можно подарить другу месяц подписки"
    : `Каждый месяц ${lv.gifts} ${plural(lv.gifts, "подарок", "подарка", "подарков")} друзьям — месяц подписки`;
  return `${gifts}. И ${self}.`;
}

export default function ReferralLevels() {
  const goBack = useSmartBack("/referral");
  const cached = peekReferral();
  const [levels, setLevels] = useState<Level[]>(cached?.levels?.length ? cached.levels : FALLBACK);
  const [current, setCurrent] = useState<string | null>(cached?.level?.key || null);
  const [selected, setSelected] = useState<string>(cached?.level?.key || "starter");

  useEffect(() => {
    loadReferral()
      .then((d) => {
        if (Array.isArray(d.levels) && d.levels.length) setLevels(d.levels);
        if (d.level?.key) {
          setCurrent(d.level.key);
          setSelected(d.level.key);
        }
      })
      .catch(() => { /* запасные уровни */ });
  }, []);

  const selIdx = Math.max(0, levels.findIndex((l) => l.key === selected));
  const sel = levels[selIdx];

  // уровни есть всегда (запасные или из кэша) — показываем сразу, не ждём сеть
  const rise = (i: number): React.CSSProperties => ({ animation: `blinvpnRise 0.45s var(--ease-out) ${0.04 * i}s both` });

  return (
    <NoirScreen>
      <NoirBack onClick={goBack} />
      <div style={{ fontSize: 36, fontWeight: 800, lineHeight: "36px", letterSpacing: "-0.025em", paddingTop: 16, color: O.text }}>Уровни и награды</div>
      <div style={{ marginTop: 12, fontSize: 14, lineHeight: "22.75px", color: O.dim }}>
        Процент капает с каждой оплаты приглашённых друзей.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 16 }}>
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
                minHeight: 124,
                padding: 16,
                textAlign: "left",
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-start",
                borderRadius: 21.6,
                border: "none",
                boxShadow: `0 0 0 ${on ? 2 : 1}px ${on ? O.red : "rgba(255,255,255,0.14)"}`,
                background: O.card,
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
                color: N.text,
                cursor: "pointer",
                transition: "border-color 0.18s ease, background 0.18s ease",
              }}
            >
              <span style={{ fontSize: 36, fontWeight: 800, lineHeight: "40px" }}>{lv.rate}%</span>
              <span style={{ marginTop: 12, fontSize: 14, fontWeight: 800, lineHeight: "20px", letterSpacing: "0.35px" }}>{lv.name.toUpperCase()}</span>
              <span style={{ fontSize: 14, lineHeight: "20px", color: O.muted }}>{rangeLabel(levels, i)}</span>
              {mine ? <span style={{ marginTop: 8, fontSize: 14, fontWeight: 700, lineHeight: "20px", color: O.red }}>Ваш уровень</span> : null}
            </button>
          );
        })}
      </div>

      {sel ? (
        <NoirCard key={sel.key} style={{ marginTop: 12, padding: 16, animation: "blinvpnFadeIn 0.25s ease both" }}>
          <div style={{ fontSize: 14, lineHeight: "22.75px", color: O.text }}>
            <b style={{ fontWeight: 700 }}>Условие:</b> {condition(sel, selIdx)}
          </div>
          <div style={{ marginTop: 8, fontSize: 14, lineHeight: "22.75px", color: O.text }}>
            <b style={{ fontWeight: 700 }}>Бонус:</b> {bonus(sel)}
          </div>
        </NoirCard>
      ) : null}
    </NoirScreen>
  );
}
