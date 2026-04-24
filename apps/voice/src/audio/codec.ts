/**
 * μ-law ↔ linear-16 PCM conversion for 8 kHz Twilio media frames.
 *
 * Twilio Programmable Voice Media Streams emit 20ms frames of base64-encoded
 * μ-law (G.711u) at 8kHz mono. Deepgram expects linear16 @ 16kHz, so inbound
 * audio is decoded and upsampled at that boundary (agent TTS uses μ-law from
 * ElevenLabs and is sent to Twilio without this codec path).
 *
 * The lookup tables are generated once at module load. The encode/decode
 * routines are tight loops with no allocations on the hot path beyond the
 * output buffer, which matters because we hit them ~50 times per second per
 * call.
 *
 * Reference: ITU-T G.711 §3.2.
 */

const MULAW_DECODE = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  const u = ~i & 0xff;
  const sign = u & 0x80 ? -1 : 1;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  MULAW_DECODE[i] = sign * sample;
}

const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

function encodeSample(pcm: number): number {
  let sign = 0;
  if (pcm < 0) {
    pcm = -pcm;
    sign = 0x80;
  }
  if (pcm > MULAW_CLIP) pcm = MULAW_CLIP;
  pcm += MULAW_BIAS;
  let exponent = 7;
  for (let m = 0x4000; (pcm & m) === 0 && exponent > 0; exponent--, m >>= 1) {
    /* find exponent */
  }
  const mantissa = (pcm >> (exponent + 3)) & 0x0f;
  const u = ~(sign | (exponent << 4) | mantissa) & 0xff;
  return u;
}

/** Decode μ-law bytes to linear16 PCM (little-endian). */
export function muLawToPcm16(mu: Buffer): Buffer {
  const out = Buffer.alloc(mu.length * 2);
  for (let i = 0; i < mu.length; i++) {
    out.writeInt16LE(MULAW_DECODE[mu[i]!]!, i * 2);
  }
  return out;
}

/** Encode linear16 PCM (little-endian) to μ-law bytes. */
export function pcm16ToMuLaw(pcm: Buffer): Buffer {
  const samples = pcm.length / 2;
  const out = Buffer.alloc(samples);
  for (let i = 0; i < samples; i++) {
    out[i] = encodeSample(pcm.readInt16LE(i * 2));
  }
  return out;
}
