export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          name: string | null;
          role: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          email: string;
          name?: string | null;
          role?: string;
        };
        Update: {
          email?: string;
          name?: string | null;
          role?: string;
        };
      };
      launcher_apps: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          url: string;
          icon_url: string | null;
          sso_type: string;
          status: string;
          display_order: number;
          open_in_new_tab: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          url: string;
          icon_url?: string | null;
          sso_type?: string;
          status?: string;
          display_order?: number;
          open_in_new_tab?: boolean;
        };
        Update: {
          name?: string;
          description?: string | null;
          url?: string;
          icon_url?: string | null;
          sso_type?: string;
          status?: string;
          display_order?: number;
          open_in_new_tab?: boolean;
        };
      };
      launcher_roles: {
        Row: {
          name: string;
          display_name: string;
          description: string | null;
          is_admin: boolean;
        };
        Insert: {
          name: string;
          display_name: string;
          description?: string | null;
          is_admin?: boolean;
        };
        Update: {
          display_name?: string;
          description?: string | null;
          is_admin?: boolean;
        };
      };
      launcher_role_app_access: {
        Row: {
          role_name: string;
          app_id: string;
        };
        Insert: {
          role_name: string;
          app_id: string;
        };
        Update: {
          role_name?: string;
          app_id?: string;
        };
      };
      launcher_sso_configs: {
        Row: {
          id: string;
          app_id: string;
          sp_entity_id: string | null;
          acs_url: string | null;
          slo_url: string | null;
          sp_cert: string | null;
          name_id_format: string;
          attribute_mapping: Record<string, string> | null;
          oauth_client_id: string | null;
          oauth_client_secret: string | null;
          oauth_authorize_url: string | null;
          oauth_token_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          app_id: string;
          sp_entity_id?: string | null;
          acs_url?: string | null;
          slo_url?: string | null;
          sp_cert?: string | null;
          name_id_format?: string;
          attribute_mapping?: Record<string, string> | null;
          oauth_client_id?: string | null;
          oauth_client_secret?: string | null;
          oauth_authorize_url?: string | null;
          oauth_token_url?: string | null;
        };
        Update: {
          sp_entity_id?: string | null;
          acs_url?: string | null;
          slo_url?: string | null;
          sp_cert?: string | null;
          name_id_format?: string;
          attribute_mapping?: Record<string, string> | null;
          oauth_client_id?: string | null;
          oauth_client_secret?: string | null;
          oauth_authorize_url?: string | null;
          oauth_token_url?: string | null;
        };
      };
      launcher_sso_audit_log: {
        Row: {
          id: string;
          user_id: string;
          app_id: string;
          event_type: string;
          details: Record<string, unknown> | null;
          ip_address: string | null;
          user_agent: string | null;
          created_at: string;
        };
        Insert: {
          user_id: string;
          app_id: string;
          event_type: string;
          details?: Record<string, unknown> | null;
          ip_address?: string | null;
          user_agent?: string | null;
        };
        Update: never;
      };
    };
  };
}
