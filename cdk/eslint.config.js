// @ts-check
const tseslint = require('typescript-eslint');
const prettier = require('eslint-config-prettier');

module.exports = tseslint.config(
  {
    ignores: ['dist/**', 'cdk.out/**', 'node_modules/**'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['lib/**/*.ts', 'test/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
      },
    },
  },
  {
    // Plain CommonJS config files: don't type-check, and allow require().
    files: ['*.js'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      sourceType: 'commonjs',
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  // Keep prettier last so it disables any formatting-related lint rules.
  prettier,
);
