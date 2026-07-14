// Generated via `pnpm supabase gen types typescript --local` — the
// canonical copy lives here (not in packages/shared-types) because the
// Supabase edge runtime only mounts supabase/ into its container, both
// locally and at deploy time; a relative import reaching outside it
// fails to resolve (confirmed via a local boot-error test). apps/web has
// no such sandboxing, so packages/shared-types/src/database.ts re-exports
// from this file instead of the other way around — see spec 6.8 for the
// overall shared-types design. Do not hand-edit; regenerate after any
// migration that changes the public schema (swap `--local` for
// `--linked` to generate from the remote project instead), then keep
// packages/shared-types/src/database.ts's re-export as-is.
export type Json = string | number | boolean | null | {
  [key: string]: Json | undefined;
} | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      bids: {
        Row: {
          amount: number;
          bidder_id: string;
          id: string;
          phase: Database["public"]["Enums"]["bid_phase"];
          placed_at: string;
          player_id: string;
          void_reason: string | null;
          voided_at: string | null;
        };
        Insert: {
          amount: number;
          bidder_id: string;
          id?: string;
          phase: Database["public"]["Enums"]["bid_phase"];
          placed_at?: string;
          player_id: string;
          void_reason?: string | null;
          voided_at?: string | null;
        };
        Update: {
          amount?: number;
          bidder_id?: string;
          id?: string;
          phase?: Database["public"]["Enums"]["bid_phase"];
          placed_at?: string;
          player_id?: string;
          void_reason?: string | null;
          voided_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "bids_bidder_id_fkey";
            columns: ["bidder_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bids_player_id_fkey";
            columns: ["player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
        ];
      };
      live_lots: {
        Row: {
          closed_at: string | null;
          closes_at: string | null;
          id: string;
          opened_at: string | null;
          player_id: string;
          queue_position: number;
          tournament_id: string;
          winning_bid_id: string | null;
        };
        Insert: {
          closed_at?: string | null;
          closes_at?: string | null;
          id?: string;
          opened_at?: string | null;
          player_id: string;
          queue_position: number;
          tournament_id: string;
          winning_bid_id?: string | null;
        };
        Update: {
          closed_at?: string | null;
          closes_at?: string | null;
          id?: string;
          opened_at?: string | null;
          player_id?: string;
          queue_position?: number;
          tournament_id?: string;
          winning_bid_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "live_lots_player_id_fkey";
            columns: ["player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "live_lots_tournament_id_fkey";
            columns: ["tournament_id"];
            isOneToOne: false;
            referencedRelation: "tournaments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "live_lots_winning_bid_id_fkey";
            columns: ["winning_bid_id"];
            isOneToOne: false;
            referencedRelation: "bids";
            referencedColumns: ["id"];
          },
        ];
      };
      players: {
        Row: {
          contact_email: string | null;
          contact_phone: string | null;
          created_at: string;
          flight: string | null;
          handicap_index: number | null;
          id: string;
          name: string;
          photo_url: string | null;
          preferences: string | null;
          slug: string;
          status: Database["public"]["Enums"]["player_status"];
          tournament_id: string;
          user_id: string | null;
        };
        Insert: {
          contact_email?: string | null;
          contact_phone?: string | null;
          created_at?: string;
          flight?: string | null;
          handicap_index?: number | null;
          id?: string;
          name: string;
          photo_url?: string | null;
          preferences?: string | null;
          slug?: string;
          status?: Database["public"]["Enums"]["player_status"];
          tournament_id: string;
          user_id?: string | null;
        };
        Update: {
          contact_email?: string | null;
          contact_phone?: string | null;
          created_at?: string;
          flight?: string | null;
          handicap_index?: number | null;
          id?: string;
          name?: string;
          photo_url?: string | null;
          preferences?: string | null;
          slug?: string;
          status?: Database["public"]["Enums"]["player_status"];
          tournament_id?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "players_tournament_id_fkey";
            columns: ["tournament_id"];
            isOneToOne: false;
            referencedRelation: "tournaments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "players_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      tournaments: {
        Row: {
          anti_snipe_seconds: number;
          created_at: string;
          id: string;
          kind: string;
          live_auction_started_at: string | null;
          min_increment: number;
          name: string;
          payout_structure: Json;
          silent_auction_end: string;
          silent_auction_start: string;
          slug: string;
          status: string;
          threshold_amount: number;
        };
        Insert: {
          anti_snipe_seconds?: number;
          created_at?: string;
          id?: string;
          kind?: string;
          live_auction_started_at?: string | null;
          min_increment: number;
          name: string;
          payout_structure?: Json;
          silent_auction_end: string;
          silent_auction_start: string;
          slug?: string;
          status?: string;
          threshold_amount: number;
        };
        Update: {
          anti_snipe_seconds?: number;
          created_at?: string;
          id?: string;
          kind?: string;
          live_auction_started_at?: string | null;
          min_increment?: number;
          name?: string;
          payout_structure?: Json;
          silent_auction_end?: string;
          silent_auction_start?: string;
          slug?: string;
          status?: string;
          threshold_amount?: number;
        };
        Relationships: [];
      };
      users: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          email: string;
          id: string;
          name: string | null;
          phone: string | null;
          role: Database["public"]["Enums"]["user_role"];
          sso_provider: Database["public"]["Enums"]["auth_provider"] | null;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          email: string;
          id: string;
          name?: string | null;
          phone?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
          sso_provider?: Database["public"]["Enums"]["auth_provider"] | null;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          email?: string;
          id?: string;
          name?: string | null;
          phone?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
          sso_provider?: Database["public"]["Enums"]["auth_provider"] | null;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      close_live_lot: { Args: { lot_id: string }; Returns: undefined };
      close_silent_auctions: { Args: never; Returns: undefined };
      current_user_role: {
        Args: never;
        Returns: Database["public"]["Enums"]["user_role"];
      };
      enqueue_player_for_live_auction: {
        Args: { p_player_id: string; p_tournament_id: string };
        Returns: undefined;
      };
      open_live_lot: { Args: { lot_id: string }; Returns: undefined };
      resequence_queue: {
        Args: { p_ordered_lot_ids: string[]; p_tournament_id: string };
        Returns: undefined;
      };
      slugify: { Args: { input: string }; Returns: string };
      start_live_auction: { Args: { tournament_id: string }; Returns: undefined };
      swap_queue_position: {
        Args: { lot_a: string; lot_b: string };
        Returns: undefined;
      };
    };
    Enums: {
      auth_provider: "google" | "azure" | "apple";
      bid_phase: "silent" | "live";
      player_status:
        | "open"
        | "reserved"
        | "sold_silent"
        | "sold_live"
        | "no_bid";
      user_role: "unassigned" | "participant" | "admin" | "owner";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema =
  DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof (
      & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
        "Tables"
      ]
      & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
        "Views"
      ]
    )
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
} ? (
    & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
      "Tables"
    ]
    & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
      "Views"
    ]
  )[TableName] extends {
    Row: infer R;
  } ? R
  : never
  : DefaultSchemaTableNameOrOptions extends
    keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[
      DefaultSchemaTableNameOrOptions
    ] extends {
      Row: infer R;
    } ? R
    : never
  : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | {
    schema: keyof DatabaseWithoutInternals;
  },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
      "Tables"
    ]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
    "Tables"
  ][TableName] extends {
    Insert: infer I;
  } ? I
  : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I;
    } ? I
    : never
  : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | {
    schema: keyof DatabaseWithoutInternals;
  },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
      "Tables"
    ]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
    "Tables"
  ][TableName] extends {
    Update: infer U;
  } ? U
  : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U;
    } ? U
    : never
  : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"] | {
    schema: keyof DatabaseWithoutInternals;
  },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]][
      "Enums"
    ]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][
    EnumName
  ]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[
      PublicCompositeTypeNameOrOptions["schema"]
    ]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]][
    "CompositeTypes"
  ][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      auth_provider: ["google", "azure", "apple"],
      bid_phase: ["silent", "live"],
      player_status: ["open", "reserved", "sold_silent", "sold_live", "no_bid"],
      user_role: ["unassigned", "participant", "admin", "owner"],
    },
  },
} as const;
