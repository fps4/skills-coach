'use client';

/**
 * Light/dark switch. Flips `data-theme` on `<html>`, which re-points the tokens in `globals.css`.
 * Persisted; the pre-paint script in the layout applies the saved choice before render.
 */

import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';

type Theme = 'dark' | 'light';

const STORAGE_KEY = 'sc.theme';

export function ThemeToggle({ label }: { label: string }) {
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    setTheme((document.documentElement.getAttribute('data-theme') as Theme | null) ?? 'dark');
  }, []);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode or storage disabled — the choice still applies for this session.
    }
    setTheme(next);
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      title={label}
      aria-label={label}
      className="text-muted-foreground hover:text-foreground"
    >
      {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
