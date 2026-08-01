/**
 * The colour-palette axis — a second dimension over the token theme in `globals.css`.
 *
 * The theme axis (`data-theme`) drives every neutral surface and swaps dark against light. A
 * palette overrides only the *hue* tokens — primary, accent, ring and their foregrounds — leaving
 * the neutrals and the status colours shared. The two compose:
 *
 *   data-theme="dark|light"  ×  data-palette="orange|blue|emerald|violet"
 *
 * The default palette's values equal `globals.css`, so out of the box nothing changes.
 *
 * Values are HSL channels to match the token convention; Tailwind wraps them as
 * `hsl(var(--token))`. The active palette is a `data-palette` attribute on `<html>`, set before
 * paint by the init script in the locale layout and changed by the palette picker.
 */

export type PaletteTokens = {
  primary: string;
  'primary-foreground': string;
  accent: string;
  'accent-foreground': string;
  ring: string;
};

export type Palette = {
  id: string;
  label: string;
  /** A finished CSS colour, for the swatch in the picker. */
  swatch: string;
  dark: PaletteTokens;
  light: PaletteTokens;
};

export const DEFAULT_PALETTE = 'orange';

export const PALETTES: Palette[] = [
  {
    id: 'orange',
    label: 'Orange',
    swatch: 'hsl(33 100% 50%)',
    dark: {
      primary: '33 100% 50%',
      'primary-foreground': '30 80% 8%',
      accent: '33 100% 66%',
      'accent-foreground': '30 80% 8%',
      ring: '33 100% 50%',
    },
    light: {
      primary: '33 100% 50%',
      'primary-foreground': '30 80% 8%',
      accent: '33 100% 60%',
      'accent-foreground': '30 80% 8%',
      ring: '33 100% 50%',
    },
  },
  {
    id: 'blue',
    label: 'Blue',
    swatch: 'hsl(217 91% 52%)',
    dark: {
      primary: '213 94% 68%',
      'primary-foreground': '222 47% 11%',
      accent: '217 33% 24%',
      'accent-foreground': '213 94% 82%',
      ring: '213 94% 68%',
    },
    light: {
      primary: '217 91% 45%',
      'primary-foreground': '0 0% 100%',
      accent: '214 95% 93%',
      'accent-foreground': '217 91% 30%',
      ring: '217 91% 55%',
    },
  },
  {
    id: 'emerald',
    label: 'Emerald',
    swatch: 'hsl(160 84% 36%)',
    dark: {
      primary: '158 64% 52%',
      'primary-foreground': '160 30% 8%',
      accent: '158 40% 18%',
      'accent-foreground': '158 64% 72%',
      ring: '158 64% 52%',
    },
    light: {
      primary: '160 84% 32%',
      'primary-foreground': '0 0% 100%',
      accent: '152 76% 92%',
      'accent-foreground': '160 84% 25%',
      ring: '160 84% 39%',
    },
  },
  {
    id: 'violet',
    label: 'Violet',
    swatch: 'hsl(262 83% 58%)',
    dark: {
      primary: '258 90% 76%',
      'primary-foreground': '260 30% 10%',
      accent: '263 40% 24%',
      'accent-foreground': '258 90% 86%',
      ring: '258 90% 76%',
    },
    light: {
      primary: '262 83% 58%',
      'primary-foreground': '0 0% 100%',
      accent: '270 100% 96%',
      'accent-foreground': '262 83% 40%',
      ring: '262 83% 58%',
    },
  },
];

function declarations(tokens: PaletteTokens): string {
  return (Object.keys(tokens) as (keyof PaletteTokens)[]).map((key) => `--${key}: ${tokens[key]};`).join(' ');
}

/**
 * Static CSS for every palette, emitted once into `<head>`. Dark values sit on
 * `[data-palette="x"]`; light values on `[data-theme="light"][data-palette="x"]`, so they compose
 * with the theme attribute. Adding a palette therefore needs no build step.
 */
export function paletteStylesheet(): string {
  return PALETTES.map(
    (palette) =>
      `[data-palette="${palette.id}"] { ${declarations(palette.dark)} }\n` +
      `[data-theme="light"][data-palette="${palette.id}"] { ${declarations(palette.light)} }`,
  ).join('\n');
}
