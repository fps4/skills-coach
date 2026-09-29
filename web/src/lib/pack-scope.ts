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
  Cloud,
  Dumbbell,
  LayoutDashboard,
  ListChecks,
  Newspaper,
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
 * A surface that hangs under a pack in the rail.
 *
 * `progress` is missing on purpose (ADR-0018): it is no longer an item beside the others, it is what
 * the pack itself lands on. The api still accepts it in a manifest's `surfaces` so packs published
 * before that change keep publishing — it simply moves nothing.
 */
export type RailSurface = Exclude<PackSurface, 'progress'>;

/**
 * Every surface the platform can render, in the order the rail shows them.
 *
 * A pack's declared list is filtered through this, never sorted by it: order is the product's, not
 * the pack's. Declaring surfaces is how a pack opts *out* of one, which is why omitting the key
 * means all of them.
 */
export const DEFAULT_SURFACES: RailSurface[] = ['lessons', 'reading', 'drills:terms', 'drills:word-order', 'quiz'];

/**
 * What a pack *has*, counted across the whole pack rather than the block in front of the learner
 * (ADR-0019).
 *
 * Every count here is pack-wide and learner-scoped, which is exactly how the progress payload
 * already reports them — so a surface's presence is a property of the pack, not of where the learner
 * happens to be in it, and the rail does not reshuffle as they move from block to block.
 */
export interface PackMaterial {
  /** Blocks of this pack the learner can see; a pack whose blocks are all someone else's has none (ADR-0015). */
  blocks: number;
  terms: number;
  wordOrder: number;
  quiz: number;
  /** Articles in this learner's library for the pack (ADR-0017). */
  reading: number;
}

/** Where a surface opens from. Only ever built inside a pack, so `packId` is known. */
export interface SurfaceContext {
  locale: string;
  packId: string;
  currentBlockId: string | null;
}

export interface SurfaceDef {
  icon: LucideIcon;
  /** A key in the `nav` dictionary — chrome, never pack content (ADR-0005). */
  labelKey: keyof Dictionary['nav'];
  /**
   * Does this pack do this at all?
   *
   * The presence gate (ADR-0019). False means the pack has no material of this kind anywhere, so
   * the item is absent rather than greyed out — a certification pack has no vocabulary and never
   * should have shown a word trainer. Adding a surface means answering this question here and
   * nowhere else.
   */
  has: (material: PackMaterial) => boolean;
  /**
   * Where it opens *right now*, or null when there is material but nothing to open yet — a pack
   * whose next block has not been published, say. That renders disabled, which is a different
   * statement from "this pack does not do this" and reads differently.
   */
  href: (context: SurfaceContext) => string | null;
}

/**
 * Every surface belongs to a pack, so every one of these is rendered under a pack and nowhere else
 * (ADR-0018). Outside a pack there is nothing to show but the packs themselves.
 *
 * Each entry answers the same two questions — *does this pack have any?* and *where does it open?* —
 * and a new surface is a new entry, never a branch somewhere else. That is the whole extension
 * point: nothing here or downstream knows which pack it is looking at.
 */
export const SURFACES: Record<RailSurface, SurfaceDef> = {
  lessons: {
    icon: Dumbbell,
    labelKey: 'lessons',
    has: ({ blocks }) => blocks > 0,
    href: ({ locale, currentBlockId }) => (currentBlockId ? `/${locale}/blocks/${currentBlockId}` : null),
  },
  /**
   * The learner's own library (ADR-0017).
   *
   * Pack-scoped but **not** block-scoped: reading material is loaded against a pack rather than
   * against whichever block is open, so it does not come and go as the learner moves through the
   * program. A pack nobody has loaded an article into does not read.
   */
  reading: {
    icon: Newspaper,
    labelKey: 'reading',
    has: ({ reading }) => reading > 0,
    href: ({ locale, packId }) => `/${locale}/reading?packId=${encodeURIComponent(packId)}`,
  },
  'drills:terms': {
    icon: Sparkles,
    labelKey: 'words',
    has: ({ terms }) => terms > 0,
    href: ({ locale, currentBlockId }) => (currentBlockId ? `/${locale}/drills/words?blockId=${currentBlockId}` : null),
  },
  'drills:word-order': {
    icon: Puzzle,
    labelKey: 'sentences',
    has: ({ wordOrder }) => wordOrder > 0,
    href: ({ locale, currentBlockId }) => (currentBlockId ? `/${locale}/drills/sentences?blockId=${currentBlockId}` : null),
  },
  quiz: {
    icon: ListChecks,
    labelKey: 'quiz',
    has: ({ quiz }) => quiz > 0,
    href: ({ locale, currentBlockId }) => (currentBlockId ? `/${locale}/quiz?blockId=${currentBlockId}` : null),
  },
};

