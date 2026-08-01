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
    // ADR-0004 / CODEBASE.md: `domain/` is pure. It decides things; it must never reach for I/O,
    // a database handle, or a web framework. Enforced rather than left to review.
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/db/**', '**/services/**', '**/http/**', '**/auth/**'],
              message: 'domain/ must stay pure — no I/O layers.',
            },
            {
              group: ['fastify', 'fastify/*', 'mongodb', 'jose'],
              message: 'domain/ must stay pure — no framework or driver imports.',
            },
          ],
        },
      ],
    },
  },
);
