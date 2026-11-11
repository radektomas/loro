import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePlanStatus } from '../../../lib/scalePlan.ts';

test('a plan is decided once no item is waiting', () => {
  assert.equal(resolvePlanStatus(['approved', 'proposed']), 'proposed');
  assert.equal(resolvePlanStatus(['approved', 'rejected', 'approved']), 'approved');
  assert.equal(resolvePlanStatus(['rejected', 'rejected']), 'rejected');
  assert.equal(resolvePlanStatus(['cut', 'rejected']), 'approved');
  assert.equal(resolvePlanStatus([]), 'proposed');
});
