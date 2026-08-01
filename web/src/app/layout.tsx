/**
 * The root layout exists only to satisfy Next's requirement for one. Everything real — including
 * the `<html lang>` — happens in `[locale]/layout.tsx`, because the interface language is a route
 * segment (ADR-0005).
 */

import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Skills Coach',
  description: 'A personalizable, pack-driven training platform.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
