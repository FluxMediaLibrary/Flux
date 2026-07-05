import nextPlugin from '@next/eslint-plugin-next';

// Flat config (ESLint v9+). Next.js 16 removed `next lint`; lint via ESLint CLI.
export default [
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'],
  },
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    plugins: {
      '@next/next': nextPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
];
