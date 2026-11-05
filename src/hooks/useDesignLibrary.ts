import { useEffect, useState } from 'react';
import type { Theme } from '../types/model';
import { getCustomThemes, getUserTemplates, onLibraryChange, type UserTemplate } from '../services/storage/designLibrary';

export function useDesignLibrary() {
  const [themes, setThemes] = useState<Theme[]>([]);
  const [templates, setTemplates] = useState<UserTemplate[]>([]);
  useEffect(() => {
    const load = () => {
      void getCustomThemes().then(setThemes);
      void getUserTemplates().then(setTemplates);
    };
    load();
    return onLibraryChange(load);
  }, []);
  return { themes, templates };
}
