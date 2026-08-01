import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** A small status label. `tone` carries meaning, and is separate from the palette's accent hue. */
export function Pill({
  children,
  tone = 'muted',
  className,
}: {
  children: ReactNode;
  tone?: 'muted' | 'primary' | 'success' | 'destructive';
  className?: string;
}) {
  const tones = {
    muted: 'border-border text-muted-foreground',
    primary: 'border-primary/40 bg-primary/10 text-foreground',
    success: 'border-success/40 text-success',
    destructive: 'border-destructive/40 text-destructive',
  } as const;

  return (
    <span
      className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium', tones[tone], className)}
    >
      {children}
    </span>
  );
}

/** A progress meter. Advisory throughout — a sequencing signal, never a grade. */
export function Meter({
  value,
  total,
  tone = 'primary',
  className,
}: {
  value: number;
  total: number;
  tone?: 'primary' | 'success' | 'muted';
  className?: string;
}) {
  const percent = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  const fill = { primary: 'bg-primary', success: 'bg-success', muted: 'bg-muted-foreground' }[tone];

  return (
    <div className={cn('h-1.5 overflow-hidden rounded-full bg-muted', className)}>
      <div className={cn('h-full transition-[width]', fill)} style={{ width: `${percent}%` }} />
    </div>
  );
}

/** A headline figure with its label — the summary tile used above detail. */
export function Stat({ icon, value, label }: { icon?: ReactNode; value: ReactNode; label: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-xl font-semibold tabular-nums tracking-tight">{value}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

/** The standard page frame: a back link, a title, an optional subtitle, then content. */
export function PageShell({
  title,
  subtitle,
  back,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  back?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 p-6 md:p-8">
      {back}
      <header>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p> : null}
      </header>
      {children}
    </div>
  );
}
