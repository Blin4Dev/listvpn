// FGN: сайт → «Поддержка» (/support). Тот же чат, что в мини-аппе (/api/app/support), по сессии сайта.
// Без входа: приветствие, «Чтобы написать в техподдержку, необходимо авторизоваться», поле «Сначала войдите».
// После сообщения пользователя, пока поддержка не ответила, — локальная подсказка «Приняли…» (не из базы).
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import RichText from "../components/RichText";
import {
  ApiError,
  closeSupportTicket,
  fetchSupport,
  markSupportRead,
  sendSupportMessage,
  type SupportFile,
  type SupportMessage,
  type SupportState,
} from "../utils/api";
import { C } from "../components/fgn";

const POLL_MS = 4000;
const GREETING = "На связи. Напишите, если не открывается ключ или зависла оплата.";

export const SUPPORT_CSS = `
.fs-sup .fs-wrap { max-width: 760px; padding-top: 34px; padding-bottom: 56px; }
.fs-sup-head { display: flex; align-items: center; gap: 14px; }
.fs-sup-back { width: 44px; height: 44px; flex-shrink: 0; border-radius: 50%; background: rgba(10,10,11,.9);
  border: 1px solid rgba(255,255,255,.16); color: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; }
.fs-sup-back:hover { border-color: rgba(255,255,255,.3); }
.fs-sup-title { font-size: 26px; font-weight: 700; letter-spacing: -.015em; line-height: 1.2; }
.fs-sup-bot { display: inline-block; margin-top: 3px; font-size: 13.5px; color: rgba(196,196,206,.62); }
.fs-sup-bot:hover { color: #fff; }
.fs-chat { position: relative; z-index: 1; margin-top: 24px; display: flex; flex-direction: column; height: min(640px, calc(100vh - 260px));
  min-height: 420px; border-radius: 18px; border: 1px solid rgba(255,255,255,.07); background: rgba(12,12,13,.92); overflow: hidden; }
.fs-chat-list { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding: 22px 22px 16px; }
.fs-chat-list::-webkit-scrollbar { width: 6px; }
.fs-chat-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,.1); border-radius: 3px; }
.fs-msg { max-width: 78%; display: flex; flex-direction: column; }
.fs-msg.me { align-self: flex-end; align-items: flex-end; }
.fs-msg.them { align-self: flex-start; align-items: flex-start; }
.fs-bub { border-radius: 18px; padding: 12px 16px 11px; font-size: 15px; line-height: 22px; word-break: break-word;
  display: flex; flex-direction: column; gap: 6px; min-width: 0; max-width: 100%; }
.fs-msg.them .fs-bub { background: #151517; color: #fff; }
.fs-msg.me .fs-bub { background: ${C.btnSoft}; color: ${C.btnText}; }
.fs-bub .t { align-self: flex-end; font-size: 11px; line-height: 13px; margin-top: -3px; color: rgba(196,196,206,.45); }
.fs-msg.me .fs-bub .t { color: rgba(10,10,10,.45); }
.fs-bub a { color: inherit !important; text-decoration: underline; }
.fs-bub img { display: block; max-width: 100%; max-height: 260px; border-radius: 12px; cursor: zoom-in; }
.fs-bub video { display: block; width: 100%; max-height: 280px; border-radius: 12px; background: #000; }
.fs-file { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 12px; background: rgba(255,255,255,.06); font-size: 13.5px; }
.fs-msg.me .fs-file { background: rgba(0,0,0,.06); }
.fs-file small { display: block; font-size: 12px; opacity: .6; }
.fs-day, .fs-sys { align-self: center; font-size: 12.5px; line-height: 16px; color: rgba(196,196,206,.62); margin: 6px 0 2px; text-align: center; }
.fs-sys { align-self: stretch; display: flex; align-items: center; gap: 10px; }
.fs-sys::before, .fs-sys::after { content: ""; flex: 1; height: 1px; background: rgba(255,255,255,.08); }
.fs-nothanks { margin-top: 8px; height: 42px; padding: 0 18px; border-radius: 21px; border: 1px solid rgba(255,255,255,.16);
  background: #0E0E10; color: #fff; font: 500 14.5px ${C.font}; cursor: pointer; }
.fs-nothanks:disabled { opacity: .6; cursor: default; }
.fs-chat-bar { flex: none; background: #0B0B0C; border-top: 1px solid rgba(255,255,255,.06); padding: 14px 18px; }
.fs-chat-note { font-size: 13px; line-height: 18px; color: rgba(196,196,206,.75); padding: 0 2px 11px; }
.fs-chat-note a { color: ${C.green}; text-decoration: underline; text-underline-offset: 3px; }
.fs-chat-err { font-size: 13px; line-height: 17px; color: ${C.danger}; padding: 0 2px 10px; cursor: pointer; }
.fs-chat-row { display: flex; align-items: flex-end; gap: 9px; }
.fs-chat-row textarea { flex: 1; min-width: 0; resize: none; height: 50px; max-height: 150px; margin: 0; padding: 14px 16px;
  border-radius: 18px; border: 1px solid rgba(255,255,255,.1); background: ${C.cardBg}; color: #fff; font: 15.5px/21px ${C.font}; outline: none; display: block; }
.fs-chat-row textarea:focus { border-color: rgba(255,255,255,.22); }
.fs-chat-row textarea:disabled { opacity: .6; cursor: not-allowed; }
.fs-chat-row textarea::placeholder { color: rgba(196,196,206,.55); opacity: 1; }
.fs-send { flex: none; width: 46px; height: 46px; margin-bottom: 2px; border-radius: 50%; border: 0; padding: 0; display: flex;
  align-items: center; justify-content: center; background: ${C.iconBg}; color: rgba(255,255,255,.32); cursor: default; transition: background .2s, color .2s; }
.fs-send.on { background: #fff; color: #0A0A0A; cursor: pointer; }
.fs-viewer { position: fixed; inset: 0; z-index: 1000; background: rgba(0,0,0,.92); display: flex; align-items: center; justify-content: center; padding: 16px; cursor: zoom-out; }
.fs-viewer img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 8px; }
@keyframes fsFade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
.fs-fade { animation: fsFade .3s ease both; }
@media (max-width: 860px) {
  .fs-sup .fs-wrap { padding-top: 20px; padding-bottom: 20px; }
  .fs-sup-title { font-size: 22px; }
  .fs-chat { margin-top: 18px; height: calc(100vh - 200px); height: calc(100dvh - 200px); min-height: 360px; border-radius: 16px; }
  .fs-chat-list { padding: 18px 14px 14px; }
  .fs-chat-bar { padding: 12px 12px; }
  .fs-msg { max-width: 88%; }
}
`;

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
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Сегодня";
  if (d.toDateString() === y.toDateString()) return "Вчера";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function Svg({ d, size = 20 }: { d: React.ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ display: "block", flexShrink: 0 }}>
      {d}
    </svg>
  );
}

