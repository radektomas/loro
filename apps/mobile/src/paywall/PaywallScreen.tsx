import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getPaywallStyle, getPaywallVariant } from '../platform/remoteFlags';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, FadeIn, FadeInDown, FadeInRight } from 'react-native-reanimated';
import type {
  PurchasesPackage,
  PurchasesStoreProduct,
} from 'react-native-purchases';
import { DeleteAccountCard } from '../auth/DeleteAccountCard';
import { SignInCard } from '../auth/SignInCard';
import { BRAND } from '../onboarding/brand';
import { Backdrop, IconTile, TypingMock } from '../onboarding/art';
import { getCatalog } from '@loro/core/catalog';
import { collectionVideos } from '@loro/core/catalog/collectionVideos';
import { storage } from '@loro/core/storage';
import { TRIP, buildRoadmap, citySize, splitCities, tripStop, withLevelKnown } from '@loro/core/roadmap';
import { cleanWord } from '@loro/core/dictionary';
import { KNOWN_BOX } from '@loro/core/srs';
import { DemoIntro, paywallDemoDue } from './DemoIntro';
import { EXIT_OFFERING_ID, ExitOffer } from './ExitOffer';
import { PaywallFeedback, markPaywallFeedbackAsked, paywallFeedbackDue, takeDevPaywallFeedback } from './PaywallFeedback';
import { getPlan, type Plan } from '../progress/plan';
import { devReleaseForcedPaywall, getPackageTypes, getPurchasesApi } from '../platform/purchases';
import { track } from '../platform/analytics';
import {
  ACCENT,
  CARD,
  GROUND,
  MUTED,
  ON_ACCENT,
  PrimaryButton,
  TEXT,
  TextButton,
} from '../onboarding/chrome';
import { getPermissionState, noteTrialStarted } from '../platform/notifications';
import { authEnabled } from '../platform/supabaseInit';
import { LegalLinks } from '../progress/LegalLinks';

/**
 * The hard paywall. Rendered by App.tsx INSTEAD OF Shell whenever the
 * entitlement gate is ready and not entitled — it is the wall, not a modal
 * over something, so it has no dismiss affordance. What it guarantees instead
 * is that no STATE inside it is a dead end: a cancelled purchase returns to
 * the plans untouched, a failure shows one plain sentence and returns, restore
 * is always one tap away, and a failed offerings fetch has a retry. Review can
 * always subscribe (sandbox), restore, or read the legal pages.
 *
 * GUIDELINE 3.1.2 LIVES ON THIS SCREEN, visibly, not behind a link: every
 * plan's name, billing period and store-localised price; the per-month
 * arithmetic for annual plans; the trial's exact length and what it converts
 * to; the auto-renewal sentence; Restore purchases; Terms and Privacy.
 *
 * NOTHING HERE IS HARDCODED MONEY. Plans come from the current RevenueCat
 * offering; every displayed price is the store product's own localised
 * priceString (or the SDK's pricePerMonthString derivation). The one fallback
 * computation (perMonthLabel) divides the store's numeric price and formats it
 * in the product's own currency.
 *
 * THE WALL MUST NOT ORPHAN AN ACCOUNT. A subscriber who created an account
 * and later lapsed lands HERE, with Progress — the only other account surface
 * — out of reach. So the footer opens an account sheet mounting the same
 * SignInCard and DeleteAccountCard Progress uses: sign-in, sign-out and
 * guideline 5.1.1(v) account deletion all stay reachable without paying
 * again. Signing in also runs Purchases.logIn via the auth listener
 * (purchases.ts), so a subscription tied to the account can open the gate by
 * itself.
 */

type Offer =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; packages: PurchasesPackage[] };

/** "per month" / "every 3 months", from an ISO-8601 subscription period. */
function periodLabel(iso: string | null): string | null {
  if (!iso) return null;
  const m = /^P(\d+)([DWMY])$/.exec(iso);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = { D: 'day', W: 'week', M: 'month', Y: 'year' }[
    m[2] as 'D' | 'W' | 'M' | 'Y'
  ];
  return n === 1 ? `per ${unit}` : `every ${n} ${unit}s`;
}

function planName(pkg: PurchasesPackage): string {
  // The enum is read through the seam rather than imported — see
  // platform/purchases.ts on why nothing may import this module statically.
  const types = getPackageTypes();
  if (!types) return pkg.product.title;
  switch (pkg.packageType) {
    case types.ANNUAL:
      return 'Annual';
    case types.SIX_MONTH:
      return '6 months';
    case types.THREE_MONTH:
      return '3 months';
    case types.TWO_MONTH:
      return '2 months';
    case types.MONTHLY:
      return 'Monthly';
    case types.WEEKLY:
      return 'Weekly';
    case types.LIFETIME:
      return 'Lifetime';
    default:
      return pkg.product.title;
  }
}

/**
 * The computed per-month price for plans billed yearly. The SDK derives it
 * where it can (pricePerMonthString, store-localised); the fallback divides
 * the store's own numeric price and formats it in the product's currency, so
 * no path invents a number the store did not supply.
 */
