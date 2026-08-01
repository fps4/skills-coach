'use client';

/**
 * Rendering a lesson section.
 *
 * One renderer per kind (ADR-0004). This is what lets the surface display *any* pack correctly the
 * day it is imported — a new pack needs content, not a new component.
 *
 * Two things it is careful about:
 *
 * - **`lang={contentLanguage}`** on every piece of pack material, so a Dutch passage is announced
 *   as Dutch by a screen reader and spellchecked as Dutch, even when the interface is English.
 * - **Answer keys stay hidden until asked for.** Exercise answers and dictation sentences are
 *   delivered with the lesson — faithful to the source, where answers were printed at the bottom of
 *   the file — but a learner has to choose to look.
 */

import { useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Headphones,
  Lightbulb,
  ListChecks,
  Mic,
  PencilLine,
  Table2,
  Type,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Dictionary } from '@/i18n/dictionaries';
import type { Section } from '@/lib/types';

interface Props {
  section: Section;
  contentLanguage: string;
  dictionary: Dictionary;
  /** Rendered under a section that asks for written answers. */
  answerSlot?: (ref: string, label: string) => ReactNode;
}

const ICONS: Record<Section['kind'], ReactNode> = {
  text: <BookOpen className="h-4 w-4 text-primary" />,
  rules: <Lightbulb className="h-4 w-4 text-primary" />,
  vocabulary: <Table2 className="h-4 w-4 text-primary" />,
  questions: <ListChecks className="h-4 w-4 text-primary" />,
  speak: <Mic className="h-4 w-4 text-primary" />,
  write: <PencilLine className="h-4 w-4 text-primary" />,
  listening: <Headphones className="h-4 w-4 text-primary" />,
  dictation: <Type className="h-4 w-4 text-primary" />,
  exercise: <ListChecks className="h-4 w-4 text-primary" />,
};

function Shell({ kind, title, children }: { kind: Section['kind']; title?: string; children: ReactNode }) {
  return (
    <Card>
      {title ? (
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            {ICONS[kind]}
            {title}
          </CardTitle>
        </CardHeader>
      ) : null}
      <CardContent className={title ? undefined : 'pt-5'}>{children}</CardContent>
    </Card>
  );
}

/** A disclosure for content the learner should meet only after trying. */
function Reveal({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 border-t border-border pt-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        {label}
      </button>
      {open ? <div className="mt-2">{children}</div> : null}
    </div>
  );
}

