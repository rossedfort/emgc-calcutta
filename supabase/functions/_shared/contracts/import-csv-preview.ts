// See ../../import-csv-preview/index.ts — the read-only parse/validate
// step; nothing is written until import-csv-confirm (import-csv-confirm.ts)
// is called with a (possibly Admin-edited) ImportCsvPreviewRow[].
export interface ImportCsvPreviewRequest {
  tournamentId: string;
  csv: string;
}

export interface ImportCsvPreviewRow {
  rowNumber: number;
  first_name: string | null;
  last_name: string | null;
  flight: string | null;
  handicap_index: number | null;
  preferences: string | null;
  photo_url: string | null;
  errors: string[];
}

export interface ImportCsvPreviewResponse {
  rows: ImportCsvPreviewRow[];
  validCount: number;
  errorCount: number;
}
