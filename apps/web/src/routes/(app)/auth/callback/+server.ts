import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals: { supabase } }) => {
	const code = url.searchParams.get('code');
	const next = url.searchParams.get('next') ?? '/';

	if (code) {
		const { error } = await supabase.auth.exchangeCodeForSession(code);
		if (!error) {
			// Best-effort: promotes the caller to 'owner' if their email matches
			// OWNER_EMAIL (see spec 4.1, bootstrap-owner Edge Function). A
			// failure here shouldn't block sign-in.
			const { error: bootstrapError } = await supabase.functions.invoke('bootstrap-owner');
			if (bootstrapError) {
				console.error('bootstrap-owner invocation failed:', bootstrapError);
			}

			redirect(303, next);
		}
	}

	redirect(303, '/login?auth_error=1');
};
