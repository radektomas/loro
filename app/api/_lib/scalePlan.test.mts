import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planProblems, type PlanInput } from '../../../lib/scalePlan.ts';

const item = (slot: number, hook: string, extra: Partial<PlanInput['items'][number]> = {}) => ({
  slot,
  account: 'loro.app',
  me_file: `/me/${slot}.mov`,
  demo_file: `/demo/${slot}.mov`,
  hook,
  hook_kind: 'statement',
  role: 'exploit',
  reason: 'won 3x on radek.spanish',
  expected_multiple: 2,
  ...extra,
});

test('a good mixed plan has no problems', () => {
  assert.deepEqual(
    planProblems({ batch: '2026-11-12', items: [item(1, 'Hook one'), item(2, 'Hook two?', { hook_kind: 'question' }), item(3, 'Hook three', { role: 'test' })] }),
    []
  );
});

test('the same hook twice in a batch is refused, even across accounts and emoji', () => {
  const p = planProblems({ batch: 'b', items: [item(1, 'Day 400 of my streak 😭'), item(2, 'day 400 of my streak', { account: 'radek.spanish' })] });
  assert.ok(p.some((x) => x.includes('same hook as slot 1')));
});

test('3+ reels need a test slot and mixed hook styles', () => {
  const p = planProblems({ batch: 'b', items: [item(1, 'a b c'), item(2, 'd e f'), item(3, 'g h i')] });
  assert.ok(p.some((x) => x.includes('no test slot')));
  assert.ok(p.some((x) => x.includes('same hook style')));
});

test('missing clips, bad enums and empty plans are named', () => {
  const p = planProblems({ batch: 'b', items: [item(1, 'x y z', { account: 'nope', role: 'maybe', voice: 'they' })] }, () => false);
  for (const s of ['unknown account', 'role must be', 'voice must be', 'me clip not found', 'demo clip not found']) assert.ok(p.some((x) => x.includes(s)), s);
  assert.deepEqual(planProblems({ batch: 'b', items: [] }), ['the plan has no items']);
});
