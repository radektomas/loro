import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  Extrapolation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { ACCENT, ON_ACCENT, TEXT } from './chrome';

/**
 * THE FIRST THING ANYONE SEES (Radek, 2026-10-27: the drawn phone with the
 * sun, the hill and Loro in it was "the weird screen … horrible").
 *
 * Spanish, scrolling like song lyrics: one line in focus, its neighbours
 * dimmed above and below. The line in focus lights up word by word, the way
 * the app's karaoke does under a clip, then one word turns mint with its
 * meaning over it and the whole line's English fades in underneath. Then the
 * next line rolls up. No drawing, no fake video: just the thing the app does
 * to a sentence, on a loop.
 *
 * The sentences are written for this screen (everyday lines, not any
 * creator's captions), so nothing here quotes or depicts a real clip.
 *
 * Plain Reanimated on transforms and opacity, keyed off `active` so it never
 * runs off stage, and still under Reduce Motion (the first line, fully lit).
 */

type Line = { words: string[]; lit: number; gloss: string; english: string };

const LINES: Line[] = [
  { words: ['¿Qué', 'quieres', 'hacer', 'hoy?'], lit: 2, gloss: 'to do', english: 'What do you want to do today?' },
  { words: ['Me', 'encanta', 'esta', 'ciudad'], lit: 1, gloss: 'I love', english: 'I love this city' },
  { words: ['No', 'tengo', 'ni', 'idea'], lit: 1, gloss: 'I have', english: 'I have no idea' },
  { words: ['Vamos', 'a', 'tomar', 'algo'], lit: 2, gloss: 'to have', english: 'Let’s go for a drink' },
  { words: ['¿Dónde', 'está', 'el', 'baño?'], lit: 3, gloss: 'bathroom', english: 'Where is the bathroom?' },
  { words: ['Estoy', 'muy', 'cansado'], lit: 2, gloss: 'tired', english: 'I’m really tired' },
];

/** One line's turn in focus, from rolling in to rolling on. */
const TURN_MS = 3600;
/** The roll from one line to the next. */
const ROLL_MS = 650;
/** Vertical spacing between line centres. The focused line needs room for
    the gloss above it and the English below it. */
const ROW = 72;
/** Lines kept mounted either side of the focus; the outermost are fully
    transparent, so mounting and unmounting them is never seen. */
const REACH = 3;

export function HookHero({ active, height }: { active: boolean; height: number }) {
  const reduced = useReducedMotion();
  /** The absolute line number in focus; LINES repeat, so it only grows. */
  const [focus, setFocus] = useState(0);
  useEffect(() => {
    if (!active || reduced) return;
    const timer = setInterval(() => setFocus((n) => n + 1), TURN_MS);
    return () => clearInterval(timer);
  }, [active, reduced]);

  const rows: number[] = [];
  for (let k = focus - REACH; k <= focus + REACH; k++) rows.push(k);
  return (
    <View style={[styles.stage, { height }]} pointerEvents="none">
      {rows.map((k) => (
        <LyricLine
          key={k}
          line={LINES[((k % LINES.length) + LINES.length) % LINES.length]}
          offset={k - focus}
          centre={height / 2}
          running={active && !reduced}
        />
      ))}
    </View>
  );
}

