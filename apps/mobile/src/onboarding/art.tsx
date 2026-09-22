import { useEffect, type ReactNode } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { BRAND } from './brand';
import { ACCENT, CARD, MUTED, ON_ACCENT, TEXT } from './chrome';

/**
 * THE ART OF THE ONBOARDING — everything that is not text or a button.
 *
 * Radek, 2026-09-22: "now it's a black page with white text, super basic,
 * boring … the onboarding slides need to be really really nice, it's the
 * first thing the user sees and decides if he wants to buy."
 *
 * DRAWN FROM VIEWS AND IMAGES ONLY. There is no gradient, SVG or Lottie
 * module in the dev client, and adding one means a native rebuild before
 * anything can be seen. So: colour comes from stacked translucent circles
 * (a glow), a fake video frame is stacked bands, an icon is a glyph on a
 * tinted tile, and motion is Reanimated on transforms and opacity. Every
 * moving thing keys off `isCurrent` or runs a slow loop, and collapses to
 * a still under Reduce Motion.
 *
 * NOTHING HERE MAKES A CLAIM. The mocks show what the product does with
 * made-up sentences (no real creator, no real clip), the ladder shows the
 * CEFR scale, and there are no numbers, ratings or names that would need
 * evidence — see the history in copy.ts before adding any.
 */

export const TINTS = {
  mint: ACCENT,
  sky: '#7cc4ff',
  amber: '#ffc46b',
  rose: '#ff8fa3',
  violet: '#b79bff',
} as const;
export type Tint = keyof typeof TINTS;

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
/** Pre-resolved for worklets, which cannot call rgba(). */
const ACCENT_DIM = rgba(ACCENT, 0.55);

// ------------------------------------------------------------------ glow

/**
 * A soft pool of colour: concentric circles, each a little smaller and a
 * little more opaque, which the eye reads as one blurred light. Absolute,
 * so it sits under whatever is drawn after it.
 */
export function Glow({
  tint,
  size,
  x,
  y,
  strength = 1,
}: {
  tint: Tint;
  size: number;
  x: number;
  y: number;
  /** 1 is the standard pool; lower for a hint, higher for a spotlight. */
  strength?: number;
}) {
  const rings = [1, 0.8, 0.62, 0.45, 0.3];
  return (
    <View pointerEvents="none" style={[styles.glow, { height: size, left: x, top: y, width: size }]}>
      {rings.map((r, i) => (
        <View
          key={i}
          style={{
            backgroundColor: rgba(TINTS[tint], 0.045 * strength),
            borderRadius: 999,
            height: size * r,
            left: (size * (1 - r)) / 2,
            position: 'absolute',
            top: (size * (1 - r)) / 2,
            width: size * r,
          }}
        />
      ))}
    </View>
  );
}

/**
 * THE BACKDROP behind every screen: a still, smooth wash — the brand green
 * at a whisper across the top third, fading to the ground — like a room
 * with one lamp on. The first cut was three coloured pools drifting with
 * parallax; Radek: "choose a different background than this sci-fi,
 * something smooth and simple but cool". No motion, one hue.
 *
 * A gradient from stacked bands: BANDS strips, each a shade more
 * transparent than the last, thin enough that the steps never show.
 */
const BANDS = 48;
/** The top of the wash: a deep forest green, opaque, that the ground
    shows through more and more on the way down. */
const WASH_TOP = { r: 16, g: 40, b: 31 };
const GROUND_RGB = { r: 10, g: 13, b: 11 };
export function Backdrop({ width, height }: { width: number; height: number }) {
  const reach = height * 0.78;
  const bandH = reach / BANDS;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {/* the wash: forest green at the top, the ground by three quarters down */}
      {Array.from({ length: BANDS }, (_, i) => {
        const t = i / (BANDS - 1);
        const k = 1 - (1 - t) * (1 - t); // eased: holds the colour, then lets go
        const r = Math.round(WASH_TOP.r + (GROUND_RGB.r - WASH_TOP.r) * k);
        const g = Math.round(WASH_TOP.g + (GROUND_RGB.g - WASH_TOP.g) * k);
        const b = Math.round(WASH_TOP.b + (GROUND_RGB.b - WASH_TOP.b) * k);
        return (
          <View
            key={i}
            style={{
              backgroundColor: `rgb(${r},${g},${b})`,
              height: bandH + 1,
              left: 0,
              position: 'absolute',
              top: i * bandH,
              width,
            }}
          />
        );
      })}
      {/* one soft light, high and a little left, where the titles sit */}
      <Glow tint="mint" size={width * 1.6} x={-width * 0.45} y={-width * 0.95} strength={1.6} />
    </View>
  );
}

