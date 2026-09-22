import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { getPlan, type Plan } from '../progress/plan';
import { getPackageTypes, getPurchasesApi } from '../platform/purchases';
import { track } from '../platform/analytics';
import {
  ACCENT,
  CARD,
  GROUND,
  MUTED,
  ON_ACCENT,
  TEXT,
  TextButton,
} from '../onboarding/chrome';
import { noteTrialStarted } from '../platform/notifications';
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
function wordCount(): number {
  const keys = new Set<string>();
  for (const video of [...getCatalog(), ...collectionVideos]) {
    for (const key of Object.keys(video.dictionary ?? {})) keys.add(key.toLowerCase());
  }
  return Math.floor(keys.size / 100) * 100;
}

export function PaywallScreen() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const words = useMemo(() => wordCount(), []);
  const [offer, setOffer] = useState<Offer>({ status: 'loading' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'purchase' | 'restore' | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);

  /**
   * THE WALL WAS SEEN. The denominator of every conversion number on the
   * dashboard, and the reason it is an effect with empty deps rather than
   * something the gate fires: App.tsx decides WHETHER to render this screen,
   * but only the screen itself knows it actually mounted, and a verdict that
   * flips to entitled mid-resolve must not be counted as a wall anybody
   * looked at.
   */
  useEffect(() => {
    track('paywall_shown');
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

  const purchase = useCallback(async () => {
    if (!selected || busy) return;
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
      });
      // The timeline's "day 5: we remind you" — made true (notifications.ts).
      const days = trialDays(selected.product);
      if (days !== null) noteTrialStarted(days);
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
        });
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
  }, [selected, busy]);

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
          { paddingTop: insets.top + 16, paddingBottom: 12 },
        ]}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {/* THE SALE, in this order: their plan (the answers they just gave,
            as chips — level, pace), the product doing the thing (a clip with
            a word lit and Loro saying the line, the tap→saved beat on a
            loop), three lines of what that buys, and a free week that is
            safe to start. Nothing here promises an outcome. */}
        <Text style={styles.title}>Your plan is ready</Text>
        <View style={styles.chips}>
          <View style={[styles.chip, styles.chipAccent]}>
            <Text style={styles.chipAccentText}>{storage.getStartLevel() ?? 'A1'}</Text>
          </View>
          <View style={styles.chip}>
            <Text style={styles.chipText}>{planLine(getPlan())}</Text>
          </View>
        </View>
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
        <View style={styles.hero}>
          <Image
            source={BRAND.parrot}
            style={styles.heroParrot}
            resizeMode="contain"
            accessibilityRole="image"
            accessibilityLabel="Loro the parrot"
          />
          <View style={styles.bubble}>
            <View style={styles.bubbleTail} />
            <TypingMock
              before={['We', 'want', 'you', 'to', 'try', 'Loro', 'for']}
              answer="free"
              after={[]}
              gloss=""
              isCurrent
              bar={false}
              frame={false}
              size={18}
            />
          </View>
        </View>

        {/* WHAT THAT BUYS — three lines, each a shipped fact. */}
        <View style={styles.benefits}>
          <View style={styles.benefit}>
            <IconTile glyph="▶︎" tint="sky" size={34} />
            <Text style={styles.benefitText}>Real clips at your level, from real people</Text>
          </View>
          <View style={styles.benefit}>
            <IconTile glyph="✓" tint="mint" size={34} />
            <Text style={styles.benefitText}>Every word you tap comes back before you forget it</Text>
          </View>
          <View style={styles.benefit}>
            <IconTile glyph="★︎" tint="amber" size={34} />
            <Text style={styles.benefitText}>{words.toLocaleString('en-US')}+ Spanish words, every one tappable</Text>
          </View>
        </View>

        {/* WHAT SOMEONE SAID — see REVIEW. */}
        <View style={styles.review} accessibilityLabel={`${REVIEW.stars} star ${REVIEW.source} by ${REVIEW.author}: ${REVIEW.text}`}>
          <Text style={styles.reviewStars}>{'★'.repeat(REVIEW.stars)}</Text>
          <Text style={styles.reviewText}>“{REVIEW.text}”</Text>
          <Text style={styles.reviewBy}>
            {REVIEW.author} <Text style={styles.reviewSource}>· {REVIEW.source}</Text>
          </Text>
        </View>

      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 10 }]}>
        {/* The owner's line, right above the button it belongs to. */}
        {selected && (
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
                  ? 'Start Loro for free'
                  : `Subscribe · ${selected.product.priceString} ${billedWord(selectedPeriod)}`}
              </Text>
            )}
          </Pressable>
        )}
        {/* The terms in READABLE size, right under the button. The sheet then
            confirms what was already read. */}
        {selected && (
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
        {other && (
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
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: GROUND, flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: 24 },
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
  benefit: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  benefitText: { color: TEXT, flex: 1, fontSize: 14, fontWeight: '600', lineHeight: 19 },
  // ---- the review ----
  review: {
    backgroundColor: 'rgba(20,26,23,0.92)',
    borderColor: 'rgba(242,245,243,0.08)',
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  reviewStars: { color: '#ffc46b', fontSize: 14, letterSpacing: 1.5 },
  reviewText: { color: TEXT, fontSize: 14, fontStyle: 'italic', lineHeight: 20, marginTop: 6 },
  reviewBy: { color: MUTED, fontSize: 12, fontWeight: '700', marginTop: 8 },
  reviewSource: { fontWeight: '600' },
  // ---- Loro and the bubble ----
  hero: { alignItems: 'flex-end', flexDirection: 'row', gap: 10, marginTop: 18 },
  heroParrot: { height: 96, width: 64 },
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
