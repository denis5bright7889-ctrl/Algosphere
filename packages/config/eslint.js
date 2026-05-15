/** @type {import("eslint").Linter.Config} */
module.exports = {
  extends: ['next/core-web-vitals', 'eslint:recommended'],
  plugins: ['@typescript-eslint'],
  parser: '@typescript-eslint/parser',
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'error',
    'no-console': ['warn', { allow: ['warn', 'error'] }],
  },
}
