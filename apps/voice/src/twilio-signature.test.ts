import { describe, expect, test } from 'vitest';
import { createHmac } from 'node:crypto';
import { buildTwilioSignaturePayload, verifyTwilioSignature } from './twilio-signature';

describe('twilio signature', () => {
  test('builds payload with lexicographically sorted form params', () => {
    const payload = buildTwilioSignaturePayload(
      'https://example.com/twilio/voice',
      'b=2&a=1&b=3',
    );
    expect(payload).toBe('https://example.com/twilio/voicea1b2b3');
  });

  test('verifies a valid signature', () => {
    const authToken = 'secret';
    const expectedUrl = 'https://example.com/twilio/voice';
    const formBody = 'CallSid=CA123&From=%2B15551231234';
    const payload = buildTwilioSignaturePayload(expectedUrl, formBody);
    const signatureHeader = createHmac('sha1', authToken).update(payload, 'utf8').digest('base64');
    expect(
      verifyTwilioSignature({
        authToken,
        expectedUrl,
        signatureHeader,
        formBody,
      }),
    ).toBe(true);
  });

  test('rejects invalid or missing signatures', () => {
    expect(
      verifyTwilioSignature({
        authToken: 'secret',
        expectedUrl: 'https://example.com/twilio/voice',
        signatureHeader: null,
        formBody: 'a=1',
      }),
    ).toBe(false);

    expect(
      verifyTwilioSignature({
        authToken: 'secret',
        expectedUrl: 'https://example.com/twilio/voice',
        signatureHeader: 'bad-signature',
        formBody: 'a=1',
      }),
    ).toBe(false);
  });
});
