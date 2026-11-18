import { useCallback, useEffect, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeInDown, FadeOut, runOnJS, useAnimatedReaction } from 'react-native-reanimated';
import { BRAND } from '../onboarding/brand';
import { usePlayerApi, usePlayerClock } from '../player/PlayerHost';
import { track } from '../platform/analytics';
import {
  canAskForPermission,
  formatTime,
  getPrefs,
  notePermissionAskedThisSession,
  requestPermission,
  setReminderTime,
  trialReminderPending,
} from '../platform/notifications';
import { getPlan } from '../progress/plan';
import { subscribeToReminderAsk, takeReminderAskDue } from './reminderAskBus';

/**
 * "YOU SAID EVERY DAY. WANT A NUDGE?" — the reminder ask, right after a
 * purchase (reminderAskBus.ts has the why and the when).
 *
 * It reads their onboarding pace back to them, lets them pick WHEN (a time
 * they chose is a plan; a time we chose is a nag), and says the trial
 * reminder out loud, because that promise on the paywall is only kept for
 * people who allow notifications.
 *
 * Allow → the reminder time is saved first, then iOS's one prompt. "Not
 * now" records NO snooze: the feed's explainer keeps its chance on a later
 * launch. Either way the feed's explainer stays quiet for this session.
 *
 * Same contract as the feed's other cards (WidgetOffer): its own Modal above
 * the top strip, the player paused and yielded while it is up. The feed has
 * only just mounted when this rises, so the first clip can start loading
 * UNDER it; the clock reaction below pauses anything that starts while open.
 */
const TIMES = [
  { label: 'Morning', hour: 8, minute: 0 },
  { label: 'Lunch', hour: 12, minute: 30 },
  { label: 'Evening', hour: 19, minute: 0 },
] as const;

const IN = Easing.out(Easing.cubic);

/** "You said every day." — the onboarding answer, in their words. */
function paceLine(): string | null {
  const plan = getPlan();
  return plan.paceLabel ? `You said ${plan.paceLabel}.` : null;
}

