import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Purchases, {
  PACKAGE_TYPE,
  type PurchasesPackage,
  type PurchasesStoreProduct,
} from 'react-native-purchases';
import { BRAND } from '../onboarding/brand';
import {
  ACCENT,
  CARD,
  GROUND,
  MUTED,
  ON_ACCENT,
  TEXT,
  TextButton,
} from '../onboarding/chrome';
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
  switch (pkg.packageType) {
    case PACKAGE_TYPE.ANNUAL:
      return 'Annual';
    case PACKAGE_TYPE.SIX_MONTH:
      return '6 months';
    case PACKAGE_TYPE.THREE_MONTH:
      return '3 months';
    case PACKAGE_TYPE.TWO_MONTH:
      return '2 months';
    case PACKAGE_TYPE.MONTHLY:
      return 'Monthly';
    case PACKAGE_TYPE.WEEKLY:
      return 'Weekly';
    case PACKAGE_TYPE.LIFETIME:
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

/** "7-day" / "1-week" / "1-month" — the trial's exact store-configured length. */
function trialLength(product: PurchasesStoreProduct): string | null {
  const intro = product.introPrice;
  if (!intro || intro.price !== 0) return null;
  const unit = intro.periodUnit.toLowerCase();
  return `${intro.periodNumberOfUnits}-${unit}`;
}

export function PaywallScreen() {
  const insets = useSafeAreaInsets();
  const [offer, setOffer] = useState<Offer>({ status: 'loading' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'purchase' | 'restore' | null>(null);

  const loadOfferings = useCallback(() => {
    setOffer({ status: 'loading' });
    void Purchases.getOfferings()
      .then((offerings) => {
        const packages = offerings.current?.availablePackages ?? [];
        if (packages.length === 0) {
          console.warn('[loro] current offering is empty');
          setOffer({ status: 'error' });
          return;
        }
        setOffer({ status: 'ready', packages });
        // Default to the annual plan when there is one — it is the one whose
        // disclosure (per-month price) benefits most from being read.
        const annual = packages.find(
          (p) => p.packageType === PACKAGE_TYPE.ANNUAL
        );
        setSelectedId((annual ?? packages[0]).identifier);
      })
      .catch((err) => {
        console.warn('[loro] offerings fetch failed', err);
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
    try {
      // Success needs no handling here: the CustomerInfo listener in
      // purchases.ts flips the gate and App.tsx unmounts this screen.
      await Purchases.purchasePackage(selected);
    } catch (err) {
      // A cancelled sheet is the user changing their mind, not an event.
      if ((err as { userCancelled?: boolean | null }).userCancelled) return;
      console.warn('[loro] purchase failed', err);
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
      const info = await Purchases.restorePurchases();
      // If a subscription came back, the gate has already opened via the
      // listener; this alert is only for the other outcome.
      if (Object.keys(info.entitlements.active).length === 0) {
        Alert.alert(
          'Nothing to restore',
          'No previous subscription was found for this Apple ID.'
        );
      }
    } catch (err) {
      console.warn('[loro] restore failed', err);
      Alert.alert(
        'Restore not completed',
        'Please check your connection and try again.'
      );
    } finally {
      setBusy(null);
    }
  }, [busy]);

  const trial = selected ? trialLength(selected.product) : null;
  const selectedPeriod = selected
    ? periodLabel(selected.product.subscriptionPeriod)
    : null;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 24, paddingBottom: 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Image
          source={BRAND.parrot}
          style={styles.parrot}
          resizeMode="contain"
        />
        <Text style={styles.title}>Unlock Loro</Text>
        <Text style={styles.subtitle}>
          Every video, every word you save, every review — one subscription.
        </Text>

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

        {offer.status === 'ready' && (
          <View style={styles.plans}>
            {offer.packages.map((pkg) => {
              const on = pkg.identifier === selected?.identifier;
              const period = periodLabel(pkg.product.subscriptionPeriod);
              const perMonth = perMonthLabel(pkg.product);
              return (
                <Pressable
                  key={pkg.identifier}
                  onPress={() => setSelectedId(pkg.identifier)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  style={[styles.plan, on && styles.planOn]}
                >
                  <View style={styles.planText}>
                    <Text style={[styles.planName, on && styles.planNameOn]}>
                      {planName(pkg)}
                    </Text>
                    {perMonth && (
                      <Text style={styles.planPerMonth}>
                        {perMonth} per month
                      </Text>
                    )}
                  </View>
                  <View style={styles.planPriceCol}>
                    <Text style={styles.planPrice}>
                      {pkg.product.priceString}
                    </Text>
                    {period && <Text style={styles.planPeriod}>{period}</Text>}
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}

        {selected && (
          <Text style={styles.disclosure}>
            {trial
              ? `Your ${trial} free trial converts to a paid subscription at ` +
                `${selected.product.priceString} ${selectedPeriod ?? ''} unless ` +
                'you cancel at least 24 hours before it ends. '
              : ''}
            The subscription is charged to your Apple ID and renews
            automatically until cancelled at least 24 hours before the end of
            the current period. Manage or cancel it in Settings →
            Subscriptions.
          </Text>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
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
                {trial ? `Start ${trial} free trial` : 'Subscribe'}
              </Text>
            )}
          </Pressable>
        )}
        <TextButton
          label={busy === 'restore' ? 'Restoring…' : 'Restore purchases'}
          onPress={() => void restore()}
        />
        <LegalLinks />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: GROUND, flex: 1 },
  scroll: { paddingHorizontal: 24 },
  parrot: { alignSelf: 'center', height: 96, width: 64 },
  title: {
    color: TEXT,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginTop: 16,
    textAlign: 'center',
  },
  subtitle: {
    color: MUTED,
    fontSize: 15,
    lineHeight: 21,
    marginTop: 8,
    textAlign: 'center',
  },
  stateBox: { alignItems: 'center', gap: 12, marginTop: 40 },
  stateText: { color: MUTED, fontSize: 14, textAlign: 'center' },
  plans: { gap: 10, marginTop: 28 },
  plan: {
    alignItems: 'center',
    backgroundColor: CARD,
    borderColor: 'transparent',
    borderRadius: 16,
    borderWidth: 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
  },
  planOn: {
    backgroundColor: 'rgba(94,230,168,0.12)',
    borderColor: 'rgba(94,230,168,0.4)',
  },
  planText: { flexShrink: 1, gap: 2 },
  planName: { color: TEXT, fontSize: 16, fontWeight: '700' },
  planNameOn: { color: ACCENT },
  planPerMonth: { color: MUTED, fontSize: 13 },
  planPriceCol: { alignItems: 'flex-end', gap: 2 },
  planPrice: { color: TEXT, fontSize: 16, fontWeight: '700' },
  planPeriod: { color: MUTED, fontSize: 12 },
  disclosure: {
    color: 'rgba(242,245,243,0.5)',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 20,
  },
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
});