// ------------------------------------------------------------ icon tile

/**
 * A tinted tile with a mark on it — the colour a choice card was missing.
 * The mark is a MONOCHROME glyph (a text-presentation symbol like ✈︎, in
 * the tint) or drawn children; never an emoji (Radek, 2026-09-22: "I
 * don't like emojis … something more smooth").
 */
export function IconTile({
  glyph,
  tint,
  on,
  size = 44,
  children,
}: {
  glyph?: string;
  tint: Tint;
  /** Selected: the tile fills with its tint and the mark goes dark. */
  on?: boolean;
  size?: number;
  children?: ReactNode;
}) {
  const colour = TINTS[tint];
  return (
    <View
      style={[
        styles.tile,
        {
          backgroundColor: on ? colour : rgba(colour, 0.16),
          borderRadius: size * 0.3,
          height: size,
          width: size,
        },
      ]}
    >
      {glyph ? (
        <Text style={[styles.tileGlyph, { color: on ? ON_ACCENT : colour, fontSize: size * 0.48 }]}>
          {glyph}
        </Text>
      ) : (
        children
      )}
    </View>
  );
}

/** Three bars, `level` of them lit — "how much Spanish": a little, some,
    a lot. Drawn, so it is the same weight as the type around it. */
export function BarsIcon({ level, tint, on }: { level: 1 | 2 | 3; tint: Tint; on?: boolean }) {
  const lit = on ? ON_ACCENT : TINTS[tint];
  const dim = on ? rgba(ON_ACCENT, 0.3) : rgba(TINTS[tint], 0.3);
  return (
    <View style={styles.bars}>
      {[1, 2, 3].map((i) => (
        <View
          key={i}
          style={{
            backgroundColor: i <= level ? lit : dim,
            borderRadius: 2,
            height: 6 + i * 5,
            width: 5,
          }}
        />
      ))}
    </View>
  );
}

/** A week of dots, `lit` of them on — "how often": a few days, every day;
    `strong` doubles the row for "as much as I can". */
export function WeekIcon({
  lit,
  strong,
  tint,
  on,
  size = 4,
}: {
  lit: number;
  strong?: boolean;
  tint: Tint;
  on?: boolean;
  /** Dot diameter — 4 inside a tile, larger when the dots stand alone. */
  size?: number;
}) {
  const colour = on ? ON_ACCENT : TINTS[tint];
  const dim = on ? rgba(ON_ACCENT, 0.3) : rgba(TINTS[tint], 0.28);
  const row = (key: string) => (
    <View key={key} style={[styles.week, { gap: Math.max(3, size * 0.6) }]}>
      {Array.from({ length: 7 }, (_, i) => (
        <View
          key={i}
          style={{ backgroundColor: i < lit ? colour : dim, borderRadius: 999, height: size, width: size }}
        />
      ))}
    </View>
  );
  return (
    <View style={[styles.weekStack, { gap: Math.max(4, size * 0.7) }]}>
      {strong ? [row('a'), row('b')] : row('a')}
    </View>
  );
}

/** Saved words as chips, and a practise button — the Words tab in one
    line, for the fourth "how it works" step. */
export function PractiseMock() {
  return (
    <View style={styles.practise}>
      {['esta', 'ciudad', 'vivo'].map((w) => (
        <View key={w} style={styles.practiseChip}>
          <Text style={styles.practiseChipText}>{w}</Text>
        </View>
      ))}
      <View style={styles.practiseGo}>
        <Text style={styles.practiseGoText}>Practise ▸</Text>
      </View>
    </View>
  );
}

// ------------------------------------------------------------ feed mock

