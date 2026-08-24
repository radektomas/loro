import { Linking, NativeModules } from 'react-native';
import { useEffect, useState } from 'react';
import type { CustomerInfo, LOG_LEVEL, PACKAGE_TYPE } from 'react-native-purchases';
import { createEmitter } from '@loro/core/emitter';
import { getSession, onAuthChange } from '@loro/core/auth';
import { EAS_BUILD_PROFILE, REVENUECAT_IOS_KEY } from './config';
import { storageDriver } from './storage';

/**
 * The purchases seam: RevenueCat configuration, identity, and the one
 * entitlement verdict the rest of the app is allowed to read.
 *
 * THE VERDICT COMES FROM CustomerInfo, NEVER FROM MMKV. The web's entitlement
 * seam caches a tier in the storage driver because its save gate must answer
 * synchronously inside saveWord(); this gate is different — it decides which
 * SCREEN renders, which is naturally async — so there is no cached-tier layer
 * to go stale or to tamper with. The SDK's own on-device CustomerInfo cache is
 * what answers when the network is down, and that cache is RevenueCat's to
 * manage, not ours to duplicate.
 *
 * IDENTITY RIDES THE SAME AUTH BUS AS THE MERGE. storage.initSync() subscribes
 * to onAuthChange at boot and runs the anonymous → signed-in merge when a
 * session appears; this module subscribes to the SAME events as a sibling, so
 * every path that triggers the merge — magic-link cold start, Google sign-in,
 * session restored from MMKV — also reaches Purchases.logIn, and a purchase
 * made anonymously follows the user onto their account. Core cannot make this
 * call itself: it is platform-shared with the web, and react-native-purchases
 * is a native module.
 *
 * FAILS OPEN when EXPO_PUBLIC_REVENUECAT_IOS_KEY is unset — see config.ts for
 * why that direction. The gate also fails open past SAFETY_TIMEOUT_MS if the
 * SDK's first answer never lands: an app that hangs on a splash forever is a
 * worse failure than one free session, and a subscriber's cached CustomerInfo
 * normally answers in milliseconds.
 */

/** The RevenueCat entitlement identifier. Must exist in the RevenueCat
    dashboard, attached to every product in the current offering. Named to
    match the web's Tier 'plus' (packages/core entitlements/limit.ts). */
export const ENTITLEMENT_ID = 'plus';

const SAFETY_TIMEOUT_MS = 6000;

/**
 * Every fail-open exit funnels through here so the situation is greppable.
 *
 * In a production binary an open gate with no verdict means revenue is
 * leaking — error level, tagged PAYWALL_FAIL_OPEN, because app.config.ts's
 * build guard should have made the missing-key case impossible and the
 * timeout case is worth counting in whatever log drain picks this up. In dev
 * and preview builds the same states are routine (no key in eas.json yet,
 * simulator with no network), so they stay a quiet warning and the runtime
 * behaviour — the gate opens — is identical everywhere.
 */
function logFailOpen(detail: string): void {
  if (EAS_BUILD_PROFILE === 'production') {
    console.error(`PAYWALL_FAIL_OPEN ${detail} — entitlement gate opened without a verdict; this install is free`);
  } else {
    console.warn(`[loro] paywall failing open: ${detail}`);
  }
}

/**
 * THE NATIVE MODULE IS LOADED LAZILY, AND THAT IS NOT STYLE — IT IS THE
 * DIFFERENCE BETWEEN A DEGRADED APP AND NO APP.
 *
 * `import Purchases from 'react-native-purchases'` at module scope throws
 * during module EVALUATION in any binary without the native module, which is
 * a red screen at boot ("Runtime not ready · RevenueCat native module not
 * found") — no try/catch inside a function can catch that, because none of
 * them have run yet. It bites exactly where it hurts most: an older
 * development client that predates the paywall can no longer open the app at
 * all, so a JS-only change cannot be tested without spending a build.
 *
 * A require() behind a guard turns that into the same fail-open the missing
 * key already takes, which is this file's established policy: the gate opens,
 * one line is logged, and the app runs free rather than not at all. Production
 * binaries always carry the module (it is a dependency) and app.config.ts
 * already refuses to build production without the key, so nothing about the
 * shipped paywall changes. Copied in shape from platform/notifications.ts,
 * whose seam exists for this same failure.
 */
type PurchasesApi = typeof import('react-native-purchases').default & {
  LOG_LEVEL?: typeof LOG_LEVEL;
};

let seam: PurchasesApi | null = null;
let seamResolved = false;
let packageTypes: typeof PACKAGE_TYPE | null = null;

/**
 * The SDK's runtime surface, or null when the native module is absent.
 * Exported so the paywall screen goes through the same guard rather than
 * re-importing the module statically and re-introducing the boot throw.
 */
