'use client';

/**
 * Taking your work out, and putting it back.
 *
 * Two things shape this screen. The first is that **restoring is never one click**: picking a file
 * runs it as a dry run and shows what it would do, and only a second, deliberate press writes
 * anything. A learner should be able to open a file they are unsure about — one of three in a
 * downloads folder, six months old — and find out what it holds without betting their streaks on it.
 *
 * The second is that the report is worth showing in full, including what did *not* land. An import
 * that silently dropped a third of a deck because the pack is not published here would look
 * identical to one that worked. So unresolved rows are counted, named, and explained.
 */

import { useRef, useState } from 'react';
import { AlertTriangle, Check, Download, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError, clientApi, isSessionExpired } from '@/lib/api-client';
import { ARCHIVE_SECTIONS, type ArchiveImportReport } from '@/lib/types';
import type { Dictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';

type Stage = 'idle' | 'checking' | 'previewing' | 'applying' | 'done';

export function ArchivePanel({ locale, dictionary }: { locale: Locale; dictionary: Dictionary }) {
  const t = dictionary.archive;

  const [stage, setStage] = useState<Stage>('idle');
  const [downloading, setDownloading] = useState(false);
  const [report, setReport] = useState<ArchiveImportReport | null>(null);
  const [pending, setPending] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const fail = (cause: unknown): void => {
    if (isSessionExpired(cause)) setExpired(true);
    else if (cause instanceof ApiError) setError(cause.message);
    else setError(dictionary.common.error);
  };

  /**
   * Fetched rather than linked. The proxy needs the session cookie and adds the bearer token
   * server-side, so a plain `<a download>` would arrive unauthenticated and save an error page.
   */
  const download = async (): Promise<void> => {
    setDownloading(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/archive', { cache: 'no-store' });
      if (!response.ok) throw new ApiError(response.status, 'unknown', dictionary.common.error);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filenameFrom(response.headers.get('content-disposition'));
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      fail(cause);
    } finally {
      setDownloading(false);
    }
  };

  /** Picking a file only ever looks at it. Writing is the button after this one. */
  const inspect = async (file: File): Promise<void> => {
    setStage('checking');
    setError(null);
    setReport(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setStage('idle');
      setError(t.notReadable);
      return;
    }
    try {
      setReport(await clientApi<ArchiveImportReport>('/v1/archive/import?dryRun=true', { method: 'POST', body: parsed }));
      setPending(parsed);
      setStage('previewing');
    } catch (cause) {
      setStage('idle');
      fail(cause);
    }
  };

  const apply = async (): Promise<void> => {
    setStage('applying');
    setError(null);
    try {
      setReport(await clientApi<ArchiveImportReport>('/v1/archive/import', { method: 'POST', body: pending }));
      setStage('done');
      setPending(null);
    } catch (cause) {
      setStage('previewing');
      fail(cause);
    }
  };

  const reset = (): void => {
    setStage('idle');
    setReport(null);
    setPending(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const totals = report ? sum(report) : null;

  return (
    <div className="space-y-4">
      {expired ? (
        <div className="flex flex-wrap items-center gap-3" role="alert">
          <p className="text-sm text-destructive">{dictionary.common.sessionExpired}</p>
          <Button
            size="sm"
            onClick={() => {
              const here = window.location.pathname;
              window.location.assign(`/login?next=${encodeURIComponent(here)}`);
            }}
          >
            {dictionary.common.signInAgain}
          </Button>
        </div>
      ) : error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Download className="h-4 w-4 text-primary" />
            {t.downloadTitle}
          </CardTitle>
          <p className="max-w-prose text-sm text-muted-foreground">{t.downloadIntro}</p>
        </CardHeader>
        <CardContent>
          <Button onClick={() => void download()} disabled={downloading}>
            {downloading ? t.downloading : t.download}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Upload className="h-4 w-4 text-primary" />
            {t.restoreTitle}
          </CardTitle>
          <p className="max-w-prose text-sm text-muted-foreground">{t.restoreIntro}</p>
          <p className="max-w-prose text-sm text-muted-foreground">{t.neverDemotes}</p>
        </CardHeader>

        <CardContent className="space-y-4">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void inspect(file);
            }}
          />

          {stage === 'idle' || stage === 'checking' ? (
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={stage === 'checking'}>
              {stage === 'checking' ? t.checking : t.choose}
            </Button>
          ) : null}

          {report ? (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium">
                  {stage === 'done' ? t.doneTitle : t.preview}
                  {stage === 'done' ? <Check className="ml-1.5 inline h-4 w-4 text-success" /> : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t.fileFrom} {new Date(report.archive.exportedAt).toLocaleString(locale)}
                </p>
              </div>

              {totals && totals.applied === 0 && totals.unresolved === 0 ? (
                <p className="text-sm text-muted-foreground">{t.nothingToDo}</p>
              ) : (
                <SectionTable report={report} dictionary={dictionary} />
              )}

              {/* A pack that has moved on is not an error, but it is the first thing worth knowing
                  when a reference did not resolve. */}
              {report.packs
                .filter((pack) => pack.live !== null && pack.live !== pack.archived)
                .map((pack) => (
                  <p key={pack.packId} className="text-xs text-muted-foreground">
                    {pack.packId} v{pack.archived} → {t.packMoved} {pack.live}
                  </p>
                ))}

              {report.examples.length > 0 ? (
                <div className="rounded-md border border-border bg-muted/40 p-3">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                    {t.unresolvedTitle}
                  </p>
                  <p className="mt-1 max-w-prose text-xs text-muted-foreground">{t.unresolvedIntro}</p>
                  <ul className="mt-2 space-y-1">
                    {report.examples.map((entry) => (
                      <li key={`${entry.section}:${entry.ref}`} className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{t.sections[entry.section]}</span> · {entry.ref} —{' '}
                        {entry.why}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {stage === 'done' ? (
                <p className="text-sm text-muted-foreground">{t.doneHint}</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void apply()} disabled={stage === 'applying' || totals?.applied === 0}>
                    {stage === 'applying' ? t.applying : t.apply}
                  </Button>
                  <Button variant="ghost" onClick={reset} disabled={stage === 'applying'}>
                    {t.cancel}
                  </Button>
                </div>
              )}

              {stage === 'done' ? (
                <Button variant="ghost" onClick={reset}>
                  {dictionary.common.back}
                </Button>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function SectionTable({ report, dictionary }: { report: ArchiveImportReport; dictionary: Dictionary }) {
  const t = dictionary.archive;
  // Sections the file has nothing to say about are left out rather than shown as a row of zeroes.
  const rows = ARCHIVE_SECTIONS.map((section) => ({ section, counts: report.sections[section] })).filter(
    ({ counts }) => counts.applied + counts.unchanged + counts.unresolved > 0,
  );
  if (rows.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="py-2 pr-4 font-medium" />
            <th className="py-2 pr-4 text-right font-medium">{report.dryRun ? t.preview : t.applied}</th>
            <th className="py-2 pr-4 text-right font-medium">{t.unchanged}</th>
            <th className="py-2 text-right font-medium">{t.unresolved}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ section, counts }) => (
            <tr key={section} className="border-b border-border/60 last:border-0">
              <td className="py-2 pr-4 font-medium">{t.sections[section]}</td>
              <td className="py-2 pr-4 text-right tabular-nums">{counts.applied}</td>
              <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">{counts.unchanged}</td>
              <td
                className={`py-2 text-right tabular-nums ${counts.unresolved > 0 ? 'text-destructive' : 'text-muted-foreground'}`}
              >
                {counts.unresolved}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const sum = (report: ArchiveImportReport) =>
  ARCHIVE_SECTIONS.reduce(
    (totals, section) => ({
      applied: totals.applied + report.sections[section].applied,
      unresolved: totals.unresolved + report.sections[section].unresolved,
    }),
    { applied: 0, unresolved: 0 },
  );

/**
 * The filename the API chose, which is date-stamped and says nothing about who the learner is.
 * Falls back rather than throwing: a missing header should still save a file.
 */
function filenameFrom(disposition: string | null): string {
  const match = disposition?.match(/filename="([^"]+)"/);
  return match?.[1] ?? 'skills-coach.json';
}
