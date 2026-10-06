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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      crm_records: {
        Row: {
          id: string
          user_id: string
          entity_type: string
          identity_key: string
          origin_run_id: string
          title: string
          fields: Json
          free_text: string | null
          confidence: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          entity_type: string
          identity_key: string
          origin_run_id: string
          title: string
          fields?: Json
          free_text?: string | null
          confidence?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          entity_type?: string
          identity_key?: string
          origin_run_id?: string
          title?: string
          fields?: Json
          free_text?: string | null
          confidence?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      crm_record_sources: {
        Row: {
          id: string
          crm_record_id: string
          user_id: string
          run_id: string
          node_id: string
          graph_revision: number
          node_revision: number
          snapshot: Json
          created_at: string
        }
        Insert: {
          id?: string
          crm_record_id: string
          user_id: string
          run_id: string
          node_id: string
          graph_revision: number
          node_revision: number
          snapshot: Json
          created_at?: string
        }
        Update: {
          id?: string
          crm_record_id?: string
          user_id?: string
          run_id?: string
          node_id?: string
          graph_revision?: number
          node_revision?: number
          snapshot?: Json
          created_at?: string
        }
        Relationships: []
      }
      crm_transfers: {
        Row: {
          run_id: string
          user_id: string
          graph_revision: number
          status: string
          source_count: number
          company_count: number
          person_count: number
          created_count: number
          linked_count: number
          failed_count: number
          attempts: number
          error: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          run_id: string
          user_id: string
          graph_revision: number
          status?: string
          source_count?: number
          company_count?: number
          person_count?: number
          created_count?: number
          linked_count?: number
          failed_count?: number
          attempts?: number
          error?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          run_id?: string
          user_id?: string
          graph_revision?: number
          status?: string
          source_count?: number
          company_count?: number
          person_count?: number
          created_count?: number
          linked_count?: number
          failed_count?: number
          attempts?: number
          error?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      assertions: {
        Row: {
          assessment_version: number
          claim: string
          confidence: string
          created_at: string
          created_by_agent: number | null
          evidence: Json
          field_key: string | null
          id: string
          owner_node_id: string
          run_id: string
        }
        Insert: {
          assessment_version?: number
          claim: string
          confidence?: string
          created_at?: string
          created_by_agent?: number | null
          evidence?: Json
          field_key?: string | null
          id?: string
          owner_node_id: string
          run_id: string
        }
        Update: {
          assessment_version?: number
          claim?: string
          confidence?: string
          created_at?: string
          created_by_agent?: number | null
          evidence?: Json
          field_key?: string | null
          id?: string
          owner_node_id?: string
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assertions_owner_node_id_fkey"
            columns: ["owner_node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assertions_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      checkpoints: {
        Row: {
          created_at: string
          generation: number
          id: string
          manifest: Json
          run_id: string
        }
        Insert: {
          created_at?: string
          generation: number
          id?: string
          manifest?: Json
          run_id: string
        }
        Update: {
          created_at?: string
          generation?: number
          id?: string
          manifest?: Json
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "checkpoints_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      edges: {
        Row: {
          assertion_id: string | null
          created_at: string
          from_node: string
          id: string
          polarity: string | null
          rationale: string | null
          relation: string
          run_id: string
          score: number | null
          to_node: string
        }
        Insert: {
          assertion_id?: string | null
          created_at?: string
          from_node: string
          id?: string
          polarity?: string | null
          rationale?: string | null
          relation: string
          run_id: string
          score?: number | null
          to_node: string
        }
        Update: {
          assertion_id?: string | null
          created_at?: string
          from_node?: string
          id?: string
          polarity?: string | null
          rationale?: string | null
          relation?: string
          run_id?: string
          score?: number | null
          to_node?: string
        }
        Relationships: [
          {
            foreignKeyName: "edges_from_node_fkey"
            columns: ["from_node"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "edges_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "edges_to_node_fkey"
            columns: ["to_node"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          agent_index: number | null
          created_at: string
          id: number
          kind: string
          payload: Json
          run_id: string
        }
        Insert: {
          agent_index?: number | null
          created_at?: string
          id?: never
          kind: string
          payload?: Json
          run_id: string
        }
        Update: {
          agent_index?: number | null
          created_at?: string
          id?: never
          kind?: string
          payload?: Json
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      invocations: {
        Row: {
          agent_index: number | null
          connector: string
          cost: number
          error: string | null
          finished_at: string | null
          id: string
          item_count: number
          operation: string
          provider: string
          query: string | null
          run_id: string
          started_at: string
          status: string
          task_id: string | null
        }
        Insert: {
          agent_index?: number | null
          connector: string
          cost?: number
          error?: string | null
          finished_at?: string | null
          id?: string
          item_count?: number
          operation: string
          provider: string
          query?: string | null
          run_id: string
          started_at?: string
          status?: string
          task_id?: string | null
        }
        Update: {
          agent_index?: number | null
          connector?: string
          cost?: number
          error?: string | null
          finished_at?: string | null
          id?: string
          item_count?: number
          operation?: string
          provider?: string
          query?: string | null
          run_id?: string
          started_at?: string
          status?: string
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invocations_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          created_at: string
          id: string
          lead_key: string
          notes: string | null
          stage: string
          starred: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          lead_key: string
          notes?: string | null
          stage?: string
          starred?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          lead_key?: string
          notes?: string | null
          stage?: string
          starred?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      nodes: {
        Row: {
          aliases: Json
          category: string
          confidence: string | null
          connector: string | null
          content: string | null
          content_hash: string | null
          created_at: string
          created_by_agent: number | null
          editorial_type: string | null
          entity_type: string | null
          event_at: string | null
          fetched_at: string | null
          fields: Json
          free_text: string | null
          id: string
          invocation_id: string | null
          is_snippet: boolean | null
          locator: string | null
          provenance: string
          provider: string | null
          published_at: string | null
          revision: number
          run_id: string
          semantic_kind: string | null
          title: string
        }
        Insert: {
          aliases?: Json
          category: string
          confidence?: string | null
          connector?: string | null
          content?: string | null
          content_hash?: string | null
          created_at?: string
          created_by_agent?: number | null
          editorial_type?: string | null
          entity_type?: string | null
          event_at?: string | null
          fetched_at?: string | null
          fields?: Json
          free_text?: string | null
          id?: string
          invocation_id?: string | null
          is_snippet?: boolean | null
          locator?: string | null
          provenance?: string
          provider?: string | null
          published_at?: string | null
          revision?: number
          run_id: string
          semantic_kind?: string | null
          title: string
        }
        Update: {
          aliases?: Json
          category?: string
          confidence?: string | null
          connector?: string | null
          content?: string | null
          content_hash?: string | null
          created_at?: string
          created_by_agent?: number | null
          editorial_type?: string | null
          entity_type?: string | null
          event_at?: string | null
          fetched_at?: string | null
          fields?: Json
          free_text?: string | null
          id?: string
          invocation_id?: string | null
          is_snippet?: boolean | null
          locator?: string | null
          provenance?: string
          provider?: string | null
          published_at?: string | null
          revision?: number
          run_id?: string
          semantic_kind?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "nodes_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      runs: {
        Row: {
          assessment_version: number
          completion_criteria: string
          connectors: Json
          cost_cap: number
          created_at: string
          ended_at: string | null
          epoch: number
          exclusions: string | null
          execution_fence: number
          graph_revision: number
          id: string
          objective: string
          outcome: string | null
          pain: string | null
          parent_run_id: string | null
          profile: string
          spend: number
          started_at: string | null
          stats: Json
          status: string
          stop_requested: boolean
          swarm_size: number
          threshold: number
          time_limit_sec: number
          universe: string | null
          user_id: string
        }
        Insert: {
          assessment_version?: number
          completion_criteria?: string
          connectors?: Json
          cost_cap?: number
          created_at?: string
          ended_at?: string | null
          epoch?: number
          exclusions?: string | null
          execution_fence?: number
          graph_revision?: number
          id?: string
          objective: string
          outcome?: string | null
          pain?: string | null
          parent_run_id?: string | null
          profile?: string
          spend?: number
          started_at?: string | null
          stats?: Json
          status?: string
          stop_requested?: boolean
          swarm_size?: number
          threshold?: number
          time_limit_sec?: number
          universe?: string | null
          user_id: string
        }
        Update: {
          assessment_version?: number
          completion_criteria?: string
          connectors?: Json
          cost_cap?: number
          created_at?: string
          ended_at?: string | null
          epoch?: number
          exclusions?: string | null
          execution_fence?: number
          graph_revision?: number
          id?: string
          objective?: string
          outcome?: string | null
          pain?: string | null
          parent_run_id?: string | null
          profile?: string
          spend?: number
          started_at?: string | null
          stats?: Json
          status?: string
          stop_requested?: boolean
          swarm_size?: number
          threshold?: number
          time_limit_sec?: number
          universe?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "runs_parent_run_id_fkey"
            columns: ["parent_run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          attempts: number
          claim_token: string | null
          completed_at: string | null
          created_at: string
          dedupe_key: string | null
          id: string
          kind: string
          lease_expires_at: string | null
          outbound_calls: number
          owner_agent: number | null
          payload: Json
          priority: number
          reserved_for_agent: number | null
          result_summary: string | null
          run_id: string
          status: string
        }
        Insert: {
          attempts?: number
          claim_token?: string | null
          completed_at?: string | null
          created_at?: string
          dedupe_key?: string | null
          id?: string
          kind: string
          lease_expires_at?: string | null
          outbound_calls?: number
          owner_agent?: number | null
          payload?: Json
          priority?: number
          reserved_for_agent?: number | null
          result_summary?: string | null
          run_id: string
          status?: string
        }
        Update: {
          attempts?: number
          claim_token?: string | null
          completed_at?: string | null
          created_at?: string
          dedupe_key?: string | null
          id?: string
          kind?: string
          lease_expires_at?: string | null
          outbound_calls?: number
          owner_agent?: number | null
          payload?: Json
          priority?: number
          reserved_for_agent?: number | null
          result_summary?: string | null
          run_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      votes: {
        Row: {
          agent_index: number
          created_at: string
          decision: string
          epoch: number
          gap_task: string | null
          id: string
          rationale: string | null
          revision: number
          run_id: string
        }
        Insert: {
          agent_index: number
          created_at?: string
          decision: string
          epoch: number
          gap_task?: string | null
          id?: string
          rationale?: string | null
          revision: number
          run_id: string
        }
        Update: {
          agent_index?: number
          created_at?: string
          decision?: string
          epoch?: number
          gap_task?: string | null
          id?: string
          rationale?: string | null
          revision?: number
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "votes_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      retry_crm_transfer: {
        Args: { p_run_id: string }
        Returns: Database["public"]["Tables"]["crm_transfers"]["Row"]
      }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
