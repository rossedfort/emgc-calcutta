import { fail } from '@sveltejs/kit';
import { FunctionsHttpError } from '@supabase/supabase-js';
import type { Actions } from './$types';

// supabase-js's invoke() wraps any non-2xx response in a FunctionsHttpError
// whose own .message is just a generic "Edge Function returned a non-2xx
// status code" — the function's actual error is in the response body, only
// reachable via .context (the raw Response).
async function extractFunctionError(error: unknown, fallback: string): Promise<string> {
	if (error instanceof FunctionsHttpError) {
		const body = await error.context.json().catch(() => null);
		if (body?.error) return body.error;
	}
	return error instanceof Error ? error.message : fallback;
}

export interface PreviewRow {
	rowNumber: number;
	name: string | null;
	contact_email: string | null;
	contact_phone: string | null;
	flight: string | null;
	preferences: string | null;
	photo_url: string | null;
	errors: string[];
	matchedUserId: string | null;
	matchedUserEmail: string | null;
}

// No own `load` — the tournament comes from the [slug] layout's load, merged
// into this page's `data` automatically.
export const actions: Actions = {
	preview: async ({ request, params, locals: { supabase } }) => {
		const formData = await request.formData();
		const file = formData.get('file');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { step: 'upload' as const, error: 'Choose a CSV file to upload' });
		}

		const { data: tournament } = await supabase
			.from('tournaments')
			.select('id')
			.eq('slug', params.slug)
			.maybeSingle();
		if (!tournament) {
			return fail(404, { step: 'upload' as const, error: 'Tournament not found' });
		}

		const csv = await file.text();

		const { data, error: invokeError } = await supabase.functions.invoke<{
			rows: PreviewRow[];
			validCount: number;
			errorCount: number;
		}>('import-csv-preview', { body: { tournamentId: tournament.id, csv } });

		if (invokeError || !data) {
			return fail(400, {
				step: 'upload' as const,
				error: await extractFunctionError(invokeError, 'Failed to parse CSV')
			});
		}

		return { step: 'preview' as const, preview: data };
	},

	confirm: async ({ request, params, locals: { supabase } }) => {
		const formData = await request.formData();
		const rowsRaw = formData.get('rows');

		let rows: unknown;
		try {
			rows = typeof rowsRaw === 'string' ? JSON.parse(rowsRaw) : null;
		} catch {
			rows = null;
		}
		if (!Array.isArray(rows) || rows.length === 0) {
			return fail(400, { step: 'preview' as const, error: 'Select at least one row to import' });
		}

		const { data: tournament } = await supabase
			.from('tournaments')
			.select('id')
			.eq('slug', params.slug)
			.maybeSingle();
		if (!tournament) {
			return fail(404, { step: 'preview' as const, error: 'Tournament not found' });
		}

		const { data, error: invokeError } = await supabase.functions.invoke<{
			count: number;
			players: { id: string; slug: string; name: string }[];
		}>('import-csv-confirm', { body: { tournamentId: tournament.id, rows } });

		if (invokeError || !data) {
			return fail(400, {
				step: 'preview' as const,
				error: await extractFunctionError(invokeError, 'Failed to import players')
			});
		}

		return { step: 'done' as const, imported: data };
	}
};
