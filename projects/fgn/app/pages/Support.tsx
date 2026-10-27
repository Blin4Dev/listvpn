// FGN: «Поддержка» (переопределение src/app/pages/Support.tsx; маршрут /support).
// Макет: шапка «назад» + «Поддержка», под ней @бот, карточка-приветствие, сообщения,
// внизу непрозрачная панель: поле «Сообщение» + круглая кнопка отправки.
// Логика (опрос, правки/удаления, «Нет, спасибо», вложения от поддержки) — как в базовом экране.
// Кнопок «прикрепить» и «ответить» в макете нет — убраны.
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTgBack } from "../components/noir";
import RichText from "../components/RichText";
import { btnReset, pageFrame, pageOuter } from "../theme";
import { useSmartBack } from "../utils/navigation";
import {
  closeSupportTicket,
  fetchConfig,
  fetchSupport,
  markSupportRead,
  sendSupportMessage,
  type SupportFile,
  type SupportMessage,
  type SupportState,
  SUPPORT_PREFILL_KEY,
} from "../utils/api";
import { C, FgnBackdrop, FgnHeader, FgnIcon } from "../components/fgn";

const POLL_MS = 4000;
const MUTED = "rgba(196, 196, 206, 0.62)";
const BUBBLE = "#151517";
const GREETING = "На связи. Напишите, если не открывается ключ или зависла оплата.";

function fmtSize(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} МБ`;
  if (n >= 1024) return `${Math.round(n / 1024)} КБ`;
  return `${n} Б`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Сегодня";
  if (same(d, y)) return "Вчера";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

type TgWebApp = { initData?: string; openLink?: (u: string) => void; openTelegramLink?: (u: string) => void };
const tg = (): TgWebApp | undefined => (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;

// открыть файл в браузере tg (скачивание внутри приложения нестабильно)
function openExternal(url: string) {
  const abs = new URL(url, window.location.origin).toString();
  const w = tg();
  if (w?.initData && w.openLink) w.openLink(abs);
  else window.open(abs, "_blank", "noopener,noreferrer");
}

function openBot(username: string) {
  const url = `https://t.me/${username}`;
  const w = tg();
  if (w?.initData && w.openTelegramLink) w.openTelegramLink(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

const bubbleBox = (mine: boolean): React.CSSProperties => ({
  background: mine ? C.btnSoft : BUBBLE,
  color: mine ? C.btnText : C.text,
  borderRadius: 18,
  padding: "13px 16px 12.5px",
  fontSize: 15.5,
  lineHeight: "22px",
  wordBreak: "break-word",
  boxSizing: "border-box",
});

function Attachment({ f, mine, onImage, onMedia }: { f: SupportFile; mine: boolean; onImage: (url: string) => void; onMedia?: () => void }) {
  const soft = mine ? "rgba(0, 0, 0, 0.06)" : "rgba(255, 255, 255, 0.06)";
  const sub = mine ? "rgba(10, 10, 10, 0.55)" : MUTED;
  if (f.kind === "deleted") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 14, background: soft, opacity: 0.8 }}>
        <FgnIcon name="file" size={20} />
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 14, lineHeight: "18px", textDecoration: "line-through", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
          <span style={{ display: "block", fontSize: 12, lineHeight: "15px", color: sub }}>Файл больше недоступен</span>
        </span>
      </div>
    );
  }
  if (f.kind === "image") {
    return (
      <button type="button" onClick={() => onImage(f.url)} style={{ ...btnReset, border: "none", padding: 0, background: "transparent", display: "block", cursor: "zoom-in" }}>
        <img src={f.url} alt={f.name} onLoad={onMedia}
          style={{ display: "block", maxWidth: "100%", maxHeight: 260, borderRadius: 14, objectFit: "cover", background: "rgba(0,0,0,0.2)" }} />
      </button>
    );
  }
  if (f.kind === "video") {
    return <video src={f.url} controls playsInline preload="metadata" onLoadedMetadata={onMedia} style={{ display: "block", width: "100%", maxHeight: 280, borderRadius: 14, background: "#000" }} />;
  }
  return (
    <button type="button" onClick={() => openExternal(f.url)} className="blin-press"
      style={{
        ...btnReset, width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 14,
        border: "none", cursor: "pointer", textAlign: "left", background: soft, color: "inherit", fontFamily: C.font,
      }}>
      <FgnIcon name="file" size={20} style={{ flexShrink: 0 }} />
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: "block", fontSize: 14, lineHeight: "18px", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
        <span style={{ display: "block", fontSize: 12, lineHeight: "15px", color: sub }}>{fmtSize(f.size)} · скачать</span>
      </span>
    </button>
  );
}

