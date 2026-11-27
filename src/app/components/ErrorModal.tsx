import React, { createContext, useContext, useMemo, useState } from "react";
import { openSupportWithError } from "../utils/api";
import { N, NoirBadge, NoirButton, NoirDialog, NoirTextButton } from "./noir";

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
        <NoirDialog onClose={() => setMsg(null)} zIndex={3400}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
            <NoirBadge icon="error" />
            <div style={{ marginTop: 16, fontWeight: 500, fontSize: 21, letterSpacing: "-0.015em", color: N.text }}>
              Что-то пошло не так
            </div>
            <div
              style={{
                marginTop: 8,
                fontSize: 15,
                lineHeight: 1.5,
                color: N.muted,
                maxHeight: 140,
                overflowY: "auto",
                wordBreak: "break-word",
              }}
            >
              {msg}
            </div>
          </div>
          <div style={{ marginTop: 20 }}>
            <NoirButton primary icon="support_agent" onClick={() => { openSupportWithError(msg || ""); setMsg(null); }}>
              Написать в поддержку
            </NoirButton>
            <div style={{ marginTop: 4 }}>
              <NoirTextButton onClick={() => setMsg(null)}>Закрыть</NoirTextButton>
            </div>
          </div>
        </NoirDialog>
      )}
    </Ctx.Provider>
  );
}
