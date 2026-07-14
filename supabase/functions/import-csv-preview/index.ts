// Parses an Admin-uploaded player CSV for a specific tournament, validates
// each row, and auto-matches contact_email against public.users.email —
// this is the preview step (spec 4.2): nothing is written here, that's
// import-csv-confirm's job once the Admin reviews and confirms this payload.
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import Papa from "papaparse";

import { resolveSupabaseEnv } from "../_shared/resolve-key.ts";
import type { Database } from "../_shared/database.ts";
import { isAdminOrOwner } from "../_shared/roles.ts";
import type {
  ImportCsvPreviewRequest,
  ImportCsvPreviewResponse,
  ImportCsvPreviewRow,
} from "../_shared/contracts/import-csv-preview.ts";

// CSV headers accepted for each Player field (spec 4.2 also lists "tee
// time / group" and "starting bid", but neither maps to a Player column —
// see spec 5's actual data model — so they're not recognized here; a
// "notes/preferences" column can carry that info as free text if an Admin
// wants it captured, and starting bid has nowhere to go until Phase 3's
// Bid table exists. "handicap" maps to handicap_index — Phase 3.5 added
// that column specifically to close this gap).
const HEADER_ALIASES: Record<string, string> = {
  "name": "name",
  "contact_email": "contact_email",
  "email": "contact_email",
  "contact_phone": "contact_phone",
  "phone": "contact_phone",
  "flight": "flight",
  "handicap": "handicap_index",
  "handicap_index": "handicap_index",
  "handicap index": "handicap_index",
  "hcp": "handicap_index",
  "preferences": "preferences",
  "notes": "preferences",
  "notes/preferences": "preferences",
  "photo_url": "photo_url",
  "photo url": "photo_url",
  "photo": "photo_url",
};

function normalizeHeader(header: string): string | null {
  return HEADER_ALIASES[header.trim().toLowerCase()] ?? null;
}

export default {
  fetch: withSupabase<Database>(
    { auth: "user", env: resolveSupabaseEnv() },
    async (req, ctx) => {
      const { data: caller, error: callerError } = await ctx.supabaseAdmin
        .from("users")
        .select("role")
        .eq("id", ctx.userClaims!.id)
        .single();
      if (callerError) {
        return Response.json({ error: callerError.message }, { status: 500 });
      }
      if (!isAdminOrOwner(caller.role)) {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }

      const body = await req.json().catch(() => null) as
        | Partial<ImportCsvPreviewRequest>
        | null;
      if (!body?.tournamentId || typeof body.csv !== "string") {
        return Response.json(
          { error: "tournamentId and csv are required" },
          { status: 400 },
        );
      }

      const { data: tournament, error: tournamentError } = await ctx
        .supabaseAdmin
        .from("tournaments")
        .select("id")
        .eq("id", body.tournamentId)
        .maybeSingle();
      if (tournamentError) {
        return Response.json({ error: tournamentError.message }, {
          status: 500,
        });
      }
      if (!tournament) {
        return Response.json({ error: "Tournament not found" }, {
          status: 404,
        });
      }

      const parsed = Papa.parse<Record<string, string>>(body.csv, {
        header: true,
        skipEmptyLines: true,
      });
      if (parsed.errors.length > 0) {
        return Response.json(
          { error: `CSV parse error: ${parsed.errors[0].message}` },
          { status: 400 },
        );
      }

      const fieldMap = new Map<string, string>();
      for (const header of parsed.meta.fields ?? []) {
        const normalized = normalizeHeader(header);
        if (normalized && !fieldMap.has(normalized)) {
          fieldMap.set(normalized, header);
        }
      }

      const getField = (row: Record<string, string>, field: string) => {
        const column = fieldMap.get(field);
        const value = column ? row[column]?.trim() : "";
        return value ? value : null;
      };

      // Unlike the other fields, an unparseable handicap is a row error
      // rather than silently dropped — an Admin reviewing the preview
      // should see that something in the CSV didn't look like a number,
      // not just find handicap_index quietly blank after import.
      const getHandicap = (
        row: Record<string, string>,
        errors: string[],
      ): number | null => {
        const raw = getField(row, "handicap_index");
        if (raw === null) return null;
        const value = Number(raw);
        if (!Number.isFinite(value)) {
          errors.push("Handicap must be a number");
          return null;
        }
        return value;
      };

      const emails = parsed.data
        .map((row: Record<string, string>) =>
          getField(row, "contact_email")?.toLowerCase()
        )
        .filter((email: string | undefined): email is string => !!email);

      const { data: matchingUsers, error: usersError } = emails.length > 0
        ? await ctx.supabaseAdmin.from("users").select("id, email").in(
          "email",
          emails,
        )
        : { data: [] as { id: string; email: string }[], error: null };
      if (usersError) {
        return Response.json({ error: usersError.message }, { status: 500 });
      }

      const usersByEmail = new Map(
        (matchingUsers ?? []).map((u) => [u.email.toLowerCase(), u]),
      );

      const rows: ImportCsvPreviewRow[] = parsed.data.map((
        row: Record<string, string>,
        index: number,
      ) => {
        const name = getField(row, "name");
        const errors: string[] = [];
        if (!name) errors.push("Name is required");
        const handicap_index = getHandicap(row, errors);

        const contact_email = getField(row, "contact_email");
        const matchedUser = contact_email
          ? usersByEmail.get(contact_email.toLowerCase())
          : undefined;

        return {
          rowNumber: index + 2, // header row + 1-indexing
          name,
          contact_email,
          contact_phone: getField(row, "contact_phone"),
          flight: getField(row, "flight"),
          handicap_index,
          preferences: getField(row, "preferences"),
          photo_url: getField(row, "photo_url"),
          errors,
          matchedUserId: matchedUser?.id ?? null,
          matchedUserEmail: matchedUser?.email ?? null,
        };
      });

      return Response.json(
        {
          rows,
          validCount: rows.filter((r) => r.errors.length === 0).length,
          errorCount: rows.filter((r) => r.errors.length > 0).length,
        } satisfies ImportCsvPreviewResponse,
      );
    },
  ),
};
