// FGN: «Договор оферты» / «Политика конфиденциальности» (макет 72; переопределение src/app/pages/LegalDocument.tsx).
// Шапка с FgnHeader, секции номерованы: «1. Общие положения», текст 14.5/20 серый #A9A9B1.
import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useSmartBack } from "../utils/navigation";
import { fetchLegal } from "../utils/api";
import { C, FgnHeader, FgnPage } from "../components/fgn";

const TEXT = "#F4F4F5";
const MUTED = "#9B9BA4";
const CARD_BG = "#141416";
const CARD_BORDER = "#2A2A30";

type Block = { kind: "h"; text: string } | { kind: "p"; text: string };

const DOC_TITLE = /^(публичная\s+)?(оферта|договор|политика)/i;

/**
 * Текст документа из панели → заголовки разделов и абзацы.
 * Заголовок: «# …» или короткая строка «1. Название» без точки в конце.
 * Первая строка-название документа («Публичная оферта …») пропускается — оно уже в шапке.
 */
function parse(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ kind: "p", text: para.join("\n") });
    para = [];
  };
  let first = true;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (first) {
      first = false;
      if (DOC_TITLE.test(line) && line.length < 70 && !/[.:]$/.test(line)) continue;
    }
    const md = /^#{1,3}\s+(.+)$/.exec(line);
    const numbered = /^\d{1,2}[.)]\s+\S/.test(line) && line.length <= 60 && !/[.;:,]$/.test(line);
    if (md || numbered) {
      flush();
      out.push({ kind: "h", text: md ? md[1] : line });
      continue;
    }
    para.push(line);
  }
  flush();
  return out;
}

export default function LegalDocument() {
  const { kind } = useParams<{ kind: string }>();
  const goBack = useSmartBack("/settings");
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const title = kind === "privacy" ? "Политика конфиденциальности" : "Договор оферты";

  useEffect(() => {
    setText(null);
    setFailed(false);
    fetchLegal()
      .then((legal) => setText((kind === "privacy" ? legal.privacy : legal.offer) || ""))
      .catch(() => { setFailed(true); setText(""); });
  }, [kind]);

  const blocks = text ? parse(text) : [];

  return (
    <FgnPage>
      <FgnHeader title={title} onBack={goBack} btnStyle={{ background: CARD_BG, borderColor: CARD_BORDER }} />

      {text === null ? (
        <div style={{ marginTop: 20, flexShrink: 0, fontSize: 14.5, lineHeight: "20px", color: MUTED }}>Загрузка…</div>
      ) : failed || blocks.length === 0 ? (
        <div style={{ marginTop: 20, flexShrink: 0, fontSize: 14.5, lineHeight: "20px", color: MUTED }}>
          {failed ? "Не удалось загрузить документ." : "Документ пока не опубликован."}
        </div>
      ) : (
        <>
          {blocks.map((b, i) =>
            b.kind === "h" ? (
              <div
                key={i}
                style={{
                  marginTop: i === 0 ? 39.5 : 14.5,
                  flexShrink: 0,
                  fontSize: 18,
                  fontWeight: 500,
                  lineHeight: "20px",
                  color: TEXT,
                  animation: `fgnFade 0.3s ease ${Math.min(i, 12) * 0.04}s both`,
                }}
              >
                {b.text}
              </div>
            ) : (
              <div
                key={i}
                style={{
                  marginTop: 18,
                  flexShrink: 0,
                  fontSize: 15,
                  lineHeight: "20px",
                  color: MUTED,
                  whiteSpace: "pre-line",
                  animation: `fgnFade 0.3s ease ${Math.min(i, 12) * 0.04}s both`,
                }}
              >
                {b.text}
              </div>
            )
          )}
        </>
      )}
    </FgnPage>
  );
}
