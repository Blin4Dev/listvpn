import { useEffect, useRef, useState } from "react";
import type React from "react";

// Скрытое поле выбора файла: НЕ display:none — WebKit (Telegram для macOS, старые iOS) не открывает
// окно выбора по .click() для поля с display:none. Прячем визуально, но оставляем в раскладке.
export const hiddenFileInput: React.CSSProperties = {
  position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden",
  clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0, opacity: 0,
};

// Telegram на компьютере (Desktop, macOS, веб-версии): там окно выбора файла в мини-приложении
// работает не во всех версиях — даём перетаскивание и Ctrl+V
export function isDesktopTelegram(): boolean {
  try {
    const p = (window as unknown as { Telegram?: { WebApp?: { platform?: string } } }).Telegram?.WebApp?.platform || "";
    return ["tdesktop", "macos", "weba", "webk", "web", "unigram"].includes(p);
  } catch {
    return false;
  }
}

/** перетаскивание файлов в окно и вставка любых файлов из буфера (Ctrl+V) → onFiles. */
export function useFileDrop(onFiles: (files: File[]) => void): boolean {
  const cb = useRef(onFiles);
  cb.current = onFiles;
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types || []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length) cb.current(files);
    };
    const paste = (e: ClipboardEvent) => {
      if (e.defaultPrevented) return; // уже обработано полем ввода (скриншот)
      const files = Array.from(e.clipboardData?.items || [])
        .filter((it) => it.kind === "file")
        .map((it) => it.getAsFile())
        .filter((f): f is File => !!f);
      if (!files.length) return;
      e.preventDefault();
      cb.current(files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    window.addEventListener("paste", paste);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
      window.removeEventListener("paste", paste);
    };
  }, []);
  return dragging;
}