function LyricLine({
  line,
  offset,
  centre,
  running,
}: {
  line: Line;
  offset: number;
  centre: number;
  running: boolean;
}) {
  /** Where this line sits relative to the focus, animated between rows. */
  const pos = useSharedValue(offset + 1);
  /** 0 → 1 across the line's turn in focus: words light, then the gloss. */
  const lit = useSharedValue(offset === 0 && !running ? 1 : 0);

  useEffect(() => {
    pos.value = running
      ? withTiming(offset, { duration: ROLL_MS, easing: Easing.bezier(0.22, 1, 0.36, 1) })
      : offset;
    if (offset === 0) {
      lit.value = running
        ? withDelay(ROLL_MS * 0.4, withTiming(1, { duration: 1500, easing: Easing.linear }))
        : 1;
    } else if (offset < 0) {
      // A line that has had its turn stays lit as it rolls away, then fades
      // with its row: switching it off would flicker on the way out.
    } else {
      lit.value = 0;
    }
  }, [offset, running, pos, lit]);

  const rowStyle = useAnimatedStyle(() => {
    const d = Math.abs(pos.value);
    return {
      opacity: interpolate(d, [0, 1, 2, REACH], [1, 0.32, 0.12, 0], Extrapolation.CLAMP),
      transform: [
        { translateY: centre + pos.value * ROW - ROW / 2 },
        { scale: interpolate(d, [0, 1], [1, 0.8], Extrapolation.CLAMP) },
      ],
    };
  });
  const english = useAnimatedStyle(() => {
    const focusOn = interpolate(Math.abs(pos.value), [0, 0.5], [1, 0], Extrapolation.CLAMP);
    return { opacity: interpolate(lit.value, [0.8, 1], [0, 1], Extrapolation.CLAMP) * focusOn };
  });

  const n = line.words.length;
  return (
    <Animated.View style={[styles.row, rowStyle]}>
      <View style={styles.words}>
        {line.words.map((w, i) => (
          <Word
            key={i}
            text={w}
            // Word i lights across its share of the first 70% of the turn.
            from={(i / n) * 0.7}
            to={((i + 1) / n) * 0.7}
            target={i === line.lit}
            gloss={line.gloss}
            lit={lit}
          />
        ))}
      </View>
      <Animated.Text style={[styles.english, english]} numberOfLines={1}>
        {line.english}
      </Animated.Text>
    </Animated.View>
  );
}

function Word({
  text,
  from,
  to,
  target,
  gloss,
  lit,
}: {
  text: string;
  from: number;
  to: number;
  target: boolean;
  gloss: string;
  lit: SharedValue<number>;
}) {
  const ink = useAnimatedStyle(() => ({
    opacity: interpolate(lit.value, [from, to], [0.38, 1], Extrapolation.CLAMP),
  }));
  /** The target's mint pill and its gloss arrive once the line is spoken. */
  const pill = useAnimatedStyle(() => {
    const t = interpolate(lit.value, [0.72, 0.84], [0, 1], Extrapolation.CLAMP);
    return { opacity: t, transform: [{ scale: 0.9 + t * 0.1 }] };
  });
  const glossStyle = useAnimatedStyle(() => {
    const t = interpolate(lit.value, [0.76, 0.9], [0, 1], Extrapolation.CLAMP);
    return { opacity: t, transform: [{ translateY: (1 - t) * 4 }] };
  });
  if (!target) {
    return <Animated.Text style={[styles.word, ink]}>{text}</Animated.Text>;
  }
  return (
    <View>
      <Animated.View style={[StyleSheet.absoluteFill, styles.pill, pill]} />
      <Animated.Text style={[styles.word, ink]}>{text}</Animated.Text>
      <PillInk text={text} lit={lit} />
      <Animated.Text style={[styles.gloss, glossStyle]} numberOfLines={1}>
        {gloss}
      </Animated.Text>
    </View>
  );
}

/** The target word drawn again in dark ink, fading in over the white as the
    mint pill lands under it, so the word reads on the pill. */
function PillInk({ text, lit }: { text: string; lit: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(lit.value, [0.72, 0.84], [0, 1], Extrapolation.CLAMP),
  }));
  return <Animated.Text style={[styles.word, styles.wordOnPill, style]}>{text}</Animated.Text>;
}

const styles = StyleSheet.create({
  stage: { alignSelf: 'stretch', overflow: 'hidden' },
  row: {
    alignItems: 'center',
    height: ROW,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  words: { flexDirection: 'row', flexWrap: 'nowrap', gap: 7 },
  word: {
    color: TEXT,
    fontSize: 27,
    fontWeight: '800',
    letterSpacing: -0.4,
    lineHeight: 36,
    paddingHorizontal: 4,
  },
  wordOnPill: { color: ON_ACCENT, left: 0, position: 'absolute', top: 0 },
  pill: { backgroundColor: ACCENT, borderRadius: 10 },
  gloss: {
    alignSelf: 'center',
    color: ACCENT,
    fontSize: 13,
    fontWeight: '700',
    position: 'absolute',
    top: -20,
  },
  english: {
    color: 'rgba(242,245,243,0.55)',
    fontSize: 15,
    fontWeight: '500',
    marginTop: 4,
  },
});