export function ReminderAsk({ onObscurePlayer }: { onObscurePlayer: (obscured: boolean) => void }) {
  const api = usePlayerApi();
  const { isPlaying } = usePlayerClock();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<number>(TIMES.length - 1); // Evening; show() re-reads the saved time
  const [copy, setCopy] = useState<{ pace: string | null; trial: boolean }>({ pace: null, trial: false });

  const show = useCallback(async (preview: boolean) => {
    if (!preview && !(await canAskForPermission())) return;
    notePermissionAskedThisSession();
    const prefs = getPrefs();
    const saved = TIMES.findIndex((t) => t.hour === prefs.hour && t.minute === prefs.minute);
    setPick(saved >= 0 ? saved : TIMES.length - 1);
    setCopy({ pace: paceLine(), trial: trialReminderPending() });
    track('reminder_ask_shown', { from: 'purchase', pace: getPlan().pace });
    setOpen(true);
  }, []);

  useEffect(() => {
    if (takeReminderAskDue()) void show(false);
    return subscribeToReminderAsk((preview) => {
      if (preview) void show(true);
      else if (takeReminderAskDue()) void show(false);
    });
  }, [show]);

  useEffect(() => {
    onObscurePlayer(open);
    if (open) api.pause();
    return () => onObscurePlayer(false);
  }, [open, onObscurePlayer, api]);

  // The first clip boots while the card is up: hold it until they answer.
  const hold = useCallback(() => api.pause(), [api]);
  useAnimatedReaction(
    () => isPlaying.value,
    (playing) => {
      if (playing && open) runOnJS(hold)();
    },
    [open, hold]
  );

  if (!open) return null;

  const close = () => {
    setOpen(false);
    setBusy(false);
    api.play();
  };

  const allow = () => {
    if (busy) return;
    setBusy(true);
    const time = TIMES[pick];
    // The time first: reconcile() inside requestPermission then schedules
    // the reminder at THEIR time from the very first run.
    setReminderTime(time.hour, time.minute);
    track('reminder_ask_answered', { from: 'purchase', answer: 'allow', hour: time.hour });
    void requestPermission('purchase').then(close, close);
  };

  const later = () => {
    if (busy) return;
    track('reminder_ask_answered', { from: 'purchase', answer: 'later' });
    close();
  };

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={later}>
      <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(180)} style={styles.backdrop}>
        <Animated.View entering={FadeInDown.duration(420).easing(IN)} style={styles.card}>
          <Image
            source={BRAND.parrot}
            style={styles.art}
            resizeMode="contain"
            accessibilityRole="image"
            accessibilityLabel="Loro the parrot"
          />
          {copy.pace && (
            <Animated.Text entering={FadeIn.delay(120).duration(360)} style={styles.eyebrow}>
              {copy.pace}
            </Animated.Text>
          )}
          <Animated.Text entering={FadeIn.delay(160).duration(360)} style={styles.title}>
            Want Loro to nudge you?
          </Animated.Text>
          <Animated.Text entering={FadeIn.delay(220).duration(360)} style={styles.body}>
            One short reminder a day when your words are ready
            {copy.trial ? ', and one 2 days before your trial ends.' : '.'}
          </Animated.Text>

          <Animated.View entering={FadeIn.delay(380).duration(320)} style={styles.times}>
            {TIMES.map((t, n) => {
              const on = n === pick;
              return (
                <Pressable
                  key={t.label}
                  disabled={busy}
                  onPress={() => setPick(n)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${t.label}, ${formatTime(t.hour, t.minute)}`}
                  style={({ pressed }) => [styles.time, on && styles.timeOn, pressed && styles.pressed]}
                >
                  <Text style={[styles.timeLabel, on && styles.timeLabelOn]}>{t.label}</Text>
                  <Text style={[styles.timeClock, on && styles.timeClockOn]}>{formatTime(t.hour, t.minute)}</Text>
                </Pressable>
              );
            })}
          </Animated.View>

          <Pressable
            disabled={busy}
            onPress={allow}
            accessibilityRole="button"
            accessibilityLabel="Yes, remind me"
            style={({ pressed }) => [styles.cta, (pressed || busy) && styles.pressed]}
          >
            <Text style={styles.ctaText}>Yes, remind me</Text>
          </Pressable>
          <Pressable
            disabled={busy}
            onPress={later}
            accessibilityRole="button"
            hitSlop={8}
            style={({ pressed }) => [styles.later, pressed && styles.pressed]}
          >
            <Text style={styles.laterText}>Not now</Text>
          </Pressable>
          <Text style={styles.foot}>You can change the time in Progress.</Text>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const MINT = '#5ee6a8';
const INK = '#f2f5f3';

const styles = StyleSheet.create({
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(8,11,9,0.9)',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    padding: 22,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  card: {
    alignItems: 'center',
    backgroundColor: '#121815',
    borderColor: 'rgba(242,245,243,0.08)',
    borderRadius: 28,
    borderWidth: 1,
    paddingBottom: 14,
    paddingHorizontal: 22,
    paddingTop: 24,
    width: '100%',
  },
  art: { height: 96, marginBottom: 12, width: 64 },
  eyebrow: { color: MINT, fontSize: 14, fontWeight: '800', textAlign: 'center' },
  title: { color: INK, fontSize: 22, fontWeight: '900', letterSpacing: -0.4, marginTop: 4, textAlign: 'center' },
  body: { color: 'rgba(242,245,243,0.65)', fontSize: 15, lineHeight: 21, marginTop: 8, textAlign: 'center' },

  times: { alignSelf: 'stretch', flexDirection: 'row', gap: 8, marginTop: 20 },
  time: {
    alignItems: 'center',
    backgroundColor: 'rgba(242,245,243,0.05)',
    borderColor: 'rgba(242,245,243,0.1)',
    borderRadius: 14,
    borderWidth: 1.5,
    flex: 1,
    paddingVertical: 10,
  },
  timeOn: { backgroundColor: 'rgba(94,230,168,0.12)', borderColor: MINT },
  timeLabel: { color: 'rgba(242,245,243,0.6)', fontSize: 13, fontWeight: '700' },
  timeLabelOn: { color: INK },
  timeClock: { color: 'rgba(242,245,243,0.45)', fontSize: 12, fontWeight: '600', marginTop: 2 },
  timeClockOn: { color: MINT },

  cta: { alignItems: 'center', alignSelf: 'stretch', backgroundColor: MINT, borderRadius: 16, marginTop: 20, paddingVertical: 14 },
  ctaText: { color: '#06130d', fontSize: 16, fontWeight: '800' },
  later: { alignItems: 'center', paddingVertical: 12 },
  laterText: { color: 'rgba(242,245,243,0.5)', fontSize: 14, fontWeight: '600' },
  foot: { color: 'rgba(242,245,243,0.32)', fontSize: 12, marginTop: 2 },
  pressed: { opacity: 0.7 },
});
