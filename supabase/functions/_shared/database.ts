// No generated Supabase types in this project yet (see spec 6.8) — this is
// just enough of the shape of `public.users`/`public.tournaments`/
// `public.players`/`public.bids` for the Edge Functions that touch them
// (bootstrap-owner, whoami, list-users, update-user-role,
// import-csv-preview, import-csv-confirm, place-bid).
export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          name: string | null;
          email: string;
          phone: string | null;
          sso_provider: string | null;
          avatar_url: string | null;
          role: string;
          created_at: string;
        };
        Insert: {
          id: string;
          name?: string | null;
          email: string;
          phone?: string | null;
          sso_provider?: string | null;
          avatar_url?: string | null;
          role?: string;
          created_at?: string;
        };
        Update: {
          name?: string | null;
          email?: string;
          phone?: string | null;
          sso_provider?: string | null;
          avatar_url?: string | null;
          role?: string;
        };
        Relationships: [];
      };
      tournaments: {
        Row: {
          id: string;
          slug: string;
          name: string;
          kind: string;
          status: string;
          silent_auction_start: string;
          silent_auction_end: string;
          threshold_amount: number;
          min_increment: number;
        };
        Insert: {
          id?: string;
          slug?: string;
          name: string;
          kind?: string;
          status?: string;
          silent_auction_start: string;
          silent_auction_end: string;
          threshold_amount: number;
          min_increment: number;
        };
        Update: {
          slug?: string;
          name?: string;
          kind?: string;
          status?: string;
          silent_auction_start?: string;
          silent_auction_end?: string;
          threshold_amount?: number;
          min_increment?: number;
        };
        Relationships: [];
      };
      players: {
        Row: {
          id: string;
          tournament_id: string;
          slug: string;
          name: string;
          contact_email: string | null;
          contact_phone: string | null;
          preferences: string | null;
          photo_url: string | null;
          flight: string | null;
          status: string;
          user_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tournament_id: string;
          slug?: string;
          name: string;
          contact_email?: string | null;
          contact_phone?: string | null;
          preferences?: string | null;
          photo_url?: string | null;
          flight?: string | null;
          status?: string;
          user_id?: string | null;
          created_at?: string;
        };
        Update: {
          slug?: string;
          name?: string;
          contact_email?: string | null;
          contact_phone?: string | null;
          preferences?: string | null;
          photo_url?: string | null;
          flight?: string | null;
          status?: string;
          user_id?: string | null;
        };
        Relationships: [];
      };
      bids: {
        Row: {
          id: string;
          player_id: string;
          bidder_id: string;
          amount: number;
          phase: string;
          placed_at: string;
          voided_at: string | null;
          void_reason: string | null;
        };
        Insert: {
          id?: string;
          player_id: string;
          bidder_id: string;
          amount: number;
          phase: string;
          placed_at?: string;
          voided_at?: string | null;
          void_reason?: string | null;
        };
        Update: {
          amount?: number;
          phase?: string;
          voided_at?: string | null;
          void_reason?: string | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
