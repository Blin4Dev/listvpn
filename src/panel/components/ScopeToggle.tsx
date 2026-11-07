import React from 'react';
import { useProjects } from '../lib/project';
import { allProjects, useMe } from '../lib/access';

// сводка по открытому проекту или по всей сети (только если проектов больше одного)
export type Scope = 'project' | 'all';

export const ScopeToggle: React.FC<{ value: Scope; onChange: (v: Scope) => void }> = ({ value, onChange }) => {
  const { list, current } = useProjects();
  const me = useMe();
  // «вся сеть» — только с доступом ко всем проектам
  if (list.length < 2 || !current || !allProjects(me)) return null;
  return (
    <div className="flex items-center gap-2">
      <button type="button" className={`chip ${value === 'project' ? 'on' : ''}`} onClick={() => onChange('project')}>{current.name}</button>
      <button type="button" className={`chip ${value === 'all' ? 'on' : ''}`} onClick={() => onChange('all')}>Вся сеть</button>
    </div>
  );
};

export const scopeQuery = (s: Scope) => (s === 'all' ? 'scope=all' : '');