/**
 * A PHONE-SHAPED PICTURE OF THE PRODUCT: a video frame (stacked bands, an
 * abstract scene), a karaoke line with one word lit, its translation, and
 * a save card. No real clip, no real person. `lit` is the word that glows;
 * `saved` swaps the lit word for the save card, which is the beat the
 * hook screen plays on a loop.
 */
export function FeedMock({
  words,
  litIndex,
  translation,
  gloss,
  isCurrent,
  loop = true,
  width = 232,
}: {
  words: string[];
  litIndex: number;
  translation: string;
  /** The lit word's meaning, for the save card. */
  gloss: string;
  isCurrent: boolean;
  /** Play the tap→save beat on repeat while on stage. */
  loop?: boolean;
  width?: number;
}) {
  const reduced = useReducedMotion();
  /** 0 = watching, 1 = the word lit, 2 = saved card up. */
  const beat = useSharedValue(1);
  useEffect(() => {
    if (!isCurrent || !loop || reduced) {
      beat.value = 1;
      return;
    }
    beat.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1400 }),
        withTiming(2, { duration: 320, easing: Easing.out(Easing.back(1.6)) }),
        withTiming(2, { duration: 1500 }),
        withTiming(1, { duration: 300, easing: Easing.in(Easing.quad) }),
        withTiming(1, { duration: 400 })
      ),
      -1,
      false
    );
  }, [isCurrent, loop, reduced, beat]);

  const cardStyle = useAnimatedStyle(() => {
    const t = Math.max(0, Math.min(1, beat.value - 1));
    return { opacity: t, transform: [{ translateY: (1 - t) * 10 }, { scale: 0.92 + t * 0.08 }] };
  });
  const pulse = useAnimatedStyle(() => {
    const t = Math.max(0, Math.min(1, beat.value - 1));
    return { opacity: 0.55 + (1 - t) * 0.45 };
  });

  const frameH = width * 1.25;
  const parrotH = frameH * 0.6;
  return (
    <View style={[styles.phone, { width, height: frameH + 96 }]}>
      {/* the video: a sky, a sun, a hill — and Loro in it, saying the line.
          (A drawn person stood here first; Radek: "a super weird person".) */}
      <View style={[styles.frame, { height: frameH }]}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <View
            key={i}
            style={{
              backgroundColor: i < 3 ? rgba(TINTS.sky, 0.18 - i * 0.05) : rgba(TINTS.amber, 0.06 + (i - 3) * 0.05),
              flex: 1,
            }}
          />
        ))}
        <View style={[styles.sun, { left: width * 0.14, top: frameH * 0.14 }]} />
        <View style={[styles.hill, { top: frameH * 0.62, width: width * 1.3, left: -width * 0.15 }]} />
        <Image
          source={BRAND.parrot}
          style={{
            height: parrotH,
            left: width * 0.5,
            position: 'absolute',
            top: frameH - parrotH + 6,
            width: parrotH * (282 / 420),
          }}
          resizeMode="contain"
          accessibilityRole="image"
          accessibilityLabel="Loro the parrot"
        />
        <View style={[styles.bubble, { left: width * 0.1, top: frameH * 0.34 }]}>
          <Text style={styles.bubbleText}>¡Hola!</Text>
          <View style={styles.bubbleTail} />
        </View>
        <View style={styles.creatorPill}>
          <View style={styles.creatorDot} />
          <View style={styles.creatorLine} />
        </View>
        <View style={styles.soundPill}>
          <Text style={styles.soundGlyph}>♪</Text>
        </View>
      </View>

      {/* the band: the line with one word lit, and its translation */}
      <View style={styles.band}>
        <View style={styles.line}>
          {words.map((w, i) => {
            const lit = i === litIndex;
            return lit ? (
              <Animated.Text key={i} style={[styles.word, styles.wordLit, pulse]}>
                {w}
              </Animated.Text>
            ) : (
              <Text key={i} style={styles.word}>
                {w}
              </Text>
            );
          })}
        </View>
        <Text style={styles.translation} numberOfLines={1}>
          {translation}
        </Text>
      </View>

      {/* the save card, rising over the band on the beat */}
      <Animated.View style={[styles.saveCard, cardStyle]} pointerEvents="none">
        <View style={styles.saveLoro}>
          <Image source={BRAND.parrot} style={styles.saveParrot} resizeMode="contain" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.saveWord}>{words[litIndex]}</Text>
          <Text style={styles.saveGloss}>{gloss}</Text>
        </View>
        <View style={styles.saveTag}>
          <Text style={styles.saveTagText}>✓ Saved</Text>
        </View>
      </Animated.View>
    </View>
  );
}

