/**
 * Which pack a URL is inside, and what that pack offers.
 *
 * This is the registry half of [ADR-0009](../../docs/architecture/decisions/0009-per-pack-presentation-is-declarative.md):
 * a pack *declares* keys, and this file is the only place that turns them into chrome. Nothing here
 * — and nothing downstream of it — branches on which pack it is. An unrecognised palette or icon
 * falls back; an unrecognised surface cannot get this far, because the api refuses it at publish.
 *
 * Pure and React-free on purpose: the middleware imports it to resolve the pack before render, and
 * the rail imports it to resolve the pack again after a client navigation. One derivation, two
 * callers, no chance of the two disagreeing.
 */

import {
  BookOpen,
  Briefcase,
  GraduationCap,
  Languages,
  MessageCircle,
  Sparkles,
  BarChart3,
  Cloud,
  Dumbbell,
  ListChecks,
  Puzzle,
  ShieldCheck,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { DEFAULT_PALETTE, PALETTES } from '@/lib/theme/palettes';
import type { Dictionary } from '@/i18n/dictionaries';
import type { PackSurface } from '@/lib/types';

/**
 * The request header the middleware writes the resolved pack into.
 *
 * The shell renders above the segment that names the pack, so this is how the *first* paint learns
 * which pack it is in. Everything after that is resolved on the client, where navigations are
 * observable — see `components/pack-palette-sync.tsx`.
 */
export const PACK_HEADER = 'x-sc-pack';

/**
 * Every surface the platform can render, in the order the rail shows them.
 *
 * A pack's declared list is filtered through this, never sorted by it: order is the product's, not
 * the pack's. Declaring surfaces is how a pack opts *out* of one, which is why omitting the key
 * means all of them.
 */
export const DEFAULT_SURFACES: PackSurface[] = ['lessons', 'drills:terms', 'drills:word-order', 'quiz', 'progress'];

export interface DeckTotals {
  terms: number;
  wordOrder: number;
  quiz: number;
}

export interface SurfaceContext {
  locale: string;
  currentBlockId: string | null;
  decks: DeckTotals;
}

export interface SurfaceDef {
  icon: LucideIcon;
  /** A key in the `nav` dictionary — chrome, never pack content (ADR-0005). */
  labelKey: keyof Dictionary['nav'];
  /** Rendered indented under the surface above it. */
  sub?: boolean;
  /**
   * Belongs to a pack, so it does not exist outside one.
   *
   * The landing page is the product's, not any pack's: it lists packs and nothing else. A surface
   * marked here is absent there — not greyed out, absent — because an item you cannot use and did
   * not ask for is worse than no item.
   */
  packScoped: boolean;
  /**
   * Null disables the item *within* a pack: it is offered, there is simply nothing to practise yet.
   * That is a different statement from not being offered at all, and it reads differently.
   */
  href: (context: SurfaceContext) => string | null;
}

export const SURFACES: Record<PackSurface, SurfaceDef> = {
  lessons: {
    icon: Dumbbell,
    labelKey: 'lessons',
    packScoped: true,
    href: ({ locale, currentBlockId }) => (currentBlockId ? `/${locale}/blocks/${currentBlockId}` : null),
  },
  'drills:terms': {
    icon: Sparkles,
    labelKey: 'words',
    sub: true,
    packScoped: true,
    // Offered by the manifest, enabled by the deck: a block with no terms yet disables rather than hides.
    href: ({ locale, currentBlockId, decks }) =>
      currentBlockId && decks.terms > 0 ? `/${locale}/drills/words?blockId=${currentBlockId}` : null,
  },
  'drills:word-order': {
    icon: Puzzle,
    labelKey: 'sentences',
    sub: true,
    packScoped: true,
    href: ({ locale, currentBlockId, decks }) =>
      currentBlockId && decks.wordOrder > 0 ? `/${locale}/drills/sentences?blockId=${currentBlockId}` : null,
  },
  quiz: {
    icon: ListChecks,
    labelKey: 'quiz',
    sub: true,
    packScoped: true,
    href: ({ locale, currentBlockId, decks }) =>
      currentBlockId && decks.quiz > 0 ? `/${locale}/quiz?blockId=${currentBlockId}` : null,
  },
  progress: {
    icon: BarChart3,
    labelKey: 'progress',
    // Spans every pack the learner has, so it survives outside one.
    packScoped: false,
    href: ({ locale }) => `/${locale}/progress`,
  },
};

/**
 * Which surfaces the rail shows.
 *
 * Outside a pack, only what spans packs — the landing page is the product's, not any pack's, and an
 * item you cannot use and did not ask for is worse than no item. Inside one, whatever that pack
 * declares, filtered through the platform's order rather than sorted by the pack's.
 *
 * `declared` being undefined means the pack said nothing, which means all of them: a pack opts out
 * of a surface, never in.
 */
export function visibleSurfaces(packInScope: boolean, declared: PackSurface[] | undefined): PackSurface[] {
  const offered = declared ?? DEFAULT_SURFACES;
  return DEFAULT_SURFACES.filter((id) => (SURFACES[id].packScoped ? packInScope && offered.includes(id) : true));
}

/** Icons a pack may name for its tile. Unknown keys fall back — losing an icon must not lose a tile. */
const PACK_ICONS: Record<string, LucideIcon> = {
  'message-circle': MessageCircle,
  'book-open': BookOpen,
  'graduation-cap': GraduationCap,
  briefcase: Briefcase,
  languages: Languages,
  sparkles: Sparkles,
  cloud: Cloud,
  'shield-check': ShieldCheck,
  'list-checks': ListChecks,
};

export function packIcon(key: string | undefined): LucideIcon {
  return (key && PACK_ICONS[key]) || BookOpen;
}

/**
 * The pack a path belongs to, or null where the URL does not name one (`/progress`, a session log,
 * the landing page itself — which is generic by design).
 *
 * Identifiers carry it: a block is `${packId}.b${order}` and a lesson `${blockId}.l${order}`
 * (`api/src/services/context.ts`), and a packId is slug-shaped with no dots, so the pack is
 * everything before the first one.
 */
export function packIdFromUrl(pathname: string, search?: URLSearchParams | null): string | null {
  const segments = pathname.split('/').filter(Boolean);
  // Drop the locale segment when there is one; every app URL carries it.
  const rest = segments.length > 0 && segments[0]?.length === 2 ? segments.slice(1) : segments;
  const [head, tail] = rest;

  if (head === 'packs' && tail) return tail;
  if ((head === 'blocks' || head === 'lessons') && tail) return packIdFromEntityId(tail);
  // Both of these name their block in the query rather than the path, so that is where the pack is.
  if (head === 'drills' || head === 'quiz') {
    const blockId = search?.get('blockId');
    return blockId ? packIdFromEntityId(blockId) : null;
  }
  return null;
}

function packIdFromEntityId(id: string): string | null {
  const packId = id.split('.')[0];
  // No dot means this is not an id this runtime minted; claiming a pack from it would be a guess.
  return packId && packId !== id ? packId : null;
}

/**
 * Which hue applies: an explicit choice, then the pack's, then the default.
 *
 * `sc.palette` is written only when the learner picks one, so its presence already means "they
 * chose" — which is what lets a pack colour the app without ever overriding a person.
 */
export function resolvePalette(pinned: string | null | undefined, packPalette: string | undefined): string {
  const known = (id: string | null | undefined): string | null => (id && PALETTES.some((entry) => entry.id === id) ? id : null);

  return known(pinned) ?? known(packPalette) ?? DEFAULT_PALETTE;
}
