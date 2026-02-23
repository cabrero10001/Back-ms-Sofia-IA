export type FlowStage =
  | 'awaiting_policy_consent'
  | 'awaiting_category'
  | 'awaiting_question'
  | 'support'
  | 'awaiting_appointment_opt'
  | 'awaiting_user_full_name'
  | 'awaiting_user_doc_type'
  | 'awaiting_user_doc_number'
  | 'awaiting_user_email'
  | 'awaiting_user_phone_confirm'
  | 'awaiting_user_phone'
  | 'awaiting_appointment_mode'
  | 'awaiting_appointment_day'
  | 'awaiting_appointment_time'
  | 'awaiting_appointment_confirm'
  | 'awaiting_appointment_reschedule_pick'
  | 'awaiting_appointment_reschedule_field'
  | 'awaiting_appointment_cancel_pick'
  | 'awaiting_appointment_cancel_confirm'
  | 'awaiting_survey_rating'
  | 'awaiting_survey_comment';
export type FlowCategory = 'laboral' | 'soporte';

export interface ConversationState {
  stage: FlowStage;
  category?: FlowCategory;
  profile?: Record<string, unknown>;
  updatedAt: number;
  expiresAt: number;
}

export class ConversationStore {
  private readonly map = new Map<string, ConversationState>();

  constructor(private readonly ttlMs: number) {}

  private cleanup(now = Date.now()): void {
    for (const [key, state] of this.map.entries()) {
      if (state.expiresAt <= now) {
        this.map.delete(key);
      }
    }
  }

  get(key: string): ConversationState | undefined {
    const now = Date.now();
    this.cleanup(now);
    const state = this.map.get(key);
    if (!state) return undefined;

    const refreshed: ConversationState = {
      ...state,
      updatedAt: now,
      expiresAt: now + this.ttlMs,
    };
    this.map.set(key, refreshed);
    return refreshed;
  }

  set(key: string, state: Omit<ConversationState, 'updatedAt' | 'expiresAt'>): ConversationState {
    const now = Date.now();
    const next: ConversationState = {
      ...state,
      updatedAt: now,
      expiresAt: now + this.ttlMs,
    };
    this.map.set(key, next);
    return next;
  }

  clear(key: string): void {
    this.map.delete(key);
  }
}
