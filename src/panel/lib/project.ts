// сеть проектов (listvpn): какой проект открыт в панели. Бэкенд один — проект уходит заголовком X-Project.
import { createContext, useContext } from 'react';

export type ProjectInfo = {
  id: string;
  name: string;
  is_default: boolean;
  bot_username: string;
  miniapp_url: string;
  channel_url: string;
  configured: boolean;            // бот проекта подключён
  payments_configured: boolean;   // свой магазин ЮKassa
  active?: boolean;               // проект включён (Проекты)
  ready?: boolean;                // работает: мини-приложение, бот, админы, оплата (сквады необязательны)
  features: Record<string, unknown>;
};

const KEY = 'panel_project';

export function getProjectId(): string {
  try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
}

// смена проекта: все данные страницы перезагружаются (проще и надёжнее, чем сбрасывать каждый экран)
export function switchProject(id: string): void {
  try { localStorage.setItem(KEY, id); } catch { /* приватный режим */ }
  // карточка пользователя / чат другого проекта в новом проекте не нужны — на раздел
  const p = window.location.pathname;
  const path = /^\/users\/\d+/.test(p) ? '/users' : /^\/support\/\d+/.test(p) ? '/support' : p;
  window.location.assign(path + window.location.search);
}

export function rememberProject(id: string): void {
  try { localStorage.setItem(KEY, id); } catch { /* */ }
}

export type ProjectsState = { list: ProjectInfo[]; current: ProjectInfo | null };
export const ProjectContext = createContext<ProjectsState>({ list: [], current: null });
export const useProjects = () => useContext(ProjectContext);
export const useProject = () => useContext(ProjectContext).current;

// разделы панели, общие для всей сети (не зависят от выбранного проекта)
export const NETWORK_PAGES = new Set(['Мониторинг', 'Сотрудники', 'Зарплата', 'Поддержка', 'Ресейл']);
export const NETWORK_SETTINGS = new Set(['antiabuse', 'squads', 'mail', 'captcha', 'forum', 'backups', 'storage']);
