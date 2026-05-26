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
      achievements: {
        Row: {
          achievement: string
          id: string
          metadata: Json | null
          unlocked_at: string
          user_id: string
        }
        Insert: {
          achievement: string
          id?: string
          metadata?: Json | null
          unlocked_at?: string
          user_id: string
        }
        Update: {
          achievement?: string
          id?: string
          metadata?: Json | null
          unlocked_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "achievements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_snapshots: {
        Row: {
          computed_at: string
          data: Json
          id: string
          snapshot_date: string
          snapshot_type: string
        }
        Insert: {
          computed_at?: string
          data: Json
          id?: string
          snapshot_date: string
          snapshot_type: string
        }
        Update: {
          computed_at?: string
          data?: Json
          id?: string
          snapshot_date?: string
          snapshot_type?: string
        }
        Relationships: []
      }
      api_keys: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          permissions: string[]
          rate_limit_per_minute: number
          revoked: boolean
          total_requests: number
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          permissions?: string[]
          rate_limit_per_minute?: number
          revoked?: boolean
          total_requests?: number
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          permissions?: string[]
          rate_limit_per_minute?: number
          revoked?: boolean
          total_requests?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      api_usage: {
        Row: {
          api_key_id: string
          count: number
          window_start: string
        }
        Insert: {
          api_key_id: string
          count?: number
          window_start: string
        }
        Update: {
          api_key_id?: string
          count?: number
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_usage_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      api_usage_meter: {
        Row: {
          calls: number
          id: string
          included_quota: number
          overage_billed_usd: number
          overage_calls: number
          overage_rate_usd: number
          period_month: string
          updated_at: string
          user_id: string
        }
        Insert: {
          calls?: number
          id?: string
          included_quota?: number
          overage_billed_usd?: number
          overage_calls?: number
          overage_rate_usd?: number
          period_month: string
          updated_at?: string
          user_id: string
        }
        Update: {
          calls?: number
          id?: string
          included_quota?: number
          overage_billed_usd?: number
          overage_calls?: number
          overage_rate_usd?: number
          period_month?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_usage_meter_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          after_state: Json | null
          before_state: Json | null
          created_at: string
          id: string
          ip_address: string | null
          resource_id: string | null
          resource_type: string
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string
          id?: string
          ip_address?: string | null
          resource_id?: string | null
          resource_type: string
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string
          id?: string
          ip_address?: string | null
          resource_id?: string | null
          resource_type?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      broker_connections: {
        Row: {
          access_token_enc: string | null
          account_id: string | null
          api_key_enc: string | null
          api_secret_enc: string | null
          broker: string
          created_at: string
          equity_updated_at: string | null
          equity_usd: number | null
          error_message: string | null
          id: string
          is_default: boolean
          is_live: boolean
          is_testnet: boolean
          label: string | null
          last_synced_at: string | null
          metaapi_token_enc: string | null
          passphrase_enc: string | null
          pending_cycles: number
          state_changed_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token_enc?: string | null
          account_id?: string | null
          api_key_enc?: string | null
          api_secret_enc?: string | null
          broker: string
          created_at?: string
          equity_updated_at?: string | null
          equity_usd?: number | null
          error_message?: string | null
          id?: string
          is_default?: boolean
          is_live?: boolean
          is_testnet?: boolean
          label?: string | null
          last_synced_at?: string | null
          metaapi_token_enc?: string | null
          passphrase_enc?: string | null
          pending_cycles?: number
          state_changed_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token_enc?: string | null
          account_id?: string | null
          api_key_enc?: string | null
          api_secret_enc?: string | null
          broker?: string
          created_at?: string
          equity_updated_at?: string | null
          equity_usd?: number | null
          error_message?: string | null
          id?: string
          is_default?: boolean
          is_live?: boolean
          is_testnet?: boolean
          label?: string | null
          last_synced_at?: string | null
          metaapi_token_enc?: string | null
          passphrase_enc?: string | null
          pending_cycles?: number
          state_changed_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "broker_connections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_alerts: {
        Row: {
          acknowledged: boolean
          created_at: string
          id: string
          kind: string
          payload: Json
          severity: string
          title: string
          user_id: string
        }
        Insert: {
          acknowledged?: boolean
          created_at?: string
          id?: string
          kind: string
          payload?: Json
          severity?: string
          title: string
          user_id: string
        }
        Update: {
          acknowledged?: boolean
          created_at?: string
          id?: string
          kind?: string
          payload?: Json
          severity?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_alerts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_reports: {
        Row: {
          body_markdown: string
          created_at: string
          id: string
          metrics: Json
          period_end: string
          period_start: string
          scope: string
          user_id: string
        }
        Insert: {
          body_markdown: string
          created_at?: string
          id?: string
          metrics?: Json
          period_end: string
          period_start: string
          scope: string
          user_id: string
        }
        Update: {
          body_markdown?: string
          created_at?: string
          id?: string
          metrics?: Json
          period_end?: string
          period_start?: string
          scope?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_reports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_state: {
        Row: {
          computed_at: string
          current_loss_streak: number
          discipline_score: number | null
          max_loss_streak: number
          oversize_events: number
          revenge_events: number
          sizing_cv: number | null
          trades: number
          trades_per_active_hour: number | null
          user_id: string
          win_rate: number | null
          win_rate_after_losses: number | null
          window_days: number
        }
        Insert: {
          computed_at?: string
          current_loss_streak?: number
          discipline_score?: number | null
          max_loss_streak?: number
          oversize_events?: number
          revenge_events?: number
          sizing_cv?: number | null
          trades?: number
          trades_per_active_hour?: number | null
          user_id: string
          win_rate?: number | null
          win_rate_after_losses?: number | null
          window_days?: number
        }
        Update: {
          computed_at?: string
          current_loss_streak?: number
          discipline_score?: number | null
          max_loss_streak?: number
          oversize_events?: number
          revenge_events?: number
          sizing_cv?: number | null
          trades?: number
          trades_per_active_hour?: number | null
          user_id?: string
          win_rate?: number | null
          win_rate_after_losses?: number | null
          window_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "coach_state_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      community_memberships: {
        Row: {
          access_granted: boolean
          amount_paid_usd: number
          cancelled_at: string | null
          community_id: string
          expires_at: string | null
          id: string
          member_id: string
          plan: string
          started_at: string
          status: string
          telegram_user_id: number | null
        }
        Insert: {
          access_granted?: boolean
          amount_paid_usd?: number
          cancelled_at?: string | null
          community_id: string
          expires_at?: string | null
          id?: string
          member_id: string
          plan?: string
          started_at?: string
          status?: string
          telegram_user_id?: number | null
        }
        Update: {
          access_granted?: boolean
          amount_paid_usd?: number
          cancelled_at?: string | null
          community_id?: string
          expires_at?: string | null
          id?: string
          member_id?: string
          plan?: string
          started_at?: string
          status?: string
          telegram_user_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "community_memberships_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "premium_communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_memberships_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      competitions: {
        Row: {
          created_at: string
          description: string | null
          ends_at: string
          id: string
          metric: string
          min_trades: number | null
          name: string
          prize_pool_usd: number | null
          slug: string
          starts_at: string
          status: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          ends_at: string
          id?: string
          metric?: string
          min_trades?: number | null
          name: string
          prize_pool_usd?: number | null
          slug: string
          starts_at: string
          status?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          ends_at?: string
          id?: string
          metric?: string
          min_trades?: number | null
          name?: string
          prize_pool_usd?: number | null
          slug?: string
          starts_at?: string
          status?: string
        }
        Relationships: []
      }
      content_reports: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          reason: string
          reporter_id: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
          target_id: string
          target_type: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          reason: string
          reporter_id: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          target_id: string
          target_type: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          reason?: string
          reporter_id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_reports_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      copy_health: {
        Row: {
          avg_lag_ms: number | null
          desync_open: number
          failed: number
          failed_rate: number | null
          fill_rate: number | null
          filled: number
          follower_id: string
          health_label: string | null
          health_score: number | null
          leader_id: string | null
          p95_lag_ms: number | null
          rejected: number
          subscription_id: string
          total_jobs: number
          updated_at: string
          window_hours: number
        }
        Insert: {
          avg_lag_ms?: number | null
          desync_open?: number
          failed?: number
          failed_rate?: number | null
          fill_rate?: number | null
          filled?: number
          follower_id: string
          health_label?: string | null
          health_score?: number | null
          leader_id?: string | null
          p95_lag_ms?: number | null
          rejected?: number
          subscription_id: string
          total_jobs?: number
          updated_at?: string
          window_hours?: number
        }
        Update: {
          avg_lag_ms?: number | null
          desync_open?: number
          failed?: number
          failed_rate?: number | null
          fill_rate?: number | null
          filled?: number
          follower_id?: string
          health_label?: string | null
          health_score?: number | null
          leader_id?: string | null
          p95_lag_ms?: number | null
          rejected?: number
          subscription_id?: string
          total_jobs?: number
          updated_at?: string
          window_hours?: number
        }
        Relationships: [
          {
            foreignKeyName: "copy_health_follower_id_fkey"
            columns: ["follower_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copy_health_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: true
            referencedRelation: "strategy_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      copy_jobs: {
        Row: {
          allocation_model: string | null
          attempts: number
          available_at: string
          broker: string | null
          claimed_at: string | null
          claimed_by: string | null
          client_order_id: string | null
          computed_lot: number | null
          copy_trade_id: string | null
          created_at: string
          filled_at: string | null
          follower_id: string
          id: string
          kind: string
          last_error: string | null
          leader_id: string
          max_attempts: number
          risk_passed_at: string | null
          risk_reason: string | null
          signal_event_id: string
          status: string
          subscription_id: string
          trace_id: string | null
          updated_at: string
        }
        Insert: {
          allocation_model?: string | null
          attempts?: number
          available_at?: string
          broker?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          client_order_id?: string | null
          computed_lot?: number | null
          copy_trade_id?: string | null
          created_at?: string
          filled_at?: string | null
          follower_id: string
          id?: string
          kind?: string
          last_error?: string | null
          leader_id: string
          max_attempts?: number
          risk_passed_at?: string | null
          risk_reason?: string | null
          signal_event_id: string
          status?: string
          subscription_id: string
          trace_id?: string | null
          updated_at?: string
        }
        Update: {
          allocation_model?: string | null
          attempts?: number
          available_at?: string
          broker?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          client_order_id?: string | null
          computed_lot?: number | null
          copy_trade_id?: string | null
          created_at?: string
          filled_at?: string | null
          follower_id?: string
          id?: string
          kind?: string
          last_error?: string | null
          leader_id?: string
          max_attempts?: number
          risk_passed_at?: string | null
          risk_reason?: string | null
          signal_event_id?: string
          status?: string
          subscription_id?: string
          trace_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "copy_jobs_copy_trade_id_fkey"
            columns: ["copy_trade_id"]
            isOneToOne: false
            referencedRelation: "copy_trades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copy_jobs_follower_id_fkey"
            columns: ["follower_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copy_jobs_leader_id_fkey"
            columns: ["leader_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copy_jobs_signal_event_id_fkey"
            columns: ["signal_event_id"]
            isOneToOne: false
            referencedRelation: "signal_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copy_jobs_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "strategy_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      copy_jobs_dlq: {
        Row: {
          attempts: number
          broker: string | null
          created_at: string
          failure_category: string
          follower_id: string
          id: string
          job_snapshot: Json
          last_error: string | null
          leader_id: string | null
          original_job_id: string | null
          replay_job_id: string | null
          replay_of: string | null
          replayed_at: string | null
          signal_event_id: string | null
          subscription_id: string | null
          trace_id: string | null
        }
        Insert: {
          attempts?: number
          broker?: string | null
          created_at?: string
          failure_category?: string
          follower_id: string
          id?: string
          job_snapshot?: Json
          last_error?: string | null
          leader_id?: string | null
          original_job_id?: string | null
          replay_job_id?: string | null
          replay_of?: string | null
          replayed_at?: string | null
          signal_event_id?: string | null
          subscription_id?: string | null
          trace_id?: string | null
        }
        Update: {
          attempts?: number
          broker?: string | null
          created_at?: string
          failure_category?: string
          follower_id?: string
          id?: string
          job_snapshot?: Json
          last_error?: string | null
          leader_id?: string | null
          original_job_id?: string | null
          replay_job_id?: string | null
          replay_of?: string | null
          replayed_at?: string | null
          signal_event_id?: string | null
          subscription_id?: string | null
          trace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "copy_jobs_dlq_follower_id_fkey"
            columns: ["follower_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copy_jobs_dlq_replay_of_fkey"
            columns: ["replay_of"]
            isOneToOne: false
            referencedRelation: "copy_jobs_dlq"
            referencedColumns: ["id"]
          },
        ]
      }
      copy_reconciliation: {
        Row: {
          copy_job_id: string | null
          copy_trade_id: string | null
          detected_at: string
          expected: Json | null
          follower_id: string
          id: string
          kind: string
          observed: Json | null
          resolution: string | null
          resolved_at: string | null
          severity: string
        }
        Insert: {
          copy_job_id?: string | null
          copy_trade_id?: string | null
          detected_at?: string
          expected?: Json | null
          follower_id: string
          id?: string
          kind: string
          observed?: Json | null
          resolution?: string | null
          resolved_at?: string | null
          severity?: string
        }
        Update: {
          copy_job_id?: string | null
          copy_trade_id?: string | null
          detected_at?: string
          expected?: Json | null
          follower_id?: string
          id?: string
          kind?: string
          observed?: Json | null
          resolution?: string | null
          resolved_at?: string | null
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "copy_reconciliation_copy_job_id_fkey"
            columns: ["copy_job_id"]
            isOneToOne: false
            referencedRelation: "copy_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copy_reconciliation_copy_trade_id_fkey"
            columns: ["copy_trade_id"]
            isOneToOne: false
            referencedRelation: "copy_trades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copy_reconciliation_follower_id_fkey"
            columns: ["follower_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      copy_trades: {
        Row: {
          broker: string | null
          broker_order_id: string | null
          closed_at: string | null
          copy_mode: string
          created_at: string
          direction: string
          earnings_settled: boolean
          follower_entry: number | null
          follower_id: string
          follower_lot: number | null
          follower_pnl: number | null
          follower_pnl_pct: number | null
          id: string
          leader_entry: number | null
          leader_id: string
          leader_lot: number | null
          leader_pnl: number | null
          opened_at: string | null
          scale_factor: number | null
          signal_id: string | null
          skip_reason: string | null
          slippage_pct: number | null
          status: string
          stop_loss: number | null
          subscription_id: string
          symbol: string
          take_profit: number | null
        }
        Insert: {
          broker?: string | null
          broker_order_id?: string | null
          closed_at?: string | null
          copy_mode: string
          created_at?: string
          direction: string
          earnings_settled?: boolean
          follower_entry?: number | null
          follower_id: string
          follower_lot?: number | null
          follower_pnl?: number | null
          follower_pnl_pct?: number | null
          id?: string
          leader_entry?: number | null
          leader_id: string
          leader_lot?: number | null
          leader_pnl?: number | null
          opened_at?: string | null
          scale_factor?: number | null
          signal_id?: string | null
          skip_reason?: string | null
          slippage_pct?: number | null
          status?: string
          stop_loss?: number | null
          subscription_id: string
          symbol: string
          take_profit?: number | null
        }
        Update: {
          broker?: string | null
          broker_order_id?: string | null
          closed_at?: string | null
          copy_mode?: string
          created_at?: string
          direction?: string
          earnings_settled?: boolean
          follower_entry?: number | null
          follower_id?: string
          follower_lot?: number | null
          follower_pnl?: number | null
          follower_pnl_pct?: number | null
          id?: string
          leader_entry?: number | null
          leader_id?: string
          leader_lot?: number | null
          leader_pnl?: number | null
          opened_at?: string | null
          scale_factor?: number | null
          signal_id?: string | null
          skip_reason?: string | null
          slippage_pct?: number | null
          status?: string
          stop_loss?: number | null
          subscription_id?: string
          symbol?: string
          take_profit?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "copy_trades_follower_id_fkey"
            columns: ["follower_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copy_trades_leader_id_fkey"
            columns: ["leader_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copy_trades_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copy_trades_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "strategy_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      creator_earnings: {
        Row: {
          created_at: string
          creator_id: string
          creator_pct: number
          creator_usd: number
          earning_type: string
          gross_usd: number
          hwm_basis: number | null
          hwm_new: number | null
          id: string
          paid_at: string | null
          payout_txid: string | null
          payout_wallet: string | null
          period_end: string | null
          period_start: string | null
          platform_fee_pct: number
          platform_fee_usd: number
          status: string
          strategy_id: string | null
          subscriber_id: string | null
        }
        Insert: {
          created_at?: string
          creator_id: string
          creator_pct: number
          creator_usd: number
          earning_type: string
          gross_usd: number
          hwm_basis?: number | null
          hwm_new?: number | null
          id?: string
          paid_at?: string | null
          payout_txid?: string | null
          payout_wallet?: string | null
          period_end?: string | null
          period_start?: string | null
          platform_fee_pct: number
          platform_fee_usd: number
          status?: string
          strategy_id?: string | null
          subscriber_id?: string | null
        }
        Update: {
          created_at?: string
          creator_id?: string
          creator_pct?: number
          creator_usd?: number
          earning_type?: string
          gross_usd?: number
          hwm_basis?: number | null
          hwm_new?: number | null
          id?: string
          paid_at?: string | null
          payout_txid?: string | null
          payout_wallet?: string | null
          period_end?: string | null
          period_start?: string | null
          platform_fee_pct?: number
          platform_fee_usd?: number
          status?: string
          strategy_id?: string | null
          subscriber_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "creator_earnings_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creator_earnings_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "published_strategies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creator_earnings_subscriber_id_fkey"
            columns: ["subscriber_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      creator_payout_requests: {
        Row: {
          amount_usd: number
          created_at: string
          creator_id: string
          earning_ids: string[]
          id: string
          minimum_met: boolean
          network: string
          processed_at: string | null
          rejection_reason: string | null
          status: string
          txid: string | null
          wallet_address: string
        }
        Insert: {
          amount_usd: number
          created_at?: string
          creator_id: string
          earning_ids: string[]
          id?: string
          minimum_met?: boolean
          network?: string
          processed_at?: string | null
          rejection_reason?: string | null
          status?: string
          txid?: string | null
          wallet_address: string
        }
        Update: {
          amount_usd?: number
          created_at?: string
          creator_id?: string
          earning_ids?: string[]
          id?: string
          minimum_met?: boolean
          network?: string
          processed_at?: string | null
          rejection_reason?: string | null
          status?: string
          txid?: string | null
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "creator_payout_requests_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      crypto_payments: {
        Row: {
          admin_note: string | null
          amount_usd: number
          billing_interval: string
          created_at: string
          currency: string
          expires_at: string
          id: string
          network: string
          plan: string
          reviewed_at: string | null
          reviewed_by: string | null
          screenshot_url: string | null
          status: string
          txid: string | null
          user_id: string
          wallet_address: string
        }
        Insert: {
          admin_note?: string | null
          amount_usd: number
          billing_interval?: string
          created_at?: string
          currency?: string
          expires_at?: string
          id?: string
          network?: string
          plan: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          screenshot_url?: string | null
          status?: string
          txid?: string | null
          user_id: string
          wallet_address: string
        }
        Update: {
          admin_note?: string | null
          amount_usd?: number
          billing_interval?: string
          created_at?: string
          currency?: string
          expires_at?: string
          id?: string
          network?: string
          plan?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          screenshot_url?: string | null
          status?: string
          txid?: string | null
          user_id?: string
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "crypto_payments_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crypto_payments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_mood_logs: {
        Row: {
          created_at: string
          feeling: string | null
          goals: string | null
          id: string
          log_date: string
          max_loss_usd: number | null
          pre_session_mood: string
          reflection: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          feeling?: string | null
          goals?: string | null
          id?: string
          log_date: string
          max_loss_usd?: number | null
          pre_session_mood: string
          reflection?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          feeling?: string | null
          goals?: string | null
          id?: string
          log_date?: string
          max_loss_usd?: number | null
          pre_session_mood?: string
          reflection?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_mood_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      discussion_replies: {
        Row: {
          author_id: string
          body: string
          created_at: string
          edited_at: string | null
          id: string
          is_flagged: boolean
          is_solution: boolean
          parent_reply_id: string | null
          thread_id: string
          votes_score: number
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          edited_at?: string | null
          id?: string
          is_flagged?: boolean
          is_solution?: boolean
          parent_reply_id?: string | null
          thread_id: string
          votes_score?: number
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          edited_at?: string | null
          id?: string
          is_flagged?: boolean
          is_solution?: boolean
          parent_reply_id?: string | null
          thread_id?: string
          votes_score?: number
        }
        Relationships: [
          {
            foreignKeyName: "discussion_replies_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discussion_replies_parent_reply_id_fkey"
            columns: ["parent_reply_id"]
            isOneToOne: false
            referencedRelation: "discussion_replies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discussion_replies_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "discussion_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      discussion_threads: {
        Row: {
          author_id: string
          body: string
          category: string
          created_at: string
          id: string
          is_locked: boolean
          is_resolved: boolean
          last_reply_at: string | null
          pinned_by: string | null
          replies_count: number
          tags: string[] | null
          title: string
          views_count: number
          votes_score: number
        }
        Insert: {
          author_id: string
          body: string
          category: string
          created_at?: string
          id?: string
          is_locked?: boolean
          is_resolved?: boolean
          last_reply_at?: string | null
          pinned_by?: string | null
          replies_count?: number
          tags?: string[] | null
          title: string
          views_count?: number
          votes_score?: number
        }
        Update: {
          author_id?: string
          body?: string
          category?: string
          created_at?: string
          id?: string
          is_locked?: boolean
          is_resolved?: boolean
          last_reply_at?: string | null
          pinned_by?: string | null
          replies_count?: number
          tags?: string[] | null
          title?: string
          views_count?: number
          votes_score?: number
        }
        Relationships: [
          {
            foreignKeyName: "discussion_threads_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discussion_threads_pinned_by_fkey"
            columns: ["pinned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      discussion_votes: {
        Row: {
          created_at: string
          target_id: string
          target_type: string
          user_id: string
          vote: number
        }
        Insert: {
          created_at?: string
          target_id: string
          target_type: string
          user_id: string
          vote: number
        }
        Update: {
          created_at?: string
          target_id?: string
          target_type?: string
          user_id?: string
          vote?: number
        }
        Relationships: [
          {
            foreignKeyName: "discussion_votes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      engine_circuit_breaker: {
        Row: {
          consecutive_losses: number | null
          daily_loss_count: number | null
          id: string
          is_open: boolean
          last_loss_at: string | null
          opens_at: string | null
          reason: string | null
          resets_at: string | null
          symbol: string
          updated_at: string
        }
        Insert: {
          consecutive_losses?: number | null
          daily_loss_count?: number | null
          id?: string
          is_open?: boolean
          last_loss_at?: string | null
          opens_at?: string | null
          reason?: string | null
          resets_at?: string | null
          symbol: string
          updated_at?: string
        }
        Update: {
          consecutive_losses?: number | null
          daily_loss_count?: number | null
          id?: string
          is_open?: boolean
          last_loss_at?: string | null
          opens_at?: string | null
          reason?: string | null
          resets_at?: string | null
          symbol?: string
          updated_at?: string
        }
        Relationships: []
      }
      enterprise_licenses: {
        Row: {
          account_manager: string | null
          api_rate_limit: number | null
          auto_renew: boolean
          billing_interval: string
          contact_email: string
          contact_name: string | null
          contract_end: string | null
          contract_start: string | null
          created_at: string
          custom_domain: string | null
          features_override: Json | null
          flat_monthly_fee: number | null
          id: string
          notes: string | null
          org_domain: string | null
          org_name: string
          plan: string
          price_per_seat: number | null
          seat_count: number
          seat_used: number
          sso_config: Json | null
          sso_provider: string | null
          status: string
          updated_at: string
          white_label_config: Json | null
        }
        Insert: {
          account_manager?: string | null
          api_rate_limit?: number | null
          auto_renew?: boolean
          billing_interval?: string
          contact_email: string
          contact_name?: string | null
          contract_end?: string | null
          contract_start?: string | null
          created_at?: string
          custom_domain?: string | null
          features_override?: Json | null
          flat_monthly_fee?: number | null
          id?: string
          notes?: string | null
          org_domain?: string | null
          org_name: string
          plan?: string
          price_per_seat?: number | null
          seat_count?: number
          seat_used?: number
          sso_config?: Json | null
          sso_provider?: string | null
          status?: string
          updated_at?: string
          white_label_config?: Json | null
        }
        Update: {
          account_manager?: string | null
          api_rate_limit?: number | null
          auto_renew?: boolean
          billing_interval?: string
          contact_email?: string
          contact_name?: string | null
          contract_end?: string | null
          contract_start?: string | null
          created_at?: string
          custom_domain?: string | null
          features_override?: Json | null
          flat_monthly_fee?: number | null
          id?: string
          notes?: string | null
          org_domain?: string | null
          org_name?: string
          plan?: string
          price_per_seat?: number | null
          seat_count?: number
          seat_used?: number
          sso_config?: Json | null
          sso_provider?: string | null
          status?: string
          updated_at?: string
          white_label_config?: Json | null
        }
        Relationships: []
      }
      enterprise_seats: {
        Row: {
          accepted_at: string | null
          email: string
          id: string
          invited_at: string
          license_id: string
          role: string
          status: string
          user_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          email: string
          id?: string
          invited_at?: string
          license_id: string
          role?: string
          status?: string
          user_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          email?: string
          id?: string
          invited_at?: string
          license_id?: string
          role?: string
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "enterprise_seats_license_id_fkey"
            columns: ["license_id"]
            isOneToOne: false
            referencedRelation: "enterprise_licenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enterprise_seats_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_events: {
        Row: {
          broker: string
          created_at: string
          event_type: string
          id: string
          payload: Json
          trace_id: string | null
          user_id: string
        }
        Insert: {
          broker: string
          created_at?: string
          event_type: string
          id?: string
          payload?: Json
          trace_id?: string | null
          user_id: string
        }
        Update: {
          broker?: string
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
          trace_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_logs: {
        Row: {
          broker_name: string | null
          broker_ticket_id: string | null
          close_price: number | null
          closed_at: string | null
          direction: string
          fill_price: number | null
          filled_at: string | null
          filled_lots: number | null
          id: string
          latency_ms: number | null
          mt5_account: string | null
          order_type: string
          realized_pips: number | null
          realized_pnl: number | null
          rejection_reason: string | null
          requested_at: string
          requested_lots: number
          requested_price: number
          signal_id: string | null
          slippage_pips: number | null
          spread_at_entry: number | null
          status: string
          symbol: string
          user_id: string
        }
        Insert: {
          broker_name?: string | null
          broker_ticket_id?: string | null
          close_price?: number | null
          closed_at?: string | null
          direction: string
          fill_price?: number | null
          filled_at?: string | null
          filled_lots?: number | null
          id?: string
          latency_ms?: number | null
          mt5_account?: string | null
          order_type: string
          realized_pips?: number | null
          realized_pnl?: number | null
          rejection_reason?: string | null
          requested_at?: string
          requested_lots: number
          requested_price: number
          signal_id?: string | null
          slippage_pips?: number | null
          spread_at_entry?: number | null
          status?: string
          symbol: string
          user_id: string
        }
        Update: {
          broker_name?: string | null
          broker_ticket_id?: string | null
          close_price?: number | null
          closed_at?: string | null
          direction?: string
          fill_price?: number | null
          filled_at?: string | null
          filled_lots?: number | null
          id?: string
          latency_ms?: number | null
          mt5_account?: string | null
          order_type?: string
          realized_pips?: number | null
          realized_pnl?: number | null
          rejection_reason?: string | null
          requested_at?: string
          requested_lots?: number
          requested_price?: number
          signal_id?: string | null
          slippage_pips?: number | null
          spread_at_entry?: number | null
          status?: string
          symbol?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_logs_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      global_risk_state: {
        Row: {
          activated_at: string | null
          activated_by: string | null
          id: boolean
          kill_switch: boolean
          reason: string | null
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          activated_by?: string | null
          id?: boolean
          kill_switch?: boolean
          reason?: string | null
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          activated_by?: string | null
          id?: boolean
          kill_switch?: boolean
          reason?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      journal_analytics: {
        Row: {
          avg_loss: number | null
          avg_win: number | null
          best_pair: string | null
          best_session: string | null
          by_hour: Json
          by_pair: Json
          by_session: Json
          by_tag: Json
          computed_at: string
          expectancy: number | null
          gross_loss: number | null
          gross_profit: number | null
          max_drawdown: number | null
          net_pnl: number | null
          profit_factor: number | null
          reward_risk: number | null
          trades: number
          user_id: string
          win_rate: number | null
          window_days: number
          worst_pair: string | null
        }
        Insert: {
          avg_loss?: number | null
          avg_win?: number | null
          best_pair?: string | null
          best_session?: string | null
          by_hour?: Json
          by_pair?: Json
          by_session?: Json
          by_tag?: Json
          computed_at?: string
          expectancy?: number | null
          gross_loss?: number | null
          gross_profit?: number | null
          max_drawdown?: number | null
          net_pnl?: number | null
          profit_factor?: number | null
          reward_risk?: number | null
          trades?: number
          user_id: string
          win_rate?: number | null
          window_days?: number
          worst_pair?: string | null
        }
        Update: {
          avg_loss?: number | null
          avg_win?: number | null
          best_pair?: string | null
          best_session?: string | null
          by_hour?: Json
          by_pair?: Json
          by_session?: Json
          by_tag?: Json
          computed_at?: string
          expectancy?: number | null
          gross_loss?: number | null
          gross_profit?: number | null
          max_drawdown?: number | null
          net_pnl?: number | null
          profit_factor?: number | null
          reward_risk?: number | null
          trades?: number
          user_id?: string
          win_rate?: number | null
          window_days?: number
          worst_pair?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_analytics_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_entries: {
        Row: {
          ai_review: string | null
          ai_score: number | null
          ai_tags: string[] | null
          auto_position_id: string | null
          broker: string | null
          created_at: string
          direction: string | null
          duration_ms: number | null
          emotion_post: string | null
          emotion_pre: string | null
          entry_price: number | null
          execution_event_id: string | null
          exit_price: number | null
          id: string
          improvements: string | null
          lot_size: number | null
          market_context: string | null
          mistakes: string[] | null
          notes: string | null
          pair: string | null
          pips: number | null
          pnl: number | null
          regime_at_entry: string | null
          risk_amount: number | null
          risk_pct: number | null
          rule_violation: boolean | null
          screenshot_url: string | null
          session: string | null
          setup_tag: string | null
          slippage_pct: number | null
          source: string
          timeframe: string | null
          trade_date: string | null
          user_id: string
          what_went_well: string | null
        }
        Insert: {
          ai_review?: string | null
          ai_score?: number | null
          ai_tags?: string[] | null
          auto_position_id?: string | null
          broker?: string | null
          created_at?: string
          direction?: string | null
          duration_ms?: number | null
          emotion_post?: string | null
          emotion_pre?: string | null
          entry_price?: number | null
          execution_event_id?: string | null
          exit_price?: number | null
          id?: string
          improvements?: string | null
          lot_size?: number | null
          market_context?: string | null
          mistakes?: string[] | null
          notes?: string | null
          pair?: string | null
          pips?: number | null
          pnl?: number | null
          regime_at_entry?: string | null
          risk_amount?: number | null
          risk_pct?: number | null
          rule_violation?: boolean | null
          screenshot_url?: string | null
          session?: string | null
          setup_tag?: string | null
          slippage_pct?: number | null
          source?: string
          timeframe?: string | null
          trade_date?: string | null
          user_id: string
          what_went_well?: string | null
        }
        Update: {
          ai_review?: string | null
          ai_score?: number | null
          ai_tags?: string[] | null
          auto_position_id?: string | null
          broker?: string | null
          created_at?: string
          direction?: string | null
          duration_ms?: number | null
          emotion_post?: string | null
          emotion_pre?: string | null
          entry_price?: number | null
          execution_event_id?: string | null
          exit_price?: number | null
          id?: string
          improvements?: string | null
          lot_size?: number | null
          market_context?: string | null
          mistakes?: string[] | null
          notes?: string | null
          pair?: string | null
          pips?: number | null
          pnl?: number | null
          regime_at_entry?: string | null
          risk_amount?: number | null
          risk_pct?: number | null
          rule_violation?: boolean | null
          screenshot_url?: string | null
          session?: string | null
          setup_tag?: string | null
          slippage_pct?: number | null
          source?: string
          timeframe?: string | null
          trade_date?: string | null
          user_id?: string
          what_went_well?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_entries_execution_event_id_fkey"
            columns: ["execution_event_id"]
            isOneToOne: false
            referencedRelation: "execution_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      launch_investors: {
        Row: {
          amount_usd: number
          created_at: string
          id: string
          investor_id: string | null
          launch_id: string
          status: string
          token_alloc: number | null
          txid: string | null
          wallet_address: string | null
        }
        Insert: {
          amount_usd: number
          created_at?: string
          id?: string
          investor_id?: string | null
          launch_id: string
          status?: string
          token_alloc?: number | null
          txid?: string | null
          wallet_address?: string | null
        }
        Update: {
          amount_usd?: number
          created_at?: string
          id?: string
          investor_id?: string | null
          launch_id?: string
          status?: string
          token_alloc?: number | null
          txid?: string | null
          wallet_address?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "launch_investors_investor_id_fkey"
            columns: ["investor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "launch_investors_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "token_launches"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          created_at: string
          email: string
          id: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
        }
        Relationships: []
      }
      news_items: {
        Row: {
          category: string | null
          fetched_at: string
          id: string
          impact: string | null
          published_at: string
          source: string
          title: string
          url: string
        }
        Insert: {
          category?: string | null
          fetched_at?: string
          id?: string
          impact?: string | null
          published_at: string
          source: string
          title: string
          url: string
        }
        Update: {
          category?: string | null
          fetched_at?: string
          id?: string
          impact?: string | null
          published_at?: string
          source?: string
          title?: string
          url?: string
        }
        Relationships: []
      }
      notification_log: {
        Row: {
          body: string | null
          channel: string
          error_msg: string | null
          event_type: string
          id: number
          provider_ref: string | null
          read_at: string | null
          sent_at: string
          status: string
          subject: string | null
          user_id: string
        }
        Insert: {
          body?: string | null
          channel: string
          error_msg?: string | null
          event_type: string
          id?: number
          provider_ref?: string | null
          read_at?: string | null
          sent_at?: string
          status?: string
          subject?: string | null
          user_id: string
        }
        Update: {
          body?: string | null
          channel?: string
          error_msg?: string | null
          event_type?: string
          id?: number
          provider_ref?: string | null
          read_at?: string | null
          sent_at?: string
          status?: string
          subject?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          email_enabled: boolean
          push_enabled: boolean
          quiet_end: string
          quiet_hours_enabled: boolean
          quiet_start: string
          quiet_timezone: string
          routing_rules: Json
          sms_enabled: boolean
          sms_number: string | null
          telegram_enabled: boolean
          updated_at: string
          user_id: string
          whatsapp_enabled: boolean
          whatsapp_number: string | null
        }
        Insert: {
          email_enabled?: boolean
          push_enabled?: boolean
          quiet_end?: string
          quiet_hours_enabled?: boolean
          quiet_start?: string
          quiet_timezone?: string
          routing_rules?: Json
          sms_enabled?: boolean
          sms_number?: string | null
          telegram_enabled?: boolean
          updated_at?: string
          user_id: string
          whatsapp_enabled?: boolean
          whatsapp_number?: string | null
        }
        Update: {
          email_enabled?: boolean
          push_enabled?: boolean
          quiet_end?: string
          quiet_hours_enabled?: boolean
          quiet_start?: string
          quiet_timezone?: string
          routing_rules?: Json
          sms_enabled?: boolean
          sms_number?: string | null
          telegram_enabled?: boolean
          updated_at?: string
          user_id?: string
          whatsapp_enabled?: boolean
          whatsapp_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      official_communities: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          display_order: number
          id: string
          invite_url: string
          member_count: number
          name: string
          platform: string
          required_tier: string
          slug: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          invite_url: string
          member_count?: number
          name: string
          platform: string
          required_tier?: string
          slug: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          invite_url?: string
          member_count?: number
          name?: string
          platform?: string
          required_tier?: string
          slug?: string
        }
        Relationships: []
      }
      order_idempotency: {
        Row: {
          avg_fill_price: number | null
          broker: string
          client_order_id: string
          created_at: string
          error: string | null
          filled_qty: number | null
          id: string
          order_id: string | null
          slippage_pct: number | null
          state: string
          status: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          avg_fill_price?: number | null
          broker: string
          client_order_id: string
          created_at?: string
          error?: string | null
          filled_qty?: number | null
          id?: string
          order_id?: string | null
          slippage_pct?: number | null
          state?: string
          status?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          avg_fill_price?: number | null
          broker?: string
          client_order_id?: string
          created_at?: string
          error?: string | null
          filled_qty?: number | null
          id?: string
          order_id?: string | null
          slippage_pct?: number | null
          state?: string
          status?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      paper_state: {
        Row: {
          balance: number
          created_at: string
          last_quote: Json
          positions: Json
          updated_at: string
          user_id: string
          volatile: boolean
        }
        Insert: {
          balance?: number
          created_at?: string
          last_quote?: Json
          positions?: Json
          updated_at?: string
          user_id: string
          volatile?: boolean
        }
        Update: {
          balance?: number
          created_at?: string
          last_quote?: Json
          positions?: Json
          updated_at?: string
          user_id?: string
          volatile?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "paper_state_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_fees: {
        Row: {
          created_at: string
          fee_amount: number
          fee_pct: number
          gross_profit: number
          hwm_basis: number
          id: string
          invoiced_at: string | null
          manager_id: string | null
          paid_at: string | null
          period_end: string
          period_start: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          fee_amount: number
          fee_pct?: number
          gross_profit: number
          hwm_basis?: number
          id?: string
          invoiced_at?: string | null
          manager_id?: string | null
          paid_at?: string | null
          period_end: string
          period_start: string
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          fee_amount?: number
          fee_pct?: number
          gross_profit?: number
          hwm_basis?: number
          id?: string
          invoiced_at?: string | null
          manager_id?: string | null
          paid_at?: string | null
          period_end?: string
          period_start?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "performance_fees_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_fees_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolio_exposure: {
        Row: {
          by_direction: Json
          by_symbol: Json
          cumulative_realized_pnl: number
          daily_realized_pnl: number
          drawdown_usd: number
          largest_concentration_pct: number | null
          open_positions: number
          peak_realized_pnl: number
          total_notional: number
          updated_at: string
          user_id: string
        }
        Insert: {
          by_direction?: Json
          by_symbol?: Json
          cumulative_realized_pnl?: number
          daily_realized_pnl?: number
          drawdown_usd?: number
          largest_concentration_pct?: number | null
          open_positions?: number
          peak_realized_pnl?: number
          total_notional?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          by_direction?: Json
          by_symbol?: Json
          cumulative_realized_pnl?: number
          daily_realized_pnl?: number
          drawdown_usd?: number
          largest_concentration_pct?: number | null
          open_positions?: number
          peak_realized_pnl?: number
          total_notional?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_exposure_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      premium_communities: {
        Row: {
          created_at: string
          creator_pct: number
          description: string | null
          id: string
          is_free: boolean
          member_count: number
          name: string
          owner_id: string
          perks: string[] | null
          platform_pct: number
          price_annual: number | null
          price_monthly: number
          slug: string
          status: string
          telegram_chat_id: number | null
          telegram_invite_link: string | null
        }
        Insert: {
          created_at?: string
          creator_pct?: number
          description?: string | null
          id?: string
          is_free?: boolean
          member_count?: number
          name: string
          owner_id: string
          perks?: string[] | null
          platform_pct?: number
          price_annual?: number | null
          price_monthly?: number
          slug: string
          status?: string
          telegram_chat_id?: number | null
          telegram_invite_link?: string | null
        }
        Update: {
          created_at?: string
          creator_pct?: number
          description?: string | null
          id?: string
          is_free?: boolean
          member_count?: number
          name?: string
          owner_id?: string
          perks?: string[] | null
          platform_pct?: number
          price_annual?: number | null
          price_monthly?: number
          slug?: string
          status?: string
          telegram_chat_id?: number | null
          telegram_invite_link?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "premium_communities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          account_type: string
          bio: string | null
          classification_meta: Json
          created_at: string
          demo_activated_at: string | null
          demo_converted_at: string | null
          demo_plan: string | null
          full_name: string | null
          id: string
          public_handle: string | null
          public_profile: boolean
          referral_code: string
          stripe_customer_id: string | null
          subscription_status: string | null
          subscription_tier: string
          telegram_chat_id: number | null
          trader_type: string | null
          trader_type_set_at: string | null
          whatsapp_number: string | null
        }
        Insert: {
          account_type?: string
          bio?: string | null
          classification_meta?: Json
          created_at?: string
          demo_activated_at?: string | null
          demo_converted_at?: string | null
          demo_plan?: string | null
          full_name?: string | null
          id: string
          public_handle?: string | null
          public_profile?: boolean
          referral_code: string
          stripe_customer_id?: string | null
          subscription_status?: string | null
          subscription_tier?: string
          telegram_chat_id?: number | null
          trader_type?: string | null
          trader_type_set_at?: string | null
          whatsapp_number?: string | null
        }
        Update: {
          account_type?: string
          bio?: string | null
          classification_meta?: Json
          created_at?: string
          demo_activated_at?: string | null
          demo_converted_at?: string | null
          demo_plan?: string | null
          full_name?: string | null
          id?: string
          public_handle?: string | null
          public_profile?: boolean
          referral_code?: string
          stripe_customer_id?: string | null
          subscription_status?: string | null
          subscription_tier?: string
          telegram_chat_id?: number | null
          trader_type?: string | null
          trader_type_set_at?: string | null
          whatsapp_number?: string | null
        }
        Relationships: []
      }
      prop_challenges: {
        Row: {
          account_size_usd: number
          breach_type: string | null
          created_at: string
          current_balance_usd: number | null
          current_daily_pnl_usd: number | null
          deadline: string | null
          failed_at: string | null
          firm_name: string
          highest_balance_usd: number | null
          id: string
          max_daily_loss_pct: number
          max_total_loss_pct: number
          max_trading_days: number | null
          min_trading_days: number | null
          mt5_account_id: string | null
          notes: string | null
          passed_at: string | null
          phase: string
          profit_target_pct: number
          started_at: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_size_usd: number
          breach_type?: string | null
          created_at?: string
          current_balance_usd?: number | null
          current_daily_pnl_usd?: number | null
          deadline?: string | null
          failed_at?: string | null
          firm_name: string
          highest_balance_usd?: number | null
          id?: string
          max_daily_loss_pct?: number
          max_total_loss_pct?: number
          max_trading_days?: number | null
          min_trading_days?: number | null
          mt5_account_id?: string | null
          notes?: string | null
          passed_at?: string | null
          phase?: string
          profit_target_pct?: number
          started_at?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_size_usd?: number
          breach_type?: string | null
          created_at?: string
          current_balance_usd?: number | null
          current_daily_pnl_usd?: number | null
          deadline?: string | null
          failed_at?: string | null
          firm_name?: string
          highest_balance_usd?: number | null
          id?: string
          max_daily_loss_pct?: number
          max_total_loss_pct?: number
          max_trading_days?: number | null
          min_trading_days?: number | null
          mt5_account_id?: string | null
          notes?: string | null
          passed_at?: string | null
          phase?: string
          profit_target_pct?: number
          started_at?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prop_challenges_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      published_strategies: {
        Row: {
          asset_classes: string[]
          avg_rr: number | null
          copy_enabled: boolean
          copy_followers_count: number | null
          copy_mode: string
          cover_image_url: string | null
          created_at: string
          creator_id: string
          creator_revenue_pct: number
          days_live: number | null
          description: string | null
          id: string
          is_free: boolean
          max_drawdown: number | null
          min_copy_capital: number | null
          monthly_return_avg: number | null
          name: string
          pairs: string[] | null
          platform_fee_pct: number
          price_annual: number | null
          price_lifetime: number | null
          price_monthly: number | null
          profit_share_pct: number | null
          published_at: string | null
          rating_avg: number | null
          rating_count: number | null
          risk_approach: string | null
          sharpe_ratio: number | null
          slug: string
          status: string
          subscribers_count: number | null
          suspended_reason: string | null
          tagline: string | null
          timeframes: string[] | null
          total_revenue_usd: number | null
          total_signals: number | null
          trading_style: string | null
          updated_at: string
          verification_level: string
          verified: boolean
          verified_at: string | null
          win_rate: number | null
        }
        Insert: {
          asset_classes?: string[]
          avg_rr?: number | null
          copy_enabled?: boolean
          copy_followers_count?: number | null
          copy_mode?: string
          cover_image_url?: string | null
          created_at?: string
          creator_id: string
          creator_revenue_pct?: number
          days_live?: number | null
          description?: string | null
          id?: string
          is_free?: boolean
          max_drawdown?: number | null
          min_copy_capital?: number | null
          monthly_return_avg?: number | null
          name: string
          pairs?: string[] | null
          platform_fee_pct?: number
          price_annual?: number | null
          price_lifetime?: number | null
          price_monthly?: number | null
          profit_share_pct?: number | null
          published_at?: string | null
          rating_avg?: number | null
          rating_count?: number | null
          risk_approach?: string | null
          sharpe_ratio?: number | null
          slug: string
          status?: string
          subscribers_count?: number | null
          suspended_reason?: string | null
          tagline?: string | null
          timeframes?: string[] | null
          total_revenue_usd?: number | null
          total_signals?: number | null
          trading_style?: string | null
          updated_at?: string
          verification_level?: string
          verified?: boolean
          verified_at?: string | null
          win_rate?: number | null
        }
        Update: {
          asset_classes?: string[]
          avg_rr?: number | null
          copy_enabled?: boolean
          copy_followers_count?: number | null
          copy_mode?: string
          cover_image_url?: string | null
          created_at?: string
          creator_id?: string
          creator_revenue_pct?: number
          days_live?: number | null
          description?: string | null
          id?: string
          is_free?: boolean
          max_drawdown?: number | null
          min_copy_capital?: number | null
          monthly_return_avg?: number | null
          name?: string
          pairs?: string[] | null
          platform_fee_pct?: number
          price_annual?: number | null
          price_lifetime?: number | null
          price_monthly?: number | null
          profit_share_pct?: number | null
          published_at?: string | null
          rating_avg?: number | null
          rating_count?: number | null
          risk_approach?: string | null
          sharpe_ratio?: number | null
          slug?: string
          status?: string
          subscribers_count?: number | null
          suspended_reason?: string | null
          tagline?: string | null
          timeframes?: string[] | null
          total_revenue_usd?: number | null
          total_signals?: number | null
          trading_style?: string | null
          updated_at?: string
          verification_level?: string
          verified?: boolean
          verified_at?: string | null
          win_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "published_strategies_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth_key: string
          created_at: string
          endpoint: string
          failed_count: number
          id: string
          last_sent_at: string | null
          p256dh_key: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth_key: string
          created_at?: string
          endpoint: string
          failed_count?: number
          id?: string
          last_sent_at?: string | null
          p256dh_key: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth_key?: string
          created_at?: string
          endpoint?: string
          failed_count?: number
          id?: string
          last_sent_at?: string | null
          p256dh_key?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          commission_amount: number
          commission_paid: boolean
          commission_pct: number
          converted_at: string | null
          created_at: string
          id: string
          paid_at: string | null
          plan: string | null
          referred_id: string
          referrer_id: string
          status: string
        }
        Insert: {
          commission_amount?: number
          commission_paid?: boolean
          commission_pct?: number
          converted_at?: string | null
          created_at?: string
          id?: string
          paid_at?: string | null
          plan?: string | null
          referred_id: string
          referrer_id: string
          status?: string
        }
        Update: {
          commission_amount?: number
          commission_paid?: boolean
          commission_pct?: number
          converted_at?: string | null
          created_at?: string
          id?: string
          paid_at?: string | null
          plan?: string | null
          referred_id?: string
          referrer_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "referrals_referred_id_fkey"
            columns: ["referred_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      regime_snapshots: {
        Row: {
          adx_value: number | null
          atr_pct: number | null
          autocorr_score: number | null
          der_score: number | null
          entropy_score: number | null
          id: string
          regime: string
          scanned_at: string
          session: string | null
          symbol: string
          timeframe: string
        }
        Insert: {
          adx_value?: number | null
          atr_pct?: number | null
          autocorr_score?: number | null
          der_score?: number | null
          entropy_score?: number | null
          id?: string
          regime: string
          scanned_at?: string
          session?: string | null
          symbol: string
          timeframe: string
        }
        Update: {
          adx_value?: number | null
          atr_pct?: number | null
          autocorr_score?: number | null
          der_score?: number | null
          entropy_score?: number | null
          id?: string
          regime?: string
          scanned_at?: string
          session?: string | null
          symbol?: string
          timeframe?: string
        }
        Relationships: []
      }
      risk_limits: {
        Row: {
          daily_loss_cap_usd: number | null
          enabled: boolean
          max_drawdown_usd: number | null
          max_open_positions: number | null
          max_symbol_concentration_pct: number | null
          max_total_exposure_usd: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          daily_loss_cap_usd?: number | null
          enabled?: boolean
          max_drawdown_usd?: number | null
          max_open_positions?: number | null
          max_symbol_concentration_pct?: number | null
          max_total_exposure_usd?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          daily_loss_cap_usd?: number | null
          enabled?: boolean
          max_drawdown_usd?: number | null
          max_open_positions?: number | null
          max_symbol_concentration_pct?: number | null
          max_total_exposure_usd?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "risk_limits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shadow_executions: {
        Row: {
          actual_fill_price: number | null
          actual_lot: number | null
          actual_status: string
          broker: string
          closed_at: string | null
          copy_trade_id: string | null
          created_at: string
          direction: string
          follower_pnl: number | null
          id: string
          intended_entry: number | null
          intended_lot: number
          intended_sl: number | null
          intended_tp: number | null
          leader_pnl: number | null
          pnl_drift_pct: number | null
          signal_id: string | null
          skip_reason: string | null
          slippage_pct: number | null
          symbol: string
          user_id: string
        }
        Insert: {
          actual_fill_price?: number | null
          actual_lot?: number | null
          actual_status: string
          broker: string
          closed_at?: string | null
          copy_trade_id?: string | null
          created_at?: string
          direction: string
          follower_pnl?: number | null
          id?: string
          intended_entry?: number | null
          intended_lot: number
          intended_sl?: number | null
          intended_tp?: number | null
          leader_pnl?: number | null
          pnl_drift_pct?: number | null
          signal_id?: string | null
          skip_reason?: string | null
          slippage_pct?: number | null
          symbol: string
          user_id: string
        }
        Update: {
          actual_fill_price?: number | null
          actual_lot?: number | null
          actual_status?: string
          broker?: string
          closed_at?: string | null
          copy_trade_id?: string | null
          created_at?: string
          direction?: string
          follower_pnl?: number | null
          id?: string
          intended_entry?: number | null
          intended_lot?: number
          intended_sl?: number | null
          intended_tp?: number | null
          leader_pnl?: number | null
          pnl_drift_pct?: number | null
          signal_id?: string | null
          skip_reason?: string | null
          slippage_pct?: number | null
          symbol?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shadow_executions_copy_trade_id_fkey"
            columns: ["copy_trade_id"]
            isOneToOne: false
            referencedRelation: "copy_trades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shadow_executions_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shadow_executions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      signal_analytics: {
        Row: {
          computed_at: string
          confidence_bucket: number | null
          duration_minutes: number | null
          exit_pips: number | null
          id: string
          mae_pips: number | null
          mfe_pips: number | null
          regime_at_entry: string | null
          session_at_entry: string | null
          signal_id: string
          spread_at_entry: number | null
          was_correct: boolean | null
        }
        Insert: {
          computed_at?: string
          confidence_bucket?: number | null
          duration_minutes?: number | null
          exit_pips?: number | null
          id?: string
          mae_pips?: number | null
          mfe_pips?: number | null
          regime_at_entry?: string | null
          session_at_entry?: string | null
          signal_id: string
          spread_at_entry?: number | null
          was_correct?: boolean | null
        }
        Update: {
          computed_at?: string
          confidence_bucket?: number | null
          duration_minutes?: number | null
          exit_pips?: number | null
          id?: string
          mae_pips?: number | null
          mfe_pips?: number | null
          regime_at_entry?: string | null
          session_at_entry?: string | null
          signal_id?: string
          spread_at_entry?: number | null
          was_correct?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "signal_analytics_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: true
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      signal_events: {
        Row: {
          created_at: string
          direction: string | null
          event_type: string
          fanned_out_at: string | null
          fanout_error: string | null
          id: string
          jobs_created: number
          leader_id: string
          payload: Json
          signal_id: string | null
          status: string
          strategy_id: string | null
          symbol: string
          trace_id: string
        }
        Insert: {
          created_at?: string
          direction?: string | null
          event_type: string
          fanned_out_at?: string | null
          fanout_error?: string | null
          id?: string
          jobs_created?: number
          leader_id: string
          payload?: Json
          signal_id?: string | null
          status?: string
          strategy_id?: string | null
          symbol: string
          trace_id?: string
        }
        Update: {
          created_at?: string
          direction?: string | null
          event_type?: string
          fanned_out_at?: string | null
          fanout_error?: string | null
          id?: string
          jobs_created?: number
          leader_id?: string
          payload?: Json
          signal_id?: string | null
          status?: string
          strategy_id?: string | null
          symbol?: string
          trace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "signal_events_leader_id_fkey"
            columns: ["leader_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_events_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_events_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "published_strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      signal_feedback: {
        Row: {
          actual_pips: number | null
          created_at: string
          id: string
          notes: string | null
          outcome: string | null
          signal_id: string
          source: string
          user_id: string | null
        }
        Insert: {
          actual_pips?: number | null
          created_at?: string
          id?: string
          notes?: string | null
          outcome?: string | null
          signal_id: string
          source?: string
          user_id?: string | null
        }
        Update: {
          actual_pips?: number | null
          created_at?: string
          id?: string
          notes?: string | null
          outcome?: string | null
          signal_id?: string
          source?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "signal_feedback_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signal_feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      signals: {
        Row: {
          admin_notes: string | null
          confidence_score: number | null
          created_by: string | null
          der_score: number | null
          direction: string
          engine_version: string | null
          entropy_score: number | null
          entry_price: number | null
          feature_snapshot: Json | null
          id: string
          invalidated_at: string | null
          lifecycle_state: string
          liquidity_score: number | null
          max_adverse_excursion: number | null
          max_favorable_excursion: number | null
          momentum_score: number | null
          pair: string
          pips_gained: number | null
          published_at: string
          quality_score: number | null
          regime: string | null
          result: string | null
          risk_reward: number | null
          rr_score: number | null
          session: string | null
          status: string
          stop_loss: number | null
          stopped_at: string | null
          strategy_id: string | null
          tags: string[] | null
          take_profit_1: number | null
          take_profit_2: number | null
          take_profit_3: number | null
          tier_required: string
          tp1_hit_at: string | null
          tp2_hit_at: string | null
          tp3_hit_at: string | null
          trend_score: number | null
          volatility_score: number | null
        }
        Insert: {
          admin_notes?: string | null
          confidence_score?: number | null
          created_by?: string | null
          der_score?: number | null
          direction: string
          engine_version?: string | null
          entropy_score?: number | null
          entry_price?: number | null
          feature_snapshot?: Json | null
          id?: string
          invalidated_at?: string | null
          lifecycle_state?: string
          liquidity_score?: number | null
          max_adverse_excursion?: number | null
          max_favorable_excursion?: number | null
          momentum_score?: number | null
          pair: string
          pips_gained?: number | null
          published_at?: string
          quality_score?: number | null
          regime?: string | null
          result?: string | null
          risk_reward?: number | null
          rr_score?: number | null
          session?: string | null
          status?: string
          stop_loss?: number | null
          stopped_at?: string | null
          strategy_id?: string | null
          tags?: string[] | null
          take_profit_1?: number | null
          take_profit_2?: number | null
          take_profit_3?: number | null
          tier_required?: string
          tp1_hit_at?: string | null
          tp2_hit_at?: string | null
          tp3_hit_at?: string | null
          trend_score?: number | null
          volatility_score?: number | null
        }
        Update: {
          admin_notes?: string | null
          confidence_score?: number | null
          created_by?: string | null
          der_score?: number | null
          direction?: string
          engine_version?: string | null
          entropy_score?: number | null
          entry_price?: number | null
          feature_snapshot?: Json | null
          id?: string
          invalidated_at?: string | null
          lifecycle_state?: string
          liquidity_score?: number | null
          max_adverse_excursion?: number | null
          max_favorable_excursion?: number | null
          momentum_score?: number | null
          pair?: string
          pips_gained?: number | null
          published_at?: string
          quality_score?: number | null
          regime?: string | null
          result?: string | null
          risk_reward?: number | null
          rr_score?: number | null
          session?: string | null
          status?: string
          stop_loss?: number | null
          stopped_at?: string | null
          strategy_id?: string | null
          tags?: string[] | null
          take_profit_1?: number | null
          take_profit_2?: number | null
          take_profit_3?: number | null
          tier_required?: string
          tp1_hit_at?: string | null
          tp2_hit_at?: string | null
          tp3_hit_at?: string | null
          trend_score?: number | null
          volatility_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "signals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signals_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategy_performance"
            referencedColumns: ["strategy_id"]
          },
          {
            foreignKeyName: "signals_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategy_registry"
            referencedColumns: ["id"]
          },
        ]
      }
      social_notifications: {
        Row: {
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          message: string
          notif_type: string
          read: boolean
          recipient_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          message: string
          notif_type: string
          read?: boolean
          recipient_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          message?: string
          notif_type?: string
          read?: boolean
          recipient_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_notifications_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      social_post_reactions: {
        Row: {
          created_at: string
          post_id: string
          reaction: string
          user_id: string
        }
        Insert: {
          created_at?: string
          post_id: string
          reaction?: string
          user_id: string
        }
        Update: {
          created_at?: string
          post_id?: string
          reaction?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_post_reactions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "social_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_post_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      social_post_saves: {
        Row: {
          post_id: string
          saved_at: string
          user_id: string
        }
        Insert: {
          post_id: string
          saved_at?: string
          user_id: string
        }
        Update: {
          post_id?: string
          saved_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_post_saves_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "social_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_post_saves_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      social_posts: {
        Row: {
          author_id: string
          body: string
          comments_count: number
          created_at: string
          edited_at: string | null
          flagged_reason: string | null
          id: string
          is_flagged: boolean
          is_pinned: boolean
          likes_count: number
          media_urls: string[] | null
          post_type: string
          reposts_count: number
          saves_count: number
          signal_id: string | null
          trade_id: string | null
          views_count: number
          visibility: string
        }
        Insert: {
          author_id: string
          body: string
          comments_count?: number
          created_at?: string
          edited_at?: string | null
          flagged_reason?: string | null
          id?: string
          is_flagged?: boolean
          is_pinned?: boolean
          likes_count?: number
          media_urls?: string[] | null
          post_type?: string
          reposts_count?: number
          saves_count?: number
          signal_id?: string | null
          trade_id?: string | null
          views_count?: number
          visibility?: string
        }
        Update: {
          author_id?: string
          body?: string
          comments_count?: number
          created_at?: string
          edited_at?: string | null
          flagged_reason?: string | null
          id?: string
          is_flagged?: boolean
          is_pinned?: boolean
          likes_count?: number
          media_urls?: string[] | null
          post_type?: string
          reposts_count?: number
          saves_count?: number
          signal_id?: string | null
          trade_id?: string | null
          views_count?: number
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_posts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_posts_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_posts_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      strategy_registry: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          display_name: string
          id: string
          instruments: string[] | null
          name: string
          timeframes: string[] | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          display_name: string
          id?: string
          instruments?: string[] | null
          name: string
          timeframes?: string[] | null
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          display_name?: string
          id?: string
          instruments?: string[] | null
          name?: string
          timeframes?: string[] | null
        }
        Relationships: []
      }
      strategy_reviews: {
        Row: {
          body: string | null
          created_at: string
          helpful_count: number | null
          id: string
          is_verified_sub: boolean
          rating: number
          reviewer_id: string
          strategy_id: string
          title: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string
          helpful_count?: number | null
          id?: string
          is_verified_sub?: boolean
          rating: number
          reviewer_id: string
          strategy_id: string
          title?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string
          helpful_count?: number | null
          id?: string
          is_verified_sub?: boolean
          rating?: number
          reviewer_id?: string
          strategy_id?: string
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "strategy_reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strategy_reviews_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "published_strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      strategy_risk_state: {
        Row: {
          auto_disabled_at: string | null
          consecutive_losses: number
          reason: string | null
          status: string
          strategy_id: string
          updated_at: string
        }
        Insert: {
          auto_disabled_at?: string | null
          consecutive_losses?: number
          reason?: string | null
          status?: string
          strategy_id: string
          updated_at?: string
        }
        Update: {
          auto_disabled_at?: string | null
          consecutive_losses?: number
          reason?: string | null
          status?: string
          strategy_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "strategy_risk_state_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: true
            referencedRelation: "published_strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      strategy_subscriptions: {
        Row: {
          allocation_model: string
          allocation_pct: number | null
          amount_paid_usd: number
          cancel_reason: string | null
          cancelled_at: string | null
          copy_enabled: boolean
          copy_mode: string
          copy_sl: boolean | null
          copy_tp: boolean | null
          expires_at: string | null
          fixed_scale: number | null
          hwm_basis: number | null
          id: string
          max_lot_size: number | null
          plan: string
          risk_multiplier: number | null
          risk_pct: number | null
          started_at: string
          status: string
          strategy_id: string
          subscriber_id: string
        }
        Insert: {
          allocation_model?: string
          allocation_pct?: number | null
          amount_paid_usd?: number
          cancel_reason?: string | null
          cancelled_at?: string | null
          copy_enabled?: boolean
          copy_mode?: string
          copy_sl?: boolean | null
          copy_tp?: boolean | null
          expires_at?: string | null
          fixed_scale?: number | null
          hwm_basis?: number | null
          id?: string
          max_lot_size?: number | null
          plan?: string
          risk_multiplier?: number | null
          risk_pct?: number | null
          started_at?: string
          status?: string
          strategy_id: string
          subscriber_id: string
        }
        Update: {
          allocation_model?: string
          allocation_pct?: number | null
          amount_paid_usd?: number
          cancel_reason?: string | null
          cancelled_at?: string | null
          copy_enabled?: boolean
          copy_mode?: string
          copy_sl?: boolean | null
          copy_tp?: boolean | null
          expires_at?: string | null
          fixed_scale?: number | null
          hwm_basis?: number | null
          id?: string
          max_lot_size?: number | null
          plan?: string
          risk_multiplier?: number | null
          risk_pct?: number | null
          started_at?: string
          status?: string
          strategy_id?: string
          subscriber_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "strategy_subscriptions_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "published_strategies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strategy_subscriptions_subscriber_id_fkey"
            columns: ["subscriber_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          billing_interval: string
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string
          id: string
          plan: string
          status: string
          stripe_subscription_id: string | null
          user_id: string
        }
        Insert: {
          billing_interval?: string
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end: string
          id?: string
          plan: string
          status: string
          stripe_subscription_id?: string | null
          user_id: string
        }
        Update: {
          billing_interval?: string
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string
          id?: string
          plan?: string
          status?: string
          stripe_subscription_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      token_launches: {
        Row: {
          chain: string
          contract_address: string | null
          created_at: string
          decimals: number | null
          deploy_tx: string | null
          description: string | null
          founder_id: string
          hard_cap_usd: number | null
          id: string
          liquidity_lock_days: number | null
          liquidity_locked: boolean
          listing_price: number | null
          logo_url: string | null
          presale_price: number | null
          project_name: string
          raised_usd: number | null
          service_fee_usd: number
          service_tier: string
          slug: string
          soft_cap_usd: number | null
          status: string
          ticker: string
          tokenomics: Json | null
          total_supply: number | null
          updated_at: string
          vesting_config: Json | null
          website: string | null
        }
        Insert: {
          chain?: string
          contract_address?: string | null
          created_at?: string
          decimals?: number | null
          deploy_tx?: string | null
          description?: string | null
          founder_id: string
          hard_cap_usd?: number | null
          id?: string
          liquidity_lock_days?: number | null
          liquidity_locked?: boolean
          listing_price?: number | null
          logo_url?: string | null
          presale_price?: number | null
          project_name: string
          raised_usd?: number | null
          service_fee_usd?: number
          service_tier?: string
          slug: string
          soft_cap_usd?: number | null
          status?: string
          ticker: string
          tokenomics?: Json | null
          total_supply?: number | null
          updated_at?: string
          vesting_config?: Json | null
          website?: string | null
        }
        Update: {
          chain?: string
          contract_address?: string | null
          created_at?: string
          decimals?: number | null
          deploy_tx?: string | null
          description?: string | null
          founder_id?: string
          hard_cap_usd?: number | null
          id?: string
          liquidity_lock_days?: number | null
          liquidity_locked?: boolean
          listing_price?: number | null
          logo_url?: string | null
          presale_price?: number | null
          project_name?: string
          raised_usd?: number | null
          service_fee_usd?: number
          service_tier?: string
          slug?: string
          soft_cap_usd?: number | null
          status?: string
          ticker?: string
          tokenomics?: Json | null
          total_supply?: number | null
          updated_at?: string
          vesting_config?: Json | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "token_launches_founder_id_fkey"
            columns: ["founder_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      trader_follows: {
        Row: {
          followed_at: string
          follower_id: string
          leader_id: string
          notifications: boolean
        }
        Insert: {
          followed_at?: string
          follower_id: string
          leader_id: string
          notifications?: boolean
        }
        Update: {
          followed_at?: string
          follower_id?: string
          leader_id?: string
          notifications?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "trader_follows_follower_id_fkey"
            columns: ["follower_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trader_follows_leader_id_fkey"
            columns: ["leader_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      trader_scores: {
        Row: {
          all_time_return_pct: number | null
          avg_follower_return: number | null
          composite_rank: number | null
          composite_score: number
          computed_at: string
          copy_followers_count: number | null
          followers_count: number | null
          following_count: number | null
          lookback_days: number | null
          max_drawdown_pct: number | null
          monthly_return_pct: number | null
          profit_factor: number | null
          rank_change_24h: number | null
          risk_label: string | null
          risk_score: number | null
          risk_updated_at: string | null
          score_consistency: number | null
          score_diversity: number | null
          score_drawdown: number | null
          score_follower_pnl: number | null
          score_recency: number | null
          score_risk_adj: number | null
          score_sample_size: number | null
          score_verification: number | null
          score_win_rate: number | null
          sharpe_ratio: number | null
          sortino_ratio: number | null
          total_aum_usd: number | null
          total_trades: number | null
          updated_at: string
          user_id: string
          win_rate: number | null
        }
        Insert: {
          all_time_return_pct?: number | null
          avg_follower_return?: number | null
          composite_rank?: number | null
          composite_score?: number
          computed_at?: string
          copy_followers_count?: number | null
          followers_count?: number | null
          following_count?: number | null
          lookback_days?: number | null
          max_drawdown_pct?: number | null
          monthly_return_pct?: number | null
          profit_factor?: number | null
          rank_change_24h?: number | null
          risk_label?: string | null
          risk_score?: number | null
          risk_updated_at?: string | null
          score_consistency?: number | null
          score_diversity?: number | null
          score_drawdown?: number | null
          score_follower_pnl?: number | null
          score_recency?: number | null
          score_risk_adj?: number | null
          score_sample_size?: number | null
          score_verification?: number | null
          score_win_rate?: number | null
          sharpe_ratio?: number | null
          sortino_ratio?: number | null
          total_aum_usd?: number | null
          total_trades?: number | null
          updated_at?: string
          user_id: string
          win_rate?: number | null
        }
        Update: {
          all_time_return_pct?: number | null
          avg_follower_return?: number | null
          composite_rank?: number | null
          composite_score?: number
          computed_at?: string
          copy_followers_count?: number | null
          followers_count?: number | null
          following_count?: number | null
          lookback_days?: number | null
          max_drawdown_pct?: number | null
          monthly_return_pct?: number | null
          profit_factor?: number | null
          rank_change_24h?: number | null
          risk_label?: string | null
          risk_score?: number | null
          risk_updated_at?: string | null
          score_consistency?: number | null
          score_diversity?: number | null
          score_drawdown?: number | null
          score_follower_pnl?: number | null
          score_recency?: number | null
          score_risk_adj?: number | null
          score_sample_size?: number | null
          score_verification?: number | null
          score_win_rate?: number | null
          sharpe_ratio?: number | null
          sortino_ratio?: number | null
          total_aum_usd?: number | null
          total_trades?: number | null
          updated_at?: string
          user_id?: string
          win_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "trader_scores_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      trader_verifications: {
        Row: {
          application_status: string
          applied_at: string | null
          basic_days_active: number | null
          basic_trade_count: number | null
          basic_unlocked_at: string | null
          broker_name: string | null
          broker_statement_url: string | null
          created_at: string
          elite_at: string | null
          elite_months_live: number | null
          elite_review_notes: string | null
          elite_sharpe: number | null
          id: string
          live_track_days: number | null
          live_trade_count: number | null
          live_win_rate: number | null
          mt5_account_id: string | null
          mt5_account_verified: boolean | null
          rejected_at: string | null
          rejection_reason: string | null
          tier: string
          updated_at: string
          user_id: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          application_status?: string
          applied_at?: string | null
          basic_days_active?: number | null
          basic_trade_count?: number | null
          basic_unlocked_at?: string | null
          broker_name?: string | null
          broker_statement_url?: string | null
          created_at?: string
          elite_at?: string | null
          elite_months_live?: number | null
          elite_review_notes?: string | null
          elite_sharpe?: number | null
          id?: string
          live_track_days?: number | null
          live_trade_count?: number | null
          live_win_rate?: number | null
          mt5_account_id?: string | null
          mt5_account_verified?: boolean | null
          rejected_at?: string | null
          rejection_reason?: string | null
          tier?: string
          updated_at?: string
          user_id: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          application_status?: string
          applied_at?: string | null
          basic_days_active?: number | null
          basic_trade_count?: number | null
          basic_unlocked_at?: string | null
          broker_name?: string | null
          broker_statement_url?: string | null
          created_at?: string
          elite_at?: string | null
          elite_months_live?: number | null
          elite_review_notes?: string | null
          elite_sharpe?: number | null
          id?: string
          live_track_days?: number | null
          live_trade_count?: number | null
          live_win_rate?: number | null
          mt5_account_id?: string | null
          mt5_account_verified?: boolean | null
          rejected_at?: string | null
          rejection_reason?: string | null
          tier?: string
          updated_at?: string
          user_id?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trader_verifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trader_verifications_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      watchlist_items: {
        Row: {
          added_at: string
          asset_class: string
          symbol: string
          user_id: string
        }
        Insert: {
          added_at?: string
          asset_class: string
          symbol: string
          user_id: string
        }
        Update: {
          added_at?: string
          asset_class?: string
          symbol?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "watchlist_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      whitelabel_configs: {
        Row: {
          brand_name: string
          created_at: string
          custom_domain: string | null
          feature_flags: Json | null
          hide_algosphere_branding: boolean
          id: string
          license_id: string | null
          logo_url: string | null
          owner_id: string
          primary_color: string
          status: string
          support_email: string | null
          updated_at: string
        }
        Insert: {
          brand_name: string
          created_at?: string
          custom_domain?: string | null
          feature_flags?: Json | null
          hide_algosphere_branding?: boolean
          id?: string
          license_id?: string | null
          logo_url?: string | null
          owner_id: string
          primary_color?: string
          status?: string
          support_email?: string | null
          updated_at?: string
        }
        Update: {
          brand_name?: string
          created_at?: string
          custom_domain?: string | null
          feature_flags?: Json | null
          hide_algosphere_branding?: boolean
          id?: string
          license_id?: string | null
          logo_url?: string | null
          owner_id?: string
          primary_color?: string
          status?: string
          support_email?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whitelabel_configs_license_id_fkey"
            columns: ["license_id"]
            isOneToOne: false
            referencedRelation: "enterprise_licenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whitelabel_configs_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      strategy_performance: {
        Row: {
          avg_confidence: number | null
          avg_loss_pips: number | null
          avg_quality_score: number | null
          avg_rr: number | null
          avg_win_pips: number | null
          breakevens: number | null
          closed_signals: number | null
          display_name: string | null
          losses: number | null
          name: string | null
          strategy_id: string | null
          total_signals: number | null
          win_rate_pct: number | null
          wins: number | null
        }
        Relationships: []
      }
      user_mistake_patterns: {
        Row: {
          avg_pnl_impact: number | null
          frequency: number | null
          last_occurred: string | null
          mistake_type: string | null
          total_pnl_impact: number | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accrue_copy_earnings: {
        Args: { p_copy_trade_id: string }
        Returns: number
      }
      auto_quarantine_breaching_strategies: {
        Args: { p_loss_threshold?: number; p_window_hours?: number }
        Returns: number
      }
      begin_order: {
        Args: {
          p_broker: string
          p_coid: string
          p_lease_seconds?: number
          p_user: string
        }
        Returns: Json
      }
      broker_execution_readiness: {
        Args: { p_broker: string; p_user_id: string }
        Returns: {
          attempts: number
          avg_abs_drift_pct: number
          avg_abs_slip_pct: number
          closed_count: number
          fill_rate_pct: number
          filled: number
          passes: boolean
          reasons: string[]
        }[]
      }
      bump_api_monthly_usage: {
        Args: { p_quota?: number; p_user_id: string }
        Returns: Json
      }
      bump_api_usage: {
        Args: { p_key_id: string; p_window: string }
        Returns: number
      }
      cast_vote: {
        Args: { p_target_id: string; p_target_type: string; p_vote: number }
        Returns: Json
      }
      claim_copy_jobs: {
        Args: { p_limit: number; p_worker: string }
        Returns: {
          allocation_model: string | null
          attempts: number
          available_at: string
          broker: string | null
          claimed_at: string | null
          claimed_by: string | null
          client_order_id: string | null
          computed_lot: number | null
          copy_trade_id: string | null
          created_at: string
          filled_at: string | null
          follower_id: string
          id: string
          kind: string
          last_error: string | null
          leader_id: string
          max_attempts: number
          risk_passed_at: string | null
          risk_reason: string | null
          signal_event_id: string
          status: string
          subscription_id: string
          trace_id: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "copy_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_signal_event: {
        Args: { p_worker: string }
        Returns: {
          created_at: string
          direction: string | null
          event_type: string
          fanned_out_at: string | null
          fanout_error: string | null
          id: string
          jobs_created: number
          leader_id: string
          payload: Json
          signal_id: string | null
          status: string
          strategy_id: string | null
          symbol: string
          trace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "signal_events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      dead_letter_copy_job: {
        Args: { p_category: string; p_error: string; p_job_id: string }
        Returns: string
      }
      evaluate_portfolio_risk: {
        Args: { p_notional_usd: number; p_symbol: string; p_user_id: string }
        Returns: Json
      }
      expire_old_crypto_payments: { Args: never; Returns: undefined }
      finish_order: {
        Args: {
          p_broker: string
          p_coid: string
          p_error?: string
          p_filled?: number
          p_order_id?: string
          p_price?: number
          p_slip?: number
          p_state: string
          p_status?: string
        }
        Returns: undefined
      }
      get_follower_count: { Args: { p_user_id: string }; Returns: number }
      is_following: { Args: { p_leader_id: string }; Returns: boolean }
      is_kill_switch_active: { Args: never; Returns: boolean }
      my_official_communities: {
        Args: never
        Returns: {
          description: string
          display_order: number
          has_access: boolean
          invite_url: string
          member_count: number
          name: string
          platform: string
          required_tier: string
          slug: string
        }[]
      }
      my_vote: {
        Args: { p_target_id: string; p_target_type: string }
        Returns: number
      }
      quarantine_strategy: {
        Args: { p_disable?: boolean; p_reason: string; p_strategy_id: string }
        Returns: string
      }
      react_to_post: {
        Args: { p_post_id: string; p_reaction?: string }
        Returns: Json
      }
      reclaim_stale_copy_jobs: {
        Args: { p_lease_seconds?: number }
        Returns: number
      }
      recompute_copy_health: {
        Args: { p_window_hours?: number }
        Returns: number
      }
      recompute_portfolio_exposure: {
        Args: { p_user_id?: string }
        Returns: number
      }
      replay_dlq_job: { Args: { p_dlq_id: string }; Returns: string }
      set_global_kill_switch: {
        Args: { p_active: boolean; p_actor?: string; p_reason?: string }
        Returns: boolean
      }
      tier_rank: { Args: { t: string }; Returns: number }
      toggle_follow: { Args: { p_leader_id: string }; Returns: Json }
      trader_leaderboard: {
        Args: { p_min_trades?: number }
        Returns: {
          avg_rr: number
          bio: string
          handle: string
          score: number
          total_pnl: number
          trades: number
          win_rate: number
          wins: number
        }[]
      }
      trader_leaderboard_v2: {
        Args: { p_category?: string; p_limit?: number; p_offset?: number }
        Returns: {
          bio: string
          composite_rank: number
          composite_score: number
          followers_count: number
          handle: string
          max_drawdown: number
          monthly_return: number
          rank_change_24h: number
          risk_label: string
          risk_score: number
          sharpe_ratio: number
          total_trades: number
          user_id: string
          verification_tier: string
          win_rate: number
        }[]
      }
      trader_profile: {
        Args: { p_handle: string }
        Returns: {
          best_trade: number
          bio: string
          handle: string
          losses: number
          member_since: string
          total_pnl: number
          trades: number
          win_rate: number
          wins: number
          worst_trade: number
        }[]
      }
      trading_session_for: { Args: { ts: string }; Returns: string }
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