// ----------------------------------------------------------- mini mocks

/** A one-line karaoke strip: the sentence, one word lit. For the "how it
    works" rows and anywhere a tiny picture of the mechanic is wanted. */
export function LineMock({
  words,
  litIndex,
  tint = 'mint',
  blank,
}: {
  words: string[];
  litIndex?: number;
  tint?: Tint;
  /** Draw the lit word as a dashed gap instead of a word. */
  blank?: boolean;
}) {
  return (
    <View style={styles.miniLine}>
      {words.map((w, i) => {
        const hit = i === litIndex;
        if (hit && blank) {
          return (
            <View key={i} style={styles.miniBlank}>
              {[0, 1, 2, 3, 4].map((d) => (
                <View key={d} style={[styles.miniDash, { backgroundColor: TINTS[tint] }]} />
              ))}
            </View>
          );
        }
        return (
          <Text
            key={i}
            style={[
              styles.miniWord,
              hit && { backgroundColor: TINTS[tint], color: ON_ACCENT, overflow: 'hidden' },
            ]}
          >
            {w}
          </Text>
        );
      })}
    </View>
  );
}

/**
 * THE RETURN ARC: a word leaving today and coming back before it fades —
 * three dots along a rail, the last one lit. The "right before you forget"
 * picture, drawn instead of described.
 */
