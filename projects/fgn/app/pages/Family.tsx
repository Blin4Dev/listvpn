// FGN: «Добавить в семью» (макет 69; переопределение src/app/pages/Family.tsx, маршрут /family).
// Подпись, «Добавить пользователя» (поле 54 + белая кнопка 52), карточки участников 78 с «Удалить»,
// «Поделиться семьёй» (код приглашения 24/700, «Скопировать код», «Заменить код семьи»), «Вставить код» + «Войти в семью».
// API (бэкенд семей): GET /family → { code, members: [{ id, name, status }] },
// POST /family/members { query }, DELETE /family/members/{id}, POST /family/code, POST /family/join { code }.
import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSmartBack } from "../utils/navigation";
import { appFetch } from "../utils/api";
import { copyText } from "../components/SubLinkBox";
import { C, FgnHeader, FgnIcon, FgnPage, fgnButton } from "../components/fgn";

const MUTED = "#9B9BA4";
const LABEL = "#6E6E78";
const PLACEHOLDER = "#7A7A82";
const CARD_BG = "#141416";
const CARD_BORDER = "#2A2A30";
const TEXT = "#F4F4F5";
const RED = "#FF8490";

type Member = { id: string | number; name: string; status?: string };
type FamilyResponse = { code?: string | null; members?: Member[] | null };

function haptic(kind: "success" | "error") {
  try {
    (window as unknown as { Telegram?: { WebApp?: { HapticFeedback?: { notificationOccurred?: (s: string) => void } } } })
      .Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.(kind);
  } catch { /* ignore */ }
}

const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/** подпись секции: 12/600, капс, разрядка (как в «Настроить подписку») */
function Section({ children, top }: { children: React.ReactNode; top: number }) {
  return (
    <div style={{ marginTop: top, flexShrink: 0, fontSize: 12, fontWeight: 600, lineHeight: "16px", letterSpacing: "0.1em", textTransform: "uppercase", color: LABEL }}>
      {children}
    </div>
  );
}

const input: React.CSSProperties = {
  appearance: "none",
  display: "block",
  flexShrink: 0,
  width: "100%",
  height: 54,
  margin: 0,
  padding: "0 17px",
  borderRadius: 18,
  border: `1px solid ${CARD_BORDER}`,
  background: CARD_BG,
  color: TEXT,
  fontFamily: C.font,
  fontSize: 16.5,
  fontWeight: 400,
  outline: "none",
  boxSizing: "border-box",
};

const whiteBtn: React.CSSProperties = { ...fgnButton, flexShrink: 0, height: 52, borderRadius: 24, fontSize: 16.5 };

const card: React.CSSProperties = {
  flexShrink: 0,
  borderRadius: 16,
  border: `1px solid ${CARD_BORDER}`,
  background: CARD_BG,
  boxSizing: "border-box",
};

