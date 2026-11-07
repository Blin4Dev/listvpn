import { createContext, useContext } from 'react';

// кто вошёл (GET /panel/auth/me)
export type Me = {
  kind: 'owner' | 'staff'; role: 'owner' | 'admin' | 'curator' | 'operator'; username: string; name: string; staff_id?: number;
  shift?: { working_today: boolean; on_shift: boolean; has_schedule?: boolean; intervals: string[][] };
  // администратор: права и проекты (["*"] — все)
  perms?: string[];
  projects?: string[];
};

export const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext);

export const isOwner = (me: Me | null) => me?.role === 'owner';
export const isAdmin = (me: Me | null) => me?.role === 'admin';
// owner + curator: полный доступ к поддержке и пользователям
export const isFull = (me: Me | null) => me?.role === 'owner' || me?.role === 'curator' || (isAdmin(me) && can(me, 'support'));

export const ROLE_LABEL: Record<string, string> = { owner: 'Владелец', admin: 'Администратор', curator: 'Куратор', operator: 'Оператор' };

/** право администратора; владелец может всё. Для кураторов/операторов — false (у них свои правила). */
export function can(me: Me | null, perm: string): boolean {
  if (!me) return false;
  if (me.role === 'owner') return true;
  if (me.role !== 'admin') return false;
  return (me.perms || []).includes(perm);
}

/** действие с пользователем (кнопки в карточке). Оператору — по правилам тикета/запрещённым действиям на сервере. */
export function canUserAction(me: Me | null, action: string): boolean {
  if (!me) return false;
  if (me.role === 'admin') return can(me, `users.action.${action}`);
  if (action === 'DELETE_USER') return me.role === 'owner';
  return true;
}

/** доступ ко всем проектам (сводка «вся сеть») */
export const allProjects = (me: Me | null) => !!me && (me.role !== 'admin' || (me.projects || []).includes('*'));

// раздел настроек → право администратора
export const SETTINGS_PERM: Record<string, string> = {
  project: 'settings.project', app: 'settings.app', price: 'settings.price', antiabuse: 'settings.antiabuse',
  offer: 'settings.legal', privacy: 'settings.legal', squads: 'settings.squads', mail: 'settings.mail',
  captcha: 'settings.captcha', forum: 'settings.forum', backups: 'settings.backups', storage: 'settings.storage',
};
export const canSettingsTab = (me: Me | null, tab: string) => me?.role === 'owner' || can(me, SETTINGS_PERM[tab] || '-');

// страница → право на просмотр (администратор)
const PAGE_VIEW: Record<string, string> = {
  'Главная': 'dashboard.view', 'Статистика': 'dashboard.view', 'Финансы': 'finance.view',
  'Пользователи': 'users.view', 'Выводы': 'withdrawals.view', 'Ресейл': 'resale.view', 'Поддержка': 'support',
  'Рассылка': 'mailing.view', 'Промокоды': 'promocodes.view', 'Подарки': 'gifts.view', 'Акции': 'promotions.view',
  'Ссылки': 'links.view', 'Мониторинг': 'monitoring.view',
};
// страница → право на изменения; без него страница только для просмотра
export const PAGE_MANAGE: Record<string, string> = {
  'Финансы': 'finance.refund', 'Выводы': 'withdrawals.manage', 'Ресейл': 'resale.manage', 'Рассылка': 'mailing.send',
  'Промокоды': 'promocodes.manage', 'Подарки': 'gifts.manage', 'Акции': 'promotions.manage', 'Ссылки': 'links.manage',
  'Мониторинг': 'monitoring.manage',
};

// какие страницы видит сотрудник; owner видит всё кроме «зарплаты»
export const canOpenPage = (me: Me | null, page: string): boolean => {
  if (!me) return false;
  if (me.role === 'owner') return page !== 'Зарплата';
  if (me.role === 'admin') {
    if (page === 'Настройки') return Object.keys(SETTINGS_PERM).some((t) => canSettingsTab(me, t));
    const perm = PAGE_VIEW[page];
    return !!perm && can(me, perm);
  }
  if (page === 'Поддержка' || page === 'Пользователи' || page === 'Зарплата') return true;
  if (page === 'Сотрудники') return me.role === 'curator';
  return false;
};

/** страница открыта администратору только на просмотр */
export const pageReadOnly = (me: Me | null, page: string): boolean =>
  me?.role === 'admin' && !!PAGE_MANAGE[page] && !can(me, PAGE_MANAGE[page]);
