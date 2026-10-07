import React from "react";
import { N, NoirButton, NoirDialog, NoirTextButton } from "./noir";

// диалог подтверждения по центру
export default function ConfirmDialog({
  title,
  children,
  confirmText,
  cancelText = "Отмена",
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: React.ReactNode;
  confirmText: string;
  cancelText?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
}) {
  return (
    <NoirDialog onClose={onCancel}>
      <div style={{ fontWeight: 500, fontSize: 21, letterSpacing: "-0.015em", color: N.text, marginBottom: 12 }}>{title}</div>
      <div style={{ fontSize: 15, lineHeight: 1.5, color: N.muted, marginBottom: 18 }}>{children}</div>
      <NoirButton primary disabled={busy} onClick={onConfirm}>{busy ? "Подождите…" : confirmText}</NoirButton>
      {onCancel ? <div style={{ marginTop: 4 }}><NoirTextButton onClick={onCancel}>{cancelText}</NoirTextButton></div> : null}
    </NoirDialog>
  );
}
