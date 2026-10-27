import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { PurchasesPackage } from 'react-native-purchases';
import { BRAND } from '../onboarding/brand';
import { ACCENT, CARD, MUTED, ON_ACCENT, TEXT, TextButton } from '../onboarding/chrome';

/**
 * THE SECOND OFFER (Radek, 2026-10-27, after Toneadapt: "when I closed the
 * paywall they gave me another discount, I want that too").
 *
 * Raised two ways, both at the moment someone is leaving: the ✕ on the
 * price page, and Apple's sheet closed without buying (84% of everyone who
 * tapped the button, 2026-09-20..10-27). Its "No thanks" returns to the
 * wall: the app is a hard paywall, so there is nowhere else to return to.
 *
 * THE OFFER IS A REAL, SEPARATE PRODUCT, configured remotely. The package
 * comes from the RevenueCat offering named EXIT_OFFERING_ID (its annual
 * package, else its first). No such offering, no ✕ and no sheet: a binary
 * that ships before the product exists behaves exactly like today's wall.
 * Apple's promotional offers are for existing or lapsed subscribers, so a
 * new user's discount is its own product in the same subscription group.
 *
 * NOTHING HERE IS HARDCODED MONEY, as on the wall. Two shapes are read off
 * the product itself:
 *   - a cheaper annual product (optionally with a free trial): the price is
 *     struck against the regular annual plan's;
 *   - an annual product whose intro offer is a PAID first year: the intro
 *     price is struck against the product's own renewal price, and the
 *     terms say what it renews at.
 * The percentage is computed, and dropped when the currencies differ or it
 * would round to nothing. No countdown, no "only today": nothing expires.
 */

export const EXIT_OFFERING_ID = 'exit';

type Pricing = {
  /** What they pay now (or after the trial). */
  now: string;
  /** The struck-through price, when there is an honest one. */
  was: string | null;
  pct: number | null;
  trialDays: number | null;
  /** The one terms line Apple's 3.1.2 asks for. */
  terms: string;
  perMonth: string | null;
};

function days(iso: string | null | undefined, units: number | null | undefined): number | null {
  const m = /^P(\d+)([DWMY])$/.exec(iso ?? '');
  if (!m) return null;
  const n = Number(m[1]) * (units ?? 1);
  return { D: n, W: n * 7, M: n * 30, Y: n * 365 }[m[2] as 'D' | 'W' | 'M' | 'Y'];
}

function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

export function exitPricing(offer: PurchasesPackage, regular: PurchasesPackage | null): Pricing {
  const p = offer.product;
  const intro = p.introPrice;
  const paidIntro = intro && intro.price > 0 ? intro : null;
  const trialDays = intro && intro.price === 0 ? days(intro.period, intro.periodNumberOfUnits) : null;
  const nowValue = paidIntro ? paidIntro.price : p.price;
  const now = paidIntro ? paidIntro.priceString : p.priceString;
  let was: string | null = null;
  let wasValue: number | null = null;
  if (paidIntro) {
    was = p.priceString;
    wasValue = p.price;
  } else if (regular && regular.product.currencyCode === p.currencyCode && regular.product.price > p.price) {
    was = regular.product.priceString;
    wasValue = regular.product.price;
  }
  const pct = wasValue && wasValue > 0 ? Math.round((1 - nowValue / wasValue) * 100) : null;
  const terms = paidIntro
    ? `${now} for the first year, then ${p.priceString} a year, renews until you cancel in Settings`
    : `${trialDays ? `${trialDays} days free, then ` : ''}${p.priceString} a year, renews until you cancel in Settings`;
  return {
    now,
    was: pct && pct >= 5 ? was : null,
    pct: pct && pct >= 5 ? pct : null,
    trialDays,
    terms,
    perMonth: money(nowValue / 12, p.currencyCode),
  };
}

