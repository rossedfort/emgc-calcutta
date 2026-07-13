import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

export default ts.config(
	{
		ignores: [
			'**/node_modules/**',
			'**/dist/**',
			'**/build/**',
			'apps/web/.svelte-kit/**',
			'apps/web/.vercel/**',
			'supabase/.temp/**',
			// Deno code — linted separately via `deno lint`/`deno check`, not
			// this frontend config (see .claude/skills/emgc-calcutta-task-workflow).
			'supabase/functions/**'
		]
	},
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	prettier,
	...svelte.configs.prettier,
	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node }
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				parser: ts.parser,
				extraFileExtensions: ['.svelte']
			}
		}
	},
	{
		// shadcn-svelte components are vendored from the registry via its CLI
		// (see .claude/skills/emgc-calcutta-task-workflow) — don't hand-edit
		// them to satisfy app-level rules like requiring resolve() on every
		// href, since their `href` props are generic pass-throughs, not
		// internal SvelteKit links.
		files: ['apps/web/src/lib/components/ui/**'],
		rules: {
			'svelte/no-navigation-without-resolve': 'off'
		}
	}
);
