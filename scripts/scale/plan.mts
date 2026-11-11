/**
 * Put the scaler's proposed batch in front of Radek (getloro.app/marketing#plan).
 *
 *   node scripts/scale/plan.mts plan.json
 *
 * plan.json: {batch, summary, items: [{slot, account, me_file, demo_file, hook,
 * hook_kind, line1_variant, voice, demo_kind, role: exploit|test, reason,
 * expected_multiple}]}. Refused (and nothing is written) if it breaks a rule
 * in lib/scalePlan.ts: a hook twice, no test slot, one hook style for all,
 * a missing clip.
 */
import { existsSync, readFileSync } from 'node:fs';
import { getAdminClient } from '../lib/supabaseAdmin.mts';
import { planProblems, type PlanInput } from '../../lib/scalePlan.ts';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/scale/plan.mts plan.json');
  process.exit(2);
}
const plan = JSON.parse(readFileSync(file, 'utf8')) as PlanInput;
const problems = planProblems(plan, existsSync);
if (problems.length) {
  console.error('plan refused:\n- ' + problems.join('\n- '));
  process.exit(1);
}

const db = getAdminClient();
const { data: saved, error } = await db.from('loro_scale_plans').insert({ batch: plan.batch, summary: plan.summary ?? null }).select('id').single();
if (error) throw new Error(`loro_scale_plans: ${error.message}`);
const { data: items, error: e2 } = await db.from('loro_scale_plan_items').insert(
  plan.items.map((i) => ({
    plan_id: saved.id,
    slot: i.slot,
    account: i.account,
    me_file: i.me_file,
    demo_file: i.demo_file,
    hook: i.hook,
    hook_kind: i.hook_kind ?? null,
    line1_variant: i.line1_variant ?? null,
    voice: i.voice ?? null,
    demo_kind: i.demo_kind ?? null,
    role: i.role,
    reason: i.reason,
    expected_multiple: i.expected_multiple ?? null,
  }))
).select('id, slot');
if (e2) {
  await db.from('loro_scale_plans').delete().eq('id', saved.id);
  throw new Error(`loro_scale_plan_items: ${e2.message}`);
}
console.log(`plan ${saved.id} · ${plan.items.length} reels → getloro.app/marketing#plan`);
for (const i of [...(items ?? [])].sort((a, b) => a.slot - b.slot)) console.log(`  slot ${i.slot}: plan_item_id ${i.id}`);
