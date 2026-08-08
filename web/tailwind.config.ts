import type { Config } from 'tailwindcss';

/**
 * Semantic colours resolve to the CSS-variable tokens in `src/app/globals.css`.
 *
 * Components only ever name the *role* — `bg-background`, `text-primary`, `border-border` — never
 * a colour. Re-skinning the whole app is a change to the token values and nothing else.
 *
 * The `<alpha-value>` placeholder is what lets opacity modifiers work (`bg-primary/90`,
 * `bg-success/15`), which is why the tokens are stored as bare HSL channels rather than as
 * finished colours.
 */
const token = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: token('border'),
        input: token('input'),
        ring: token('ring'),
        background: token('background'),
        foreground: token('foreground'),
        card: { DEFAULT: token('card'), foreground: token('card-foreground') },
        muted: { DEFAULT: token('muted'), foreground: token('muted-foreground') },
        primary: { DEFAULT: token('primary'), foreground: token('primary-foreground') },
        accent: { DEFAULT: token('accent'), foreground: token('accent-foreground') },
        success: { DEFAULT: token('success'), foreground: token('success-foreground') },
        destructive: { DEFAULT: token('destructive'), foreground: token('destructive-foreground') },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 4px)',
        sm: 'calc(var(--radius) - 8px)',
      },
      boxShadow: {
        card: '0 8px 30px rgba(0,0,0,0.25)',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      maxWidth: {
        prose: '68ch',
      },
    },
  },
  // Typography supplies the rhythm for wiki articles; its colours are re-pointed at the tokens in
  // `globals.css` (`.wiki-prose`), so it does not introduce a second palette.
  plugins: [require('@tailwindcss/typography')],
} satisfies Config;
