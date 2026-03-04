export type SsoType = "none" | "saml" | "oauth" | "direct_link" | "jwt";
export type AppStatus = "active" | "inactive" | "maintenance";

export interface LauncherApp {
  id: string;
  name: string;
  description: string | null;
  url: string;
  icon_url: string | null;
  sso_type: SsoType;
  status: AppStatus;
  display_order: number;
  open_in_new_tab: boolean;
  created_at: string;
  updated_at: string;
}

export interface LauncherRole {
  name: string;
  display_name: string;
  description: string | null;
  is_admin: boolean;
}

export interface RoleAppAccess {
  role_name: string;
  app_id: string;
}

export interface SsoConfig {
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
  jwt_acs_url: string | null;
  jwt_audience: string | null;
  created_at: string;
  updated_at: string;
}

export interface SsoAuditLog {
  id: string;
  user_id: string;
  app_id: string;
  event_type: string;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface AppWithAccess extends LauncherApp {
  roles: string[];
  sso_config?: SsoConfig | null;
}
