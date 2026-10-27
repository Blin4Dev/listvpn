// FGN: лист «Остался один шаг» (переопределение src/app/components/SetupPrompt.tsx).
// Появляется раз за сессию, если подписка есть, но ключ ни разу не добавляли.
import React from "react";
import { FgnSheet, fgnButton } from "./fgn";

const TEXT = "#F4F4F5";
const MUTED = "#9B9BA4";
const CARD_BORDER = "#2A2A30";

/** «Остался один шаг»: после оплаты/подарка предлагаем добавить подписку в приложение */
export default function SetupPrompt({
  onContinue,
  onClose,
}: {
  onContinue: () => void;
  onClose: () => void;
}) {
  return (
    <FgnSheet title="Остался один шаг" onClose={onClose}>
      <div style={{ marginTop: 19, fontSize: 14.5, lineHeight: "20px", color: MUTED }}>
        Добавьте подписку в приложение и подключитесь к серверу — VPN заработает меньше чем за минуту.
      </div>
      <button
        type="button"
        className="blin-press"
        onClick={onContinue}
        style={{ ...fgnButton, marginTop: 18, height: 52, borderRadius: 16, fontSize: 16 }}
      >
        Продолжить настройку
      </button>
    </FgnSheet>
  );
}