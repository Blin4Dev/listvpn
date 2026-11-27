// FGN: глобальная ошибка (переопределение src/app/components/ErrorModal.tsx).
// Логика та же (контекст + «написать в поддержку с текстом ошибки»), дизайн — FgnDialog FGN.
import React, { createContext, useContext, useMemo, useState } from "react";
import { openSupportWithError } from "../utils/api";
import { FgnDialog } from "./fgn";

type ErrorCtx = { showError: (message: string) => void };

const Ctx = createContext<ErrorCtx>({ showError: () => {} });

export function useAppError(): ErrorCtx {
  return useContext(Ctx);
}

export function AppErrorProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);

  const api = useMemo<ErrorCtx>(() => ({ showError: (m: string) => setMsg(m || "Неизвестная ошибка") }), []);

  return (
    <Ctx.Provider value={api}>
      {children}
      {msg != null && (
        <FgnDialog
          title="Что-то пошло не так"
          text={<span style={{ display: "block", maxHeight: 140, overflowY: "auto", wordBreak: "break-word" }}>{msg}</span>}
          primary="Написать в поддержку"
          onPrimary={() => { openSupportWithError(msg || ""); setMsg(null); }}
          secondary="Закрыть"
          onClose={() => setMsg(null)}
        />
      )}
    </Ctx.Provider>
  );
}