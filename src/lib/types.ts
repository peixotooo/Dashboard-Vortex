export interface Campaign {
  id: string;
  name: string;
  status: "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED";
  objective: string;
  daily_budget?: string;
  lifetime_budget?: string;
  budget_remaining?: string;
  created_time?: string;
  updated_time?: string;
  start_time?: string;
  stop_time?: string;
  special_ad_categories?: string[];
  bid_strategy?: string;
}

export interface AdSet {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  campaign_id: string;
  daily_budget?: string;
  lifetime_budget?: string;
  optimization_goal?: string;
  billing_event?: string;
  targeting?: Targeting;
  created_time?: string;
}

export interface Targeting {
  age_min?: number;
  age_max?: number;
  genders?: number[];
  geo_locations?: {
    countries?: string[];
    cities?: { key: string; name: string }[];
  };
  interests?: { id: string; name: string }[];
  behaviors?: { id: string; name: string }[];
}

export interface Ad {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  campaign_id: string;
  adset_id: string;
  creative?: { id: string };
  created_time?: string;
}

export interface InsightMetrics {
  date_start: string;
  date_stop: string;
  impressions: string;
  clicks: string;
  spend: string;
  reach?: string;
  frequency?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  actions?: { action_type: string; value: string }[];
  cost_per_action_type?: { action_type: string; value: string }[];
  // Breakdown fields
  age?: string;
  gender?: string;
  placement?: string;
  device_platform?: string;
  country?: string;
}

export interface Audience {
  id: string;
  name: string;
  subtype: string;
  description?: string;
  approximate_count?: number;
  data_source?: {
    type: string;
    sub_type?: string;
  };
  delivery_status?: {
    status: string;
  };
  time_created?: string;
  time_updated?: string;
}

export interface Creative {
  id: string;
  name: string;
  title?: string;
  body?: string;
  image_url?: string;
  video_id?: string;
  call_to_action_type?: string;
  status?: string;
  thumbnail_url?: string;
}

export interface AdAccount {
  id: string;
  account_id: string;
  name: string;
  account_status: number;
  currency: string;
  timezone_name?: string;
  business_name?: string;
  amount_spent?: string;
}

export type DatePreset =
  | "today"
  | "yesterday"
  | "last_7d"
  | "last_14d"
  | "last_30d"
  | "last_90d"
  | "this_month"
  | "last_month";

export type BreakdownType =
  | "age"
  | "gender"
  | "placement"
  | "device_platform"
  | "country";

export interface McpToolResult {
  success?: boolean;
  error?: string;
  message?: string;
  [key: string]: unknown;
}
