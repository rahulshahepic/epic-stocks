import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import stylistic from '@stylistic/eslint-plugin'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: { '@stylistic': stylistic },
    rules: {
      // Every .tsx file had its indentation flattened to a single space at all
      // depths, which is how nesting mistakes stayed invisible. Enforced so it
      // cannot come back; `npm run lint -- --fix` re-indents.
      '@stylistic/indent': ['error', 2, { SwitchCase: 1, ignoredNodes: ['TSUnionType', 'TSIntersectionType'] }],
      '@stylistic/jsx-indent-props': ['error', 2],
      // `const { id, version, ...rest } = row` is how this codebase drops columns
      // before a PUT, and `_`-prefixed names say "deliberately unused". Reporting
      // those buried the real findings under a dozen false positives.
      '@typescript-eslint/no-unused-vars': ['error', {
        ignoreRestSiblings: true,
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      // `try { localStorage… } catch {}` — a browser that refuses storage falls
      // through to the default. There is nothing to handle.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
])
