import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // `supabase/functions` is Deno and TypeScript, deployed rather than bundled.
  // It escapes linting today only because no `files` glob below matches `.ts` --
  // saying so out loud means a future config that does match one fails on Deno
  // globals instead of silently pulling a file this project never builds.
  globalIgnores(['dist', 'supabase/functions']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    files: ['src/sw.js'],
    languageOptions: {
      globals: { ...globals.serviceworker },
    },
  },
])
