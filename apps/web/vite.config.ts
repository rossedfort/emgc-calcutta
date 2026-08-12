import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-vercel';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter(),
			// Without a pollInterval, SvelteKit only notices a new deployment
			// reactively (a stale client's next navigation fails to resolve a
			// chunk and falls back to a hard reload) — fine for someone
			// actively clicking around, but a tab left open and idle (the
			// live-auction TV display especially, which runs unattended for
			// hours with no one there to navigate or refresh) would never
			// find out. Polling makes `updated.current` (see
			// UpdateBanner.svelte) go true in the background instead of only
			// at the next navigation attempt.
			version: {
				pollInterval: 60_000
			}
		})
	],
	test: {
		environment: 'node',
		include: ['src/**/*.{test,spec}.ts']
	}
});
