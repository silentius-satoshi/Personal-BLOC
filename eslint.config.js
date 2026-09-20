import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/**', 'dev-dist/**', 'node_modules/**', 'coverage/**', 'playwright-report/**', 'test-results/**'] },
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
      // OFF for now: exactly one site — runAdvisor declares `let btcBought: number;` (:153) and assigns it
      // once at :316, siblings in the same block. ⚠ ESLint reports this shape but CANNOT autofix it
      // (fixableErrors: 0, no `fix` on the message), so enabling the rule means hand-restructuring the
      // advisor engine or carrying a permanent error. Verified by turning it on and running --fix: empty
      // diff, error unchanged. A candidate for the next widening pass, with the restructure done by hand.
      'prefer-const': 'off',
      eqeqeq: ['error', 'smart'],
    },
  },
);
