import { createServerClient } from '@supabase/ssr';
import { type Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import type { Database } from '@emgc-calcutta/shared-types';

import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY } from '$env/static/public';

const supabase: Handle = async ({ event, resolve }) => {
	event.locals.supabase = createServerClient<Database>(
		PUBLIC_SUPABASE_URL,
		PUBLIC_SUPABASE_PUBLISHABLE_KEY,
		{
			cookies: {
				getAll: () => event.cookies.getAll(),
				setAll: (cookiesToSet) => {
					cookiesToSet.forEach(({ name, value, options }) => {
						event.cookies.set(name, value, { ...options, path: '/' });
					});
				}
			}
		}
	);

	// getSession() reads the JWT from the cookie without revalidating it — fine
	// for reading claims, but never trust it for authorization decisions. Use
	// safeGetSession() (below) instead, which calls getUser() to have GoTrue
	// verify the JWT against the auth server before trusting it.
	event.locals.safeGetSession = async () => {
		const {
			data: { session }
		} = await event.locals.supabase.auth.getSession();
		if (!session) {
			return { session: null, user: null };
		}

		const {
			data: { user },
			error
		} = await event.locals.supabase.auth.getUser();
		if (error) {
			// JWT didn't validate — don't trust the cookie's session claims.
			return { session: null, user: null };
		}

		return { session, user };
	};

	return resolve(event, {
		filterSerializedResponseHeaders(name) {
			return name === 'content-range' || name === 'x-supabase-api-version';
		}
	});
};

// Route-level authorization (role checks, protected sections) is out of
// scope here — that's the Role management UI / RLS policies backlog items.
// This just makes session/user available to every load function and route.
const populateSession: Handle = async ({ event, resolve }) => {
	const { session, user } = await event.locals.safeGetSession();
	event.locals.session = session;
	event.locals.user = user;

	return resolve(event);
};

export const handle: Handle = sequence(supabase, populateSession);