export function getPurchasesApi(): PurchasesApi | null {
  return getSeam();
}

/** The PACKAGE_TYPE enum off the same module, or null when it is absent. */
export function getPackageTypes(): typeof PACKAGE_TYPE | null {
  getSeam(); // resolves the module (and packageTypes with it) exactly once
  return packageTypes;
}

function getSeam(): PurchasesApi | null {
  if (seamResolved) return seam;
  seamResolved = true;
  /**
   * ⚠️ require() SUCCEEDING IS NOT ENOUGH, which is how the first version of
   * this guard still crashed. react-native-purchases' JS wrapper imports
   * fine in a binary without the native side; every method then dereferences
   * a null NativeModules.RNPurchases, so the throw simply moves from import
   * time to the first call ("Cannot read property 'setLogLevel' of null") and
   * lands as an unhandled promise rejection. The native module itself is the
   * thing to test for.
   */
  if (!NativeModules.RNPurchases) {
    seam = null;
    logFailOpen('the RevenueCat native module is not linked in this binary');
    return seam;
  }
  try {
    const mod = require('react-native-purchases') as {
      default: PurchasesApi;
      LOG_LEVEL: typeof LOG_LEVEL;
      PACKAGE_TYPE: typeof PACKAGE_TYPE;
    };
    seam = mod.default;
    if (seam) seam.LOG_LEVEL = mod.LOG_LEVEL;
    packageTypes = mod.PACKAGE_TYPE;
  } catch (error) {
    seam = null;
    logFailOpen(`react-native-purchases is unavailable in this binary: ${String(error)}`);
  }
  return seam;
}

export type PurchaseGate = {
  /** False until the first entitlement verdict (or timeout). While false the
      splash stays up — render nothing meaningful behind it. */
  ready: boolean;
  /** True = the app is open: active entitlement, or purchases unconfigured. */
  entitled: boolean;
  /** False when the SDK key is missing and the gate is open by default. */
  configured: boolean;
};

let gate: PurchaseGate = { ready: false, entitled: false, configured: false };
const gateChanged = createEmitter<void>('purchaseGateChanged');

function setGate(next: Partial<PurchaseGate>): void {
  const merged = { ...gate, ...next };
  if (
    merged.ready === gate.ready &&
    merged.entitled === gate.entitled &&
    merged.configured === gate.configured
  ) {
    return;
  }
  gate = merged;
  gateChanged.emit();
}

export function getPurchaseGate(): PurchaseGate {
  return gate;
}

export function onPurchaseGateChanged(callback: () => void): () => void {
  return gateChanged.subscribe(callback);
}

/** The gate as React state. App.tsx decides Shell vs PaywallScreen on it. */
export function usePurchaseGate(): PurchaseGate {
  const [state, setState] = useState(gate);
  useEffect(() => onPurchaseGateChanged(() => setState(gate)), []);
  return state;
}

function entitledIn(info: CustomerInfo): boolean {
  return info.entitlements.active[ENTITLEMENT_ID] != null;
}

function applyCustomerInfo(info: CustomerInfo): void {
  setGate({ ready: true, entitled: entitledIn(info) });
}

// ------------------------------------------------------------------ identity

/**
 * undefined = no identity applied yet this launch; string|null mirrors the
 * session's user id. The dedupe matters because getSession() at boot and the
 * first onAuthChange event usually agree, and logIn is a network call.
 */
let appliedUserId: string | null | undefined;

/** Serialises logIn/logOut so a fast sign-in/sign-out cannot interleave. */
let identityQueue: Promise<void> = Promise.resolve();

function applyIdentity(userId: string | null): void {
  identityQueue = identityQueue.then(async () => {
    if (userId === appliedUserId) return;
    const previous = appliedUserId;
    appliedUserId = userId;
    const api = getSeam();
    if (!api) return;
    try {
      if (userId) {
        // Anonymous purchases transfer to this app user id by RevenueCat's
        // default transfer behaviour — this is the "purchases follow the
        // account" half of the anonymous → signed-in merge.
        const { customerInfo } = await api.logIn(userId);
        applyCustomerInfo(customerInfo);
      } else if (previous) {
        // Signed out: back to a fresh anonymous id. Entitlements bought under
        // the account drop with it; Restore purchases can re-attach what this
        // device's Apple ID actually owns.
        const customerInfo = await api.logOut();
        applyCustomerInfo(customerInfo);
      }
    } catch (err) {
      // Retried at the next auth event — same contract as the sync engine.
      appliedUserId = undefined;
      console.error('[loro] purchases identity change failed', err);
    }
  });
}

// ----------------------------------------------------------------- configure

let configured = false;

/**
 * Called once, at module scope, from platform/boot.ts — after initAuth, so the
 * session read below answers, and before anything renders, so the listener is
 * live for the whole life of the process.
 */