function Note({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return (
    <div style={{ marginTop: 10, flexShrink: 0, fontSize: 14.5, lineHeight: "20px", color: msg.ok ? MUTED : C.danger, animation: "fgnFade 0.25s ease both" }}>
      {msg.text}
    </div>
  );
}

export default function Family() {
  const goBack = useSmartBack("/subscription");
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [code, setCode] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [query, setQuery] = useState("");
  const [joinCode, setJoinCode] = useState(() => (params.get("code") || "").toUpperCase());
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [addMsg, setAddMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [codeMsg, setCodeMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [joinMsg, setJoinMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const apply = (d: FamilyResponse | null | undefined) => {
    if (!d) return;
    if (d.code) setCode(String(d.code));
    if (Array.isArray(d.members)) setMembers(d.members);
  };

  useEffect(() => {
    appFetch<FamilyResponse>("/family").then(apply).catch(() => { /* бэкенд семей ещё не отвечает */ });
  }, []);

  const addMember = async () => {
    const q = query.trim();
    if (!q || busy) return;
    setBusy("add");
    setAddMsg(null);
    try {
      apply(await appFetch<FamilyResponse>("/family/members", { method: "POST", body: JSON.stringify({ query: q }) }));
      setQuery("");
      haptic("success");
    } catch (e) {
      haptic("error");
      setAddMsg({ ok: false, text: errText(e, "Не удалось добавить") });
    } finally {
      setBusy(null);
    }
  };

  const removeMember = async (m: Member) => {
    if (busy) return;
    setBusy(`del:${m.id}`);
    try {
      await appFetch(`/family/members/${encodeURIComponent(String(m.id))}`, { method: "DELETE" });
      setMembers((list) => list.filter((x) => x.id !== m.id));
    } catch (e) {
      haptic("error");
      setAddMsg({ ok: false, text: errText(e, "Не удалось удалить") });
    } finally {
      setBusy(null);
    }
  };

  const copyCode = async () => {
    if (!code) return;
    if (await copyText(code)) {
      haptic("success");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  };

  const replaceCode = async () => {
    if (busy) return;
    setBusy("code");
    setCodeMsg(null);
    try {
      apply(await appFetch<FamilyResponse>("/family/code", { method: "POST" }));
      setCopied(false);
      haptic("success");
    } catch (e) {
      haptic("error");
      setCodeMsg({ ok: false, text: errText(e, "Не удалось заменить код") });
    } finally {
      setBusy(null);
    }
  };

  const join = async () => {
    const c = joinCode.trim();
    if (!c || busy) return;
    setBusy("join");
    setJoinMsg(null);
    try {
      await appFetch("/family/join", { method: "POST", body: JSON.stringify({ code: c }) });
      haptic("success");
      navigate("/", { replace: true });
    } catch (e) {
      haptic("error");
      setJoinMsg({ ok: false, text: errText(e, "Не удалось войти в семью") });
      setBusy(null);
    }
  };

  const statusText = (s?: string) => (s === "pending" ? "Приглашение отправлено" : "В семье");

  return (
    <FgnPage>
      <FgnHeader title="Добавить в семью" onBack={goBack} btnStyle={{ background: CARD_BG, borderColor: CARD_BORDER }} />
      <style>{`.fgn-family-input::placeholder{color:${PLACEHOLDER};opacity:1}`}</style>

      <div style={{ marginTop: 20.5, flexShrink: 0, fontSize: 14.5, lineHeight: "20px", color: MUTED }}>
        Владелец добавляет и удаляет людей. Участник может выйти сам.
      </div>

      <Section top={24}>Добавить пользователя</Section>
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setAddMsg(null); }}
        onKeyDown={(e) => { if (e.key === "Enter") void addMember(); }}
        placeholder="Почта или юзернейм Telegram"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className="fgn-family-input"
        style={{ ...input, marginTop: 7.5 }}
      />
      <button type="button" className="blin-press" onClick={() => void addMember()} style={{ ...whiteBtn, marginTop: 12 }}>
        {busy === "add" ? "Добавляем…" : "Добавить"}
      </button>
      <Note msg={addMsg} />

      {members.map((m, i) => (
        <div
          key={m.id}
          style={{
            ...card,
            marginTop: i === 0 ? 16 : 10,
            height: 78,
            padding: "0 17px 0 16px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            animation: "fgnFade 0.3s ease both",
          }}
        >
          <div style={{ flex: 1, minWidth: 0, marginTop: 5 }}>
            <div style={{ fontSize: 16.5, fontWeight: 500, lineHeight: "21px", color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</div>
            <div style={{ fontSize: 14.5, lineHeight: "20px", color: MUTED, whiteSpace: "nowrap" }}>{statusText(m.status)}</div>
          </div>
          <button
            type="button"
            className="blin-press"
            onClick={() => void removeMember(m)}
            style={{ appearance: "none", margin: 0, padding: "6px 0 6px 8px", border: "none", background: "none", fontFamily: C.font, fontSize: 15.5, lineHeight: "20px", color: RED, cursor: "pointer", flexShrink: 0 }}
          >
            {busy === `del:${m.id}` ? "Удаляем…" : "Удалить"}
          </button>
        </div>
      ))}

      <Section top={25}>Поделиться семьёй</Section>
      <div style={{ ...card, marginTop: 7.5, padding: "16.5px 16px 15.5px" }}>
        <div style={{ fontSize: 14.5, lineHeight: "20px", color: MUTED }}>Код приглашения</div>
        <div style={{ marginTop: 11, fontSize: 24, fontWeight: 700, lineHeight: "28px", letterSpacing: "0.01em", color: TEXT, whiteSpace: "nowrap" }}>
          {code || "—"}
        </div>
        <div style={{ marginTop: 9, fontSize: 14.5, lineHeight: "20px", color: MUTED }}>
          Скопируйте код. Человек вставляет его ниже и заходит в семью.
        </div>
        <button
          type="button"
          className="blin-press"
          onClick={() => void copyCode()}
          style={{ ...whiteBtn, marginTop: 15.5, gap: 10 }}
        >
          <FgnIcon name={copied ? "check" : "copy"} size={17} stroke={2} />
          {copied ? "Скопировано" : "Скопировать код"}
        </button>
        <button
          type="button"
          className="blin-press"
          onClick={() => void replaceCode()}
          style={{ ...whiteBtn, marginTop: 8, height: 54, background: CARD_BG, border: `1px solid ${CARD_BORDER}`, color: TEXT, boxSizing: "border-box" }}
        >
          {busy === "code" ? "Заменяем…" : "Заменить код семьи"}
        </button>
        <Note msg={codeMsg} />
      </div>

      <Section top={25}>Вставить код</Section>
      <input
        value={joinCode}
        onChange={(e) => { setJoinCode(e.target.value.toUpperCase().replace(/\s+/g, "")); setJoinMsg(null); }}
        onKeyDown={(e) => { if (e.key === "Enter") void join(); }}
        placeholder="Код приглашения"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        className="fgn-family-input"
        style={{ ...input, marginTop: 7.5, borderColor: joinMsg && !joinMsg.ok ? "rgba(255, 75, 75, 0.55)" : CARD_BORDER }}
      />
      <button type="button" className="blin-press" onClick={() => void join()} style={{ ...whiteBtn, marginTop: 12 }}>
        {busy === "join" ? "Входим…" : "Войти в семью"}
      </button>
      <Note msg={joinMsg} />
    </FgnPage>
  );
}