function Bubble({ m, onImage, onMedia, onNoThanks, closing }: {
  m: SupportMessage; onImage: (url: string) => void; onMedia?: () => void;
  onNoThanks: (m: SupportMessage) => void; closing: boolean;
}) {
  if (m.sender === "system") {
    // служебные события одной серой строкой-разделителем
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0", fontSize: 12.5, lineHeight: "16px", color: MUTED }}>
        <span style={{ flex: 1, height: 1, background: "rgba(255, 255, 255, 0.08)" }} />
        <span style={{ textAlign: "center", maxWidth: "70%" }}>{m.text}</span>
        <span style={{ flex: 1, height: 1, background: "rgba(255, 255, 255, 0.08)" }} />
      </div>
    );
  }
  const mine = m.sender === "user";
  const onlyMedia = m.files.length > 0 && !m.text;
  return (
    <div style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "86%", display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start" }}>
      <div style={{ ...bubbleBox(mine), padding: onlyMedia ? 4 : bubbleBox(mine).padding, display: "flex", flexDirection: "column", gap: 6, minWidth: 0, maxWidth: "100%" }}>
        {m.files.map((f) => <Attachment key={f.id} f={f} mine={mine} onImage={onImage} onMedia={onMedia} />)}
        {m.text ? (
          <div className="fgn-chat" style={{ padding: m.files.length ? "2px 4px 0" : 0 }}>
            <RichText text={m.text} tone="chat" compact />
          </div>
        ) : null}
        <span style={{ alignSelf: "flex-end", fontSize: 11, lineHeight: "13px", marginTop: -3, padding: onlyMedia ? "0 8px 4px" : 0,
          color: mine ? "rgba(10, 10, 10, 0.45)" : "rgba(196, 196, 206, 0.45)" }}>
          {m.edited ? "изменено · " : ""}{fmtTime(m.created_at)}
        </span>
      </div>
      {/* «ещё помочь?» → «Нет, спасибо» под сообщением поддержки */}
      {m.kind === "close_prompt" && m.action_active ? (
        <button type="button" onClick={() => onNoThanks(m)} disabled={closing} className="blin-press"
          style={{ ...btnReset, alignSelf: "stretch", marginTop: 8, minWidth: 200, height: 46, padding: "0 18px",
            borderRadius: 23, border: "1px solid rgba(255, 255, 255, 0.16)", background: "#0E0E10",
            color: C.text, fontFamily: C.font, fontSize: 15.5, fontWeight: 500, cursor: closing ? "default" : "pointer", opacity: closing ? 0.6 : 1 }}>
          {closing ? "Закрываем…" : "Нет, спасибо"}
        </button>
      ) : null}
    </div>
  );
}

