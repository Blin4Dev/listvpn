// FGN: перенос из старого VPN (ресейл). Человек из проекта, переданного под управление FGN,
// при входе видит «<старый VPN> теперь FGN» и кнопку «Заменить ключ»: сервер выдаёт перенесённый срок
// (≤ 30 дней, к своей подписке или новой), затем — «Куда добавить» (SetupSheet), чтобы поставить новый ключ.
import React, { useEffect, useState } from "react";
import { C, FGN_DIM, FgnIcon, fgnButton } from "./fgn";
import { useTgBack } from "./noir";
import SetupSheet from "./SetupSheet";
import { claimMigration, fetchMigration, notifySubscriptionChanged, type MigrationPending } from "../utils/api";
import { formatDateRu } from "../utils/date";

const TEXT = "#F4F4F5";
const MUTED = "#9B9BA4";
const DANGER = "#FF5D62";

const KEYFRAMES = `
@keyframes fgnFade { from { opacity: 0; } to { opacity: 1; } }
@keyframes fgnMigRise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
`;

function haptic() {
  try {
    (window as unknown as { Telegram?: { WebApp?: { HapticFeedback?: { notificationOccurred?: (s: string) => void } } } })
      .Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.("success");
  } catch { /* ignore */ }
}

function MigrationDialog({ info, onClaimed, onClose }: { info: MigrationPending; onClaimed: (note: string) => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useTgBack(busy ? () => { /* ждём ответа */ } : onClose);

  const replace = async () => {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      const r = await claimMigration();
      haptic();
      notifySubscriptionChanged();
      const until = r.expires_at ? formatDateRu(r.expires_at) : "";
      onClaimed(until ? `Подписка ${r.target || info.target} действует до ${until}. Добавьте новый ключ на устройство.`
        : `Подписка ${r.target || info.target} готова. Добавьте новый ключ на устройство.`);
    } catch (e) {
      setErr(e instanceof Error && e.message ? e.message : "Не удалось заменить ключ, попробуйте ещё раз");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 3100,
        background: FGN_DIM,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        padding: "0 16px",
        paddingBottom: "calc(24px + max(env(safe-area-inset-bottom, 0px), var(--blin-tg-pad-bottom, 0px)))",
        boxSizing: "border-box",
        animation: "fgnFade 0.2s ease both",
        fontFamily: C.font,
      }}
    >
      <style>{KEYFRAMES}</style>
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 488,
          background: C.cardBg,
          border: "1px solid #2A2A30",
          borderRadius: 24,
          padding: "24px 20px 20px",
          boxSizing: "border-box",
          color: TEXT,
          animation: "fgnMigRise 0.32s cubic-bezier(0.22, 1, 0.36, 1) both",
        }}
      >
        <button
          type="button"
          aria-label="Закрыть"
          className="blin-press"
          disabled={busy}
          onClick={onClose}
          style={{
            position: "absolute", top: 14, right: 14, width: 36, height: 36, padding: 0, border: "none", borderRadius: "50%",
            background: "#1E1E22", color: TEXT, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
          }}
        >
          <FgnIcon name="close" size={16} stroke={2} />
        </button>
        <div
          style={{
            width: 52, height: 52, borderRadius: 16, background: "rgba(52,214,124,.12)", color: C.green,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <FgnIcon name="key" size={24} stroke={2} />
        </div>
        <div style={{ marginTop: 18, paddingRight: 30, fontSize: 22, fontWeight: 600, lineHeight: "28px", letterSpacing: "-0.015em" }}>
          {info.name} теперь {info.target}
        </div>
        <div style={{ marginTop: 10, fontSize: 14.5, lineHeight: "22px", color: MUTED }}>
          Проект {info.name} был передан под управление {info.target}. Старый ключ необходимо заменить на новый кнопкой ниже
        </div>
        {err ? <div style={{ marginTop: 12, fontSize: 14, lineHeight: "20px", color: DANGER }}>{err}</div> : null}
        <button
          type="button"
          className="blin-press"
          disabled={busy}
          onClick={() => void replace()}
          style={{ ...fgnButton, marginTop: 22, height: 52, borderRadius: 16, background: "#F3F3F4", fontSize: 16, letterSpacing: 0, opacity: busy ? 0.6 : 1 }}
        >
          {busy ? "Заменяем…" : "Заменить ключ"}
        </button>
      </div>
    </div>
  );
}

/** на старте: если человек пришёл из переданного проекта — окно замены ключа, затем установка */
export default function MigrationPrompt() {
  const [info, setInfo] = useState<MigrationPending | null>(null);
  const [setupNote, setSetupNote] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchMigration().then((m) => { if (alive) setInfo(m); });
    return () => { alive = false; };
  }, []);

  if (setupNote !== null) {
    return <SetupSheet note={setupNote} onClose={() => { setSetupNote(null); notifySubscriptionChanged(); }} />;
  }
  if (!info) return null;
  return (
    <MigrationDialog
      info={info}
      onClose={() => setInfo(null)}
      onClaimed={(note) => { setInfo(null); setSetupNote(note); }}
    />
  );
}
