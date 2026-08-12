import { error } from '@sveltejs/kit';
import { parsePageSize } from '$lib/pagination';
import type { PageServerLoad } from './$types';
import type { ListUsersResponse } from './types';

export interface UsersFilters {
	search: string;
	roles: string[];
}

function parseUsersFilters(url: URL): UsersFilters {
	return {
		search: url.searchParams.get('search')?.trim() ?? '',
		roles: url.searchParams.getAll('role')
	};
}

function parsePage(raw: string | null): number {
	const n = Number(raw);
	return Number.isInteger(n) && n > 0 ? n : 1;
}

// Phase 35: search/role filtering and pagination both moved server-side,
// into the list-users Edge Function itself rather than this load function —
// unlike Audit Events/Silent Auction Bids, this data doesn't come from a
// direct table query (public.users has no client-readable RLS policy, see
// spec 6.5), so there's no query builder here to extend. Only the "everyone
// else" section (role != 'unassigned') is actually paginated — pending and
// rejected stay full/unpaginated, by design (see the Edge Function's own
// contract comment for why).
export const load: PageServerLoad = async ({ url, locals: { supabase } }) => {
	const filters = parseUsersFilters(url);
	const pageSize = parsePageSize(url.searchParams.get('page_size'));
	const page = parsePage(url.searchParams.get('page'));
	const offset = (page - 1) * pageSize;

	const { data, error: invokeError } = await supabase.functions.invoke<ListUsersResponse>(
		'list-users',
		{
			body: {
				search: filters.search || undefined,
				roles: filters.roles.length > 0 ? filters.roles : undefined,
				limit: pageSize,
				offset
			}
		}
	);
	if (invokeError || !data) {
		error(500, invokeError?.message ?? 'Failed to load users');
	}

	return {
		pending: data.pending,
		rejected: data.rejected,
		others: data.others,
		othersTotal: data.othersTotal,
		filters,
		page,
		pageSize,
		title: 'Users · EMGC Bet',
		description: 'Manage EMGC Bet participant and admin accounts.'
	};
};