export default function Support() {
  const goBack = useSmartBack("/");
  const [state, setState] = useState<SupportState | null>(null);
  const [bot, setBot] = useState("");
  const [error, setError] = useState("");
  const [text, setText] = useState(() => {
    try {
      const t = sessionStorage.getItem(SUPPORT_PREFILL_KEY) || "";
      sessionStorage.removeItem(SUPPORT_PREFILL_KEY);
      return t;
    } catch { return ""; }
  });
  const [sending, setSending] = useState(false);
  const [viewer, setViewer] = useState<string | null>(null);
  useTgBack(viewer ? () => setViewer(null) : undefined);
  const [closing, setClosing] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const lastId = useRef(0);
  const stick = useRef(true);

  useEffect(() => {
    void fetchConfig().then((c) => {
      const u = typeof c.botUsername === "string" ? c.botUsername.replace(/^@/, "") : "";
      if (u) setBot(u);
    });
  }, []);

  const merge = useCallback((incoming: SupportMessage[]) => {
    if (!incoming.length) return;
    setState((s) => {
      if (!s) return s;
      const have = new Set(s.messages.map((m) => m.id));
      const add = incoming.filter((m) => !have.has(m.id));
      if (!add.length) return s;
      // lastId двигает только опрос (иначе ответ поддержки прямо перед нашим пропадёт)
      return { ...s, messages: [...s.messages, ...add].sort((a, b) => a.id - b.id) };
    });
  }, []);

  const stateRef = useRef<SupportState | null>(null);
  stateRef.current = state;
  const reload = useCallback(() => {
    fetchSupport(0).then((s) => { lastId.current = s.messages.length ? s.messages[s.messages.length - 1].id : 0; setState(s); }).catch(() => {});
  }, []);

  // первичная загрузка
  useEffect(() => {
    let alive = true;
    fetchSupport(0)
      .then((s) => {
        if (!alive) return;
        lastId.current = s.messages.length ? s.messages[s.messages.length - 1].id : 0;
        setState(s);
        if (s.chat?.unread) void markSupportRead();
      })
      .catch((e: Error) => alive && setError(e.message || "Не удалось открыть чат"));
    return () => { alive = false; };
  }, []);

  // опрос новых сообщений
  useEffect(() => {
    if (!state) return;
    const t = window.setInterval(() => {
      fetchSupport(lastId.current)
        .then((s) => {
          const cur = stateRef.current;
          if (cur && (cur.ticket?.status !== s.ticket?.status)) {
            // тикет открыт/закрыт: полная перезагрузка (вопрос о закрытии мог исчезнуть)
            reload();
            if (s.messages.some((m) => m.sender !== "user")) void markSupportRead();
            return;
          }
          // поддержка изменила или удалила сообщение
          if (s.changes && s.changes.length) {
            const ch = new Map(s.changes.map((m) => [m.id, m]));
            setState((st) => {
              if (!st || !st.messages.some((m) => ch.has(m.id))) return st;
              const msgs = st.messages
                .filter((m) => !(ch.get(m.id) as { deleted?: boolean } | undefined)?.deleted)
                .map((m) => (ch.has(m.id) ? { ...m, ...ch.get(m.id)! } : m));
              return { ...st, messages: msgs };
            });
          }
          if (s.messages.length) {
            lastId.current = Math.max(lastId.current, ...s.messages.map((m) => m.id));
            merge(s.messages);
            if (s.messages.some((m) => m.sender !== "user")) void markSupportRead();
          }
        })
        .catch(() => { /* ignore */ });
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [state !== null, merge, reload]);

  // прокрутить вниз при новых, если уже внизу
  const keepBottom = useCallback(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, []);
  useLayoutEffect(() => { keepBottom(); }, [state?.messages.length, keepBottom]);

  const onScroll = () => {
    const el = listRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const maxText = state?.limits?.max_text || 4000;
  const canSend = !sending && text.trim().length > 0;

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setError("");
    try {
      const m = await sendSupportMessage(text.trim(), []);
      stick.current = true;
      if (!state?.chat) setState((s) => (s ? { ...s, chat: { id: 0, unread: 0 } } : s));
      // любой ответ снимает вопрос «ещё помочь?»
      setState((s) => (s ? { ...s, messages: s.messages.map((x) => (x.action_active ? { ...x, action_active: false } : x)) } : s));
      merge([m]);
      setText("");
      // первое сообщение после закрытия открывает тикет
      if (state?.ticket?.status !== "open" || m.ticket_closed) reload();
      if (taRef.current) taRef.current.style.height = "";
    } catch (e) {
      setError((e as Error).message || "Не удалось отправить");
    } finally {
      setSending(false);
    }
  };

  const onText = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value.slice(0, maxText));
    const el = e.target;
    el.style.height = "";
    if (el.scrollHeight > el.clientHeight) el.style.height = `${Math.min(150, el.scrollHeight + 2)}px`;
  };

  const noThanks = async (m: SupportMessage) => {
    if (closing) return;
    setClosing(true);
    setError("");
    try {
      await closeSupportTicket(m.id);
      stick.current = true;
    } catch (e) {
      setError((e as Error).message || "Не удалось закрыть обращение");
    } finally {
      reload();
      setClosing(false);
    }
  };

  const msgs = state?.messages || [];
  const lastMsg = msgs.length ? msgs[msgs.length - 1] : null;
  const closedNow = state?.ticket?.status === "closed" && lastMsg?.sender === "system";

  return (
    <div style={pageOuter({ background: C.bg })}>
      <div style={pageFrame({ background: C.bg, fontFamily: C.font, color: C.text })}>
        <FgnBackdrop />
        <style>{`.fgn-chat a{color:inherit!important}.fgn-support-ta::placeholder{color:rgba(196,196,206,0.55);opacity:1}`}</style>
        <div style={{ position: "relative", zIndex: 1, height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
          {/* шапка */}
          <div style={{ flex: "none", padding: "0 20px", paddingTop: "calc(24px + var(--blin-tg-pad-top, 0px) / var(--blin-scale))" }}>
            <FgnHeader title="Поддержка" onBack={goBack} />
            <div
              onClick={bot ? () => openBot(bot) : undefined}
              style={{ marginTop: 21, height: 18, fontSize: 14.5, lineHeight: "18px", color: MUTED, cursor: bot ? "pointer" : "default", alignSelf: "flex-start", width: "fit-content" }}
            >
              {bot ? `@${bot}` : ""}
            </div>
          </div>

          {/* сообщения */}
          <div ref={listRef} onScroll={onScroll} className="blin-scroll"
            style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, padding: "17px 20px 16px", boxSizing: "border-box" }}>
            <div style={{ ...bubbleBox(false), alignSelf: "flex-start", maxWidth: "86%", animation: "fgnFade 0.3s ease both" }}>
              <div style={{ maxWidth: 268 }}>{GREETING}</div>
            </div>
            {!state && !error ? <div style={{ margin: "12px auto 0", color: MUTED, fontSize: 14 }}>Загрузка…</div> : null}
            {msgs.map((m, i) => {
              const showDay = i === 0 || new Date(msgs[i - 1].created_at).toDateString() !== new Date(m.created_at).toDateString();
              return (
                <React.Fragment key={m.id}>
                  {showDay ? <div style={{ alignSelf: "center", fontSize: 12.5, lineHeight: "16px", color: MUTED, margin: "6px 0 2px" }}>{dayLabel(m.created_at)}</div> : null}
                  <Bubble m={m} onImage={setViewer} onMedia={keepBottom} onNoThanks={noThanks} closing={closing} />
                </React.Fragment>
              );
            })}
            {closedNow ? (
              <div style={{ fontSize: 13, lineHeight: "17px", color: MUTED, textAlign: "center", padding: "4px 8px" }}>
                Обращение закрыто. Если вопрос остался — просто напишите, и мы откроем новое.
              </div>
            ) : null}
          </div>

          {/* панель ввода */}
          <div style={{
            flex: "none",
            background: "#0B0B0C",
            borderTop: "1px solid rgba(255, 255, 255, 0.06)",
            padding: "13.5px 20px 0",
            paddingBottom: "calc(12.5px + var(--blin-tg-pad-bottom, 0px) / var(--blin-scale))",
          }}>
            {error ? (
              <div style={{ fontSize: 13, lineHeight: "17px", color: C.danger, padding: "0 2px 10px" }} onClick={() => setError("")}>{error}</div>
            ) : null}
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8.5 }}>
              <textarea
                ref={taRef}
                value={text}
                onChange={onText}
                rows={1}
                placeholder="Сообщение"
                className="fgn-support-ta"
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(pointer: fine)").matches) { e.preventDefault(); void send(); } }}
                style={{
                  ...btnReset, flex: 1, minWidth: 0, resize: "none", height: 53, maxHeight: 150, margin: 0,
                  padding: "15px 16px", borderRadius: 20, border: "1px solid rgba(255, 255, 255, 0.1)", background: C.cardBg,
                  color: C.text, fontFamily: C.font, fontSize: 17, lineHeight: "21px", display: "block",
                }}
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={!canSend}
                aria-label="Отправить"
                className={canSend ? "blin-press" : undefined}
                style={{
                  ...btnReset, flex: "none", width: 48, height: 48, marginBottom: 2.5, padding: 0, borderRadius: "50%", border: "none",
                  background: canSend ? C.btn : C.iconBg, color: canSend ? C.btnText : "rgba(255, 255, 255, 0.32)",
                  display: "flex", alignItems: "center", justifyContent: "center", cursor: canSend ? "pointer" : "default",
                  transition: "background 0.2s ease, color 0.2s ease",
                }}
              >
                <FgnIcon name="up" size={22} stroke={2} />
              </button>
            </div>
          </div>
        </div>

        {viewer ? (
          <div onClick={() => setViewer(null)}
            style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.92)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <img src={viewer} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 8 }} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
