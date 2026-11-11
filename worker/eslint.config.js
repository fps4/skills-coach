import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // `card.ts` is the specification of what a suggestion may contain; it stays free of I/O so the
    // tests can read it as one.
    files: ['src/card.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['@anthropic-ai/*', 'node:*'], message: 'card.ts must stay pure — no I/O.' }] },
      ],
    },
  },
);
