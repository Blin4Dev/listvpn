// FGN: «Уровни» (переопределение src/app/pages/ReferralLevels.tsx), макет 56.
// Шапка как у остальных экранов, подзаголовок 14.5/20, сетка 2×N карточек (радиус 20, зазор 12):
// процент 32/700, название 15/500 капсом, диапазон 14.5 серым, «Ваш уровень» зелёным; выбранная — белая рамка.
// Ниже карточка «Условие / Бонус» 14.5/22.
import React, { useEffect, useState } from "react";
import { useSmartBack } from "../utils/navigation";
import { loadReferral, peekReferral } from "../utils/referral";
import { C, FgnHeader, FgnPage } from "../components/fgn";

const MUTED = "#9B9BA4";
const CARD_BG = "#141416";
const CARD_BORDER = "#2A2A30";
const TEXT = "#F4F4F5";
const GREEN = "#3EE08A";

type Level = { key: string; name: string; min: number; rate: number; gifts: number; self_free_from: number };

// на случай, если сервер не ответил
const FALLBACK: Level[] = [
  { key: "starter", name: "FRESHMAN", min: 0, rate: 20, gifts: 0, self_free_from: 5 },
  { key: "spreader", name: "LOYAL", min: 30, rate: 25, gifts: 1, self_free_from: 0 },
  { key: "special", name: "PERSON", min: 50, rate: 30, gifts: 2, self_free_from: 0 },
  { key: "greater", name: "GOTHAM BOSS", min: 100, rate: 35, gifts: 3, self_free_from: 0 },
  { key: "gen_s", name: "BRUCE WAYNE", min: 1000, rate: 50, gifts: 10, self_free_from: 0 },
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

const pct = (n: number) => `${n % 1 ? n.toFixed(1).replace(".", ",") : Math.round(n)}%`;

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
  const fade = (i: number): React.CSSProperties => ({ animation: `fgnFade 0.35s ease ${0.04 * i}s both` });

  return (
    <FgnPage>
      <FgnHeader title="Уровни" onBack={goBack} btnStyle={{ background: CARD_BG, borderColor: CARD_BORDER }} />

      <div style={{ marginTop: 19.5, flexShrink: 0, fontSize: 14.5, lineHeight: "20px", color: MUTED }}>
        Процент капает с каждой оплаты приглашённых друзей.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 16.5, flexShrink: 0 }}>
        {levels.map((lv, i) => {
          const on = lv.key === selected;
          const mine = lv.key === current;
          return (
            <button
              key={lv.key}
              type="button"
              className="blin-press"
              aria-pressed={on}
              onClick={() => setSelected(lv.key)}
              style={{
                ...fade(i),
                appearance: "none",
                margin: 0,
                minWidth: 0,
                padding: "15px 16px 17px",
                borderRadius: 20,
                border: `1px solid ${on ? TEXT : CARD_BORDER}`,
                background: CARD_BG,
                boxSizing: "border-box",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                alignItems: "flex-start",
                textAlign: "left",
                fontFamily: C.font,
                color: TEXT,
                cursor: "pointer",
                transition: "border-color 0.18s ease",
              }}
            >
              <span style={{ fontSize: 32, fontWeight: 700, lineHeight: "35px", whiteSpace: "nowrap" }}>{pct(lv.rate)}</span>
              <span style={{ marginTop: 9, fontSize: 15, fontWeight: 500, lineHeight: "20px", textTransform: "uppercase", whiteSpace: "nowrap" }}>{lv.name}</span>
              <span style={{ fontSize: 14.5, lineHeight: "20px", color: MUTED, whiteSpace: "nowrap" }}>{rangeLabel(levels, i)}</span>
              {mine ? <span style={{ marginTop: 8, fontSize: 14.5, fontWeight: 500, lineHeight: "20px", color: GREEN, whiteSpace: "nowrap" }}>Ваш уровень</span> : null}
            </button>
          );
        })}
      </div>

      {sel ? (
        <div
          key={sel.key}
          style={{
            marginTop: 12,
            flexShrink: 0,
            padding: "16px 16px 17px",
            borderRadius: 20,
            border: `1px solid ${CARD_BORDER}`,
            background: CARD_BG,
            boxSizing: "border-box",
            fontSize: 14.5,
            lineHeight: "22px",
            color: TEXT,
            animation: "fgnFade 0.25s ease both",
          }}
        >
          <div>
            <b style={{ fontWeight: 600 }}>Условие:</b> {condition(sel, selIdx)}
          </div>
          <div style={{ marginTop: 13 }}>
            <b style={{ fontWeight: 600 }}>Бонус:</b> {bonus(sel)}
          </div>
        </div>
      ) : null}
    </FgnPage>
  );
}