export function initPurchases(): void {
  if (configured) return;
  if (!REVENUECAT_IOS_KEY) {
    logFailOpen('EXPO_PUBLIC_REVENUECAT_IOS_KEY is unset, purchases disabled');
    setGate({ ready: true, entitled: true, configured: false });
    return;
  }
  const api = getSeam();
  if (!api) {
    // getSeam already logged why. Same shape as the missing-key branch above.
    setGate({ ready: true, entitled: true, configured: false });
    return;
  }
  configured = true;

  /**
   * BELT AND BRACES over the probe above. The probe answers "is the module
   * linked"; this catches every other way a native call can fail on a binary
   * that is subtly out of step with the JS (a partially linked module, an SDK
   * major mismatch). Failing open here is the same verdict the missing key and
   * missing module already produce, and it must never be a crash: refusing to
   * boot is a far worse outcome than one free session.
   */
  try {
    if (__DEV__ && api.LOG_LEVEL) {
      // .catch, not void: a rejected promise from a native bridge with no
      // handler is an unhandled rejection, which RN surfaces as a red screen.
      api.setLogLevel(api.LOG_LEVEL.DEBUG).catch(() => {});
    }
    api.configure({ apiKey: REVENUECAT_IOS_KEY });
    setGate({ configured: true });

    // Fires on every entitlement change for the life of the process: purchase,
    // restore, renewal, refund, logIn/logOut. The paywall never has to push its
    // result anywhere — the gate hears it from here.
    api.addCustomerInfoUpdateListener(applyCustomerInfo);
  } catch (error) {
    configured = false;
    logFailOpen(`RevenueCat configure failed: ${String(error)}`);
    setGate({ ready: true, entitled: true, configured: false });
    return;
  }

  // First verdict. Served from the SDK's on-device cache when offline, so a
  // subscriber in airplane mode still opens; genuinely unknown (first launch
  // offline) resolves to the paywall, which has its own retry.
  void api.getCustomerInfo()
    .then(applyCustomerInfo)
    .catch((err) => {
      console.warn('[loro] initial CustomerInfo fetch failed', err);
      setGate({ ready: true });
    });

  // The splash must not be able to hang on a fetch that never settles.
  setTimeout(() => {
    if (!gate.ready) {
      logFailOpen(`no CustomerInfo verdict within ${SAFETY_TIMEOUT_MS}ms`);
      setGate({ ready: true, entitled: true });
    }
  }, SAFETY_TIMEOUT_MS);

  // Identity, exactly as storage.initSync() does it: the restored session
  // first, then every change. Both funnel through the same dedupe.
  void getSession().then((session) => applyIdentity(session?.user?.id ?? null));
  onAuthChange((session) => applyIdentity(session?.user?.id ?? null));
}

// -------------------------------------------------------------- attribution

const CAMPAIGN_KEY = 'loro.campaign';
const CAMPAIGN_CAPTURED_KEY = 'loro.campaignCaptured';
const CAMPAIGN_SENT_KEY = 'loro.campaignSent';

function parseCampaignToken(url: string): string | null {
  try {
    const params = new URL(url).searchParams;
    return params.get('campaign') ?? params.get('utm_campaign');
  } catch {
    return null;
  }
}

/**
 * First-launch acquisition attribution, called from finishBoot().
 *
 * Reads a campaign token from the URL the app was first opened with (e.g.
 * loro://…?campaign=tiktok-aug) and sets it as RevenueCat's $campaign
 * subscriber attribute, so a trial start seen in the dashboard can be tied to
 * the campaign that produced the install.
 *
 * The CAPTURE happens exactly once, on the first launch — a deep link opened
 * months later is navigation, not acquisition. The SEND is retried on later
 * launches until it succeeds, because the token may be captured on a build
 * with no SDK key, or the first setCampaign may fail offline.
 */
export async function captureCampaignAttribution(): Promise<void> {
  const local = storageDriver.local;
  try {
    if (local.getItem(CAMPAIGN_CAPTURED_KEY) !== '1') {
      local.setItem(CAMPAIGN_CAPTURED_KEY, '1');
      const url = await Linking.getInitialURL();
      const token = url ? parseCampaignToken(url) : null;
      if (token) local.setItem(CAMPAIGN_KEY, token);
    }
    const token = local.getItem(CAMPAIGN_KEY);
    if (!token || !configured) return;
    if (local.getItem(CAMPAIGN_SENT_KEY) === '1') return;
    const api = getSeam();
    if (!api) return;
    await api.setCampaign(token);
    local.setItem(CAMPAIGN_SENT_KEY, '1');
  } catch (err) {
    console.warn('[loro] campaign attribution failed', err);
  }
}
