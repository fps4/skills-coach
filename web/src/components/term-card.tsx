/**
 * The rest of a word's card: its example, forms, synonyms and note (ADR-0023).
 *
 * Shown after an answer, never before — the example contains the word, and the forms often do too.
 * Everything here is content, not chrome: it arrives in the pack's languages and is marked up with
 * them, so a Dutch example is read and spellchecked as Dutch whatever the interface is in (ADR-0005).
 */

import type { Dictionary } from '@/i18n/dictionaries';
import type { TermDetails } from '@/lib/types';

interface Props {
  example?: string;
  details?: TermDetails;
  contentLanguage: string;
  translationLanguage: string;
  dictionary: Dictionary;
}

export function TermCard({ example, details, contentLanguage, translationLanguage, dictionary }: Props) {
  const t = dictionary.assist;
  if (!example && !details) return null;

  const rows: { label: string; value: React.ReactNode }[] = [];
  if (details?.partOfSpeech) {
    rows.push({ label: t.partOfSpeech, value: <span lang={translationLanguage}>{details.partOfSpeech}</span> });
  }
  if (details?.forms?.length) {
    rows.push({
      label: t.forms,
      value: (
        <span>
          {details.forms.map((form, index) => (
            <span key={`${form.label}-${index}`}>
              {index > 0 ? ' · ' : null}
              {form.label ? (
                <span className="text-muted-foreground" lang={translationLanguage}>
                  {form.label}{' '}
                </span>
              ) : null}
              <span lang={contentLanguage}>{form.value}</span>
            </span>
          ))}
        </span>
      ),
    });
  }
  if (example) {
    rows.push({
      label: t.example,
      value: (
        <span>
          <span lang={contentLanguage}>{example}</span>
          {details?.exampleTranslation ? (
            <span className="block text-muted-foreground" lang={translationLanguage}>
              {details.exampleTranslation}
            </span>
          ) : null}
        </span>
      ),
    });
  }
  if (details?.synonyms?.length) {
    rows.push({ label: t.synonyms, value: <span lang={contentLanguage}>{details.synonyms.join(', ')}</span> });
  }
  if (details?.antonyms?.length) {
    rows.push({ label: t.antonyms, value: <span lang={contentLanguage}>{details.antonyms.join(', ')}</span> });
  }
  if (details?.note) rows.push({ label: t.note, value: <span lang={translationLanguage}>{details.note}</span> });

  if (rows.length === 0) return null;

  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-md bg-muted/50 px-3 py-2.5 text-sm">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-xs leading-5 text-muted-foreground">{row.label}</dt>
          <dd className="min-w-0 break-words">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
