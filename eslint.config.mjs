import tseslint from 'typescript-eslint';

export default [
  { ignores: ['.next/**', 'node_modules/**', 'dist/**', 'coverage/**'] },
  tseslint.configs.base,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: { '@typescript-eslint/no-explicit-any': 'off' }
  }
];
