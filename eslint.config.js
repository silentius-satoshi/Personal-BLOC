import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/**', 'dev-dist/**', 'node_modules/**', 'coverage/**', 'playwright-report/**', 'test-results/**', 'Claude outputs/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Vercel serverless functions: plain Node ESM/CJS, not part of the TS program.
  {
    files: ['api/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node, ...globals.serviceworker } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // TS already resolves identifiers; the core rule only produces false positives in a TS project.
      'no-undef': 'off',
      // `any` at the untrusted-input boundary (migrate/validate) is deliberate. Its own mission, later.
      '@typescript-eslint/no-explicit-any': 'off',
      // The `_`-prefix strip idiom (persistConfig, payloads) is intentional and load-bearing.
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_', ignoreRestSiblings: true,
      }],
      // `cond ? localStorage.setItem(…) : localStorage.removeItem(…)` as a statement is a deliberate
      // idiom in the gate/credential-key write-throughs (identitySlice, uiSlice) — both branches are
      // real calls. Rewriting that code to satisfy a style rule is the wrong trade in a commit whose
      // stated purpose is "add a lint config".
      '@typescript-eslint/no-unused-expressions': ['error', { allowTernary: true }],
      'react-hooks/rules-of-hooks': 'error',
      'no-constant-condition': 'error',
      // OFF for now. Its one site was runAdvisor's `let btcBought` (declared, then assigned once — a shape ESLint reports
      // but can't autofix), and it left with the engine in 5e (D5-A): measured then, the rule reports nothing on the
      // tree. Turning it on is a gate change, so it waits for the next widening pass.
      'prefer-const': 'off',
      eqeqeq: ['error', 'smart'],
    },
  },
);
