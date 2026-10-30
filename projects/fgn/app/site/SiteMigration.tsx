// FGN сайт: перенос из старого VPN (ресейл) — как MigrationPrompt мини-аппа.
// Вошёл человек из проекта, переданного под управление FGN → окно «<старый VPN> теперь FGN»,
// «Заменить ключ» выдаёт перенесённый срок и открывает «Куда добавить» → приложение → новый ключ.
import React, { useEffect, useState } from "react";
import { claimMigration, fetchMigration, type MigrationPending } from "../utils/api";
import { formatDateRu } from "../utils/date";
import { C } from "../components/fgn";
import { DevicePicker } from "./SiteCabinet";
import { IcClose } from "./SiteDownload";
import { Ic, errText, isAuthErr, type CabNav } from "./siteKit";

type Desktop = { windows_url?: string; macos_url?: string; version?: string };

export const MIGRATION_CSS = `
.fs-mig { max-width: 440px; position: relative; padding: 26px 24px 24px; }
.fs-mig .fs-round { position: absolute; top: 16px; right: 16px; }
.fs-mig-ic { width: 52px; height: 52px; border-radius: 16px; background: rgba(52,214,124,.12); color: ${C.green};
  display: flex; align-items: center; justify-content: center; }
.fs-mig h3 { margin: 18px 34px 0 0; font-size: 24px; line-height: 30px; font-weight: 700; letter-spacing: -.015em; color: #fff; }
.fs-mig p { margin: 10px 0 0; font-size: 15px; line-height: 23px; color: #9B9BA4; }
.fs-mig .fs-dlp-btn { margin-top: 22px; }
.fs-mig-err { margin-top: 12px; font-size: 14px; line-height: 20px; color: ${C.danger}; }
`;

export default function SiteMigration({ nav, desktop }: { nav: CabNav; desktop: Desktop }) {
  const [info, setInfo] = useState<MigrationPending | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchMigration().then((m) => { if (alive) setInfo(m); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!info || busy) return;
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") setInfo(null); };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [info, busy]);

  const replace = async () => {
    if (!info || busy) return;
    setBusy(true);
    setErr("");
    try {
      const r = await claimMigration();
      const until = r.expires_at ? formatDateRu(r.expires_at) : "";
      setInfo(null);
      setNote(until ? `Подписка ${r.target || info.target} действует до ${until}. Добавьте новый ключ на устройство.`
        : `Подписка ${r.target || info.target} готова. Добавьте новый ключ на устройство.`);
    } catch (e) {
      if (isAuthErr(e)) {
        nav.expired();
        setInfo(null);
      } else setErr(errText(e, "Не удалось заменить ключ, попробуйте ещё раз"));
    } finally {
      setBusy(false);
    }
  };

  if (note !== null) {
    return (
      <DevicePicker
        desktop={desktop}
        note={note}
        onClose={() => {
          setNote(null);
          // кабинет и подписка уже открыты — перечитать с новым сроком
          if (window.location.pathname.startsWith("/cabinet")) window.location.reload();
        }}
      />
    );
  }
  if (!info) return null;
  return (
    <div className="fs-sheet-bg">
      <div className="fs-sheet fs-mig" role="dialog" aria-modal="true">
        <button type="button" className="fs-round" aria-label="Закрыть" disabled={busy} onClick={() => setInfo(null)}>
          <IcClose />
        </button>
        <div className="fs-mig-ic">{Ic.key(24)}</div>
        <h3>{info.name} теперь {info.target}</h3>
        <p>Проект {info.name} был передан под управление {info.target}. Старый ключ необходимо заменить на новый кнопкой ниже</p>
        {err ? <div className="fs-mig-err">{err}</div> : null}
        <button type="button" className="fs-dlp-btn white" disabled={busy} onClick={() => void replace()}>
          {busy ? "Заменяем…" : "Заменить ключ"}
        </button>
      </div>
    </div>
  );
}
