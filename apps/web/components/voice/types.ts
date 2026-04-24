/**
 * Wire types shared between the live-call SSE channel, the example-call
 * server route, and the client components. Kept here (not in `lib/`) so the
 * client bundle doesn't accidentally pull server-only code through transitive
 * imports.
 */

export type TranscriptTurn = {
  speaker: 'caller' | 'agent';
  text: string;
  t_ms: number;
  action?:
    | { kind: 'add_to_cart'; item: string; qty: number; modifiers?: string[] }
    | { kind: 'transfer_to_staff'; reason: string }
    | { kind: 'end_call' }
    | { kind: 'lookup_menu_item'; query: string };
};

export type CartSnapshotItem = {
  menu_item_id: string;
  name: string;
  qty: number;
  modifiers: string[];
  unit_price_cents: number;
};

export type CartSnapshot = {
  items: CartSnapshotItem[];
  subtotal_cents: number;
  t_ms: number;
};

export type LiveCall = {
  call_id: string;
  source: 'twilio' | 'example';
  caller_label?: string | null;
  started_at: number;
  ended_at?: number;
  ended_reason?: 'hangup' | 'completed' | 'error';
  turns: TranscriptTurn[];
  cart?: CartSnapshot;
};
