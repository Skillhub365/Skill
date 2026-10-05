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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      activity_logs: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string | null
          actor_role: string | null
          at: string
          correlation_id: string | null
          detail: string | null
          error_code: string | null
          id: string
          ip_address: string | null
          metadata: Json
          outcome: string
          target_id: string | null
          target_type: string | null
          tenant_id: string | null
          workspace_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          at?: string
          correlation_id?: string | null
          detail?: string | null
          error_code?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json
          outcome?: string
          target_id?: string | null
          target_type?: string | null
          tenant_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          at?: string
          correlation_id?: string | null
          detail?: string | null
          error_code?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json
          outcome?: string
          target_id?: string | null
          target_type?: string | null
          tenant_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cleanup_runs: {
        Row: {
          created_at: string
          detail: string | null
          failures: number
          finished_at: string | null
          id: string
          job: string
          lease_until: string
          metadata: Json
          reclaimed: number
          started_at: string
          status: string
          worker_id: string
        }
        Insert: {
          created_at?: string
          detail?: string | null
          failures?: number
          finished_at?: string | null
          id?: string
          job: string
          lease_until?: string
          metadata?: Json
          reclaimed?: number
          started_at?: string
          status?: string
          worker_id: string
        }
        Update: {
          created_at?: string
          detail?: string | null
          failures?: number
          finished_at?: string | null
          id?: string
          job?: string
          lease_until?: string
          metadata?: Json
          reclaimed?: number
          started_at?: string
          status?: string
          worker_id?: string
        }
        Relationships: []
      }
      cloud_connections: {
        Row: {
          azure_tenant_id: string
          client_id: string
          created_at: string
          created_by: string | null
          health: Database["public"]["Enums"]["connection_health"]
          health_detail: string | null
          id: string
          last_event_at: string | null
          last_event_source: string | null
          last_reconcile_summary: Json
          last_reconciled_at: string | null
          last_refreshed_at: string | null
          last_validated_at: string | null
          name: string
          provider: Database["public"]["Enums"]["cloud_provider"]
          refresh_enabled: boolean
          refresh_interval_seconds: number
          secret_ref: string
          secret_rotated_at: string | null
          status: string
          subscription_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          azure_tenant_id: string
          client_id: string
          created_at?: string
          created_by?: string | null
          health?: Database["public"]["Enums"]["connection_health"]
          health_detail?: string | null
          id?: string
          last_event_at?: string | null
          last_event_source?: string | null
          last_reconcile_summary?: Json
          last_reconciled_at?: string | null
          last_refreshed_at?: string | null
          last_validated_at?: string | null
          name: string
          provider?: Database["public"]["Enums"]["cloud_provider"]
          refresh_enabled?: boolean
          refresh_interval_seconds?: number
          secret_ref: string
          secret_rotated_at?: string | null
          status?: string
          subscription_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          azure_tenant_id?: string
          client_id?: string
          created_at?: string
          created_by?: string | null
          health?: Database["public"]["Enums"]["connection_health"]
          health_detail?: string | null
          id?: string
          last_event_at?: string | null
          last_event_source?: string | null
          last_reconcile_summary?: Json
          last_reconciled_at?: string | null
          last_refreshed_at?: string | null
          last_validated_at?: string | null
          name?: string
          provider?: Database["public"]["Enums"]["cloud_provider"]
          refresh_enabled?: boolean
          refresh_interval_seconds?: number
          secret_ref?: string
          secret_rotated_at?: string | null
          status?: string
          subscription_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cloud_connections_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cloud_inventory: {
        Row: {
          azure_resource_id: string
          connection_id: string
          id: string
          name: string
          payload: Json
          region: string | null
          resource_group: string | null
          resource_type: string
          synced_at: string
        }
        Insert: {
          azure_resource_id: string
          connection_id: string
          id?: string
          name: string
          payload?: Json
          region?: string | null
          resource_group?: string | null
          resource_type: string
          synced_at?: string
        }
        Update: {
          azure_resource_id?: string
          connection_id?: string
          id?: string
          name?: string
          payload?: Json
          region?: string | null
          resource_group?: string | null
          resource_type?: string
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cloud_inventory_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "cloud_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      cloud_mappings: {
        Row: {
          azure_resource_id: string
          connection_id: string | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          metadata: Json
          resource_kind: string
          tenant_id: string
        }
        Insert: {
          azure_resource_id: string
          connection_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          metadata?: Json
          resource_kind: string
          tenant_id: string
        }
        Update: {
          azure_resource_id?: string
          connection_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          metadata?: Json
          resource_kind?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cloud_mappings_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "cloud_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cloud_mappings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      gateway_connections: {
        Row: {
          cleaned_up_at: string | null
          created_at: string
          expires_at: string | null
          guac_connection_id: string | null
          guac_user_created_at: string | null
          guac_username: string | null
          id: string
          last_error: string | null
          metadata: Json
          session_id: string
          status: Database["public"]["Enums"]["gateway_status"]
          token_expires_at: string | null
          updated_at: string
          vm_id: string | null
        }
        Insert: {
          cleaned_up_at?: string | null
          created_at?: string
          expires_at?: string | null
          guac_connection_id?: string | null
          guac_user_created_at?: string | null
          guac_username?: string | null
          id?: string
          last_error?: string | null
          metadata?: Json
          session_id: string
          status?: Database["public"]["Enums"]["gateway_status"]
          token_expires_at?: string | null
          updated_at?: string
          vm_id?: string | null
        }
        Update: {
          cleaned_up_at?: string | null
          created_at?: string
          expires_at?: string | null
          guac_connection_id?: string | null
          guac_user_created_at?: string | null
          guac_username?: string | null
          id?: string
          last_error?: string | null
          metadata?: Json
          session_id?: string
          status?: Database["public"]["Enums"]["gateway_status"]
          token_expires_at?: string | null
          updated_at?: string
          vm_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gateway_connections_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gateway_connections_vm_id_fkey"
            columns: ["vm_id"]
            isOneToOne: false
            referencedRelation: "vm_records"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_assignments: {
        Row: {
          access_ends_at: string | null
          access_starts_at: string | null
          allowed_minutes: number | null
          assigned_by: string | null
          completed_at: string | null
          created_at: string
          id: string
          lab_id: string
          last_started_at: string | null
          last_stopped_at: string | null
          persistent_vm_id: string | null
          progress: Json
          remaining_minutes: number | null
          started_at: string | null
          status: Database["public"]["Enums"]["assignment_status"]
          updated_at: string
          used_minutes: number
          user_id: string
          workspace_id: string
        }
        Insert: {
          access_ends_at?: string | null
          access_starts_at?: string | null
          allowed_minutes?: number | null
          assigned_by?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          lab_id: string
          last_started_at?: string | null
          last_stopped_at?: string | null
          persistent_vm_id?: string | null
          progress?: Json
          remaining_minutes?: number | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["assignment_status"]
          updated_at?: string
          used_minutes?: number
          user_id: string
          workspace_id: string
        }
        Update: {
          access_ends_at?: string | null
          access_starts_at?: string | null
          allowed_minutes?: number | null
          assigned_by?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          lab_id?: string
          last_started_at?: string | null
          last_stopped_at?: string | null
          persistent_vm_id?: string | null
          progress?: Json
          remaining_minutes?: number | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["assignment_status"]
          updated_at?: string
          used_minutes?: number
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lab_assignments_lab_id_fkey"
            columns: ["lab_id"]
            isOneToOne: false
            referencedRelation: "labs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_assignments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      labs: {
        Row: {
          created_at: string
          created_by: string | null
          default_access_days: number
          default_allowed_minutes: number
          description: string | null
          duration_minutes: number
          id: string
          idle_shutdown_minutes: number
          instructions: string | null
          lab_mode: Database["public"]["Enums"]["lab_mode"]
          max_extensions: number
          persistence_policy: Database["public"]["Enums"]["persistence_policy"]
          published_at: string | null
          reset_on_access_end: boolean
          status: Database["public"]["Enums"]["lab_status"]
          template_id: string | null
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          default_access_days?: number
          default_allowed_minutes?: number
          description?: string | null
          duration_minutes?: number
          id?: string
          idle_shutdown_minutes?: number
          instructions?: string | null
          lab_mode?: Database["public"]["Enums"]["lab_mode"]
          max_extensions?: number
          persistence_policy?: Database["public"]["Enums"]["persistence_policy"]
          published_at?: string | null
          reset_on_access_end?: boolean
          status?: Database["public"]["Enums"]["lab_status"]
          template_id?: string | null
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          default_access_days?: number
          default_allowed_minutes?: number
          description?: string | null
          duration_minutes?: number
          id?: string
          idle_shutdown_minutes?: number
          instructions?: string | null
          lab_mode?: Database["public"]["Enums"]["lab_mode"]
          max_extensions?: number
          persistence_policy?: Database["public"]["Enums"]["persistence_policy"]
          published_at?: string | null
          reset_on_access_end?: boolean
          status?: Database["public"]["Enums"]["lab_status"]
          template_id?: string | null
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "labs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "labs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      lifecycle_events: {
        Row: {
          at: string
          correlation_id: string | null
          detail: string | null
          duration_ms: number | null
          entity_id: string
          entity_type: string
          id: string
          message: string | null
          metadata: Json
          phase: string
          progress: number | null
          seq: number
          session_id: string | null
          source: string
          status: string
          tenant_id: string | null
          vm_id: string | null
        }
        Insert: {
          at?: string
          correlation_id?: string | null
          detail?: string | null
          duration_ms?: number | null
          entity_id: string
          entity_type: string
          id?: string
          message?: string | null
          metadata?: Json
          phase: string
          progress?: number | null
          seq?: number
          session_id?: string | null
          source?: string
          status?: string
          tenant_id?: string | null
          vm_id?: string | null
        }
        Update: {
          at?: string
          correlation_id?: string | null
          detail?: string | null
          duration_ms?: number | null
          entity_id?: string
          entity_type?: string
          id?: string
          message?: string | null
          metadata?: Json
          phase?: string
          progress?: number | null
          seq?: number
          session_id?: string | null
          source?: string
          status?: string
          tenant_id?: string | null
          vm_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lifecycle_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lifecycle_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      metric_events: {
        Row: {
          at: string
          correlation_id: string | null
          id: string
          lab_id: string | null
          metadata: Json
          metric: string
          outcome: string | null
          session_id: string | null
          tenant_id: string | null
          unit: string
          user_id: string | null
          value: number
          vm_id: string | null
          workspace_id: string | null
        }
        Insert: {
          at?: string
          correlation_id?: string | null
          id?: string
          lab_id?: string | null
          metadata?: Json
          metric: string
          outcome?: string | null
          session_id?: string | null
          tenant_id?: string | null
          unit?: string
          user_id?: string | null
          value?: number
          vm_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          at?: string
          correlation_id?: string | null
          id?: string
          lab_id?: string | null
          metadata?: Json
          metric?: string
          outcome?: string | null
          session_id?: string | null
          tenant_id?: string | null
          unit?: string
          user_id?: string | null
          value?: number
          vm_id?: string | null
          workspace_id?: string | null
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          entra_object_id: string | null
          failed_login_count: number
          full_name: string | null
          id: string
          last_sign_in_at: string | null
          locked_until: string | null
          status: Database["public"]["Enums"]["account_status"]
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          entra_object_id?: string | null
          failed_login_count?: number
          full_name?: string | null
          id: string
          last_sign_in_at?: string | null
          locked_until?: string | null
          status?: Database["public"]["Enums"]["account_status"]
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          entra_object_id?: string | null
          failed_login_count?: number
          full_name?: string | null
          id?: string
          last_sign_in_at?: string | null
          locked_until?: string | null
          status?: Database["public"]["Enums"]["account_status"]
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      session_events: {
        Row: {
          at: string
          correlation_id: string | null
          event_type: string
          id: string
          message: string | null
          metadata: Json
          phase: string | null
          seq: number
          session_id: string
        }
        Insert: {
          at?: string
          correlation_id?: string | null
          event_type: string
          id?: string
          message?: string | null
          metadata?: Json
          phase?: string | null
          seq?: number
          session_id: string
        }
        Update: {
          at?: string
          correlation_id?: string | null
          event_type?: string
          id?: string
          message?: string | null
          metadata?: Json
          phase?: string | null
          seq?: number
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          allocation_lock_token: string | null
          assignment_id: string | null
          billable_minutes: number
          cleanup_attempts: number
          cleanup_error: string | null
          connection_status: string
          correlation_id: string
          created_at: string
          duration_minutes: number
          ended_at: string | null
          ended_reason: string | null
          error_code: string | null
          expires_at: string
          extended_minutes: number
          extension_count: number
          gateway_cleaned_at: string | null
          hourly_rate_cents: number | null
          id: string
          lab_id: string
          lab_mode: Database["public"]["Enums"]["lab_mode"]
          lab_title: string | null
          last_heartbeat_at: string
          launch_key: string | null
          max_extension_minutes: number
          message: string | null
          provider: string
          started_at: string
          state_changed_at: string
          status: string
          tenant_id: string
          updated_at: string
          user_id: string
          user_name: string | null
          vm_id: string | null
          vm_name: string | null
          vm_released_at: string | null
          vm_size: string | null
          workspace_id: string
          workspace_name: string | null
          workspace_slug: string | null
        }
        Insert: {
          allocation_lock_token?: string | null
          assignment_id?: string | null
          billable_minutes?: number
          cleanup_attempts?: number
          cleanup_error?: string | null
          connection_status?: string
          correlation_id?: string
          created_at?: string
          duration_minutes?: number
          ended_at?: string | null
          ended_reason?: string | null
          error_code?: string | null
          expires_at: string
          extended_minutes?: number
          extension_count?: number
          gateway_cleaned_at?: string | null
          hourly_rate_cents?: number | null
          id?: string
          lab_id: string
          lab_mode?: Database["public"]["Enums"]["lab_mode"]
          lab_title?: string | null
          last_heartbeat_at?: string
          launch_key?: string | null
          max_extension_minutes?: number
          message?: string | null
          provider?: string
          started_at?: string
          state_changed_at?: string
          status?: string
          tenant_id: string
          updated_at?: string
          user_id: string
          user_name?: string | null
          vm_id?: string | null
          vm_name?: string | null
          vm_released_at?: string | null
          vm_size?: string | null
          workspace_id: string
          workspace_name?: string | null
          workspace_slug?: string | null
        }
        Update: {
          allocation_lock_token?: string | null
          assignment_id?: string | null
          billable_minutes?: number
          cleanup_attempts?: number
          cleanup_error?: string | null
          connection_status?: string
          correlation_id?: string
          created_at?: string
          duration_minutes?: number
          ended_at?: string | null
          ended_reason?: string | null
          error_code?: string | null
          expires_at?: string
          extended_minutes?: number
          extension_count?: number
          gateway_cleaned_at?: string | null
          hourly_rate_cents?: number | null
          id?: string
          lab_id?: string
          lab_mode?: Database["public"]["Enums"]["lab_mode"]
          lab_title?: string | null
          last_heartbeat_at?: string
          launch_key?: string | null
          max_extension_minutes?: number
          message?: string | null
          provider?: string
          started_at?: string
          state_changed_at?: string
          status?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
          user_name?: string | null
          vm_id?: string | null
          vm_name?: string | null
          vm_released_at?: string | null
          vm_size?: string | null
          workspace_id?: string
          workspace_name?: string | null
          workspace_slug?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sessions_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "lab_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_lab_id_fkey"
            columns: ["lab_id"]
            isOneToOne: false
            referencedRelation: "labs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      templates: {
        Row: {
          cloud_connection_id: string | null
          cloud_provider: Database["public"]["Enums"]["cloud_provider"]
          configuration: Json
          created_at: string
          created_by: string | null
          description: string | null
          gallery_name: string | null
          gallery_resource_group: string | null
          id: string
          image: string
          image_definition: string | null
          image_resource_id: string | null
          image_version: string | null
          name: string
          operating_system: string
          region: string
          status: Database["public"]["Enums"]["template_status"]
          tenant_id: string
          updated_at: string
          vm_size: string
        }
        Insert: {
          cloud_connection_id?: string | null
          cloud_provider?: Database["public"]["Enums"]["cloud_provider"]
          configuration?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          gallery_name?: string | null
          gallery_resource_group?: string | null
          id?: string
          image: string
          image_definition?: string | null
          image_resource_id?: string | null
          image_version?: string | null
          name: string
          operating_system: string
          region: string
          status?: Database["public"]["Enums"]["template_status"]
          tenant_id: string
          updated_at?: string
          vm_size: string
        }
        Update: {
          cloud_connection_id?: string | null
          cloud_provider?: Database["public"]["Enums"]["cloud_provider"]
          configuration?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          gallery_name?: string | null
          gallery_resource_group?: string | null
          id?: string
          image?: string
          image_definition?: string | null
          image_resource_id?: string | null
          image_version?: string | null
          name?: string
          operating_system?: string
          region?: string
          status?: Database["public"]["Enums"]["template_status"]
          tenant_id?: string
          updated_at?: string
          vm_size?: string
        }
        Relationships: [
          {
            foreignKeyName: "templates_cloud_connection_id_fkey"
            columns: ["cloud_connection_id"]
            isOneToOne: false
            referencedRelation: "cloud_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          id: string
          max_concurrent_sessions: number | null
          max_session_minutes: number | null
          monthly_budget_cents: number | null
          monthly_vm_hour_budget: number | null
          name: string
          plan: string
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          max_concurrent_sessions?: number | null
          max_session_minutes?: number | null
          monthly_budget_cents?: number | null
          monthly_vm_hour_budget?: number | null
          name: string
          plan?: string
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          max_concurrent_sessions?: number | null
          max_session_minutes?: number | null
          monthly_budget_cents?: number | null
          monthly_vm_hour_budget?: number | null
          name?: string
          plan?: string
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      vm_pool_entries: {
        Row: {
          allocation_expires_at: string | null
          allocation_lock_token: string | null
          assigned_user_id: string | null
          assigned_user_name: string | null
          azure_missing: boolean
          azure_resource_id: string
          azure_vm_name: string
          cloud_connection_id: string
          cloud_connection_name: string
          created_at: string
          current_session_id: string | null
          drift_detail: string | null
          drift_detected: boolean
          id: string
          image_version: string | null
          lab_id: string | null
          last_azure_event_at: string | null
          last_error: string | null
          last_event_source: string | null
          last_event_type: string | null
          last_reconciled_at: string | null
          last_synced_at: string | null
          mock: boolean
          name: string
          orphaned: boolean
          os_type: string
          power_state: string
          private_ip: string | null
          region: string
          resource_group: string
          status: string
          subscription_id: string
          template_id: string
          template_name: string
          tenant_id: string | null
          updated_at: string
          vm_size: string
          workspace_id: string | null
        }
        Insert: {
          allocation_expires_at?: string | null
          allocation_lock_token?: string | null
          assigned_user_id?: string | null
          assigned_user_name?: string | null
          azure_missing?: boolean
          azure_resource_id: string
          azure_vm_name: string
          cloud_connection_id: string
          cloud_connection_name: string
          created_at?: string
          current_session_id?: string | null
          drift_detail?: string | null
          drift_detected?: boolean
          id: string
          image_version?: string | null
          lab_id?: string | null
          last_azure_event_at?: string | null
          last_error?: string | null
          last_event_source?: string | null
          last_event_type?: string | null
          last_reconciled_at?: string | null
          last_synced_at?: string | null
          mock?: boolean
          name: string
          orphaned?: boolean
          os_type?: string
          power_state?: string
          private_ip?: string | null
          region: string
          resource_group: string
          status?: string
          subscription_id: string
          template_id: string
          template_name: string
          tenant_id?: string | null
          updated_at?: string
          vm_size: string
          workspace_id?: string | null
        }
        Update: {
          allocation_expires_at?: string | null
          allocation_lock_token?: string | null
          assigned_user_id?: string | null
          assigned_user_name?: string | null
          azure_missing?: boolean
          azure_resource_id?: string
          azure_vm_name?: string
          cloud_connection_id?: string
          cloud_connection_name?: string
          created_at?: string
          current_session_id?: string | null
          drift_detail?: string | null
          drift_detected?: boolean
          id?: string
          image_version?: string | null
          lab_id?: string | null
          last_azure_event_at?: string | null
          last_error?: string | null
          last_event_source?: string | null
          last_event_type?: string | null
          last_reconciled_at?: string | null
          last_synced_at?: string | null
          mock?: boolean
          name?: string
          orphaned?: boolean
          os_type?: string
          power_state?: string
          private_ip?: string | null
          region?: string
          resource_group?: string
          status?: string
          subscription_id?: string
          template_id?: string
          template_name?: string
          tenant_id?: string | null
          updated_at?: string
          vm_size?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vm_pool_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      vm_records: {
        Row: {
          allocation_lock_token: string | null
          allocation_locked_until: string | null
          assigned_user_id: string | null
          azure_resource_id: string
          azure_vm_name: string
          connection_id: string
          created_at: string
          current_session_id: string | null
          id: string
          last_error: string | null
          last_heartbeat_at: string | null
          last_synced_at: string | null
          name: string
          power_state: string | null
          private_ip: string | null
          region: string
          resource_group: string
          status: Database["public"]["Enums"]["pool_vm_status"]
          template_id: string | null
          tenant_id: string
          updated_at: string
          vm_size: string
          workspace_id: string | null
        }
        Insert: {
          allocation_lock_token?: string | null
          allocation_locked_until?: string | null
          assigned_user_id?: string | null
          azure_resource_id: string
          azure_vm_name: string
          connection_id: string
          created_at?: string
          current_session_id?: string | null
          id?: string
          last_error?: string | null
          last_heartbeat_at?: string | null
          last_synced_at?: string | null
          name: string
          power_state?: string | null
          private_ip?: string | null
          region: string
          resource_group: string
          status?: Database["public"]["Enums"]["pool_vm_status"]
          template_id?: string | null
          tenant_id: string
          updated_at?: string
          vm_size: string
          workspace_id?: string | null
        }
        Update: {
          allocation_lock_token?: string | null
          allocation_locked_until?: string | null
          assigned_user_id?: string | null
          azure_resource_id?: string
          azure_vm_name?: string
          connection_id?: string
          created_at?: string
          current_session_id?: string | null
          id?: string
          last_error?: string | null
          last_heartbeat_at?: string | null
          last_synced_at?: string | null
          name?: string
          power_state?: string | null
          private_ip?: string | null
          region?: string
          resource_group?: string
          status?: Database["public"]["Enums"]["pool_vm_status"]
          template_id?: string | null
          tenant_id?: string
          updated_at?: string
          vm_size?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vm_records_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "cloud_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vm_records_session_fk"
            columns: ["current_session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vm_records_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vm_records_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vm_records_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_users: {
        Row: {
          accepted_at: string | null
          capabilities: string[]
          created_at: string
          id: string
          invited_at: string | null
          invited_by: string | null
          role: string
          status: Database["public"]["Enums"]["account_status"]
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          capabilities?: string[]
          created_at?: string
          id?: string
          invited_at?: string | null
          invited_by?: string | null
          role?: string
          status?: Database["public"]["Enums"]["account_status"]
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          capabilities?: string[]
          created_at?: string
          id?: string
          invited_at?: string | null
          invited_by?: string | null
          role?: string
          status?: Database["public"]["Enums"]["account_status"]
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_users_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          access_type: Database["public"]["Enums"]["access_type"]
          cloud_connection_id: string | null
          created_at: string
          created_by: string | null
          default_template_id: string | null
          description: string | null
          id: string
          max_concurrent_sessions: number | null
          max_session_minutes: number | null
          monthly_budget_cents: number | null
          monthly_vm_hour_budget: number | null
          name: string
          organization_name: string
          public_landing: Json
          slug: string
          status: Database["public"]["Enums"]["workspace_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          access_type?: Database["public"]["Enums"]["access_type"]
          cloud_connection_id?: string | null
          created_at?: string
          created_by?: string | null
          default_template_id?: string | null
          description?: string | null
          id?: string
          max_concurrent_sessions?: number | null
          max_session_minutes?: number | null
          monthly_budget_cents?: number | null
          monthly_vm_hour_budget?: number | null
          name: string
          organization_name: string
          public_landing?: Json
          slug: string
          status?: Database["public"]["Enums"]["workspace_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          access_type?: Database["public"]["Enums"]["access_type"]
          cloud_connection_id?: string | null
          created_at?: string
          created_by?: string | null
          default_template_id?: string | null
          description?: string | null
          id?: string
          max_concurrent_sessions?: number | null
          max_session_minutes?: number | null
          monthly_budget_cents?: number | null
          monthly_vm_hour_budget?: number | null
          name?: string
          organization_name?: string
          public_landing?: Json
          slug?: string
          status?: Database["public"]["Enums"]["workspace_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_cloud_connection_fk"
            columns: ["cloud_connection_id"]
            isOneToOne: false
            referencedRelation: "cloud_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspaces_default_template_fk"
            columns: ["default_template_id"]
            isOneToOne: false
            referencedRelation: "templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspaces_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      access_type: "WORKSPACE_URL" | "USER_SESSION_URL"
      account_status: "active" | "invited" | "suspended" | "disabled"
      app_role: "superadmin" | "admin" | "user"
      assignment_status: "assigned" | "in_progress" | "completed" | "revoked"
      cloud_provider: "azure"
      connection_health: "unknown" | "healthy" | "degraded" | "failed"
      gateway_status:
        | "PENDING"
        | "CONNECTING"
        | "CONNECTED"
        | "DISCONNECTED"
        | "ERROR"
        | "CLEANED"
      lab_mode: "session_based" | "persistent"
      lab_status: "draft" | "configured" | "published" | "archived"
      persistence_policy: "keep_vm" | "keep_disk" | "snapshot_restore"
      pool_vm_status:
        | "AVAILABLE"
        | "ALLOCATED"
        | "STARTING"
        | "READY"
        | "IN_USE"
        | "STOPPING"
        | "STOPPED"
        | "ERROR"
        | "RETIRED"
      session_status: "PENDING" | "ACTIVE" | "EXPIRED" | "STOPPED" | "ERROR"
      template_status: "draft" | "active" | "archived"
      workspace_status: "active" | "draft" | "archived" | "suspended"
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
    Enums: {
      access_type: ["WORKSPACE_URL", "USER_SESSION_URL"],
      account_status: ["active", "invited", "suspended", "disabled"],
      app_role: ["superadmin", "admin", "user"],
      assignment_status: ["assigned", "in_progress", "completed", "revoked"],
      cloud_provider: ["azure"],
      connection_health: ["unknown", "healthy", "degraded", "failed"],
      gateway_status: [
        "PENDING",
        "CONNECTING",
        "CONNECTED",
        "DISCONNECTED",
        "ERROR",
        "CLEANED",
      ],
      lab_mode: ["session_based", "persistent"],
      lab_status: ["draft", "configured", "published", "archived"],
      persistence_policy: ["keep_vm", "keep_disk", "snapshot_restore"],
      pool_vm_status: [
        "AVAILABLE",
        "ALLOCATED",
        "STARTING",
        "READY",
        "IN_USE",
        "STOPPING",
        "STOPPED",
        "ERROR",
        "RETIRED",
      ],
      session_status: ["PENDING", "ACTIVE", "EXPIRED", "STOPPED", "ERROR"],
      template_status: ["draft", "active", "archived"],
      workspace_status: ["active", "draft", "archived", "suspended"],
    },
  },
} as const
