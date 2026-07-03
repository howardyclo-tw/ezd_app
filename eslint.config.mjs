import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** @type {import('eslint').Linter.Config[]} */
const nextCoreWebVitals = require('eslint-config-next/core-web-vitals');

/** @type {import('eslint').Linter.Config[]} */
const nextTypescript = require('eslint-config-next/typescript');

/** @type {import('eslint').Linter.Config[]} */
export default [
  // Next.js core-web-vitals preset (includes base Next + react + jsx-a11y + import)
  ...nextCoreWebVitals,

  // TypeScript preset (typescript-eslint recommended + Next.js overrides)
  ...nextTypescript,

  // Additional project ignores
  {
    ignores: [
      '.next/**',
      'out/**',
      'build/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
    ],
  },
];
