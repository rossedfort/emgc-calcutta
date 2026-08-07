// See ../../import-csv-confirm/index.ts — the write step, called with the
// (possibly Admin-edited) rows from an ImportCsvPreviewResponse. A newly
// added row (no `id`) never carries a user link — self-service linking
// (Phase 10) is the only way a Player gets connected to a User, so every
// CSV-added player starts unlinked; an updated row (has `id`) leaves an
// existing link untouched, since linking isn't a CSV-editable field.
export interface ImportCsvConfirmRow {
  // Present = update this existing player; absent/blank = insert a new one.
  id?: string;
  first_name?: string;
  last_name?: string;
  flight?: string | null;
  handicap_index?: number | null;
  preferences?: string | null;
  photo_url?: string | null;
}

export interface ImportCsvConfirmRequest {
  tournamentId: string;
  rows: ImportCsvConfirmRow[];
}

export interface ImportCsvConfirmRowError {
  id: string;
  error: string;
}

export interface ImportCsvConfirmResponse {
  addedCount: number;
  updatedCount: number;
  players: {
    id: string;
    slug: string;
    first_name: string;
    last_name: string;
    action: "added" | "updated";
  }[];
  // Update rows are applied independently, not as one all-or-nothing
  // batch (see index.ts) — a row that fails (player deleted since preview,
  // bid activity newly appeared) is skipped and reported here rather than
  // discarding every other row's successful update.
  rowErrors: ImportCsvConfirmRowError[];
}