export function SectionView({ section, contentLanguage, dictionary, answerSlot }: Props) {
  const t = dictionary.lesson;
  const lang = contentLanguage;

  switch (section.kind) {
    case 'text':
    case 'rules':
      return (
        <Shell kind={section.kind} title={section.title ?? (section.kind === 'text' ? t.readAloud : t.rules)}>
          <p className="max-w-prose whitespace-pre-wrap leading-relaxed" lang={lang}>
            {section.body}
          </p>
        </Shell>
      );

    case 'vocabulary':
      return (
        <Shell kind="vocabulary" title={section.title ?? t.vocabulary}>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">{t.term}</th>
                  <th className="py-2 pr-4 font-medium">{t.translation}</th>
                  <th className="py-2 font-medium">{t.example}</th>
                </tr>
              </thead>
              <tbody>
                {section.items.map((item) => (
                  <tr key={item.term} className="border-b border-border/60 align-top last:border-0">
                    <td className="py-2 pr-4 font-medium" lang={lang}>
                      {item.term}
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">{item.translation}</td>
                    <td className="py-2 text-muted-foreground" lang={lang}>
                      {item.example}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Shell>
      );

    case 'questions':
      return (
        <Shell kind="questions" title={section.title ?? t.questions}>
          {section.instruction ? (
            <p className="mb-4 text-sm text-muted-foreground" lang={lang}>
              {section.instruction}
            </p>
          ) : null}
          <ol className="space-y-5">
            {section.items.map((item) => (
              <li key={item.ref}>
                <p lang={lang}>
                  <span className="mr-2 text-muted-foreground">{item.ref}.</span>
                  {item.prompt}
                </p>
                {answerSlot?.(`${section.id}.${item.ref}`, item.prompt)}
              </li>
            ))}
          </ol>
        </Shell>
      );

    case 'speak':
      return (
        <Shell kind="speak" title={section.title ?? t.speak}>
          <p className="max-w-prose whitespace-pre-wrap leading-relaxed" lang={lang}>
            {section.prompt}
          </p>
          {section.requirements?.length ? (
            <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-muted-foreground" lang={lang}>
              {section.requirements.map((requirement) => (
                <li key={requirement}>{requirement}</li>
              ))}
            </ul>
          ) : null}
          <p className="mt-4 text-sm text-muted-foreground">{t.speakHint}</p>
        </Shell>
      );

    case 'write':
      return (
        <Shell kind="write" title={section.title ?? t.write}>
          <p className="max-w-prose whitespace-pre-wrap leading-relaxed" lang={lang}>
            {section.prompt}
          </p>
          {section.requirements?.length ? (
            <>
              <p className="mt-4 text-sm font-medium">{t.requirements}</p>
              <ul className="mt-1 list-inside list-disc space-y-1 text-sm text-muted-foreground" lang={lang}>
                {section.requirements.map((requirement) => (
                  <li key={requirement}>{requirement}</li>
                ))}
              </ul>
            </>
          ) : null}
          {answerSlot?.(section.id, section.prompt)}
        </Shell>
      );

    case 'listening':
      return (
        <Shell kind="listening" title={section.title ?? t.listening}>
          <p className="max-w-prose whitespace-pre-wrap leading-relaxed" lang={lang}>
            {section.prompt}
          </p>
          {section.sources?.length ? (
            <>
              <p className="mt-4 text-sm font-medium">{t.sources}</p>
              <ul className="mt-1 list-inside list-disc space-y-1 text-sm text-muted-foreground" lang={lang}>
                {section.sources.map((source) => (
                  <li key={source.title}>
                    {source.title}
                    {source.note ? ` — ${source.note}` : ''}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </Shell>
      );

    case 'dictation':
      return (
        <Shell kind="dictation" title={section.title ?? t.dictation}>
          {section.prompt ? (
            <p className="max-w-prose whitespace-pre-wrap leading-relaxed" lang={lang}>
              {section.prompt}
            </p>
          ) : null}
          <p className="mt-3 text-sm text-muted-foreground">{t.dictationHint}</p>
          {answerSlot?.(section.id, section.title ?? t.dictation)}
          <Reveal label={t.answers}>
            <ol className="list-inside list-decimal space-y-1 text-sm" lang={lang}>
              {section.sentences.map((sentence) => (
                <li key={sentence}>{sentence}</li>
              ))}
            </ol>
          </Reveal>
        </Shell>
      );

    case 'exercise':
      return (
        <Shell kind="exercise" title={section.title ?? t.exercise}>
          {section.prompt ? (
            <p className="mb-4 text-sm text-muted-foreground" lang={lang}>
              {section.prompt}
            </p>
          ) : null}
          <ol className="space-y-5">
            {section.items.map((item) => (
              <li key={item.ref}>
                <p lang={lang}>
                  <span className="mr-2 text-muted-foreground">{item.ref}.</span>
                  {item.prompt}
                </p>
                {answerSlot?.(`${section.id}.${item.ref}`, item.prompt)}
              </li>
            ))}
          </ol>
          {section.answers?.length ? (
            <Reveal label={t.answers}>
              <ol className="space-y-1 text-sm" lang={lang}>
                {section.answers.map((answer) => (
                  <li key={answer.ref}>
                    <span className="mr-2 text-muted-foreground">{answer.ref}.</span>
                    {answer.answer}
                  </li>
                ))}
              </ol>
            </Reveal>
          ) : null}
        </Shell>
      );
  }
}
