import { createHmac, timingSafeEqual } from 'node:crypto';

export function buildTwilioSignaturePayload(url: string, formBody: string): string {
  const params = new URLSearchParams(formBody);
  const keys = [...new Set(params.keys())].sort();
  let payload = url;
  for (const key of keys) {
    const values = params.getAll(key);
    for (const value of values) payload += `${key}${value}`;
  }
  return payload;
}

export function verifyTwilioSignature(args: {
  authToken: string;
  expectedUrl: string;
  signatureHeader: string | null;
  formBody: string;
}): boolean {
  if (!args.signatureHeader) return false;
  const payload = buildTwilioSignaturePayload(args.expectedUrl, args.formBody);
  const expected = createHmac('sha1', args.authToken).update(payload, 'utf8').digest('base64');
  const a = Buffer.from(args.signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
