// бренд проекта сети — из projects/<id>/project.json (подставляет vite при сборке, см. vite.config.ts)
// проект может переопределить и этот файл целиком: projects/<id>/app/utils/brand.ts
declare const __LISTVPN_PROJECT__: {
  id: string; name: string; channelUrl: string; version: string; features: Record<string, boolean>;
  refLevelNames?: Record<string, string>; stageWidth?: number;
};

const P = __LISTVPN_PROJECT__;

export const PROJECT_ID = P.id;
export const BRAND_NAME = P.name;
// ширина макета (project.json → stage_width), по умолчанию 402
export const STAGE_WIDTH = P.stageWidth || 402;
export const APP_VERSION = P.version || "1.0";
// «Наш канал» в настройках
export const CHANNEL_URL = P.channelUrl;

// фишки проекта (features в project.json): у FGN — промокоды на дни, промокод при оплате и т.д.
export const FEATURES: Record<string, boolean> = P.features || {};
export const hasFeature = (key: string): boolean => !!FEATURES[key];

// название реферального уровня проекта (project.json → ref_level_names), иначе общее
export const levelName = (key: string, fallback: string): string => (P.refLevelNames || {})[key] || fallback;
