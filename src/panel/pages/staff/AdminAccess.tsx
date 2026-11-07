import React from 'react';
import { Check, Layers } from 'lucide-react';

// права администратора: справочник приходит с GET /panel/staff (admin_perms, projects)
export type PermItem = { key: string; label: string; scope: 'project' | 'network'; implies?: string | null };
export type PermCatalog = { groups: { group: string; items: PermItem[] }[] };
export type ProjectRef = { id: string; name: string };
export type AdminAccessValue = { perms: string[]; projects: string[] };

// права, которые включаются сами вместе с другим (управление → просмотр; любое действие → просмотр пользователей)
function impliedBy(catalog: PermCatalog, perms: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const g of catalog.groups) for (const it of g.items) {
    if (perms.has(it.key) && it.implies) out.add(it.implies);
  }
  for (const k of perms) if (k.startsWith('users.') && k !== 'users.view') out.add('users.view');
  if (perms.has('support')) out.add('users.view');
  return out;
}

const Box: React.FC<{ on: boolean; locked?: boolean; onClick: () => void; children: React.ReactNode; hint?: string }> = ({ on, locked, onClick, children, hint }) => (
  <button type="button" onClick={locked ? undefined : onClick} title={hint}
    style={{
      display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left', padding: '7px 9px', borderRadius: 8,
      background: on ? 'rgba(255,255,255,0.06)' : 'transparent', border: '1px solid var(--border)', color: 'var(--text)',
      cursor: locked ? 'default' : 'pointer', opacity: locked ? 0.7 : 1, fontSize: 13, lineHeight: 1.35,
    }}>
    <span style={{
      width: 17, height: 17, flex: 'none', borderRadius: 5, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      border: `1px solid ${on ? 'var(--text)' : 'var(--border)'}`, background: on ? 'var(--text)' : 'transparent', color: 'var(--bg)',
    }}>{on && <Check size={12} strokeWidth={3} />}</span>
    <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
  </button>
);

export const AdminAccessEditor: React.FC<{
  catalog: PermCatalog; projects: ProjectRef[]; value: AdminAccessValue; onChange: (v: AdminAccessValue) => void;
}> = ({ catalog, projects, value, onChange }) => {
  const perms = new Set(value.perms);
  const implied = impliedBy(catalog, perms);
  const allProjects = value.projects.includes('*');

  const setPerms = (next: Set<string>) => onChange({ ...value, perms: Array.from(next).sort() });
  const toggle = (key: string) => {
    const next = new Set(perms);
    if (next.has(key)) next.delete(key); else next.add(key);
    setPerms(next);
  };
  const toggleGroup = (items: PermItem[]) => {
    const allOn = items.every((i) => perms.has(i.key) || implied.has(i.key));
    const next = new Set(perms);
    for (const i of items) { if (allOn) next.delete(i.key); else next.add(i.key); }
    setPerms(next);
  };
  const toggleProject = (id: string) => {
    if (id === '*') { onChange({ ...value, projects: allProjects ? [] : ['*'] }); return; }
    const cur = new Set(value.projects.filter((p) => p !== '*'));
    if (cur.has(id)) cur.delete(id); else cur.add(id);
    onChange({ ...value, projects: Array.from(cur).sort() });
  };
  const total = catalog.groups.reduce((n, g) => n + g.items.length, 0);
  const chosen = new Set([...perms, ...implied]).size;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className="field-label"><Layers size={12} style={{ display: 'inline', marginRight: 5, verticalAlign: -1 }} />Проекты</label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <Box on={allProjects} onClick={() => toggleProject('*')}>
            <b>Все проекты</b><div className="faint" style={{ fontSize: 11.5 }}>и новые, которые появятся позже</div>
          </Box>
          {projects.map((p) => (
            <Box key={p.id} on={allProjects || value.projects.includes(p.id)} locked={allProjects} onClick={() => toggleProject(p.id)}>
              {p.name} <span className="faint mono" style={{ fontSize: 11 }}>{p.id}</span>
            </Box>
          ))}
        </div>
        <div className="faint" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>
          Пользователи, платежи, промокоды, рассылки и настройки проекта — только в выбранных проектах.
          Разделы «вся сеть» (мониторинг, сквады, почта и т.п.) от проекта не зависят.
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
          <label className="field-label" style={{ margin: 0 }}>Права</label>
          <div className="flex items-center gap-2">
            <span className="faint" style={{ fontSize: 12 }}>{chosen} из {total}</span>
            <button type="button" className="btn sm" onClick={() => setPerms(new Set(catalog.groups.flatMap((g) => g.items.map((i) => i.key))))}>Все</button>
            <button type="button" className="btn sm" onClick={() => setPerms(new Set())}>Сбросить</button>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          {catalog.groups.map((g) => {
            const on = g.items.filter((i) => perms.has(i.key) || implied.has(i.key)).length;
            return (
              <div key={g.group} className="inset" style={{ padding: 10 }}>
                <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{g.group} <span className="faint" style={{ fontWeight: 400 }}>· {on}/{g.items.length}</span></div>
                  <button type="button" className="btn ghost sm" onClick={() => toggleGroup(g.items)}>
                    {on === g.items.length ? 'Снять все' : 'Выбрать все'}
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                  {g.items.map((i) => {
                    const auto = !perms.has(i.key) && implied.has(i.key);
                    return (
                      <Box key={i.key} on={perms.has(i.key) || auto} locked={auto} onClick={() => toggle(i.key)}
                        hint={auto ? 'Включено вместе с другим правом' : undefined}>
                        {i.label}
                        {i.scope === 'network' && <span className="faint" style={{ fontSize: 11 }}> · вся сеть</span>}
                        {auto && <div className="faint" style={{ fontSize: 11 }}>включено вместе с другим правом</div>}
                      </Box>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/** краткая подпись в списке сотрудников */
export function accessSummary(v: AdminAccessValue | null | undefined, projects: ProjectRef[]): string {
  if (!v) return '';
  const pr = v.projects.includes('*') ? 'все проекты'
    : v.projects.map((id) => projects.find((p) => p.id === id)?.name || id).join(', ') || 'нет проектов';
  return `${v.perms.length} прав · ${pr}`;
}
