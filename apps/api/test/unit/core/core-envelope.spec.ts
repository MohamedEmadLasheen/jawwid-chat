/**
 * The Core envelope (contract §2): four required fields, and only the event
 * types this boundary PROCESSES -- today `subscription.created`. Anything else
 * is refused, never accepted into a ledger nobody drains.
 */
import { ACCEPTED_EVENT_TYPES, parseEnvelope } from '../../../src/core-boundary/core-event-envelope';
import { loadCoreWebhookConfig } from '../../../src/core-boundary/core-webhook.config';

const raw = (v: unknown) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v), 'utf8');
const good = {
  event_id: 'evt-1',
  event_type: 'subscription.created',
  occurred_at: '2026-10-19T10:00:00Z',
  data: { core_subscription_id: '652f1c2ab8e4a10012ab0001', chat_trial_id: '7d6c6f2e-1a2b-4c3d-8e9f-0a1b2c3d4e5f' },
};

describe('the Core envelope', () => {
  it('accepts exactly one type today: subscription.created', () => {
    expect([...ACCEPTED_EVENT_TYPES]).toEqual(['subscription.created']);
    const out = parseEnvelope(raw(good));
    expect(out).toEqual({
      ok: true,
      envelope: { eventId: 'evt-1', eventType: 'subscription.created', occurredAt: new Date('2026-10-19T10:00:00Z'), data: good.data },
    });
  });

  it.each([
    ['not json', '{', 'malformed_json'],
    ['an array', [], 'envelope_not_an_object'],
    ['no event id', { ...good, event_id: '' }, 'missing_event_id'],
    ['an over-long event id', { ...good, event_id: 'x'.repeat(201) }, 'missing_event_id'],
    ['no event type', { ...good, event_type: undefined }, 'missing_event_type'],
    // Types the old consumer branch accepted but nothing on this line drains.
    ['class_session.upserted', { ...good, event_type: 'class_session.upserted' }, 'unknown_event_type'],
    ['subscription.upserted', { ...good, event_type: 'subscription.upserted' }, 'unknown_event_type'],
    ['no occurred_at', { ...good, occurred_at: undefined }, 'missing_occurred_at'],
    ['a bad occurred_at', { ...good, occurred_at: 'yesterday' }, 'invalid_occurred_at'],
    ['no data', { ...good, data: null }, 'missing_data'],
    ['array data', { ...good, data: [] }, 'missing_data'],
  ])('refuses %s', (_label, body, reason) => {
    expect(parseEnvelope(raw(body))).toEqual({ ok: false, reason });
  });
});

describe('the webhook secret variable', () => {
  it('reads CORE_WEBHOOK_SECRETS, and the deployed name CORE_WEBHOOK_SECRET when it is unset, in one format', () => {
    expect(loadCoreWebhookConfig({ CORE_WEBHOOK_SECRETS: 'k1:s1' } as never)?.keys).toEqual([{ keyId: 'k1', secret: 's1' }]);
    expect(loadCoreWebhookConfig({ CORE_WEBHOOK_SECRET: 'k2:s2' } as never)?.keys).toEqual([{ keyId: 'k2', secret: 's2' }]);
    expect(loadCoreWebhookConfig({ CORE_WEBHOOK_SECRETS: 'k1:s1', CORE_WEBHOOK_SECRET: 'k2:s2' } as never)?.keys).toEqual([
      { keyId: 'k1', secret: 's1' },
    ]);
  });

  it('a bare secret with no key id is not a boundary: it stays closed (503), never guesses', () => {
    expect(loadCoreWebhookConfig({ CORE_WEBHOOK_SECRET: 'just-a-secret' } as never)).toBeNull();
    expect(loadCoreWebhookConfig({} as never)).toBeNull();
  });
});