function perMonthLabel(product: PurchasesStoreProduct): string | null {
  const m = /^P(\d+)Y$/.exec(product.subscriptionPeriod ?? '');
  if (!m) return null;
  if (product.pricePerMonthString) return product.pricePerMonthString;
  const months = Number(m[1]) * 12;
  const value = product.price / months;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: product.currencyCode,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${product.currencyCode}`;
  }
}

/**
 * The plan as one line, the way the user would say it. "as much as you can"
 * is the serious option's label and reads as a shrug here, so that plan is
 * stated as its numbers, every day — which is what it is.
 */
function planLine(plan: Plan): string {
  const words = `${plan.wordsPerDay} words a day`;
  switch (plan.pace) {
    case 'light':
      return `${words}, a few times a week`;
    case 'daily':
    case 'serious':
      return `${words}, every day`;
    default:
      return words;
  }
}

/**
 * WHICH PLAN IS PRE-SELECTED — and so which price the first Apple sheet says.
 *
 * Until 2026-09-11 it was the annual plan. Thirty days of purchase events
 * then read: six taps on Subscribe, five cancelled on Apple's sheet, four of
 * them looking at the yearly price. A first sheet that says $9.99 is a
 * smaller thing to say yes to than $59.99, so MONTHLY goes first — but only
 * when it carries a trial. A sheet that says "$9.99 now" with no trial is
 * worse than the yearly one with "free for 7 days", so a plan with a trial
 * always beats one without, and the trial is store configuration
 * (App Store Connect → Introductory Offers), not code: add it to the
 * monthly product and monthly becomes the default with no build.
 *
 * Order: monthly with trial, then any other plan with a trial (annual),
 * then monthly without, then whatever is first.
 */
function defaultPackage(packages: PurchasesPackage[]): PurchasesPackage {
  const monthlyType = getPackageTypes()?.MONTHLY;
  const isMonthly = (p: PurchasesPackage) => p.packageType === monthlyType;
  const hasTrial = (p: PurchasesPackage) => trialLength(p.product) !== null;
  return (
    packages.find((p) => isMonthly(p) && hasTrial(p)) ??
    packages.find(hasTrial) ??
    packages.find(isMonthly) ??
    packages[0]
  );
}

/**
 * "Save 50%" on a yearly plan, against the monthly plan paid twelve times.
 * Computed from the store's own numeric prices in the same currency, never
 * hardcoded — prices move per territory. Null when there is no monthly to
 * compare with, when currencies differ, or when the saving is under 10%
 * (a "Save 4%" chip reads as a joke).
 */
function savingLabel(pkg: PurchasesPackage, all: PurchasesPackage[]): string | null {
  const types = getPackageTypes();
  if (!types || pkg.packageType !== types.ANNUAL) return null;
  const monthly = all.find((p) => p.packageType === types.MONTHLY);
  if (!monthly || monthly.product.currencyCode !== pkg.product.currencyCode) return null;
  const yearAtMonthly = monthly.product.price * 12;
  if (yearAtMonthly <= 0) return null;
  const pct = Math.round((1 - pkg.product.price / yearAtMonthly) * 100);
  return pct >= 10 ? `Save ${pct}%` : null;
}

/** "7-day" / "1-week" / "1-month" — the trial's exact store-configured length. */
function trialLength(product: PurchasesStoreProduct): string | null {
  const intro = product.introPrice;
  if (!intro || intro.price !== 0) return null;
  const unit = intro.periodUnit.toLowerCase();
  return `${intro.periodNumberOfUnits}-${unit}`;
}

/** The trial in whole days (7 for "1-week"), or null when there is none. */
function trialDays(product: PurchasesStoreProduct): number | null {
  const intro = product.introPrice;
  if (!intro || intro.price !== 0) return null;
  const n = intro.periodNumberOfUnits;
  switch (intro.periodUnit.toUpperCase()) {
    case 'DAY':
      return n;
    case 'WEEK':
      return n * 7;
    case 'MONTH':
      return n * 30;
    case 'YEAR':
      return n * 365;
    default:
      return null;
  }
}

/** How many Peppa episodes ship in this build — a fact from the bundle,
    never a number typed into copy. */
/**
 * THE ONE REVIEW, quoted. A REAL App Store review (Czech storefront,
 * five stars, by "tomasooooo", 2026), reproduced with its grammar tidied
 * and its meaning untouched: the original reads "Finally someone did
 * something for get my Spanish after 4years of duolingo to higher level".
 * This repo once shipped invented testimonials and deleted them; a quote
 * lives here only because a person wrote it on the store, and the next
 * one goes in the same way — copy it from the store, note the original.
 */
const REVIEW = {
  stars: 5,
  text: 'Finally someone did something to get my Spanish to a higher level after four years of Duolingo.',
  author: 'tomasooooo',
  source: 'App Store review',
};

/**
 * HOW MANY WORDS LORO HOLDS — distinct dictionary entries across the
 * catalog on the device plus the bundled shelves, rounded DOWN to the
 * hundred so the line never claims more than is there. Counted, never
 * typed (Radek, 2026-09-22: "say the amount of words we have on Loro").
 */
/**
 * THE WALL OUT OF THE FIRST ARRIVAL (Radek, 2026-10-08: "do it how you think
 * it will convert the best"). What they already have, then what is next:
 * Loro cheering them on, "Don't stop now", Sevilla as a concrete next
 * step, and the five words they actually learned, ticked. Their own words
 * make stopping feel like leaving something behind; a sample could not. Everything on it is theirs.
 */
/**
 * THEIR SPANISH, MID-WAY (Radek, 2026-10-09: "words in progress of
 * learning, so it's like they are in the process and they don't want to
 * stop"). The Madrid words they finished, bar full, then the words already
 * waiting in Sevilla, bar part-way by how far their schedule has got them —
 * a row that is visibly unfinished. Real rows only; a user with nothing
 * waiting yet sees just their Madrid words.
 */
function wordsInProgress(): { word: string; meaning: string; fill: number }[] {
  const trip = withLevelKnown(storage.getSavedWords(), storage.getLevelKnownWords()).words;
  const cities = splitCities(buildRoadmap(trip));
  const learned = (cities[0] ?? [])
    .filter((n) => n.status === 'done')
    .map((n) => ({ word: cleanWord(n.word.text), meaning: n.word.translation, fill: 1 }));
  const going = cities
    .slice(1)
    .flat()
    .filter((n) => n.status !== 'done')
    .slice(0, 3)
    .map((n) => ({
      word: cleanWord(n.word.text),
      meaning: n.word.translation,
      fill: Math.min(0.8, Math.max(0.2, (n.word.box ?? 0) / KNOWN_BOX)),
    }));
  return [...learned.slice(0, 6 - going.length), ...going];
}

function ArrivedHead({ tight }: { tight: boolean }) {
  const words = useMemo(() => wordsInProgress(), []);
  const next = tripStop(1);
  return (
    <View style={styles.arrived}>
      {/* Loro on top, as everywhere a moment is his (Radek, 2026-10-08), and
          the five-star review in his bubble — someone else saying it, next
          to the mascot (Radek, 2026-10-09: "put the review instead of the
          chat bubble"). */}
      <View style={[styles.hero, styles.arrivedHero]}>
        <Image
          source={BRAND.parrotWaving}
          style={tight ? styles.arrivedParrotTight : styles.arrivedParrot}
          resizeMode="contain"
          accessibilityRole="image"
          accessibilityLabel="Loro the parrot"
        />
        <View
          style={[styles.bubble, styles.arrivedBubble]}
          accessibilityLabel={`${REVIEW.stars} star ${REVIEW.source} by ${REVIEW.author}: ${REVIEW.text}`}
        >
          <View style={styles.bubbleTail} />
          <Text style={styles.reviewStars}>{'★'.repeat(REVIEW.stars)}</Text>
          <Text style={styles.bubbleReview}>“{REVIEW.text}”</Text>
          <Text style={styles.reviewBy}>
            {REVIEW.author} <Text style={styles.reviewSource}>· {REVIEW.source}</Text>
          </Text>
        </View>
      </View>
      <Text style={[styles.title, styles.arrivedTitle, tight && styles.arrivedTitleTight]}>Don't stop now</Text>
      <Text style={styles.arrivedLine}>
        {next.city} is next: {citySize(1)} words and a new local word.
      </Text>
      {words.length > 0 && (
        <>
          <Text style={styles.arrivedLabel}>YOUR WORDS IN PROGRESS</Text>
          <View style={styles.learnedRow}>
            {words.map((w, i) => (
              <Animated.View
                key={w.word}
                entering={FadeInDown.delay(250 + i * 110).duration(420).easing(Easing.out(Easing.cubic))}
                style={[styles.learnedTile, tight && styles.learnedTileTight]}
              >
                <Text style={styles.learnedWord} numberOfLines={1}>
                  {w.word}
                </Text>
                <Text style={styles.learnedMeaning} numberOfLines={1}>
                  {w.meaning}
                </Text>
                {/* How far along: full for a finished word, part-way for one
                    still being learned. */}
                <View style={styles.learnedTrack}>
                  <View style={[styles.learnedFill, { width: `${Math.round(w.fill * 100)}%` }]} />
                </View>
              </Animated.View>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

/** Three dots over the multi-page wall: demo, value, price. */
function PageDots({ page }: { page: 1 | 2 | 3 }) {
  return (
    <View style={styles.dots} accessibilityLabel={`Page ${page} of 3`}>
      {[1, 2, 3].map((n) => (
        <View key={n} style={[styles.dot, n === page && styles.dotOn, n < page && styles.dotDone]} />
      ))}
    </View>
  );
}

/** Videos the user can actually watch: the catalog plus the bundled shelves,
    rounded DOWN to the ten. Counted, like wordCount, never typed. */
function videoCount(): number {
  return Math.floor((getCatalog().length + collectionVideos.length) / 10) * 10;
}

/** Down to a round figure for a headline: thousands from 1,000 up,
    hundreds below. 10,430 → 10,000; 547 → 500. Never rounds up. */
function niceFloor(n: number): number {
  if (n >= 1000) return Math.floor(n / 1000) * 1000;
  if (n >= 100) return Math.floor(n / 100) * 100;
  return n;
}

/**
 * THE WORDS HEADLINE ROUNDS UP, and that is the owner's call, made knowing
 * it (Radek, 2026-10-27: "make it 10,000+ … I know it's a bit of a lie, but
 * we can round the number"). On that day the device counted ~9,400
 * distinct words, so "10,000+" ran ahead of the catalog by ~600; each
 * harvest closes the gap. Below 1,000 (a catalog that failed to load) it
 * shows the real count rather than inventing one.
 */
function wordsHeadline(n: number): number {
  return n >= 1000 ? Math.ceil(n / 1000) * 1000 : n;
}

function wordCount(): number {
  const keys = new Set<string>();
  for (const video of [...getCatalog(), ...collectionVideos]) {
    for (const key of Object.keys(video.dictionary ?? {})) keys.add(key.toLowerCase());
  }
  return Math.floor(keys.size / 100) * 100;
}

export function PaywallScreen({
  arrived = false,
}: {
  /** Shown out of the first city arrival (paywall/freePass.ts): Madrid was
      free, and the wall says where they got to instead of "your plan". */
  arrived?: boolean;
} = {}) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [remindable, setRemindable] = useState(false);
  /** The package whose Apple sheet was just closed: the feedback card is up. */
  const [feedbackFor, setFeedbackFor] = useState<string | null>(() =>
    takeDevPaywallFeedback() ? 'dev-preview' : null
  );
  /** The arrival wall's fit: once the content is measured taller than the
      page, it switches to tight sizes for good (no flip-flopping). */
  const [viewportH, setViewportH] = useState(0);
  const [contentH, setContentH] = useState(0);
  const [tight, setTight] = useState(false);
  const [innerH, setInnerH] = useState(0);
  /** Room the page has: the scroll view minus its own top and bottom padding. */
  const room = viewportH - (insets.top + 8) - 12;
  const fit = arrived && tight && innerH > 0 && room > 0 ? Math.min(1, room / innerH) : 1;
  useEffect(() => {
    if (arrived && !tight && viewportH > 0 && contentH > viewportH + 1) setTight(true);
  }, [arrived, tight, viewportH, contentH]);
  useEffect(() => {
    if (!arrived) return;
    void getPermissionState().then((s) => setRemindable(s === 'granted'));
  }, [arrived]);
  const words = useMemo(() => wordCount(), []);
  const videos = useMemo(() => videoCount(), []);
  const [offer, setOffer] = useState<Offer>({ status: 'loading' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'purchase' | 'restore' | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  /**
   * THE EXIT OFFER (ExitOffer.tsx): the package from the RevenueCat
   * offering EXIT_OFFERING_ID, null when there is none — then neither the ✕
   * nor the sheet exists. `exitPreview` is dev only: no offering yet, so the
   * wall's own annual stands in to show the design.
   */
  const [exitPkg, setExitPkg] = useState<PurchasesPackage | null>(null);
  const [exitPreview, setExitPreview] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  /** The sheet-close trigger fires once per wall; the ✕ always works. */
  const exitAutoShown = useRef(false);
  const openExit = useCallback((from: 'close' | 'sheet') => {
    track('exit_offer_shown', { from });
    setExitOpen(true);
  }, []);
  /**
   * THE MULTI-PAGE WALL (Radek, 2026-10-12: "multi page paywall converts
   * better … it solves the problem, I couldn't fit everything into one
   * screen"). The launch wall only, and only in the 'multi' arm of the
   * remote split (remoteFlags.getPaywallStyle):
   *   1. the demo — a phone slides up playing the real recording (DemoIntro)
   *   2. the value — their plan, what it buys, the App Store review
   *   3. the price — Loro: "We want you to try Loro for free", then the button
   * The demo is once per install; a later launch opens on the price page.
   * The 'single' arm is the one-page wall exactly as shipped through 1.9.2.
   */
  const [multi] = useState(() => !arrived && getPaywallStyle() === 'multi');
  const [demo, setDemo] = useState(() => multi && paywallDemoDue());
  const [page, setPage] = useState<2 | 3>(() => (multi && paywallDemoDue() ? 2 : 3));
  const showPrice = !multi || page === 3;
  useEffect(() => {
    if (multi && !demo) track('paywall_page', { page });
  }, [multi, demo, page]);

  /**
   * THE WALL WAS SEEN. The denominator of every conversion number on the
   * dashboard, and the reason it is an effect with empty deps rather than
   * something the gate fires: App.tsx decides WHETHER to render this screen,
   * but only the screen itself knows it actually mounted, and a verdict that
   * flips to entitled mid-resolve must not be counted as a wall anybody
   * looked at.
   */
  useEffect(() => {
    track('paywall_shown', { after: arrived ? 'arrival' : 'launch', variant: getPaywallVariant(), style: arrived ? null : getPaywallStyle() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadOfferings = useCallback(() => {
    setOffer({ status: 'loading' });
    const api = getPurchasesApi();
    if (!api) {
      // No native module: the gate is already open (purchases.ts fails open),
      // so this screen should not be mounted at all. Fail visibly rather than
      // throwing.
      track('paywall_offerings_failed', { reason: 'no_native_module' });
      setOffer({ status: 'error' });
      return;
    }
    void api.getOfferings()
      .then((offerings) => {
        const packages = offerings.current?.availablePackages ?? [];
        if (packages.length === 0) {
          console.warn('[loro] current offering is empty');
          track('paywall_offerings_failed', { reason: 'empty_offering' });
          setOffer({ status: 'error' });
          return;
        }
        setOffer({ status: 'ready', packages });
        setSelectedId(defaultPackage(packages).identifier);
        const exit = offerings.all?.[EXIT_OFFERING_ID];
        const exitChoice = exit?.annual ?? exit?.availablePackages[0] ?? null;
        if (exitChoice) {
          setExitPkg(exitChoice);
        } else if (__DEV__) {
          const annual = packages.find((p) => p.packageType === getPackageTypes()?.ANNUAL) ?? null;
          setExitPkg(annual);
          setExitPreview(annual !== null);
        }
      })
      .catch((err) => {
        console.warn('[loro] offerings fetch failed', err);
        /**
         * Worth its own row rather than folding into "left": this is the
         * failure that presents as a paywall with no prices and no way to
         * pay, so a spike here is a revenue outage, not a pricing problem.
         */
        track('paywall_offerings_failed', { reason: 'fetch_failed' });
        setOffer({ status: 'error' });
      });
  }, []);

  useEffect(() => {
    loadOfferings();
  }, [loadOfferings]);

  const selected =
    offer.status === 'ready'
      ? (offer.packages.find((p) => p.identifier === selectedId) ??
        offer.packages[0])
      : null;
  /** The wall's chosen plan, under a name the purchase handler can shadow. */
  const selectedPkg = selected;

  const purchase = useCallback(async (chosen?: PurchasesPackage) => {
    const selected = chosen ?? selectedPkg;
    if (!selected || busy) return;
    /** Bought through the exit offer, not the wall's own plans. */
    const viaExit = chosen !== undefined && chosen === exitPkg;
    setBusy('purchase');
    /**
     * INTENT, RECORDED BEFORE THE SHEET OPENS. This is the event that splits
     * "the price was wrong" from "the checkout was broken": everyone below it
     * in the funnel wanted to pay, so the gap between this and
     * purchase_completed is money the App Store sheet lost, not money the
     * pricing lost. It must be written before the await for the obvious
     * reason — the process can die inside Apple's sheet.
     */
    track('purchase_started', {
      packageId: selected.identifier,
      packageType: selected.packageType,
      productId: selected.product.identifier,
      price: selected.product.price,
      currency: selected.product.currencyCode,
      // What Apple's sheet led with: "free for 7 days" or the price itself.
      // Without this the cancels above could not be told apart.
      trial: trialLength(selected.product),
      offer: viaExit ? 'exit' : null,
    });
    try {
      // Success needs no handling here: the CustomerInfo listener in
      // purchases.ts flips the gate and App.tsx unmounts this screen.
      const api = getPurchasesApi();
      if (!api) return;
      await api.purchasePackage(selected);
      /**
       * Recorded here even though the gate has already flipped underneath us.
       * RevenueCat knows about the money; this row is what ties it back to an
       * install_id, and therefore to the onboarding run and the paywall view
       * that produced it — the join the dashboard's funnel is built on.
       */
      track('purchase_completed', {
        packageId: selected.identifier,
        packageType: selected.packageType,
        productId: selected.product.identifier,
        price: selected.product.price,
        currency: selected.product.currencyCode,
        trial: trialLength(selected.product),
        offer: viaExit ? 'exit' : null,
      });
      // The timeline's "day 5: we remind you" — made true (notifications.ts).
      const days = trialDays(selected.product);
      if (days !== null) noteTrialStarted(days);
      // Dev only: a forced test wall lets go after a sandbox purchase.
      devReleaseForcedPaywall();
    } catch (err) {
      // A cancelled sheet is the user changing their mind, so it stays silent
      // in the UI — but it is emphatically an EVENT: someone who opened the
      // Apple sheet and backed out is the most persuadable person the funnel
      // has, and telling them apart from a failed charge is the difference
      // between a pricing fix and a bug fix.
      if ((err as { userCancelled?: boolean | null }).userCancelled) {
        track('purchase_cancelled', {
          packageId: selected.identifier,
          packageType: selected.packageType,
          offer: viaExit ? 'exit' : null,
        });
        // Leaving the wall's own plan: the exit offer first, once per wall
        // (ExitOffer.tsx). The feedback card waits for the next close.
        if (!viaExit && exitPkg && !exitAutoShown.current) {
          exitAutoShown.current = true;
          openExit('sheet');
          return;
        }
        // The one moment their reason is real — asked once ever.
        if (paywallFeedbackDue()) {
          markPaywallFeedbackAsked();
          setFeedbackFor(selected.identifier);
        }
        return;
      }
      console.warn('[loro] purchase failed', err);
      track('purchase_failed', {
        packageId: selected.identifier,
        packageType: selected.packageType,
        // RevenueCat's stable code, not the localised message: the message is
        // in the user's language and would fragment one cause into twenty.
        code: (err as { code?: string | number }).code ?? null,
      });
      Alert.alert(
        'Purchase not completed',
        'Nothing was charged. Please try again in a moment.'
      );
    } finally {
      setBusy(null);
    }
  }, [selectedPkg, busy, exitPkg, openExit]);

  const restore = useCallback(async () => {
    if (busy) return;
    setBusy('restore');
    try {
      const api = getPurchasesApi();
      if (!api) return;
      const info = await api.restorePurchases();
      // If a subscription came back, the gate has already opened via the
      // listener; this alert is only for the other outcome.
      if (Object.keys(info.entitlements.active).length === 0) {
        track('restore_empty');
        Alert.alert(
          'Nothing to restore',
          'No previous subscription was found for this Apple ID.'
        );
      } else {
        /**
         * A restore is NOT a sale, and the paywall report keeps it in its own
         * row for that reason: these are reinstalls and second devices. Folding
         * them into purchases would inflate conversion by exactly the number of
         * existing subscribers who reinstalled — which rises when retention
         * falls, so the metric would look best when the product was doing worst.
         */
        track('restore_succeeded');
        devReleaseForcedPaywall();
      }
    } catch (err) {
      console.warn('[loro] restore failed', err);
      track('restore_failed', {
        code: (err as { code?: string | number }).code ?? null,
      });
      Alert.alert(
        'Restore not completed',
        'Please check your connection and try again.'
      );
    } finally {
      setBusy(null);
    }
  }, [busy]);

  const trial = selected ? trialLength(selected.product) : null;
  const selectedDays = selected ? trialDays(selected.product) : null;
  const selectedPeriod = selected
    ? periodLabel(selected.product.subscriptionPeriod)
    : null;

  /**
   * ONE SCREEN, NO SCROLL, NO PLAN CARDS (Radek, 2026-09-11: "better a
   * click through than a scroll"). The offer is the trial; the yearly plan
   * that carries it is implied by the button and spelled out in the line
   * under it. Monthly — no trial, by the owner's choice — is one tap on a
   * text link that swaps the button, the terms and the timeline, and the
   * same link swaps back. Both prices are always on screen (the link names
   * the one not selected), which is what Apple's 3.1.2 asks for.
   */
  const other =
    offer.status === 'ready' && selected
      ? offer.packages.find((p) => p.identifier !== selected.identifier) ?? null
      : null;
  const otherPeriod = other ? periodLabel(other.product.subscriptionPeriod) : null;
  const otherDays = other ? trialDays(other.product) : null;
  const otherPerMonth = other ? perMonthLabel(other.product) : null;
  const otherSaving =
    other && offer.status === 'ready' ? savingLabel(other, offer.packages) : null;
  const billedWord = (period: string | null) =>
    period === 'per year' ? 'a year' : period === 'per month' ? 'a month' : period ?? '';

  return (
    <View style={styles.screen}>
      {/* The same wash the onboarding sits on — the wall is its last page. */}
      <Backdrop width={width} height={height} />
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + (arrived ? 8 : 16), paddingBottom: 12 },
        ]}
        showsVerticalScrollIndicator={false}
        bounces={false}
        // OUT OF THE ARRIVAL IT IS ONE STILL PAGE (Radek, 2026-10-08: "it
        // has to be a still, one page"). Nothing scrolls; a phone too short
        // for it gets the tight sizes instead (measured, below).
        scrollEnabled={!arrived}
        onLayout={arrived ? (e) => setViewportH(e.nativeEvent.layout.height) : undefined}
        onContentSizeChange={arrived ? (_w, h) => setContentH(h) : undefined}
      >
        {/* FIT, DON'T SCROLL (Radek, 2026-10-08: "you would need to scroll
            to see all that, I don't want that"). Tight sizes first; if the
            page is still taller than the screen, the whole page is scaled
            down to fit from the top. A transform does not change layout, so
            the measured height stays the natural one and nothing loops. */}
        <View
          onLayout={arrived ? (e) => setInnerH(e.nativeEvent.layout.height) : undefined}
          style={
            arrived && fit < 1
              ? { transform: [{ scale: fit }], transformOrigin: 'top center' }
              : multi
                ? styles.pageFill
                : undefined
          }
        >
        {/* THE SALE, in this order: their plan (the answers they just gave,
            as chips — level, pace), the product doing the thing (a clip with
            a word lit and Loro saying the line, the tap→saved beat on a
            loop), three lines of what that buys, and a free week that is
            safe to start. Nothing here promises an outcome. */}
        {multi && <PageDots page={demo ? 1 : page} />}
        <Animated.View
          key={multi ? `page-${page}` : 'single'}
          entering={multi ? FadeInRight.duration(280) : undefined}
          style={multi ? styles.pageFill : undefined}
        >
        {arrived ? (
          <ArrivedHead tight={tight} />
        ) : multi && page === 3 ? null : multi ? (
          /* THE VALUE PAGE'S OWN LINE (Radek, 2026-10-27): "Your plan is
             ready" had just been said by the two plan screens before the
             wall, so this page says what the numbers under it are for. */
          <>
            <Text style={styles.title}>Real Spanish, the way people actually speak it</Text>
          </>
        ) : (
          <>
            <Text style={styles.title}>Your plan is ready</Text>
            <View style={styles.chips}>
              <View style={[styles.chip, styles.chipAccent]}>
                <Text style={styles.chipAccentText}>{storage.getStartLevel() ?? 'A1'}</Text>
              </View>
              <View style={styles.chip}>
                <Text style={styles.chipText}>{planLine(getPlan())}</Text>
              </View>
            </View>
          </>
        )}
        {/* THREE COUNTED NUMBERS on the value page (Radek: "half of the page
            is empty … put something more"). Each is read off the device. */}
        {/* TWO NUMBERS, BIG (Radek, 2026-10-27: "more simple, only the
            10,000+ words and 500+ videos, and the review"). Counted on the
            device and rounded DOWN to a round figure (niceFloor), so the
            page never claims more than is there. */}
        {multi && page === 2 && (
          <View style={styles.stats}>
            <View style={styles.stat}>
              <Text style={styles.statNum}>{wordsHeadline(words).toLocaleString('en-US')}+</Text>
              <Text style={styles.statLabel}>Spanish words to tap</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statNum}>{niceFloor(videos).toLocaleString('en-US')}+</Text>
              <Text style={styles.statLabel}>real videos</Text>
            </View>
          </View>
        )}
        {/* No paragraph under the title: the value card below says it, and
            the wall must fit one screen (Radek: "I don't want any
            scrolling"). */}

        {offer.status === 'loading' && (
          <View style={styles.stateBox}>
            <ActivityIndicator color={ACCENT} />
          </View>
        )}

        {offer.status === 'error' && (
          <View style={styles.stateBox}>
            <Text style={styles.stateText}>
              The plans could not be loaded. Please check your connection.
            </Text>
            <TextButton label="Try again" onPress={loadOfferings} />
          </View>
        )}

        {/* THE MECHANIC, IN ONE STRIP: the line with the word lit, and the
            saved tag it becomes — the same picture the how-it-works screen
            opens on. (A drawn clip with Loro saying "¡Hola!" stood here for
            an hour; Radek: "I don't want that banner".) */}
        {/* LORO SAYS THE OWNER'S LINE, and the last word arrives the way a
            blank does in the app: letter by letter, then green (Radek,
            2026-09-22: "the mascot saying in a bubble 'we want you to try
            Loro for free', and the free will be like esta is now"). */}
        {!arrived && (!multi || page === 3) && (
        <View style={[styles.hero, multi && styles.heroBig]}>
          <Image
            source={BRAND.parrot}
            style={multi ? styles.heroParrotBig : styles.heroParrot}
            resizeMode="contain"
            accessibilityRole="image"
            accessibilityLabel="Loro the parrot"
          />
          <View style={[styles.bubble, multi && styles.bubbleBig]}>
            {!multi && <View style={styles.bubbleTail} />}
            <TypingMock
              before={['We', 'want', 'you', 'to', 'try', 'Loro', 'for']}
              answer="free"
              after={[]}
              gloss=""
              isCurrent
              bar={false}
              frame={false}
              size={multi ? 26 : 18}
            />
          </View>
        </View>
        )}

        {/* WHAT THAT BUYS — three lines, each a shipped fact. Not on the
            arrival wall (Radek, 2026-10-08: "put the real clips and Peppa
            Pig away"): there their words and the review carry it. */}
        {/* Not on the multi wall's value page any more: two numbers and
            the review carry it (2026-10-27). */}
        {!arrived && !multi && (
          <View style={[styles.benefits, multi && styles.benefitsBig]}>
            <View style={styles.benefit}>
              <IconTile glyph="▶︎" tint="sky" size={multi ? 42 : 34} />
              <Text style={[styles.benefitText, multi && styles.benefitTextBig]}>Real clips at your level, from real people</Text>
            </View>
            <View style={styles.benefit}>
              <IconTile glyph="✓" tint="mint" size={multi ? 42 : 34} />
              <Text style={[styles.benefitText, multi && styles.benefitTextBig]}>Every word you save, trained until it sticks</Text>
            </View>
            <View style={styles.benefit}>
              <IconTile glyph="★︎" tint="amber" size={multi ? 42 : 34} />
              <Text style={[styles.benefitText, multi && styles.benefitTextBig]}>
                {multi ? `One trip from Madrid across ${new Set(TRIP.map((t) => t.country)).size} Spanish-speaking countries` : `${words.toLocaleString('en-US')}+ Spanish words, every one tappable`}
              </Text>
            </View>
          </View>
        )}

        {/* WHAT SOMEONE SAID — see REVIEW. Out of the arrival it sits in
            Loro's bubble instead (ArrivedHead). */}
        {!arrived && (!multi || page === 2) && (
          <View style={[styles.review, multi && styles.reviewBig]} accessibilityLabel={`${REVIEW.stars} star ${REVIEW.source} by ${REVIEW.author}: ${REVIEW.text}`}>
            <View style={styles.reviewTop}>
              <Text style={styles.reviewStars}>{'★'.repeat(REVIEW.stars)}</Text>
              <Text style={styles.reviewBadge}>APP STORE</Text>
            </View>
            <Text style={[styles.reviewText, multi && styles.reviewTextBig]}>“{REVIEW.text}”</Text>
            <Text style={styles.reviewBy}>
              {REVIEW.author} <Text style={styles.reviewSource}>· {REVIEW.source}</Text>
            </Text>
          </View>
        )}
        </Animated.View>

        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 10 }]}>
        {/* THE PLANS AS TWO CARDS on the arrival wall (Radek, 2026-10-09:
            "the options of a trial"): both visible, each with its trial and
            price, the chosen one outlined in mint. Yearly first, with its
            saving. The button below follows the choice. */}
        {arrived && offer.status === 'ready' && offer.packages.length > 1 && (
          <View style={styles.plans}>
            {[...offer.packages]
              .sort((a, b) => (b.product.price ?? 0) - (a.product.price ?? 0))
              .map((pkg) => {
                const on = selected?.identifier === pkg.identifier;
                const days = trialDays(pkg.product);
                const period = periodLabel(pkg.product.subscriptionPeriod);
                const perMonth = perMonthLabel(pkg.product);
                const saving = savingLabel(pkg, offer.packages);
                return (
                  <Pressable
                    key={pkg.identifier}
                    onPress={() => setSelectedId(pkg.identifier)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    style={[styles.plan, on && styles.planOn]}
                  >
                    <View style={[styles.planDot, on && styles.planDotOn]}>
                      {on && <View style={styles.planDotInner} />}
                    </View>
                    <View style={styles.planText}>
                      <View style={styles.planHead}>
                        <Text style={styles.planName}>{planName(pkg)}</Text>
                        {saving && (
                          <View style={styles.planSave}>
                            <Text style={styles.planSaveText}>{saving}</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.planPrice} numberOfLines={1}>
                        {days !== null ? 'then ' : ''}
                        {pkg.product.priceString} {billedWord(period)}
                        {perMonth ? ` · ${perMonth} / month` : ''}
                      </Text>
                    </View>
                    {days !== null && <Text style={[styles.planTrial, on && styles.planTrialOn]}>{days} days free</Text>}
                  </Pressable>
                );
              })}
          </View>
        )}
        {/* The value page's only button: on to the price. */}
        {!showPrice && <PrimaryButton label="Continuar" onPress={() => setPage(3)} />}
        {/* The owner's line, right above the button it belongs to. */}
        {showPrice && selected && (
          <Pressable
            onPress={() => void purchase()}
            disabled={busy !== null}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.cta,
              (pressed || busy !== null) && styles.ctaDim,
            ]}
          >
            {busy === 'purchase' ? (
              <ActivityIndicator color={ON_ACCENT} />
            ) : (
              <Text style={styles.ctaText}>
                {selectedDays !== null
                  ? arrived
                    ? `Keep going, free for ${selectedDays} days`
                    : 'Start Loro for free'
                  : `Subscribe · ${selected.product.priceString} ${billedWord(selectedPeriod)}`}
              </Text>
            )}
          </Pressable>
        )}
        {/* The terms in READABLE size, right under the button. The sheet then
            confirms what was already read. */}
        {/* THE FEAR APPLE'S SHEET RAISES, answered before it opens: the
            trails showed people tapping, closing the sheet, trying Restore
            (2026-10-08). Only what is true: the reminder line needs
            notifications on (notifications.ts noteTrialStarted). */}
        {arrived && selected && selectedDays !== null && (
          <Text style={styles.ctaCalm}>
            {remindable ? 'No charge today · We remind you 2 days before' : 'No charge today · Cancel anytime in Settings'}
          </Text>
        )}
        {showPrice && selected && (
          <Text style={styles.ctaTerms}>
            {selectedDays !== null
              ? `${selectedDays} days free, then ${selected.product.priceString} ${billedWord(selectedPeriod)}` +
                (perMonthLabel(selected.product) ? ` (${perMonthLabel(selected.product)} / month)` : '') +
                ', renews until you cancel in Settings'
              : `${selected.product.priceString} ${billedWord(selectedPeriod)}, renews until you cancel in Settings`}
          </Text>
        )}
        {/* THE OTHER PLAN, one tap away. Names its price and whether it has a
            trial, so the choice is made here and not discovered on the sheet. */}
        {showPrice && other && !arrived && (
          <Pressable
            onPress={() => setSelectedId(other.identifier)}
            accessibilityRole="button"
            hitSlop={6}
            style={({ pressed }) => [styles.switchPlan, pressed && styles.ctaDim]}
          >
            <Text style={styles.switchPlanText}>
              {otherDays !== null
                ? `${planName(other)} · ${otherDays} days free, then ` +
                  (otherPerMonth ? `${otherPerMonth} / month` : `${other.product.priceString} ${billedWord(otherPeriod)}`) +
                  (otherSaving ? ` · ${otherSaving}` : '')
                : `${planName(other)} · ${other.product.priceString} ${billedWord(otherPeriod)}`}
            </Text>
          </Pressable>
        )}
        {/* No boilerplate paragraph here any more (Radek: "are those things
            necessary? I want a really nice paywall"). The one line under
            the button carries the terms Apple's 3.1.2 asks for — price,
            period, trial, auto-renewal, how to cancel — and Apple's own
            purchase sheet repeats them before any money moves. */}
        <View style={styles.footerLinks}>
          <TextButton
            label={busy === 'restore' ? 'Restoring…' : 'Restore purchases'}
            onPress={() => void restore()}
          />
          {authEnabled && (
            <TextButton
              label="Sign in & account"
              onPress={() => setAccountOpen(true)}
            />
          )}
        </View>
        <LegalLinks />
      </View>

      {/* THE ✕ (Radek, 2026-10-27, after Toneadapt): on the price page
          only, and only when an exit offer exists. It does not leave the
          wall (there is nowhere to go); it opens the better price. */}
      {showPrice && !arrived && !demo && exitPkg && !exitOpen && (
        <Animated.View
          entering={FadeIn.delay(2500).duration(400)}
          style={[styles.exitX, { top: insets.top + 6 }]}
        >
          <Pressable
            onPress={() => openExit('close')}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={12}
          >
            <Text style={styles.exitXText}>✕</Text>
          </Pressable>
        </Animated.View>
      )}

      {exitOpen && exitPkg && (
        <ExitOffer
          offer={exitPkg}
          regular={
            offer.status === 'ready'
              ? offer.packages.find((p) => p.packageType === getPackageTypes()?.ANNUAL) ?? null
              : null
          }
          busy={busy === 'purchase'}
          preview={exitPreview}
          onClaim={() => void purchase(exitPkg)}
          onClose={() => {
            track('exit_offer_closed');
            setExitOpen(false);
          }}
        />
      )}

      {feedbackFor !== null && (
        <PaywallFeedback packageId={feedbackFor} onClose={() => setFeedbackFor(null)} />
      )}

      {/* The account sheet — see the header note on not orphaning accounts.
          A pageSheet rather than a screen: the wall stays the surface, this
          is a drawer on it. DeleteAccountCard renders nothing while signed
          out, and its completed deletion path remounts the whole app. */}
      <Modal
        visible={accountOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setAccountOpen(false)}
      >
        <View style={styles.accountSheet}>
          <ScrollView
            contentContainerStyle={[
              styles.accountScroll,
              { paddingBottom: insets.bottom + 24 },
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.accountHead}>
              <Text style={styles.accountTitle}>Your account</Text>
              <Pressable
                onPress={() => setAccountOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={10}
                style={({ pressed }) => pressed && styles.accountClosePressed}
              >
                <Text style={styles.accountClose}>✕</Text>
              </Pressable>
            </View>
            <Text style={styles.accountBody}>
              Signing in brings back the words and progress synced to your
              account, and lets you manage or delete the account itself. A
              past subscription comes back with “Restore purchases”, through
              your Apple ID.
            </Text>
            <SignInCard />
            <DeleteAccountCard />
          </ScrollView>
        </View>
      </Modal>
      {/* Last, so it sits over the whole wall until Continuar slides it away. */}
      {demo && <DemoIntro onDone={() => setDemo(false)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: GROUND, flex: 1 },
  exitX: { left: 18, position: 'absolute' },
  exitXText: { color: 'rgba(242,245,243,0.35)', fontSize: 20, fontWeight: '600' },
  scroll: { flexGrow: 1, paddingHorizontal: 24 },
  // ---- out of the arrival ----
  arrived: { alignItems: 'center' },
  /** Bigger than the first wall's Loro: here he is the moment, not a guide. */
  arrivedHero: { marginTop: 0 },
  arrivedParrotTight: { height: 84, width: 58 },
  arrivedTitleTight: { fontSize: 22, lineHeight: 26 },
  learnedTileTight: { paddingVertical: 5 },
  arrivedParrot: { height: 112, width: 78 },
  arrivedBubble: { marginBottom: 20, paddingVertical: 12 },
  arrivedLabel: {
    color: MUTED,
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 1.4,
    marginTop: 14,
    textAlign: 'center',
  },
  learnedRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
    marginTop: 8,
  },
  learnedTile: {
    alignItems: 'center',
    backgroundColor: 'rgba(94,230,168,0.09)',
    borderRadius: 14,
    minWidth: 84,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  learnedWord: { color: TEXT, fontSize: 16, fontWeight: '800' },
  learnedTrack: {
    alignSelf: 'stretch',
    backgroundColor: 'rgba(242,245,243,0.1)',
    borderRadius: 2,
    height: 3,
    marginTop: 6,
    overflow: 'hidden',
  },
  learnedFill: { backgroundColor: ACCENT, borderRadius: 2, height: 3 },
  bubbleReview: { color: TEXT, fontSize: 13, fontStyle: 'italic', lineHeight: 18, marginTop: 4 },
  learnedMeaning: { color: 'rgba(94,230,168,0.8)', fontSize: 11.5, fontWeight: '600', marginTop: 1 },
  arrivedTitle: { fontSize: 24, lineHeight: 29, marginTop: 2 },
  arrivedLine: { color: MUTED, fontSize: 14, lineHeight: 19, marginTop: 4, textAlign: 'center' },
  plans: { gap: 8, marginBottom: 12 },
  plan: {
    alignItems: 'center',
    backgroundColor: 'rgba(20,26,23,0.92)',
    borderColor: 'rgba(242,245,243,0.12)',
    borderRadius: 16,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  planOn: { backgroundColor: 'rgba(94,230,168,0.08)', borderColor: ACCENT },
  planDot: {
    alignItems: 'center',
    borderColor: 'rgba(242,245,243,0.35)',
    borderRadius: 11,
    borderWidth: 2,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  planDotOn: { borderColor: ACCENT },
  planDotInner: { backgroundColor: ACCENT, borderRadius: 5, height: 10, width: 10 },
  planText: { flex: 1 },
  planHead: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  planName: { color: TEXT, fontSize: 16, fontWeight: '800' },
  planSave: { backgroundColor: 'rgba(255,196,107,0.18)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  planSaveText: { color: '#ffc46b', fontSize: 11, fontWeight: '800' },
  planPrice: { color: MUTED, fontSize: 12.5, fontWeight: '600', marginTop: 2 },
  planTrial: { color: MUTED, fontSize: 13, fontWeight: '800' },
  planTrialOn: { color: ACCENT },
  ctaCalm: { color: ACCENT, fontSize: 13, fontWeight: '700', marginTop: 8, textAlign: 'center' },
  // ---- the plan as chips ----
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 12 },
  chip: {
    backgroundColor: 'rgba(242,245,243,0.08)',
    borderColor: 'rgba(242,245,243,0.12)',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipText: { color: TEXT, fontSize: 13, fontWeight: '700' },
  chipAccent: { backgroundColor: 'rgba(94,230,168,0.16)', borderColor: 'rgba(94,230,168,0.4)' },
  chipAccentText: { color: ACCENT, fontSize: 13, fontWeight: '800' },
  // ---- the demo and the benefits ----
  benefits: { gap: 10, marginTop: 18 },
  benefitsBig: { gap: 16, marginTop: 26 },
  benefitTextBig: { fontSize: 16.5, lineHeight: 22 },
  pageFill: { flexGrow: 1, justifyContent: 'center' },
  stats: { flexDirection: 'row', gap: 12, marginTop: 34 },
  stat: {
    alignItems: 'center',
    backgroundColor: 'rgba(20,26,23,0.92)',
    borderColor: 'rgba(94,230,168,0.18)',
    borderRadius: 22,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 24,
  },
  statNum: { color: ACCENT, fontSize: 36, fontWeight: '900', letterSpacing: -1 },
  statLabel: { color: TEXT, fontSize: 14, fontWeight: '700', marginTop: 4 },
  benefit: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  benefitText: { color: TEXT, flex: 1, fontSize: 14, fontWeight: '600', lineHeight: 19 },
  // ---- the review ----
  /** A touch of gold (Radek, 2026-10-27): the review is the one piece of
      social proof on the wall, so it gets the App Store's star colour. */
  review: {
    backgroundColor: 'rgba(255,196,77,0.07)',
    borderColor: 'rgba(255,196,77,0.45)',
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  reviewTop: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  reviewStars: { color: '#ffc44d', fontSize: 18, letterSpacing: 2 },
  reviewBadge: { color: '#ffc44d', fontSize: 10.5, fontWeight: '900', letterSpacing: 1.4 },
  reviewText: { color: TEXT, fontSize: 14, fontStyle: 'italic', lineHeight: 20, marginTop: 6 },
  reviewBy: { color: 'rgba(255,196,77,0.85)', fontSize: 12, fontWeight: '700', marginTop: 8 },
  reviewSource: { fontWeight: '600' },
  // ---- Loro and the bubble ----
  hero: { alignItems: 'flex-end', flexDirection: 'row', gap: 10, marginTop: 18 },
  heroParrot: { height: 96, width: 64 },
  heroBig: { alignItems: 'center', flexDirection: 'column-reverse', gap: 4, marginTop: 56 },
  bubbleBig: { alignSelf: 'stretch', borderBottomLeftRadius: 18, flex: 0, marginBottom: 0, paddingHorizontal: 20, paddingVertical: 18 },
  reviewBig: { marginTop: 18, paddingHorizontal: 18, paddingVertical: 18 },
  reviewTextBig: { fontSize: 16.5, lineHeight: 23 },
  heroParrotBig: { height: 190, width: 128 },
  dots: { alignSelf: 'center', flexDirection: 'row', gap: 6, marginBottom: 14 },
  dot: { backgroundColor: 'rgba(242,245,243,0.18)', borderRadius: 3, height: 6, width: 6 },
  dotOn: { backgroundColor: ACCENT, width: 22 },
  dotDone: { backgroundColor: 'rgba(94,230,168,0.5)' },
  bubble: {
    backgroundColor: 'rgba(20,26,23,0.95)',
    borderColor: 'rgba(242,245,243,0.1)',
    borderRadius: 18,
    borderBottomLeftRadius: 6,
    borderWidth: 1,
    flex: 1,
    marginBottom: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  /** The wedge on the bubble's lower-left corner, toward the parrot. */
  bubbleTail: {
    backgroundColor: 'rgba(20,26,23,0.95)',
    borderColor: 'rgba(242,245,243,0.1)',
    borderLeftWidth: 1,
    borderBottomWidth: 1,
    bottom: -7,
    height: 12,
    left: 10,
    position: 'absolute',
    transform: [{ rotate: '45deg' }],
    width: 12,
  },
  title: {
    color: TEXT,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
    lineHeight: 31,
    marginTop: 12,
    textAlign: 'center',
  },
  // ---- the mechanic strip ----
  mechanic: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(20,26,23,0.92)',
    borderColor: 'rgba(242,245,243,0.08)',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'center',
    marginTop: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  mechanicArrow: { color: MUTED, fontSize: 16, fontWeight: '800' },
  savedTag: {
    backgroundColor: 'rgba(94,230,168,0.14)',
    borderColor: 'rgba(94,230,168,0.35)',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  savedTagText: { color: ACCENT, fontSize: 12, fontWeight: '800' },
  stateBox: { alignItems: 'center', gap: 12, marginTop: 40 },
  stateText: { color: MUTED, fontSize: 14, textAlign: 'center' },
  /** The other plan as a second, quiet button under the mint one: same
      shape, grey, so it reads as a real choice rather than a footnote. */
  switchPlan: {
    alignItems: 'center',
    backgroundColor: CARD,
    borderColor: 'rgba(242,245,243,0.12)',
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: 10,
    minHeight: 48,
    paddingHorizontal: 14,
  },
  switchPlanText: {
    color: 'rgba(242,245,243,0.8)',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  footerLinks: { alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 4 },
  footer: {
    alignItems: 'stretch',
    gap: 10,
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  cta: {
    alignItems: 'center',
    backgroundColor: ACCENT,
    borderRadius: 16,
    justifyContent: 'center',
    minHeight: 54,
  },
  ctaDim: { opacity: 0.7 },
  ctaText: { color: ON_ACCENT, fontSize: 17, fontWeight: '800' },
  ctaLead: {
    color: TEXT,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 10,
    textAlign: 'center',
  },
  ctaTerms: {
    color: 'rgba(242,245,243,0.75)',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 8,
    textAlign: 'center',
  },

  // ---- account sheet ----
  accountSheet: { backgroundColor: GROUND, flex: 1 },
  accountScroll: { gap: 12, padding: 24 },
  accountHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  accountTitle: { color: TEXT, fontSize: 20, fontWeight: '800' },
  accountClose: { color: MUTED, fontSize: 17, padding: 4 },
  accountClosePressed: { opacity: 0.6 },
  accountBody: { color: MUTED, fontSize: 13, lineHeight: 19, marginBottom: 6 },
});
