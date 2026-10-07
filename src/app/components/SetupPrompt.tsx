import React from "react";
import { N, NoirBadge, NoirButton, NoirSheet } from "./noir";

/** «Остался один шаг»: после оплаты/подарка предлагаем добавить подписку в приложение */
export default function SetupPrompt({
  onContinue,
  onClose,
}: {
  onContinue: () => void;
  onClose: () => void;
}) {
  return (
    <NoirSheet title="" onClose={onClose}>
      <div style={{ marginTop: -8 }}>
        <NoirBadge icon="bolt" />
        <div style={{ marginTop: 16, fontWeight: 500, fontSize: 24, letterSpacing: "-0.02em", color: N.text }}>
          Остался один шаг
        </div>
        <div style={{ marginTop: 8, marginBottom: 22, fontSize: 15.5, lineHeight: 1.5, color: N.muted }}>
          Добавьте подписку в приложение и подключитесь к серверу — VPN заработает меньше чем за минуту.
        </div>
        <NoirButton primary onClick={onContinue}>Продолжить настройку</NoirButton>
      </div>
    </NoirSheet>
  );
}
