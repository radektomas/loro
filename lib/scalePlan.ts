/**
 * The rules a scaler plan must keep before it reaches Radek (checked by
 * scripts/scale/plan.mts). Pure: node --test loads it.
 */
import { ACCOUNTS, hookKey } from './cutReels.ts';

export type PlanItemInput = {
  slot: number;
  account: string;
  me_file: string;
  demo_file: string;
  hook: string;
  hook_kind?: string | null;
  line1_variant?: string | null;
  voice?: string | null;
  demo_kind?: string | null;
  role: string;
  reason: string;
  expected_multiple?: number | null;
};
export type PlanInput = { batch: string; summary?: string; items: PlanItemInput[] };

export type ItemStatus = 'proposed' | 'approved' | 'rejected' | 'cut';

/** A plan's status from its items: decided once none is waiting; approved if any item went ahead. */
export function resolvePlanStatus(items: ItemStatus[]): 'proposed' | 'approved' | 'rejected' {
  if (items.length === 0 || items.includes('proposed')) return 'proposed';
  return items.some((s) => s === 'approved' || s === 'cut') ? 'approved' : 'rejected';
}

/** Everything wrong with a plan, in plain words; empty = it can go to Radek. */
export function planProblems(plan: PlanInput, fileExists: (p: string) => boolean = () => true): string[] {
  const out: string[] = [];
  if (!plan.batch) out.push('batch is missing');
  if (!plan.items?.length) return [...out, 'the plan has no items'];
  const hooks = new Map<string, number>();
  const slots = new Set<number>();
  for (const i of plan.items) {
    const at = `slot ${i.slot}`;
    if (slots.has(i.slot)) out.push(`${at}: slot used twice`);
    slots.add(i.slot);
    if (!ACCOUNTS.includes(i.account as never)) out.push(`${at}: unknown account "${i.account}"`);
    if (!['exploit', 'test'].includes(i.role)) out.push(`${at}: role must be exploit or test`);
    if (!i.hook?.trim()) out.push(`${at}: no hook`);
    if (!i.reason?.trim()) out.push(`${at}: no reason`);
    if (i.hook_kind && !['question', 'statement'].includes(i.hook_kind)) out.push(`${at}: hook_kind must be question or statement`);
    if (i.voice && !['i', 'you'].includes(i.voice)) out.push(`${at}: voice must be i or you`);
    if (i.demo_kind && !['reels', 'peppa', 'other', 'unknown'].includes(i.demo_kind)) out.push(`${at}: unknown demo_kind`);
    if (!fileExists(i.me_file)) out.push(`${at}: me clip not found: ${i.me_file}`);
    if (!fileExists(i.demo_file)) out.push(`${at}: demo clip not found: ${i.demo_file}`);
    const k = hookKey(i.hook ?? '');
    if (hooks.has(k)) out.push(`${at}: same hook as slot ${hooks.get(k)} (no hook twice in a batch, on any account)`);
    hooks.set(k, i.slot);
  }
  // winners first (Radek, 2026-11-13: "push mainly the winning hooks"): tests are optional, at most 1 per 4 reels
  const tests = plan.items.filter((i) => i.role === 'test').length;
  if (tests > Math.max(1, Math.floor(plan.items.length / 4))) out.push(`too many tests (${tests}): at most 1 per 4 reels, the rest push winning hooks`);
  const kinds = new Set(plan.items.map((i) => i.hook_kind).filter(Boolean));
  if (plan.items.length >= 3 && kinds.size === 1) out.push('every reel has the same hook style: mix question and statement hooks');
  return out;
}