export function ReturnMock() {
  // Every stop lit — the middle one was grey and read as "off" (Radek).
  const stops = [
    { label: 'today', on: true },
    { label: '3 days', on: true },
    { label: '2 weeks', on: true },
  ];
  // One rail under three dots, the dots spread over it — drawn as layers,
  // so no label is ever clipped by a rail segment (the first cut cut "3
  // days" in half).
  return (
    <View style={styles.returnBox}>
      <View style={styles.returnRail} />
      <View style={styles.returnDots}>
        {stops.map((s) => (
          <View key={s.label} style={styles.returnStop}>
            <View style={[styles.returnDot, s.on && styles.returnDotOn]} />
            <Text style={[styles.returnLabel, s.on && styles.returnLabelOn]} numberOfLines={1}>
              {s.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// --------------------------------------------------------------- ladder

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;

/** The CEFR scale with one level lit — the result screen's context: not
    "A2" alone, but A2 on the road to C2. */
export function LevelLadder({ level }: { level: string }) {
  const at = Math.max(0, LEVELS.indexOf(level as (typeof LEVELS)[number]));
  return (
    <View style={styles.ladder} accessibilityLabel={`${level} on the scale from A1 to C2`}>
      {LEVELS.map((l, i) => {
        const done = i < at;
        const here = i === at;
        return (
          <View key={l} style={styles.rung}>
            <View
              style={[
                styles.rungBar,
                done && styles.rungBarDone,
                here && styles.rungBarHere,
                { height: 10 + i * 6 },
              ]}
            />
            <Text style={[styles.rungLabel, here && styles.rungLabelHere]}>{l}</Text>
          </View>
        );
      })}
    </View>
  );
}

// ----------------------------------------------------------- typing mock

/**
 * THE BLANK BEING FILLED: the gap, then letters arriving one by one, then
 * the word turning mint. Loops while on stage — the "video waits for you,
 * you type it, it carries on" sentence, shown.
 */
export function TypingMock({
  before,
  answer,
  after,
  gloss,
  isCurrent,
}: {
  before: string[];
  answer: string;
  after: string[];
  gloss: string;
  isCurrent: boolean;
}) {
  const reduced = useReducedMotion();
  /** 0..answer.length letters typed, then answer.length+1 = graded. */
  const typed = useSharedValue(0);
  useEffect(() => {
    if (!isCurrent || reduced) {
      typed.value = answer.length + 1;
      return;
    }
    const steps = Array.from({ length: answer.length }, (_, i) =>
      withTiming(i + 1, { duration: 170 })
    );
    typed.value = 0;
    typed.value = withRepeat(
      withSequence(
        withTiming(0, { duration: 900 }),
        ...steps,
        withTiming(answer.length + 1, { duration: 200 }),
        withTiming(answer.length + 1, { duration: 1700 }),
        withTiming(0, { duration: 250 })
      ),
      -1,
      false
    );
  }, [isCurrent, reduced, typed, answer.length]);

  const letters = answer.split('');
  return (
    <View style={styles.typing}>
      <View style={styles.typingLine}>
        {before.map((w, i) => (
          <Text key={`b${i}`} style={styles.typingWord}>
            {w}
          </Text>
        ))}
        <View style={styles.typingSlot}>
          <Text style={styles.typingGloss}>{gloss}</Text>
          <View style={styles.typingCells}>
            {letters.map((ch, i) => (
              <TypingCell key={i} index={i} letter={ch} typed={typed} total={letters.length} />
            ))}
          </View>
        </View>
        {after.map((w, i) => (
          <Text key={`a${i}`} style={styles.typingWord}>
            {w}
          </Text>
        ))}
      </View>
      <View style={styles.answerBar}>
        <AnswerText answer={answer} typed={typed} />
        <View style={styles.answerGo}>
          <Text style={styles.answerGoText}>→</Text>
        </View>
      </View>
    </View>
  );
}

function TypingCell({
  index,
  letter,
  typed,
  total,
}: {
  index: number;
  letter: string;
  typed: SharedValue<number>;
  total: number;
}) {
  const style = useAnimatedStyle(() => {
    const shown = typed.value > index;
    const graded = typed.value > total;
    return {
      opacity: shown ? 1 : 0,
      color: graded ? ACCENT : TEXT,
      transform: [{ translateY: shown ? 0 : 6 }],
    };
  });
  // Colours are resolved HERE, on JS: a worklet cannot call rgba() (it is a
  // plain function, and Reanimated throws "tried to synchronously call a
  // remote function" the moment the style runs on the UI thread).
  const dash = useAnimatedStyle(() => ({
    backgroundColor: typed.value > total ? ACCENT : ACCENT_DIM,
  }));
  return (
    <View style={styles.cell}>
      <Animated.Text style={[styles.cellLetter, style]}>{letter}</Animated.Text>
      <Animated.View style={[styles.cellDash, dash]} />
    </View>
  );
}

function AnswerText({ answer, typed }: { answer: string; typed: SharedValue<number> }) {
  // The bar mirrors the cells: same letters, so both read from `typed`.
  const letters = answer.split('');
  return (
    <View style={styles.answerText}>
      {letters.map((ch, i) => (
        <AnswerLetter key={i} index={i} letter={ch} typed={typed} />
      ))}
      <Caret typed={typed} total={letters.length} />
    </View>
  );
}

function AnswerLetter({ index, letter, typed }: { index: number; letter: string; typed: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({ opacity: typed.value > index ? 1 : 0 }));
  return <Animated.Text style={[styles.answerLetter, style]}>{letter}</Animated.Text>;
}

function Caret({ typed, total }: { typed: SharedValue<number>; total: number }) {
  const style = useAnimatedStyle(() => ({ opacity: typed.value > total ? 0 : 1 }));
  return <Animated.View style={[styles.caret, style]} />;
}

// ------------------------------------------------------------ parrot peek

/** Loro looking in from the edge of the screen, gently bobbing. */
export function ParrotPeek({
  side = 'right',
  size = 150,
  waving,
  style,
}: {
  side?: 'left' | 'right';
  size?: number;
  waving?: boolean;
  style?: object;
}) {
  const reduced = useReducedMotion();
  const bob = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    bob.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 2200, easing: Easing.inOut(Easing.sin) })
      ),
      -1,
      true
    );
  }, [bob, reduced]);
  const anim = useAnimatedStyle(() => ({
    transform: [{ translateY: bob.value * -6 }, { rotate: `${(bob.value - 0.5) * 3}deg` }],
  }));
  const ratio = waving ? 375 / 420 : 282 / 420;
  return (
    <Animated.View style={[anim, style]} pointerEvents="none">
      <Image
        source={waving ? BRAND.parrotWaving : BRAND.parrot}
        style={{ height: size, width: size * ratio, transform: [{ scaleX: side === 'left' ? -1 : 1 }] }}
        resizeMode="contain"
        accessibilityRole="image"
        accessibilityLabel="Loro the parrot"
      />
    </Animated.View>
  );
}