/**
 * Where a pack lands (ADR-0018).
 *
 * Its progress — the decks, the error log, what to do next — because that is what the learner needs
 * on arriving at a pack they are already working through. The block list stays one click away on the
 * pack page, which is what the landing tiles link to.
 */
export function packLanding(locale: string, packId: string): string {
  return `/${locale}/progress?packId=${encodeURIComponent(packId)}`;
}

/**
 * Which surfaces the rail shows under a pack: the ones it *offers* and actually *has*, in the
 * platform's order rather than the order the pack listed them (ADR-0019).
 *
 * `declared` being undefined means the pack said nothing, which means all of them: a manifest opts
 * out of a surface, never in. A key the rail no longer renders — `progress`, which is now the pack's
 * own landing — is ignored rather than refused, so a manifest written against ADR-0009 still
 * publishes.
 *
 * Declaring is intent and the material is reality; an item needs both. It is why a pack that simply
 * has no questions never shows a practice test, without its author having to remember to say so.
 */
export function visibleSurfaces(declared: PackSurface[] | undefined, material: PackMaterial): RailSurface[] {
  const offered: PackSurface[] = declared ?? DEFAULT_SURFACES;
  return DEFAULT_SURFACES.filter((id) => offered.includes(id) && SURFACES[id].has(material));
}

/** One tab along the top of a skill's page (ADR-0021). */
export interface SkillTab {
  id: 'overview' | RailSurface;
  icon: LucideIcon;
  labelKey: keyof Dictionary['nav'];
  /** Null renders the tab disabled: the skill has this, there is simply nothing to open right now. */
  href: string | null;
}

/**
 * The tabs of a skill's page: its overview, then every surface it offers and has.
 *
 * These used to hang under the pack in the rail (ADR-0018). They moved here when the rail became
 * folders of skills, because a third level of nesting in a sidebar is where menus stop being
 * readable — and a skill's surfaces are about *that* skill, so its own page is where they belong.
 * Which surfaces appear is still `visibleSurfaces`, so the rules of ADR-0019 are unchanged.
 */
export function skillTabs(
  locale: string,
  skill: { packId: string; currentBlockId: string | null; surfaces?: PackSurface[]; material: PackMaterial },
): SkillTab[] {
  const context = { locale, packId: skill.packId, currentBlockId: skill.currentBlockId };
  return [
    { id: 'overview', icon: LayoutDashboard, labelKey: 'overview', href: packLanding(locale, skill.packId) },
    ...visibleSurfaces(skill.surfaces, skill.material).map((id) => ({
      id,
      icon: SURFACES[id].icon,
      labelKey: SURFACES[id].labelKey,
      href: SURFACES[id].href(context),
    })),
  ];
}

/**
 * Which tab a path belongs to.
 *
 * By route rather than by exact href, because most surfaces open on more than one page — the lessons
 * tab covers the pack's block list, a block, a lesson and the session log a lesson produced.
 */
export function activeTab(pathname: string): SkillTab['id'] | null {
  const segments = pathname.split('/').filter(Boolean);
  const rest = segments.length > 0 && segments[0]?.length === 2 ? segments.slice(1) : segments;
  const [head, tail] = rest;

  if (head === 'progress') return 'overview';
  if (head === 'packs' || head === 'blocks' || head === 'lessons' || head === 'sessions') return 'lessons';
  if (head === 'reading') return 'reading';
  if (head === 'quiz') return 'quiz';
  if (head === 'drills' && tail === 'words') return 'drills:terms';
  if (head === 'drills' && tail === 'sentences') return 'drills:word-order';
  return null;
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
 * The pack a path belongs to, or null where the URL does not name one (a session log, the landing
 * page itself — which is generic by design).
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
  // An article is `${packId}.r…`, so a URL naming one already carries its pack; the library itself
  // names the pack directly, because it belongs to no block.
  if (head === 'reading') return tail ? packIdFromEntityId(tail) : (search?.get('packId') ?? null);
  // A pack's landing page (ADR-0018). It names the pack in the query, because progress belongs to a
  // pack without belonging to any block of it.
  if (head === 'progress') return search?.get('packId') ?? null;
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
