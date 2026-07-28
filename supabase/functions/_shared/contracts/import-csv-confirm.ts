// See ../../import-csv-confirm/index.ts — the write step, called with the
// (possibly Admin-edited) rows from an ImportCsvPreviewResponse. A row never
// carries a user link — self-service linking (Phase 10) is the only way a
// Player gets connected to a User, so every CSV-imported player starts
// unlinked.
export interface ImportCsvConfirmRow {
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

export interface ImportCsvConfirmResponse {
  count: number;
  players: {
    id: string;
    slug: string;
    first_name: string;
    last_name: string;
  }[];
}
