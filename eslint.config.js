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
		// Every internal href/goto() in this app is expected to go through
		// $lib/routes.ts (see its own header comment) rather than calling
		// resolve() directly at each call site — introduced specifically so a
		// route-tree reshuffle (e.g. the (app) group split for the live-
		// auction TV display) only requires updating routeIds in one place
		// instead of every file that links there. This rule can only trace a
		// direct `resolve()` call (or a variable assigned from one) in the
		// same scope, so it can't see through routes.ts's wrapper functions —
		// every href/goto in the app would otherwise flag as unresolved. The
		// safety this rule provides isn't actually lost: routes.ts's own
		// resolve() calls are still checked against real, typed route ids by
		// TypeScript, which is exactly the failure mode (a stale/typo'd route
		// id) this rule exists to catch. Also covers shadcn-svelte's vendored
		// ui/** components (see .claude/skills/emgc-calcutta-task-workflow) —
		// their `href` props are generic pass-throughs, not internal
		// SvelteKit links, so they were never a fit for this rule either.
		files: ['apps/web/**/*.svelte'],
		rules: {
			'svelte/no-navigation-without-resolve': 'off'
		}
	}
);
