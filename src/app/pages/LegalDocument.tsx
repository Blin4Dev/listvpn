import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useSmartBack } from "../utils/navigation";
import { fetchLegal } from "../utils/api";
import { RichText } from "../components/RichText";
import { N, NoirBack, NoirScreen } from "../components/noir";

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
    <NoirScreen dim={0.45}>
      <div style={{ paddingTop: 20, marginBottom: 22 }}>
        <NoirBack onClick={goBack} />
      </div>
      <div
        style={{
          fontSize: kind === "privacy" ? "min(32px, 8.2vw)" : 32,
          fontWeight: 500,
          letterSpacing: "-0.025em",
          lineHeight: 1.15,
          color: N.text,
          marginBottom: 26,
        }}
      >
        {title}
      </div>

      {text === null ? (
        <div style={{ fontSize: 15.5, color: N.muted }}>Загрузка…</div>
      ) : failed || blocks.length === 0 ? (
        <div style={{ fontSize: 15.5, lineHeight: 1.5, color: N.muted }}>
          {failed ? "Не удалось загрузить документ. Попробуйте позже." : "Документ пока не опубликован."}
        </div>
      ) : (
        <div style={{ paddingBottom: 32, animation: "blinvpnRise 0.5s var(--ease-out) both" }}>
          {blocks.map((b, i) =>
            b.kind === "h" ? (
              <div
                key={i}
                role="heading"
                aria-level={2}
                style={{ fontSize: 17.5, fontWeight: 500, lineHeight: 1.3, color: N.text, marginTop: i === 0 ? 0 : 26, marginBottom: 10 }}
              >
                {b.text}
              </div>
            ) : (
              <RichText
                key={i}
                text={b.text}
                compact
                style={{ fontSize: 16, lineHeight: 1.45, color: N.muted, marginTop: i > 0 && blocks[i - 1].kind === "p" ? 12 : 0 }}
              />
            ),
          )}
        </div>
      )}
    </NoirScreen>
  );
}
