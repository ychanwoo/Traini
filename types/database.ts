export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string;
          avatar_url: string | null;
          target_distance: string | null;
          target_time_seconds: number | null;
          target_date: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name?: string;
          avatar_url?: string | null;
          target_distance?: string | null;
          target_time_seconds?: number | null;
          target_date?: string | null;
        };
        Update: {
          display_name?: string;
          avatar_url?: string | null;
          target_distance?: string | null;
          target_time_seconds?: number | null;
          target_date?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
