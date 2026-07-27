import { fail } from '@sveltejs/kit';
import { FunctionsHttpError } from '@supabase/supabase-js';
import type {
	ErrorResponse,
	ImportCsvConfirmRequest,
	ImportCsvConfirmResponse,
	ImportCsvPreviewRequest,
	ImportCsvPreviewResponse
} from '@emgc-calcutta/shared-types';
import type { Actions, PageServerLoad } from './$types';

// supabase-js's invoke() wraps any non-2xx response in a FunctionsHttpError
// whose own .message is just a generic "Edge Function returned a non-2xx
// status code" — the function's actual error is in the response body, only
// reachable via .context (the raw Response).
async function extractFunctionError(error: unknown, fallback: string): Promise<string> {
	if (error instanceof FunctionsHttpError) {
		const body = (await error.context.json().catch(() => null)) as ErrorResponse | null;
		if (body?.error) return body.error;
	}
	return error instanceof Error ? error.message : fallback;
}

// Otherwise no own `load` — the tournament comes from the [slug] layout's
// load, merged into this page's `data` automatically.
export const load: PageServerLoad = async ({ parent }) => {
	const { tournament } = await parent();
	return {
		title: `Import players · ${tournament.name} · EMGC Calcutta`,
		description: `Bulk-import players into ${tournament.name} from a CSV file.`
	};
};

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

		const { data, error: invokeError } = await supabase.functions.invoke<ImportCsvPreviewResponse>(
			'import-csv-preview',
			{ body: { tournamentId: tournament.id, csv } satisfies ImportCsvPreviewRequest }
		);

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
		// Client-submitted, not otherwise validated here — import-csv-confirm
		// itself is the authoritative re-check (see its own comments).
		const confirmedRows = rows as ImportCsvConfirmRequest['rows'];

		const { data: tournament } = await supabase
			.from('tournaments')
			.select('id')
			.eq('slug', params.slug)
			.maybeSingle();
		if (!tournament) {
			return fail(404, { step: 'preview' as const, error: 'Tournament not found' });
		}

		const { data, error: invokeError } = await supabase.functions.invoke<ImportCsvConfirmResponse>(
			'import-csv-confirm',
			{
				body: { tournamentId: tournament.id, rows: confirmedRows } satisfies ImportCsvConfirmRequest
			}
		);

		if (invokeError || !data) {
			return fail(400, {
				step: 'preview' as const,
				error: await extractFunctionError(invokeError, 'Failed to import players')
			});
		}

		return { step: 'done' as const, imported: data };
	}
};
