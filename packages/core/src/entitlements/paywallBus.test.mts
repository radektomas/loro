import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  onPaywallRequested,
  requestPaywall,
  type PaywallRequest,
} from './paywallBus.ts';

const request = (over: Partial<PaywallRequest> = {}): PaywallRequest => ({
  reason: 'save_limit',
  savedCount: 50,
  limit: 50,
  ...over,
});

describe('paywallBus', () => {
  it('delivers the request synchronously to a subscriber', () => {
    const seen: PaywallRequest[] = [];
    const off = onPaywallRequested((r) => seen.push(r));
    requestPaywall(request({ savedCount: 51 }));
    assert.deepEqual(seen, [request({ savedCount: 51 })]);
    off();
  });

  it('stops delivering after unsubscribe, and unsubscribing twice is harmless', () => {
    const seen: PaywallRequest[] = [];
    const off = onPaywallRequested((r) => seen.push(r));
    requestPaywall(request());
    off();
    off();
    requestPaywall(request());
    assert.equal(seen.length, 1);
  });

  it('delivers to every subscriber, in subscription order', () => {
    const order: string[] = [];
    const offA = onPaywallRequested(() => order.push('a'));
    const offB = onPaywallRequested(() => order.push('b'));
    requestPaywall(request());
    assert.deepEqual(order, ['a', 'b']);
    offA();
    offB();
  });

  it('delivers twice when the same callback subscribes twice', () => {
    let calls = 0;
    const callback = () => {
      calls += 1;
    };
    const offA = onPaywallRequested(callback);
    const offB = onPaywallRequested(callback);
    requestPaywall(request());
    assert.equal(calls, 2);
    offA();
    requestPaywall(request());
    assert.equal(calls, 3);
    offB();
  });

  it('does not deliver the in-flight event to a subscriber added during dispatch', () => {
    let lateCalls = 0;
    let offLate: (() => void) | null = null;
    const offFirst = onPaywallRequested(() => {
      offLate = onPaywallRequested(() => {
        lateCalls += 1;
      });
    });
    requestPaywall(request());
    assert.equal(lateCalls, 0);
    requestPaywall(request());
    assert.equal(lateCalls, 1);
    offFirst();
    offLate!();
  });

  it('does not call a subscriber unsubscribed during dispatch', () => {
    let calls = 0;
    let offSecond: () => void = () => {};
    const offFirst = onPaywallRequested(() => offSecond());
    offSecond = onPaywallRequested(() => {
      calls += 1;
    });
    requestPaywall(request());
    assert.equal(calls, 0);
    offFirst();
    offSecond();
  });

  it('a throwing subscriber does not prevent the others from being called', (t) => {
    t.mock.method(console, 'error', () => {});
    let afterCalls = 0;
    const offThrower = onPaywallRequested(() => {
      throw new Error('boom');
    });
    const offAfter = onPaywallRequested(() => {
      afterCalls += 1;
    });
    assert.doesNotThrow(() => requestPaywall(request()));
    assert.equal(afterCalls, 1);
    offThrower();
    offAfter();
  });
});
