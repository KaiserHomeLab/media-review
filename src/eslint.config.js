// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KaiserHomeLab
//
// ESLint (development only: `npm run lint`, and on every push in CI). The app itself has no
// npm dependencies; these tools are never installed in the Docker image.
'use strict';
const js = require('@eslint/js');
const globals = require('globals');
const prettier = require('eslint-config-prettier'); // formatting is Prettier's job

const rules = {
  eqeqeq: ['error', 'always', { null: 'ignore' }], // `x == null` (null or undefined) is fine
  'prefer-const': 'error',
  'no-var': 'error',
  'no-unused-vars': ['error', { caughtErrors: 'none', argsIgnorePattern: '^_' }],
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-shadow': ['error', { builtinGlobals: false }],
  'no-throw-literal': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  'no-eval': 'error',
  'no-script-url': 'error',
  'no-return-assign': ['error', 'except-parens'],
  'no-unneeded-ternary': 'error',
  'object-shorthand': ['error', 'properties'],
  'no-useless-concat': 'error',
  'no-lonely-if': 'error',
  'no-else-return': ['error', { allowElseIf: false }],
};

module.exports = [
  { ignores: ['node_modules/**', 'data/**'] },
  { linterOptions: { reportUnusedDisableDirectives: 'error' } },
  js.configs.recommended,
  {
    // Server: Node.js, CommonJS
    files: ['server.js', 'lib/**/*.js', 'test/**/*.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs', globals: { ...globals.node } },
    rules,
  },
  {
    // Web app: classic browser scripts
    files: ['public/**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'script', globals: { ...globals.browser } },
    rules,
  },
  prettier,
];
