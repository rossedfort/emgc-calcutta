// See ../../import-csv-confirm/index.ts — the write step, called with the
// (possibly Admin-edited) rows from an ImportCsvPreviewResponse. Note the
// field names here don't exactly match ImportCsvPreviewRow — this is what
// the Admin confirms after reviewing the preview, keyed by userId (singular
// link choice) rather than the preview's matchedUserId/matchedUserEmail
// pair.
export interface ImportCsvConfirmRow {
  name?: string;
  contact_email?: string | null;
  contact_phone?: string | null;
  flight?: string | null;
  preferences?: string | null;
  photo_url?: string | null;
  userId?: string | null;
}

export interface ImportCsvConfirmRequest {
  tournamentId: string;
  rows: ImportCsvConfirmRow[];
}

export interface ImportCsvConfirmResponse {
  count: number;
  players: { id: string; slug: string; name: string }[];
}
