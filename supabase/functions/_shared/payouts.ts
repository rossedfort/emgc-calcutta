// Shared by set-placement (computing a placement's payout for the first
// time, or a correction) and respond-stake-buyback (recomputing a single
// entry's payout when a buy-back is accepted after set-placement already
// ran for it) — one place for "pot x share, split across a buyer and a
// golfer if an accepted stake_buyback exists for this entry" so the two
// Edge Functions that need this money math don't duplicate it.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.ts";

export interface AcceptedBuyback {
  id: string;
  requester_id: string;
  percentage: number;
}

export interface PayoutRowInput {
  tournament_id: string;
  entry_id: string;
  bidder_id: string;
  placement: number;
  pot_share: number;
  amount: number;
  calculated_at: string;
  stake_buyback_id: string | null;
}

// (flight, division) group key, shared with set-placement's own grouping
// so a caller building potByGroup's keys and a caller reading them always
// agree on the format.
export function potGroupKey(flight: string, division: string): string {
  return JSON.stringify([flight, division]);
}

// One payout row if no accepted buy-back exists for this entry, two
// (buyer + golfer) if one does. The golfer's share is rounded first and
// the buyer's share is whatever's left (amount - golferAmount), not
// independently rounded — this guarantees the two rows always sum to
// exactly the placement's full computed amount, never a penny more or
// less from separately rounding each side.
export function computeEntryPayoutRows(params: {
  tournamentId: string;
  entryId: string;
  bidderId: string;
  placement: number;
  potShare: number;
  pot: number;
  acceptedBuyback: AcceptedBuyback | null;
}): PayoutRowInput[] {
  const amount = Math.round(params.pot * params.potShare * 100) / 100;
  const calculatedAt = new Date().toISOString();
  const base = {
    tournament_id: params.tournamentId,
    entry_id: params.entryId,
    placement: params.placement,
    pot_share: params.potShare,
    calculated_at: calculatedAt,
  };

  if (!params.acceptedBuyback) {
    return [{
      ...base,
      bidder_id: params.bidderId,
      amount,
      stake_buyback_id: null,
    }];
  }

  const golferAmount =
    Math.round(amount * params.acceptedBuyback.percentage * 100) / 100;
  const buyerAmount = Math.round((amount - golferAmount) * 100) / 100;

  return [
    {
      ...base,
      bidder_id: params.bidderId,
      amount: buyerAmount,
      stake_buyback_id: params.acceptedBuyback.id,
    },
    {
      ...base,
      bidder_id: params.acceptedBuyback.requester_id,
      amount: golferAmount,
      stake_buyback_id: params.acceptedBuyback.id,
    },
  ];
}

// Pot per (flight, division) group across every sold entry in the
// tournament (spec 4.8 + the Phase 7.5 per-group scoping) — the same
// computation set-placement always needed, extracted so
// respond-stake-buyback's single-entry recompute can read the one group's
// pot it needs without duplicating the query/aggregation. Returns the
// Supabase-style { data, error } tuple this codebase's Edge Functions
// consistently check, rather than throwing.
export async function computePotByGroup(
  supabaseAdmin: SupabaseClient<Database>,
  tournamentId: string,
): Promise<
  { potByGroup: Map<string, number>; error: null } | {
    potByGroup: null;
    error: string;
  }
> {
  const { data: soldEntries, error } = await supabaseAdmin
    .from("player_entries")
    .select(
      "flight, division, winning_bid:bids!player_entries_winning_bid_id_fkey(amount)",
    )
    .eq("tournament_id", tournamentId)
    .in("status", ["sold_silent", "sold_live"]);
  if (error) {
    return { potByGroup: null, error: error.message };
  }

  const potByGroup = new Map<string, number>();
  for (const p of soldEntries ?? []) {
    const key = potGroupKey(p.flight, p.division);
    potByGroup.set(
      key,
      (potByGroup.get(key) ?? 0) + (p.winning_bid?.amount ?? 0),
    );
  }
  return { potByGroup, error: null };
}
