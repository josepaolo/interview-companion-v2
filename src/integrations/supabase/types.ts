export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      messages: {
        Row: {
          audio_url: string | null
          created_at: string
          id: string
          question_index: number | null
          role: string
          session_id: string
          text: string
        }
        Insert: {
          audio_url?: string | null
          created_at?: string
          id?: string
          question_index?: number | null
          role: string
          session_id: string
          text?: string
        }
        Update: {
          audio_url?: string | null
          created_at?: string
          id?: string
          question_index?: number | null
          role?: string
          session_id?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      sessions: {
        Row: {
          access_token: string
          completed_at: string | null
          consent_given: boolean
          consent_text_snapshot: string | null
          current_question_index: number
          id: string
          mode: string
          participant_email: string | null
          participant_name: string | null
          started_at: string
          status: string
          study_id: string
          updated_at: string
          withdrawn: boolean
        }
        Insert: {
          access_token?: string
          completed_at?: string | null
          consent_given?: boolean
          consent_text_snapshot?: string | null
          current_question_index?: number
          id?: string
          mode?: string
          participant_email?: string | null
          participant_name?: string | null
          started_at?: string
          status?: string
          study_id: string
          updated_at?: string
          withdrawn?: boolean
        }
        Update: {
          access_token?: string
          completed_at?: string | null
          consent_given?: boolean
          consent_text_snapshot?: string | null
          current_question_index?: number
          id?: string
          mode?: string
          participant_email?: string | null
          participant_name?: string | null
          started_at?: string
          status?: string
          study_id?: string
          updated_at?: string
          withdrawn?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "sessions_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "studies"
            referencedColumns: ["id"]
          },
        ]
      }
      studies: {
        Row: {
          allow_withdrawal: boolean
          collect_identity: boolean
          consent_enabled: boolean
          consent_text: string
          created_at: string
          data_use_notice: boolean
          description: string | null
          id: string
          interview_guide: string | null
          max_duration_minutes: number
          max_questions: number
          owner_id: string
          participant_modes: string[]
          persona_background: string | null
          persona_name: string
          persona_tone: string
          research_questions: string | null
          share_active: boolean
          share_token: string
          status: string
          structure_type: string
          survey_items: Json
          target_sample_size: number
          title: string
          updated_at: string
        }
        Insert: {
          allow_withdrawal?: boolean
          collect_identity?: boolean
          consent_enabled?: boolean
          consent_text?: string
          created_at?: string
          data_use_notice?: boolean
          description?: string | null
          id?: string
          interview_guide?: string | null
          max_duration_minutes?: number
          max_questions?: number
          owner_id: string
          participant_modes?: string[]
          persona_background?: string | null
          persona_name?: string
          persona_tone?: string
          research_questions?: string | null
          share_active?: boolean
          share_token?: string
          status?: string
          structure_type?: string
          survey_items?: Json
          target_sample_size?: number
          title?: string
          updated_at?: string
        }
        Update: {
          allow_withdrawal?: boolean
          collect_identity?: boolean
          consent_enabled?: boolean
          consent_text?: string
          created_at?: string
          data_use_notice?: boolean
          description?: string | null
          id?: string
          interview_guide?: string | null
          max_duration_minutes?: number
          max_questions?: number
          owner_id?: string
          participant_modes?: string[]
          persona_background?: string | null
          persona_name?: string
          persona_tone?: string
          research_questions?: string | null
          share_active?: boolean
          share_token?: string
          status?: string
          structure_type?: string
          survey_items?: Json
          target_sample_size?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      session_token_header: { Args: never; Returns: string }
      study_is_open: { Args: { _study_id: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
