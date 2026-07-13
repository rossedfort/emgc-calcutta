// No generated Supabase types in this project yet (see spec 6.8) — this is
// just enough of the shape of `public.users`/`public.tournaments` for the
// Edge Functions that touch them (bootstrap-owner, whoami, list-users,
// update-user-role, import-csv-preview).
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
        };
        Insert: {
          id?: string;
          slug?: string;
          name: string;
          kind?: string;
          status?: string;
        };
        Update: {
          slug?: string;
          name?: string;
          kind?: string;
          status?: string;
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
