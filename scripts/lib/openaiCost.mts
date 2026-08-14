/**
 * OpenAI spend metering with a hard ceiling.
 *
 * WHY THIS EXISTS. Every publish run spends real money — one gloss call per
 * video, and the gloss is output-heavy (a dictionary entry in four languages
 * for every unique word). Until now the only stop condition was the account
 * balance running dry, which the publisher detects *after* the fact via
 * `insufficient_quota`. That is a fine safety net and a terrible budget.
 *
 * So: every call routes its `usage` block through `charge()`, which converts
 * tokens to dollars against the table below and throws BudgetExceededError
 * once a run has spent its allowance. The publisher catches that and stops
 * cleanly, leaving every unprocessed candidate 'eligible' for the next run.
 *
 * The ceiling is checked BEFORE a call, not after: `assertAffordable()` refuses
 * to start work that would obviously overshoot. It cannot be exact — you do not
 * know a response's output length until you have it — so a run may finish a few
 * cents over. That is why RESERVE_USD exists.
 */

/**
 * USD per 1M tokens, {input, output}.
 *
 * Deliberately an allow-list that THROWS on an unknown model rather than
 * defaulting to zero or to some average. A budget computed from a made-up
 * price is worse than no budget: it reads as authoritative and is not. Adding
 * a model here means looking its price up, not guessing.
 */
const PRICES: Readonly<Record<string, { input: number; output: number }>> = {
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4.1': { input: 2, output: 8 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4 },
  'gpt-5': { input: 1.25, output: 10 },
  'gpt-5-mini': { input: 0.25, output: 2 },
  'gpt-5-nano': { input: 0.05, output: 0.4 },
};

export type Usage = {
  prompt_tokens?: number;
  completion_tokens?: number;
};

export class BudgetExceededError extends Error {
  constructor(spent: number, limit: number) {
    super(`OpenAI budget exhausted: $${spent.toFixed(4)} spent of $${limit.toFixed(2)}`);
    this.name = 'BudgetExceededError';
  }
}

type ModelLedger = { calls: number; input: number; output: number; usd: number };

const ledger = new Map<string, ModelLedger>();
/** null means "no ceiling" — the historical behaviour, still the default. */
let limitUsd: number | null = null;
/**
 * Headroom kept back so the in-flight call cannot push the run past the
 * ceiling. One gloss call on a wordy 75s clip is the largest single charge the
 * pipeline makes, and it lands around $0.05.
 */
const RESERVE_USD = 0.08;

export function setBudget(usd: number | null): void {
  limitUsd = usd;
}

export function priceOf(model: string): { input: number; output: number } {
  const price = PRICES[model];
  if (!price) {
    throw new Error(
      `No price on file for OpenAI model "${model}". Add it to PRICES in ` +
        `scripts/lib/openaiCost.mts (look the price up — do not guess).`
    );
  }
  return price;
}

/** Record one call's usage and return what it cost. */
export function charge(model: string, usage: Usage | undefined): number {
  const price = priceOf(model);
  const input = usage?.prompt_tokens ?? 0;
  const output = usage?.completion_tokens ?? 0;
  const usd = (input * price.input + output * price.output) / 1_000_000;

  const entry = ledger.get(model) ?? { calls: 0, input: 0, output: 0, usd: 0 };
  entry.calls += 1;
  entry.input += input;
  entry.output += output;
  entry.usd += usd;
  ledger.set(model, entry);
  return usd;
}

export function spentUsd(): number {
  let total = 0;
  for (const entry of ledger.values()) total += entry.usd;
  return total;
}

export function remainingUsd(): number {
  return limitUsd === null ? Infinity : Math.max(0, limitUsd - spentUsd());
}

/**
 * Throw if there is no room left for another unit of work. Call this before
 * starting a video, so the run stops between videos rather than half way
 * through one.
 */
export function assertAffordable(reserve = RESERVE_USD): void {
  if (limitUsd === null) return;
  if (spentUsd() + reserve > limitUsd) {
    throw new BudgetExceededError(spentUsd(), limitUsd);
  }
}

export function report(): string {
  const lines = [...ledger.entries()]
    .sort((a, b) => b[1].usd - a[1].usd)
    .map(
      ([model, e]) =>
        `  ${model.padEnd(14)} ${String(e.calls).padStart(4)} calls  ` +
        `${String(e.input).padStart(9)} in / ${String(e.output).padStart(8)} out  ` +
        `$${e.usd.toFixed(4)}`
    );
  const total = `  ${'TOTAL'.padEnd(14)} ${' '.repeat(33)}$${spentUsd().toFixed(4)}`;
  return [...lines, total].join('\n');
}
