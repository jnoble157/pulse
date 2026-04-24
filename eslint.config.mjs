// @ts-check
import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import prettier from 'eslint-config-prettier';

const nodeGlobals = {
  process: 'readonly',
  console: 'readonly',
  Buffer: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  clearImmediate: 'readonly',
  queueMicrotask: 'readonly',
  global: 'readonly',
  fetch: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  // Web Crypto / Web Streams — available on both Edge and Node 20+.
  crypto: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  ReadableStream: 'readonly',
  WritableStream: 'readonly',
  TransformStream: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  performance: 'readonly',
};

const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  HTMLElement: 'readonly',
  HTMLInputElement: 'readonly',
  HTMLButtonElement: 'readonly',
  HTMLFormElement: 'readonly',
  HTMLAudioElement: 'readonly',
  HTMLDivElement: 'readonly',
  Element: 'readonly',
  Event: 'readonly',
  MouseEvent: 'readonly',
  KeyboardEvent: 'readonly',
  CustomEvent: 'readonly',
  FormData: 'readonly',
  FileList: 'readonly',
  File: 'readonly',
  Blob: 'readonly',
  Response: 'readonly',
  Request: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  React: 'readonly',
  JSX: 'readonly',
  EventSource: 'readonly',
  MessageEvent: 'readonly',
};

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
      'infra/drizzle/meta/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: { ...nodeGlobals, ...browserGlobals, React: 'readonly' },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@anthropic-ai/sdk', '@anthropic-ai/sdk/*', 'openai', 'openai/*'],
              message: 'Use llm.call() from @pulse/telemetry. See AGENTS.md §Hard invariants #2.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/telemetry/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/tests/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  prettier,
];
