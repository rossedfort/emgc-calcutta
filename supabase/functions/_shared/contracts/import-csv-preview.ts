// See ../../import-csv-preview/index.ts — the read-only parse/validate
// step; nothing is written until import-csv-confirm (import-csv-confirm.ts)
// is called with a (possibly Admin-edited) ImportCsvPreviewRow[].
export interface ImportCsvPreviewRequest {
  tournamentId: string;
  csv: string;
}

// One entry per field that differs between the CSV row and the current DB
// row for an `id`-matched row — empty for an 'add' row (nothing to diff
// against yet) and for an 'unchanged' row (matched, but every field is
// already identical).
export interface ImportCsvPreviewFieldChange {
  field: "first_name" | "last_name" | "flight" | "handicap_index" | "preferences" | "photo_url";
  before: string | number | null;
  after: string | number | null;
}

export interface ImportCsvPreviewRow {
  rowNumber: number;
  // Present only when the CSV row had a non-blank `id`/`player_id` column,
  // matched against an existing player in this tournament. Round-tripped
  // straight through to import-csv-confirm unchanged, so it stays the same
  // key an Admin re-uploading an edited export already has in hand.
  id: string | null;
  first_name: string | null;
  last_name: string | null;
  flight: string | null;
  handicap_index: number | null;
  preferences: string | null;
  photo_url: string | null;
  // 'add' — blank id, becomes a new player on confirm.
  // 'update' — id matched an existing player, at least one field differs.
  // 'unchanged' — id matched, but the row is identical to the DB already;
  //   never included in a confirm submission, only informational.
  changeType: "add" | "update" | "unchanged";
  changes: ImportCsvPreviewFieldChange[];
  errors: string[];
}

export interface ImportCsvPreviewResponse {
  rows: ImportCsvPreviewRow[];
  // Rows with no errors and changeType !== 'unchanged' — i.e. rows a
  // confirm submission could actually do something with. Drives the
  // preview UI's default-checked "Include" state, same as before.
  validCount: number;
  errorCount: number;
  addCount: number;
  updateCount: number;
  unchangedCount: number;
}