function Attachment({ f, onImage, onMedia }: { f: SupportFile; onImage: (u: string) => void; onMedia: () => void }) {
  if (f.kind === "deleted") {
    return (
      <div className="fs-file" style={{ opacity: 0.8 }}>
        <span style={{ minWidth: 0 }}>
          <span style={{ textDecoration: "line-through" }}>{f.name}</span>
          <small>Файл больше недоступен</small>
        </span>
      </div>
    );
  }
  if (f.kind === "image") return <img src={f.url} alt={f.name} onLoad={onMedia} onClick={() => onImage(f.url)} />;
  if (f.kind === "video") return <video src={f.url} controls playsInline preload="metadata" onLoadedMetadata={onMedia} />;
  return (
    <a className="fs-file" href={f.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
      <Svg size={18} d={<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>} />
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
        <small>{fmtSize(f.size)} · скачать</small>
      </span>
    </a>
  );
}

type Props = {
  bot: string;
  /** null — ещё проверяем сессию */
  authed: boolean | null;
  loginHref: string;
  onLogin: (e: React.MouseEvent) => void;
  onBack: () => void;
  /** сессия протухла (401) */
  onExpired: () => void;
};

export default function SiteSupport({ bot, authed, loginHref, onLogin, onBack, onExpired }: Props) {
  const [state, setState] = useState<SupportState | null>(null);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [viewer, setViewer] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const lastId = useRef(0);
  const stick = useRef(true);
  const stateRef = useRef<SupportState | null>(null);
  stateRef.current = state;

  const fail = useCallback(
    (e: unknown, fallback: string) => {
      if (e instanceof ApiError && e.status === 401) {
        onExpired();
        return;
      }
      setError((e as Error)?.message || fallback);
    },
    [onExpired],
  );

  const merge = useCallback((incoming: SupportMessage[]) => {
    if (!incoming.length) return;
    setState((s) => {
      if (!s) return s;
      const have = new Set(s.messages.map((m) => m.id));
      const add = incoming.filter((m) => !have.has(m.id));
      if (!add.length) return s;
      return { ...s, messages: [...s.messages, ...add].sort((a, b) => a.id - b.id) };
    });
  }, []);

  const reload = useCallback(() => {
    fetchSupport(0)
      .then((s) => {
        lastId.current = s.messages.length ? s.messages[s.messages.length - 1].id : 0;
        setState(s);
      })
      .catch(() => {});
  }, []);

  // загрузка чата после входа
  useEffect(() => {
    if (!authed) {
      setState(null);
      return;
    }
    let alive = true;
    fetchSupport(0)
      .then((s) => {
        if (!alive) return;
        lastId.current = s.messages.length ? s.messages[s.messages.length - 1].id : 0;
        setState(s);
        if (s.chat?.unread) void markSupportRead();
      })
      .catch((e) => alive && fail(e, "Не удалось открыть чат"));
    return () => {
      alive = false;
    };
  }, [authed, fail]);

  // опрос новых сообщений (как в мини-аппе)
  useEffect(() => {
    if (!authed || !state) return;
    const t = window.setInterval(() => {
      if (document.hidden) return;
      fetchSupport(lastId.current)
        .then((s) => {
          const cur = stateRef.current;
          if (cur && cur.ticket?.status !== s.ticket?.status) {
            reload();
            if (s.messages.some((m) => m.sender !== "user")) void markSupportRead();
            return;
          }
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
        .catch((e) => {
          if (e instanceof ApiError && e.status === 401) onExpired();
        });
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [authed, state !== null, merge, reload, onExpired]);

  const keepBottom = useCallback(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, []);
  useLayoutEffect(() => {
    keepBottom();
  }, [state?.messages.length, sending, keepBottom]);

  const onScroll = () => {
    const el = listRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const maxText = state?.limits?.max_text || 4000;
  const ready = !!authed && !!state;
  const canSend = ready && !sending && text.trim().length > 0;

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setError("");
    try {
      const m = await sendSupportMessage(text.trim(), []);
      stick.current = true;
      setState((s) => (s ? { ...s, chat: s.chat || { id: 0, unread: 0 }, messages: s.messages.map((x) => (x.action_active ? { ...x, action_active: false } : x)) } : s));
      merge([m]);
      setText("");
      if (state?.ticket?.status !== "open" || m.ticket_closed) reload();
      if (taRef.current) taRef.current.style.height = "";
    } catch (e) {
      fail(e, "Не удалось отправить");
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
      fail(e, "Не удалось закрыть обращение");
    } finally {
      reload();
      setClosing(false);
    }
  };

  const msgs = state?.messages || [];
  const lastMsg = msgs.length ? msgs[msgs.length - 1] : null;
  const closedNow = state?.ticket?.status === "closed" && lastMsg?.sender === "system";
  // «Приняли…»: последнее — наше сообщение, ответа ещё нет
  const ack = !!lastMsg && lastMsg.sender === "user" && state?.ticket?.status === "open";
  const botLink = bot ? `https://t.me/${bot}` : "";

  return (
    <section className="fs-sup">
      <div className="fs-wrap">
        <div className="fs-sup-head">
          <button type="button" className="fs-sup-back" aria-label="Назад" onClick={onBack}>
            <Svg d={<path d="m14.5 18-6-6 6-6" />} />
          </button>
          <div>
            <div className="fs-sup-title">Поддержка</div>
            {bot ? (
              <a className="fs-sup-bot" href={botLink} target="_blank" rel="noopener noreferrer">
                @{bot}
              </a>
            ) : null}
          </div>
        </div>

        <div className="fs-chat">
          <div ref={listRef} onScroll={onScroll} className="fs-chat-list">
            <div className="fs-msg them fs-fade">
              <div className="fs-bub">
                <div style={{ maxWidth: 300 }}>{GREETING}</div>
              </div>
            </div>
            {authed && !state && !error ? <div className="fs-day">Загрузка…</div> : null}
            {msgs.map((m, i) => {
              const showDay = i === 0 || new Date(msgs[i - 1].created_at).toDateString() !== new Date(m.created_at).toDateString();
              const mine = m.sender === "user";
              const onlyMedia = m.files.length > 0 && !m.text;
              return (
                <React.Fragment key={m.id}>
                  {showDay ? <div className="fs-day">{dayLabel(m.created_at)}</div> : null}
                  {m.sender === "system" ? (
                    <div className="fs-sys">
                      <span style={{ maxWidth: "70%" }}>{m.text}</span>
                    </div>
                  ) : (
                    <div className={`fs-msg ${mine ? "me" : "them"}`}>
                      <div className="fs-bub" style={onlyMedia ? { padding: 4 } : undefined}>
                        {m.files.map((f) => (
                          <Attachment key={f.id} f={f} onImage={setViewer} onMedia={keepBottom} />
                        ))}
                        {m.text ? (
                          <div style={{ padding: m.files.length ? "2px 4px 0" : 0 }}>
                            <RichText text={m.text} tone="chat" compact />
                          </div>
                        ) : null}
                        <span className="t" style={onlyMedia ? { padding: "0 8px 4px" } : undefined}>
                          {m.edited ? "изменено · " : ""}
                          {fmtTime(m.created_at)}
                        </span>
                      </div>
                      {m.kind === "close_prompt" && m.action_active ? (
                        <button type="button" className="fs-nothanks" disabled={closing} onClick={() => void noThanks(m)}>
                          {closing ? "Закрываем…" : "Нет, спасибо"}
                        </button>
                      ) : null}
                    </div>
                  )}
                </React.Fragment>
              );
            })}
            {ack ? (
              <div className="fs-msg them fs-fade">
                <div className="fs-bub">
                  <div>
                    Приняли.{" "}
                    {bot ? (
                      <>
                        Если вопрос срочный — напишите{" "}
                        <a href={botLink} target="_blank" rel="noopener noreferrer">
                          @{bot}
                        </a>
                        .
                      </>
                    ) : (
                      "Ответим здесь, как только оператор освободится."
                    )}
                  </div>
                </div>
              </div>
            ) : null}
            {closedNow ? <div className="fs-day">Обращение закрыто. Если вопрос остался — просто напишите, и мы откроем новое.</div> : null}
          </div>

          <div className="fs-chat-bar">
            {authed === false ? (
              <div className="fs-chat-note">
                Чтобы написать в техподдержку, необходимо{" "}
                <a href={loginHref} onClick={onLogin}>
                  авторизоваться
                </a>
                .
              </div>
            ) : null}
            {error ? (
              <div className="fs-chat-err" onClick={() => setError("")}>
                {error}
              </div>
            ) : null}
            <div className="fs-chat-row">
              <textarea
                ref={taRef}
                value={text}
                onChange={onText}
                rows={1}
                disabled={!ready}
                placeholder={authed === false ? "Сначала войдите" : "Сообщение"}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(pointer: fine)").matches) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <button type="button" className={`fs-send${canSend ? " on" : ""}`} disabled={!canSend} aria-label="Отправить" onClick={() => void send()}>
                <Svg size={21} d={<path d="M12 19V5M6 11l6-6 6 6" />} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {viewer ? (
        <div className="fs-viewer" onClick={() => setViewer(null)}>
          <img src={viewer} alt="" />
        </div>
      ) : null}
    </section>
  );
}
