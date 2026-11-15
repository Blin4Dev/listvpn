import React, { useEffect, useState } from "react";
import { useSmartBack } from "../utils/navigation";
import { loadReferral, peekReferral } from "../utils/referral";
import { btnReset } from "../components/ui";
import { N, NoirBack, NoirCard, NoirScreen } from "../components/noir";
import { O } from "../components/lyam";
import { levelName } from "../utils/brand";

// ЛЯМ200: 18 «Уровни» — общий экран в стиле ЛЯМ200 (компоненты noir → дизайн ЛЯМ200)

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
  if (i === 0) return "Уровень считается с самого начала.";
  return `Уровень — с ${lv.min} ${plural(lv.min, "активного друга", "активных друзей", "активных друзей")}.`;
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
  const [active, setActive] = useState<number>(Number(cached?.active_count ?? 0));

  useEffect(() => {
    loadReferral()
      .then((d) => {
        if (Array.isArray(d.levels) && d.levels.length) setLevels(d.levels);
        setActive(Number(d.active_count ?? 0));
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
      <div style={{ fontSize: 24, fontWeight: 600, lineHeight: "32px", paddingTop: 6, color: O.text }}>Уровни и награды</div>
      <div style={{ paddingTop: 16, fontSize: 14, lineHeight: "20px", color: O.muted }}>
        Процент считается с оплат приглашённых друзей. Сейчас активных друзей: {active}.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 16, alignItems: "start" }}>
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
                minHeight: 112,
                padding: "16px 12px",
                textAlign: "left",
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-start",
                borderRadius: 16,
                border: "none",
                boxShadow: on ? `0 0 0 2px ${O.red}` : "none",
                background: O.card,
                color: N.text,
                cursor: "pointer",
                transition: "border-color 0.18s ease, background 0.18s ease",
              }}
            >
              <span style={{ fontSize: 24, fontWeight: 600, lineHeight: "32px" }}>{lv.rate}%</span>
              <span style={{ marginTop: 8, fontSize: 14, fontWeight: 500, lineHeight: "20px" }}>{lv.name.toUpperCase()}</span>
              <span style={{ fontSize: 14, lineHeight: "20px", color: O.muted }}>{rangeLabel(levels, i)}</span>
              {mine ? <span style={{ marginTop: 8, fontSize: 14, fontWeight: 500, lineHeight: "20px", color: O.text }}>Ваш уровень</span> : null}
            </button>
          );
        })}
      </div>

      {sel ? (
        <NoirCard key={sel.key} style={{ marginTop: 12, padding: 16, animation: "blinvpnFadeIn 0.25s ease both" }}>
          <div style={{ fontSize: 14, lineHeight: "20px", color: O.text }}>{condition(sel, selIdx)}</div>
          <div style={{ marginTop: 8, fontSize: 14, lineHeight: "20px", color: O.muted }}>{bonus(sel)} Сейчас друзей {active}.</div>
        </NoirCard>
      ) : null}
    </NoirScreen>
  );
}
