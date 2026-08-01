/**
 * Rendering a lesson section.
 *
 * One renderer per kind (ADR-0004). This is what lets the surface display *any* pack correctly the
 * day it is imported — a new pack needs content, not a new component.
 *
 * Two things this is careful about:
 *
 * - **`lang={contentLanguage}`** on every piece of pack material, so a Dutch passage is announced
 *   as Dutch by a screen reader and spellchecked as Dutch, even when the interface is English.
 * - **Answer keys stay hidden until asked for.** `exercise.answers` and `dictation.sentences` are
 *   delivered with the lesson (faithful to the source, where answers were printed at the bottom of
 *   the file), but a learner has to choose to look.
 */

'use client';

import { useState } from 'react';
import type { Dictionary } from '@/i18n/dictionaries';
import type { Section } from '@/lib/types';

interface Props {
  section: Section;
  contentLanguage: string;
  dictionary: Dictionary;
  /** Rendered under a section that asks for written answers. */
  answerSlot?: (ref: string, label: string) => React.ReactNode;
}

function SectionShell({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="card">
      {title ? <h2 className="mb-3 text-lg font-semibold tracking-tight">{title}</h2> : null}
      {children}
    </section>
  );
}

/** A disclosure for content the learner should meet only after trying. */
function Reveal({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 border-t border-line pt-3">
      <button type="button" onClick={() => setOpen(!open)} className="btn-ghost px-0 text-sm">
        {open ? '▾' : '▸'} {label}
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
      return (
        <SectionShell title={section.title ?? t.readAloud}>
          <p className="prose-content max-w-prose" lang={lang}>
            {section.body}
          </p>
        </SectionShell>
      );

    case 'rules':
      return (
        <SectionShell title={section.title ?? t.rules}>
          <div className="prose-content max-w-prose" lang={lang}>
            {section.body}
          </div>
        </SectionShell>
      );

    case 'vocabulary':
      return (
        <SectionShell title={section.title ?? t.vocabulary}>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left text-muted">
                  <th className="py-2 pr-4 font-medium">{t.term}</th>
                  <th className="py-2 pr-4 font-medium">{t.translation}</th>
                  <th className="py-2 font-medium">{t.example}</th>
                </tr>
              </thead>
              <tbody>
                {section.items.map((item) => (
                  <tr key={item.term} className="border-b border-line/60 align-top last:border-0">
                    <td className="py-2 pr-4 font-medium" lang={lang}>
                      {item.term}
                    </td>
                    <td className="py-2 pr-4 text-muted">{item.translation}</td>
                    <td className="py-2 text-muted" lang={lang}>
                      {item.example}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionShell>
      );

    case 'questions':
      return (
        <SectionShell title={section.title ?? t.questions}>
          {section.instruction ? (
            <p className="mb-4 text-sm text-muted" lang={lang}>
              {section.instruction}
            </p>
          ) : null}
          <ol className="space-y-5">
            {section.items.map((item) => (
              <li key={item.ref}>
                <p lang={lang}>
                  <span className="mr-2 text-muted">{item.ref}.</span>
                  {item.prompt}
                </p>
                {answerSlot?.(`${section.id}.${item.ref}`, item.prompt)}
              </li>
            ))}
          </ol>
        </SectionShell>
      );

    case 'speak':
      return (
        <SectionShell title={section.title ?? t.speak}>
          <p className="prose-content max-w-prose" lang={lang}>
            {section.prompt}
          </p>
          {section.requirements?.length ? (
            <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-muted" lang={lang}>
              {section.requirements.map((requirement) => (
                <li key={requirement}>{requirement}</li>
              ))}
            </ul>
          ) : null}
          <p className="mt-4 text-sm text-muted">{t.speakHint}</p>
        </SectionShell>
      );

    case 'write':
      return (
        <SectionShell title={section.title ?? t.write}>
          <p className="prose-content max-w-prose" lang={lang}>
            {section.prompt}
          </p>
          {section.requirements?.length ? (
            <>
              <p className="mt-4 text-sm font-medium">{t.requirements}</p>
              <ul className="mt-1 list-inside list-disc space-y-1 text-sm text-muted" lang={lang}>
                {section.requirements.map((requirement) => (
                  <li key={requirement}>{requirement}</li>
                ))}
              </ul>
            </>
          ) : null}
          {answerSlot?.(section.id, section.prompt)}
        </SectionShell>
      );

    case 'listening':
      return (
        <SectionShell title={section.title ?? t.listening}>
          <p className="prose-content max-w-prose" lang={lang}>
            {section.prompt}
          </p>
          {section.sources?.length ? (
            <>
              <p className="mt-4 text-sm font-medium">{t.sources}</p>
              <ul className="mt-1 list-inside list-disc space-y-1 text-sm text-muted" lang={lang}>
                {section.sources.map((source) => (
                  <li key={source.title}>
                    {source.title}
                    {source.note ? ` — ${source.note}` : ''}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </SectionShell>
      );

    case 'dictation':
      return (
        <SectionShell title={section.title ?? t.dictation}>
          {section.prompt ? (
            <p className="prose-content max-w-prose" lang={lang}>
              {section.prompt}
            </p>
          ) : null}
          <p className="mt-3 text-sm text-muted">{t.dictationHint}</p>
          {answerSlot?.(section.id, section.title ?? t.dictation)}
          <Reveal label={t.answers}>
            <ol className="list-inside list-decimal space-y-1 text-sm" lang={lang}>
              {section.sentences.map((sentence) => (
                <li key={sentence}>{sentence}</li>
              ))}
            </ol>
          </Reveal>
        </SectionShell>
      );

    case 'exercise':
      return (
        <SectionShell title={section.title ?? t.exercise}>
          {section.prompt ? (
            <p className="mb-4 text-sm text-muted" lang={lang}>
              {section.prompt}
            </p>
          ) : null}
          <ol className="space-y-5">
            {section.items.map((item) => (
              <li key={item.ref}>
                <p lang={lang}>
                  <span className="mr-2 text-muted">{item.ref}.</span>
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
                    <span className="mr-2 text-muted">{answer.ref}.</span>
                    {answer.answer}
                  </li>
                ))}
              </ol>
            </Reveal>
          ) : null}
        </SectionShell>
      );
  }
}
