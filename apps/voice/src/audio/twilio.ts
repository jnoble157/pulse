/**
 * Twilio Media Stream WebSocket protocol.
 *
 * Twilio sends a stream of JSON frames. The ones we care about:
 *   - `connected`: socket handshake.
 *   - `start`: stream metadata (callSid, streamSid, mediaFormat).
 *   - `media`: { payload: base64-μlaw, timestamp, sequenceNumber }.
 *   - `stop`: end of stream.
 *   - `mark`: server → client sync point (echoed back when audio plays out).
 *
 * To play audio we send `media` frames back with the streamSid set; Twilio
 * plays them on the call. To clear an in-flight buffer (for barge-in), send
 * `clear`. To get a callback when a buffered audio item finishes playing,
 * send `mark` and Twilio echoes it back.
 *
 * Spec: https://www.twilio.com/docs/voice/twiml/stream
 */

export type TwilioInbound =
  | { event: 'connected'; protocol: string; version: string }
  | { event: 'start'; sequenceNumber: string; start: TwilioStartMeta; streamSid: string }
  | { event: 'media'; sequenceNumber: string; media: TwilioMediaPayload; streamSid: string }
  | { event: 'stop'; sequenceNumber: string; stop: { accountSid: string; callSid: string }; streamSid: string }
  | { event: 'mark'; sequenceNumber: string; mark: { name: string }; streamSid: string };

export type TwilioStartMeta = {
  accountSid: string;
  callSid: string;
  streamSid: string;
  mediaFormat: { encoding: 'audio/x-mulaw'; sampleRate: 8000; channels: 1 };
  customParameters?: Record<string, string>;
};

export type TwilioMediaPayload = {
  track: 'inbound' | 'outbound';
  chunk: string;
  timestamp: string;
  payload: string;
};

export function parseInbound(data: string | Buffer): TwilioInbound | null {
  try {
    return JSON.parse(typeof data === 'string' ? data : data.toString('utf8')) as TwilioInbound;
  } catch {
    return null;
  }
}

export function makeMediaFrame(streamSid: string, payloadB64: string): string {
  return JSON.stringify({
    event: 'media',
    streamSid,
    media: { payload: payloadB64 },
  });
}

export function makeMark(streamSid: string, name: string): string {
  return JSON.stringify({ event: 'mark', streamSid, mark: { name } });
}

export function makeClear(streamSid: string): string {
  return JSON.stringify({ event: 'clear', streamSid });
}
