import { createBrowserClient, createServerClient, isBrowser } from '@supabase/ssr';
import type { Database } from '@emgc-calcutta/shared-types';

import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY } from '$env/static/public';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ data, depends, fetch }) => {
	depends('supabase:auth');

	const supabase = isBrowser()
		? createBrowserClient<Database>(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
				global: { fetch }
			})
		: createServerClient<Database>(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
				global: { fetch },
				cookies: { getAll: () => data.cookies }
			});

	const {
		data: { session }
	} = await supabase.auth.getSession();

	return { ...data, supabase, session };
};