export function ExitOffer({
  offer,
  regular,
  busy,
  preview,
  onClaim,
  onClose,
}: {
  offer: PurchasesPackage;
  /** The wall's own annual plan, for the struck-through price. */
  regular: PurchasesPackage | null;
  busy: boolean;
  /** Dev only: the offering does not exist yet and `offer` is a stand-in. */
  preview?: boolean;
  onClaim: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const price = exitPricing(offer, regular);
  const title = price.pct ? `${price.pct}% off Loro for a whole year` : 'A better price for your year';
  const cta = price.trialDays
    ? price.pct
      ? `Start free with ${price.pct}% off`
      : 'Start free'
    : price.pct
      ? `Get ${price.pct}% off`
      : 'Get this price';
  return (
    <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(200)} style={styles.scrim}>
      <Animated.View
        entering={SlideInDown.duration(380)}
        exiting={SlideOutDown.duration(240)}
        style={[styles.sheet, { paddingBottom: insets.bottom + 14 }]}
      >
        <Image source={BRAND.parrotWaving} style={styles.parrot} resizeMode="contain" />
        {preview && (
          <Text style={styles.preview}>
            DEV PREVIEW · create the “{EXIT_OFFERING_ID}” offering in RevenueCat to make this real
          </Text>
        )}
        <Text style={styles.kicker}>WAIT, BEFORE YOU GO</Text>
        <Text style={styles.title}>{title}</Text>

        <View style={styles.priceCard}>
          {price.pct && <View style={styles.pctTag}><Text style={styles.pctText}>−{price.pct}%</Text></View>}
          {price.was && <Text style={styles.was}>{price.was}</Text>}
          <Text style={styles.now}>
            {price.now}
            <Text style={styles.per}> / year</Text>
          </Text>
          {price.perMonth && <Text style={styles.perMonth}>That’s {price.perMonth} a month</Text>}
          {price.trialDays && <Text style={styles.trial}>{price.trialDays} days free first, cancel anytime</Text>}
        </View>

        <Pressable
          onPress={onClaim}
          disabled={busy}
          accessibilityRole="button"
          style={({ pressed }) => [styles.cta, (pressed || busy) && { opacity: 0.75 }]}
        >
          {busy ? <ActivityIndicator color={ON_ACCENT} /> : <Text style={styles.ctaText}>{cta}</Text>}
        </Pressable>
        <Text style={styles.terms}>{price.terms}</Text>
        <TextButton label="No thanks" onPress={onClose} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    backgroundColor: 'rgba(4,7,5,0.78)',
    bottom: 0,
    justifyContent: 'flex-end',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  sheet: {
    alignItems: 'center',
    backgroundColor: '#101612',
    borderColor: 'rgba(94,230,168,0.22)',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    borderWidth: 1,
    paddingHorizontal: 24,
    paddingTop: 54,
  },
  parrot: { height: 96, position: 'absolute', top: -60, width: 86 },
  preview: { color: '#ffc46b', fontSize: 11, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  kicker: { color: ACCENT, fontSize: 12, fontWeight: '900', letterSpacing: 1.6 },
  title: {
    color: TEXT,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    lineHeight: 34,
    marginTop: 8,
    textAlign: 'center',
  },
  priceCard: {
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: CARD,
    borderColor: 'rgba(94,230,168,0.35)',
    borderRadius: 22,
    borderWidth: 1.5,
    marginTop: 20,
    paddingVertical: 20,
  },
  pctTag: {
    backgroundColor: ACCENT,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
    position: 'absolute',
    right: 14,
    top: -13,
  },
  pctText: { color: ON_ACCENT, fontSize: 14, fontWeight: '900' },
  was: { color: MUTED, fontSize: 17, fontWeight: '700', textDecorationLine: 'line-through' },
  now: { color: TEXT, fontSize: 40, fontWeight: '900', letterSpacing: -1, marginTop: 2 },
  per: { color: MUTED, fontSize: 18, fontWeight: '700', letterSpacing: 0 },
  perMonth: { color: ACCENT, fontSize: 15, fontWeight: '700', marginTop: 4 },
  trial: { color: TEXT, fontSize: 14, fontWeight: '600', marginTop: 10 },
  cta: {
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: ACCENT,
    borderRadius: 16,
    marginTop: 20,
    paddingVertical: 17,
  },
  ctaText: { color: ON_ACCENT, fontSize: 17, fontWeight: '900' },
  terms: { color: MUTED, fontSize: 12, lineHeight: 17, marginTop: 10, textAlign: 'center' },
});