/** A small caption strip: label on the left in a tint, text on the right. */
export function Note({ tint, children }: { tint: Tint; children: ReactNode }) {
  return (
    <View style={[styles.note, { borderColor: rgba(TINTS[tint], 0.35), backgroundColor: rgba(TINTS[tint], 0.08) }]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  glow: { position: 'absolute' },
  tile: { alignItems: 'center', justifyContent: 'center' },
  tileGlyph: { fontWeight: '700' },
  bars: { alignItems: 'flex-end', flexDirection: 'row', gap: 3 },
  weekStack: { gap: 4 },
  week: { flexDirection: 'row', gap: 3 },
  practise: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  practiseChip: {
    backgroundColor: 'rgba(242,245,243,0.08)',
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  practiseChipText: { color: TEXT, fontSize: 13, fontWeight: '700' },
  practiseGo: { backgroundColor: ACCENT, borderRadius: 8, marginLeft: 4, paddingHorizontal: 10, paddingVertical: 4 },
  practiseGoText: { color: ON_ACCENT, fontSize: 12, fontWeight: '800' },

  phone: {
    alignSelf: 'center',
    backgroundColor: '#0f1412',
    borderColor: 'rgba(242,245,243,0.12)',
    borderRadius: 28,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { height: 18, width: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 28,
  },
  frame: { overflow: 'hidden' },
  sun: {
    backgroundColor: rgba(TINTS.amber, 0.7),
    borderRadius: 999,
    height: 34,
    position: 'absolute',
    width: 34,
  },
  hill: {
    backgroundColor: rgba(TINTS.mint, 0.22),
    borderRadius: 999,
    height: 260,
    position: 'absolute',
  },
  bubble: {
    backgroundColor: '#f2f5f3',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 7,
    position: 'absolute',
  },
  bubbleText: { color: '#06130d', fontSize: 15, fontWeight: '800' },
  /** A little wedge under the bubble, pointing down-right at the parrot. */
  bubbleTail: {
    backgroundColor: '#f2f5f3',
    bottom: -5,
    height: 12,
    position: 'absolute',
    right: 12,
    transform: [{ rotate: '45deg' }],
    width: 12,
  },
  creatorPill: {
    alignItems: 'center',
    backgroundColor: 'rgba(10,13,11,0.55)',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 6,
    left: 12,
    padding: 5,
    paddingRight: 12,
    position: 'absolute',
    top: 12,
  },
  creatorDot: { backgroundColor: rgba(TINTS.violet, 0.9), borderRadius: 999, height: 16, width: 16 },
  creatorLine: { backgroundColor: 'rgba(242,245,243,0.6)', borderRadius: 2, height: 4, width: 42 },
  soundPill: {
    alignItems: 'center',
    backgroundColor: 'rgba(10,13,11,0.55)',
    borderRadius: 999,
    height: 28,
    justifyContent: 'center',
    position: 'absolute',
    right: 12,
    top: 10,
    width: 28,
  },
  soundGlyph: { color: TEXT, fontSize: 14, fontWeight: '800' },
  band: { backgroundColor: '#0a0d0b', paddingHorizontal: 14, paddingVertical: 14 },
  line: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  word: { color: TEXT, fontSize: 18, fontWeight: '700', lineHeight: 26 },
  wordLit: {
    backgroundColor: ACCENT,
    borderRadius: 6,
    color: ON_ACCENT,
    overflow: 'hidden',
    paddingHorizontal: 5,
  },
  translation: { color: MUTED, fontSize: 12, marginTop: 6 },
  saveCard: {
    alignItems: 'center',
    backgroundColor: CARD,
    borderColor: 'rgba(94,230,168,0.35)',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    left: 10,
    paddingHorizontal: 9,
    paddingVertical: 8,
    position: 'absolute',
    right: 10,
    shadowColor: ACCENT,
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    top: '52%',
  },
  saveLoro: {
    alignItems: 'center',
    backgroundColor: 'rgba(94,230,168,0.14)',
    borderRadius: 10,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  saveParrot: { height: 30, width: 24 },
  saveWord: { color: TEXT, fontSize: 14, fontWeight: '800' },
  saveGloss: { color: MUTED, fontSize: 11, fontWeight: '600' },
  saveTag: { backgroundColor: 'rgba(94,230,168,0.16)', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 4 },
  saveTagText: { color: ACCENT, fontSize: 10, fontWeight: '800' },

  miniLine: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  miniWord: { borderRadius: 5, color: TEXT, fontSize: 15, fontWeight: '700', paddingHorizontal: 3, paddingVertical: 1 },
  miniBlank: { flexDirection: 'row', gap: 3, paddingBottom: 4, paddingHorizontal: 3 },
  miniDash: { borderRadius: 1.5, height: 3, width: 6 },

  returnBox: { marginTop: 6, paddingHorizontal: 18 },
  /** Sits at the dots' midline: the dot row starts at the top of the box,
      the biggest dot is 14 tall, so its centre is 7 down. */
  returnRail: {
    backgroundColor: 'rgba(94,230,168,0.3)',
    height: 2,
    left: 24,
    position: 'absolute',
    right: 24,
    top: 6,
  },
  returnDots: { flexDirection: 'row', justifyContent: 'space-between' },
  returnStop: { alignItems: 'center', width: 64 },
  returnDot: {
    backgroundColor: '#1a221e',
    borderColor: 'rgba(242,245,243,0.25)',
    borderRadius: 999,
    borderWidth: 2,
    height: 14,
    width: 14,
  },
  returnDotOn: { backgroundColor: ACCENT, borderColor: ACCENT },
  returnLabel: { color: 'rgba(242,245,243,0.45)', fontSize: 11, fontWeight: '600', marginTop: 6 },
  returnLabelOn: { color: TEXT },

  ladder: { alignItems: 'flex-end', flexDirection: 'row', gap: 8, justifyContent: 'center', marginTop: 22 },
  rung: { alignItems: 'center', gap: 6, width: 40 },
  rungBar: { backgroundColor: 'rgba(242,245,243,0.1)', borderRadius: 4, width: 22 },
  rungBarDone: { backgroundColor: 'rgba(94,230,168,0.35)' },
  rungBarHere: {
    backgroundColor: ACCENT,
    shadowColor: ACCENT,
    shadowOffset: { height: 0, width: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 10,
  },
  rungLabel: { color: 'rgba(242,245,243,0.4)', fontSize: 12, fontWeight: '700' },
  rungLabelHere: { color: ACCENT },

  typing: {
    backgroundColor: CARD,
    borderColor: 'rgba(242,245,243,0.08)',
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 26,
    overflow: 'hidden',
    padding: 16,
  },
  typingLine: { alignItems: 'flex-end', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typingWord: { color: TEXT, fontSize: 22, fontWeight: '700', lineHeight: 30 },
  typingSlot: { alignItems: 'center' },
  typingGloss: { color: rgba(ACCENT, 0.6), fontSize: 12, fontWeight: '600', marginBottom: 2 },
  typingCells: { flexDirection: 'row', gap: 4 },
  cell: { alignItems: 'center', width: 16 },
  cellLetter: { fontSize: 22, fontWeight: '800', lineHeight: 26 },
  cellDash: { borderRadius: 1.5, height: 3, marginTop: 2, width: 14 },
  answerBar: {
    alignItems: 'center',
    backgroundColor: '#0a0d0b',
    borderColor: 'rgba(242,245,243,0.1)',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    marginTop: 16,
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 6,
  },
  answerText: { alignItems: 'center', flex: 1, flexDirection: 'row', minHeight: 30 },
  answerLetter: { color: TEXT, fontSize: 17, fontWeight: '700' },
  caret: { backgroundColor: ACCENT, height: 20, marginLeft: 2, width: 2 },
  answerGo: {
    alignItems: 'center',
    backgroundColor: ACCENT,
    borderRadius: 10,
    height: 32,
    justifyContent: 'center',
    width: 40,
  },
  answerGoText: { color: ON_ACCENT, fontSize: 16, fontWeight: '800' },

  note: { borderRadius: 14, borderWidth: 1, marginTop: 18, padding: 12 },
});
