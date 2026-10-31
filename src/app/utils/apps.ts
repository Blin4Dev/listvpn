// клиенты vpn: имена, иконки, ссылки установки

export type DeviceKind = "android" | "ios" | "windows" | "macos" | "linux" | "android_tv";
export type AppKind = "koala" | "incy" | "happ" | "other";

export const DEVICE_TITLE: Record<DeviceKind, string> = {
  android: "Android",
  ios: "iOS",
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
  android_tv: "Android TV",
};

const HAPP_INSTALL: Record<DeviceKind, string> = {
  android: "https://play.google.com/store/apps/details?id=com.happproxy&hl=ru",
  ios: "https://apps.apple.com/ru/app/happ-proxy-utility-plus/id6746188973",
  windows: "https://github.com/Happ-proxy/happ-desktop/releases/latest/download/setup-Happ.x64.exe",
  macos: "https://apps.apple.com/ru/app/happ-proxy-utility-plus/id6746188973",
  linux: "https://github.com/Happ-proxy/happ-desktop/releases/latest/",
  android_tv: "https://play.google.com/store/apps/details?id=com.happproxy",
};

const INCY_INSTALL: Record<DeviceKind, string> = {
  android: "https://play.google.com/store/apps/details?id=llc.itdev.incy",
  ios: "https://apps.apple.com/ru/app/incy/id6756943388",
  windows: "https://github.com/INCY-DEV/incy-platforms/releases/latest/download/incy-windows-setup.exe",
  macos: "https://apps.apple.com/ru/app/incy/id6756943388",
  linux: "https://github.com/INCY-DEV/incy-platforms/releases/latest/download/incy-linux-x64.deb",
  android_tv: "https://play.google.com/store/apps/details?id=llc.itdev.incy",
};

// Koala Clash — только компьютер (Windows / macOS / Linux): github.com/coolcoala/koala-clash
const KOALA_RELEASE = "https://github.com/coolcoala/koala-clash/releases/latest";
const KOALA_DL = `${KOALA_RELEASE}/download`;

export const APP_META: Record<AppKind, { title: string; sub: string; img?: string; icon?: string; recommended?: boolean }> = {
  koala: { title: "Koala Clash", sub: "Рекомендуем для компьютера", img: "/assets/koala.png", recommended: true },
  incy: { title: "Incy", sub: "Рекомендуем", img: "/assets/incy.png", recommended: true },
  happ: { title: "Happ", sub: "Популярное", img: "/assets/happ.png" },
  other: { title: "Другое приложение", sub: "Ссылка на подписку", icon: "link" },
};

export function detectDeviceKind(): DeviceKind {
  if (typeof navigator === "undefined") return "linux";
  const ua = navigator.userAgent || "";
  if (/Android/i.test(ua) && /TV|AFT|BRAVIA|GoogleTV/i.test(ua)) return "android_tv";
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Win/i.test(ua)) return "windows";
  if (/Mac/i.test(ua)) return "macos";
  return "linux";
}

export const isDesktop = (d: DeviceKind): boolean => d === "windows" || d === "macos" || d === "linux";

/** приложения в списке выбора: на компьютере Koala Clash — первым и рекомендуемым */
export function appsFor(device: DeviceKind): AppKind[] {
  return isDesktop(device) ? ["koala", "incy", "happ", "other"] : ["incy", "happ", "other"];
}

/** рекомендуемое для устройства: компьютер — Koala Clash, телефон — Incy */
export function isRecommended(app: AppKind, device: DeviceKind): boolean {
  return isDesktop(device) ? app === "koala" : app === "incy";
}

/** подпись под названием в списке */
export function appSub(app: AppKind, device: DeviceKind): string {
  if (isRecommended(app, device)) return "Рекомендуем";
  if (app === "incy" || app === "happ") return isDesktop(device) ? "Тоже подойдёт" : "Популярное";
  return APP_META[app].sub;
}

export type InstallOption = { label: string; url: string; note?: string };

/** установочные файлы: у Koala Clash для macOS и Linux несколько вариантов */
export function installOptions(app: AppKind, device: DeviceKind): InstallOption[] {
  if (app === "koala") {
    if (device === "windows") return [
      { label: "Скачать для Windows", url: `${KOALA_DL}/Koala.Clash_x64-setup.exe`, note: "64-бит, .exe" },
      { label: "Windows на ARM", url: `${KOALA_DL}/Koala.Clash_arm64-setup.exe` },
    ];
    if (device === "macos") return [
      { label: "Скачать для Mac на M1–M4", url: `${KOALA_DL}/Koala.Clash_arm64.pkg`, note: "Apple Silicon, .pkg" },
      { label: "Mac на Intel", url: `${KOALA_DL}/Koala.Clash_x64.pkg` },
    ];
    if (device === "linux") return [
      { label: "Скачать .deb", url: `${KOALA_DL}/Koala.Clash_amd64.deb`, note: "Ubuntu, Debian, Mint" },
      { label: ".rpm (Fedora, openSUSE)", url: `${KOALA_DL}/Koala.Clash_x86_64.rpm` },
      { label: "Другие сборки", url: KOALA_RELEASE },
    ];
    return [];
  }
  const url = installUrl(app, device);
  return url ? [{ label: `Скачать ${APP_META[app].title}`, url }] : [];
}

/** инструкция по установке Koala Clash (система ругается на неподписанный установщик) */
export const KOALA_GUIDE: Partial<Record<DeviceKind, string[]>> = {
  windows: [
    "Скачайте установщик и запустите его.",
    "Если Windows покажет «Система Windows защитила ваш компьютер» — «Подробнее» → «Выполнить в любом случае».",
    "Пройдите установку и откройте Koala Clash.",
  ],
  macos: [
    "Скачайте .pkg для своего Mac: M1–M4 или Intel (меню Apple → «Об этом Mac» → «Чип»).",
    "Откройте файл. Если macOS не даёт установить — Системные настройки → Конфиденциальность и безопасность → «Всё равно открыть».",
    "Пройдите установку и откройте Koala Clash из Программ.",
  ],
  linux: [
    "Скачайте пакет для своего дистрибутива.",
    "Установите: sudo apt install ./Koala.Clash_amd64.deb (или sudo dnf install ./Koala.Clash_x86_64.rpm).",
    "Запустите Koala Clash из меню приложений.",
  ],
};

export function installUrl(app: AppKind, device: DeviceKind): string | null {
  if (app === "koala") return isDesktop(device) ? installOptions(app, device)[0]?.url || null : null;
  if (app === "happ") return HAPP_INSTALL[device];
  if (app === "incy") return INCY_INSTALL[device];
  return null;
}

