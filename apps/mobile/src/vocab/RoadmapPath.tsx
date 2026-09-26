import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { SavedWord } from '@loro/core/types';
import { BRAND } from '../onboarding/brand';
import { tierForLearned } from '@loro/core/levels';
import { learnedTotal } from '../feed/wordLearned';
import {
  buildRoadmap,
  OPEN_SLOTS,
  STAGE_SIZE,
  type RoadmapNode,
} from '@loro/core/roadmap';

/**
 * THE PATH — the Words tab as a road, in the order the words were saved
 * (Radek, 2026-09-26, branch words-roadmap: "a roadmap based of when did he
 * save the word, a bit like duolingo the levels but with words, and
 * everytime you learn a word you unlock a new [one]").
 *
 * Third pass, after seeing the second on device ("the design looks cool as
 * hell" but "still chaotic"). What calmed it:
 *   - ONE accent. Mint is learned; the current word is the only bright coin;
 *     open words are dark with mint pips; locked words are grey. The gold
 *     "done" colour and the per-word coloured chips are gone.
 *   - TWO LINES per word: the word, then "meaning · N writes left". The save
 *     date lives on the stage heading, where it is one line for ten words.
 *   - FOLDING. A finished stage is one line; the stages past the next one
 *     fold into a single "N more stages" line. Only the stage you are in and
 *     the next are drawn in full; any fold opens on a tap.
 *
 * The rule lives in core (roadmap.ts): OPEN_SLOTS words are open, learning
 * one opens the next saved word, the rest wait — and waiting words are not
 * asked in the feed or counted as ready. This file only draws it.
 */

const MINT = '#5ee6a8';
const INK = '#f2f5f3';
const MUTED = 'rgba(242,245,243,0.5)';
const FAINT = 'rgba(242,245,243,0.3)';

/** Face + lip per coin: the lip is the coin's thickness, drawn under it. */
const COIN = {
  done: { face: MINT, lip: '#2a9e6d' },
  // The word you are on is WHITE, never mint: mint means learned, and the
  // two must not be confused at a glance (Radek: "make the learned and
  // learning words more distinct").
  here: { face: INK, lip: '#aab4af' },
  open: { face: '#1d2b25', lip: '#121c18' },
  locked: { face: '#232a27', lip: '#171d1a' },
} as const;

const COIN_W = 70;
const COIN_H = 58;
const LIP = 6;
const ROW_H = 84;
/** The current coin carries a halo and a tag above it. */
const HERE_ROW_H = 132;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortDate(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function savedRange(nodes: RoadmapNode[]): string {
  // Learned words are drawn in the order they were learned, so a stage's
  // save dates are its earliest and latest, not its first and last node.
  const times = nodes.map((n) => n.savedAt);
  const a = shortDate(Math.min(...times));
  const b = shortDate(Math.max(...times));
  return a === b ? `saved ${a}` : `saved ${a} – ${b}`;
}

/** A padlock from two shapes — the app does not use emoji. */
function Lock() {
  return (
    <View style={styles.lock}>
      <View style={styles.lockShackle} />
      <View style={styles.lockBody} />
    </View>
  );
}

/** "Tap to train": a play mark drawn from borders (no emoji, no font glyph). */
function Play({ onMint }: { onMint: boolean }) {
  return (
    <View
      style={[
        styles.play,
        { borderLeftColor: onMint ? '#06130d' : MINT },
      ]}
    />
  );
}

/**
 * LORO ON THE PATH, like Duo beside his. He stands in the empty half of the
 * road inside the stage you are on, bobbing, with one line about what to do
 * next. Two poses exist (standing, waving); the waving one closes the path.
 */
function Mascot({
  side,
  line,
  waving = false,
}: {
  side: 'left' | 'right';
  line: string;
  waving?: boolean;
}) {
  const bob = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [bob]);
  const translateY = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -7] });
  return (
    <View style={[styles.mascotRow, { flexDirection: side === 'left' ? 'row' : 'row-reverse' }]}>
      <Animated.Image
        source={waving ? BRAND.parrotWaving : BRAND.parrot}
        style={[waving ? styles.mascotWaving : styles.mascot, { transform: [{ translateY }, { scaleX: side === 'left' ? 1 : -1 }] }]}
        resizeMode="contain"
      />
      <View style={[styles.bubble, side === 'left' ? styles.bubbleLeft : styles.bubbleRight]}>
        <Text style={styles.bubbleText}>{line}</Text>
      </View>
    </View>
  );
}

function Coin({ node, here }: { node: RoadmapNode; here: boolean }) {
  const c = COIN[here ? 'here' : node.status];
  return (
    <View style={{ width: COIN_W, height: COIN_H + LIP }}>
      <View style={[styles.coinLayer, { top: LIP, backgroundColor: c.lip }]} />
      <View
        style={[
          styles.coinLayer,
          styles.coinFace,
          { top: 0, backgroundColor: c.face },
          node.status === 'open' && !here && styles.coinOpenRing,
        ]}
      >
        {node.status === 'done' && <Text style={styles.check}>✓</Text>}
        {node.status === 'open' && <Play onMint={here} />}
        {node.status === 'locked' && <Lock />}
      </View>
    </View>
  );
}

function Row({
  node,
  index,
  here,
  width,
  onOpen,
  onLongPress,
  onHereLayout,
}: {
  node: RoadmapNode;
  index: number;
  here: boolean;
  width: number;
  onOpen: () => void;
  onLongPress: () => void;
  onHereLayout?: (y: number) => void;
}) {
  const swing = Math.min(70, width * 0.18);
  const offset = Math.sin(index * 0.9) * swing;
  const coinLeft = width / 2 + offset - COIN_W / 2;
  const height = here ? HERE_ROW_H : ROW_H;
  const coinTop = here ? 52 : 10;
  // The words take the wider side of the road.
  const labelLeft = offset >= 0;
  const gap = here ? 26 : 16;
  const labelBox = labelLeft
    ? { left: 0, width: Math.max(90, coinLeft - gap) }
    : { left: coinLeft + COIN_W + gap, right: 0 };
  const align = labelLeft ? ('right' as const) : ('left' as const);

  const { word, status } = node;
  const detail =
    status === 'done'
      ? `${word.translation} · ✓ learned`
      : status === 'open'
        ? `${word.translation} · ${word.state === 'lapsed' ? 'train again' : 'tap to train'}`
        : null;
  const a11y =
    status === 'locked'
      ? `${word.text}. Waiting.`
      : `${word.text}, ${detail}. Saved ${shortDate(node.savedAt)}.`;

  return (
    <Pressable
      onPress={onOpen}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityHint='Train this word. Long press for its card.'
      style={({ pressed }) => [{ height }, pressed && styles.pressed]}
      onLayout={here && onHereLayout ? (e) => onHereLayout(e.nativeEvent.layout.y) : undefined}
    >
      {here && (
        <View style={[styles.hereTag, { left: coinLeft + COIN_W / 2 - 48 }]}>
          <Text style={styles.hereText}>YOU'RE HERE</Text>
          <View style={styles.hereTail} />
        </View>
      )}
      <View style={{ position: 'absolute', top: coinTop, left: coinLeft }}>
        {here && <View style={styles.halo} />}
        <Coin node={node} here={here} />
      </View>
      <View style={[styles.label, labelBox, { top: coinTop + 10 }]}>
        <Text
          style={[
            styles.labelWord,
            status === 'locked' && styles.labelWordLocked,
            status === 'done' && styles.labelWordDone,
            { textAlign: align },
          ]}
          numberOfLines={1}
        >
          {word.text}
        </Text>
        {detail !== null && (
          <Text style={[styles.labelDetail, { textAlign: align }]} numberOfLines={1}>
            {detail}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

/** A folded stage (finished) or a folded run of stages (far ahead): one line. */
function Fold({
  title,
  body,
  done,
  onPress,
}: {
  title: string;
  body: string;
  done: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityHint="Shows these words"
      style={({ pressed }) => [styles.fold, pressed && styles.pressed]}
    >
      <View style={[styles.foldMark, done ? styles.foldMarkDone : styles.foldMarkLocked]}>
        {done ? <Text style={styles.foldCheck}>✓</Text> : <Lock />}
      </View>
      <View style={styles.foldText}>
        <Text style={[styles.foldTitle, !done && styles.foldTitleLocked]}>{title}</Text>
        <Text style={styles.foldBody}>{body}</Text>
      </View>
      <Text style={styles.foldChevron}>›</Text>
    </Pressable>
  );
}

export function RoadmapPath({
  words,
  onOpen,
  onLongPress,
  onAnchor,
}: {
  words: readonly SavedWord[];
  /** Tap: train the word (the practice set). */
  onOpen: (word: SavedWord) => void;
  /** Long press: the word card: hear it, see it explained, remove it. */
  onLongPress: (word: SavedWord) => void;
  /** Y of "You're here" inside this component, once it has laid out. */
  onAnchor: (y: number) => void;
}) {
  const { width: screenW } = useWindowDimensions();
  // VocabScreen's scroll pads 16 each side.
  const width = screenW - 32;
  const path = useMemo(() => buildRoadmap(words), [words]);
  const counts = useMemo(() => {
    let done = 0;
    let open = 0;
    let locked = 0;
    for (const n of path) {
      if (n.status === 'done') done++;
      else if (n.status === 'open') open++;
      else locked++;
    }
    return { done, open, locked };
  }, [path]);
  const hereNode = path.find((n) => n.status === 'open') ?? null;
  const hereKey = hereNode?.key ?? null;
  const hereWord = hereNode?.word.text ?? null;
  const stages = useMemo(() => {
    const out: RoadmapNode[][] = [];
    for (let i = 0; i < path.length; i += STAGE_SIZE) out.push(path.slice(i, i + STAGE_SIZE));
    return out;
  }, [path]);

  /**
   * What is drawn in full: the stage you are in and the one after it.
   * "In" = the first stage that is not all done; with nothing open (every
   * word learned) there is no current stage and everything folds done.
   */
  const current = stages.findIndex((nodes) => nodes.some((n) => n.status !== 'done'));
  const [opened, setOpened] = useState<ReadonlySet<number>>(new Set());
  const [showAhead, setShowAhead] = useState(false);
  const expand = (s: number) => setOpened((prev) => new Set(prev).add(s));
  const lastFull = current === -1 ? -1 : current + 1;
  const ahead = stages.slice(lastFull + 1);
  const aheadWords = ahead.reduce((n, st) => n + st.length, 0);

  // "You're here" is nested: row y inside its stage, stage y inside the path.
  const stageY = useRef(new Map<number, number>());
  const hereAt = useRef<{ stage: number; y: number } | null>(null);
  const report = () => {
    const h = hereAt.current;
    if (!h) return;
    const s = stageY.current.get(h.stage);
    if (s !== undefined) onAnchor(s + h.y);
  };

  const renderStage = (nodes: RoadmapNode[], s: number) => {
    const done = nodes.filter((n) => n.status === 'done').length;
    const allDone = done === nodes.length;
    if (allDone && !opened.has(s)) {
      return (
        <Fold
          key={nodes[0].key}
          done
          title={`Stage ${s + 1}`}
          body={`All ${nodes.length} learned · ${savedRange(nodes)}`}
          onPress={() => expand(s)}
        />
      );
    }
    const isCurrent = s === current;
    const share = done / nodes.length;
    /**
     * A stage opened from a fold closes the same way (Radek: "after popping
     * up the previous stage it needs to be able to close again") — a done
     * stage folds back to its line, a stage ahead folds the whole run.
     */
    const isAhead = s > lastFull;
    const canFold = (allDone && opened.has(s)) || isAhead;
    const fold = () => {
      if (isAhead) setShowAhead(false);
      else
        setOpened((prev) => {
          const nextSet = new Set(prev);
          nextSet.delete(s);
          return nextSet;
        });
    };
    return (
      <View
        key={nodes[0].key}
        style={styles.stageBlock}
        onLayout={(e) => {
          stageY.current.set(s, e.nativeEvent.layout.y);
          report();
        }}
      >
        <Pressable
          disabled={!canFold}
          onPress={fold}
          accessibilityRole={canFold ? 'button' : undefined}
          accessibilityHint={canFold ? 'Folds this stage away' : undefined}
          style={({ pressed }) => [styles.banner, isCurrent && styles.bannerCurrent, pressed && styles.pressed]}
        >
          <View style={styles.bannerRow}>
            <Text style={[styles.bannerTitle, isCurrent && styles.bannerTitleCurrent]}>
              Stage {s + 1}
            </Text>
            <Text style={[styles.bannerCount, isCurrent && styles.bannerCountCurrent]}>
              {done} of {nodes.length} learned
            </Text>
          </View>
          <Text style={[styles.bannerSub, isCurrent && styles.bannerSubCurrent]}>
            {savedRange(nodes).replace(/^s/, 'S')}
          </Text>
          <View style={[styles.track, isCurrent && styles.trackCurrent]}>
            <View
              style={[
                styles.fill,
                isCurrent && styles.fillCurrent,
                { width: `${Math.round(share * 100)}%` },
              ]}
            />
          </View>
          {canFold && <Text style={styles.foldAway}>Tap to fold away</Text>}
        </Pressable>
        {nodes.map((node, i) => [
          isCurrent && i === Math.min(4, nodes.length - 1) ? (
            <Mascot
              key="loro"
              side={Math.sin((s * STAGE_SIZE + i + 0.5) * 0.9) >= 0 ? 'left' : 'right'}
              line={
                hereWord
                  ? `Tap «${hereWord}» to train it. Two out of three right and it's yours!`
                  : `${nodes.length - done} to go in Stage ${s + 1}!`
              }
            />
          ) : null,
          <Row
            key={node.key}
            node={node}
            index={s * STAGE_SIZE + i}
            here={node.key === hereKey}
            width={width}
            onOpen={() => onOpen(node.word)}
            onLongPress={() => onLongPress(node.word)}
            onHereLayout={(y) => {
              hereAt.current = { stage: s, y };
              report();
            }}
          />,
        ])}
      </View>
    );
  };

  // YOUR LEVEL IS WORDS LEARNED — the Progress page's ladder, the same
  // count (tierForLearned over learnedTotal), so the two tabs can never
  // disagree. The feed's own blank-difficulty level (storage.getLevelState)
  // shares the tier NAMES but is a different number and stays off-screen;
  // showing it here said "Nativo" beside Progress's "Se Defiende".
  const ladder = useMemo(() => tierForLearned(learnedTotal(words)), [words]);
  const tier = ladder.tier;
  const nextTier = ladder.next;
  const levelNumber = tier.level;

  return (
    <View>
      <View style={styles.intro}>
        <Text style={styles.introTitle}>One word at a time</Text>
        <Text style={styles.introBody}>
          Train a word here and it's learned. Then it pops up in your videos, so it sticks.
          {` ${OPEN_SLOTS} at a time; each one you learn opens the next.`}
        </Text>
        <View style={styles.stats}>
          <Text style={styles.stat}>
            <Text style={[styles.statNum, { color: MINT }]}>{counts.done}</Text> learned
          </Text>
          <Text style={styles.statDot}>·</Text>
          <Text style={styles.stat}>
            <Text style={styles.statNum}>{counts.open}</Text> to train
          </Text>
          <Text style={styles.statDot}>·</Text>
          <Text style={styles.stat}>
            <Text style={styles.statNum}>{counts.locked}</Text> waiting
          </Text>
        </View>
      </View>

      {/* YOUR LEVEL (Radek: "we should show the levels in the words page"):
          words learned, the Progress page's ladder — each word trained on
          the path below moves it. */}
      <View style={styles.level}>
        <View style={styles.levelBadge}>
          <Text style={styles.levelBadgeNum}>{levelNumber}</Text>
        </View>
        <View style={styles.levelText}>
          <View style={styles.levelRow}>
            <Text style={styles.levelName}>{tier.name}</Text>
            <Text style={styles.levelMeaning} numberOfLines={1}>{tier.meaning}</Text>
          </View>
          <View style={styles.levelTrack}>
            <View style={[styles.levelFill, { width: `${Math.max(4, ladder.meter)}%` }]} />
          </View>
          <Text style={styles.levelHint} numberOfLines={1}>
            {nextTier
              ? `Learn ${ladder.need - ladder.have} more ${ladder.need - ladder.have === 1 ? 'word' : 'words'} to reach ${nextTier.name}`
              : 'The top level. ¡Nativo!'}
          </Text>
        </View>
      </View>

      {stages.slice(0, lastFull + 1 || stages.length).map((nodes, s) => renderStage(nodes, s))}

      {ahead.length > 0 &&
        (showAhead ? (
          ahead.map((nodes, i) => renderStage(nodes, lastFull + 1 + i))
        ) : (
          <Fold
            done={false}
            title={`${ahead.length} more ${ahead.length === 1 ? 'stage' : 'stages'}`}
            body={`${aheadWords} words waiting their turn`}
            onPress={() => setShowAhead(true)}
          />
        ))}

      {path.length > 0 && (
        <Mascot waving side="right" line="Every word you save joins the end of your path. ¡Vamos!" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.75 },
  level: {
    alignItems: 'center',
    backgroundColor: '#121815',
    borderRadius: 20,
    flexDirection: 'row',
    gap: 14,
    marginBottom: 20,
    padding: 16,
  },
  levelBadge: {
    alignItems: 'center',
    backgroundColor: MINT,
    borderBottomColor: '#2a9e6d',
    borderBottomWidth: 4,
    borderRadius: 16,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  levelBadgeNum: { color: '#06130d', fontSize: 24, fontWeight: '900' },
  levelText: { flex: 1 },
  levelRow: { alignItems: 'baseline', flexDirection: 'row', gap: 8 },
  levelName: { color: INK, fontSize: 18, fontWeight: '900' },
  levelMeaning: { color: MUTED, flexShrink: 1, fontSize: 12 },
  levelTrack: {
    backgroundColor: 'rgba(94,230,168,0.15)',
    borderRadius: 999,
    height: 7,
    marginTop: 8,
    overflow: 'hidden',
  },
  levelFill: { backgroundColor: MINT, borderRadius: 999, height: '100%' },
  levelHint: { color: MUTED, fontSize: 11, marginTop: 6 },
  intro: {
    backgroundColor: '#121815',
    borderRadius: 20,
    marginBottom: 12,
    padding: 18,
  },
  introTitle: { color: INK, fontSize: 21, fontWeight: '900' },
  introBody: { color: 'rgba(242,245,243,0.65)', fontSize: 14, lineHeight: 20, marginTop: 4 },
  stats: { alignItems: 'baseline', flexDirection: 'row', gap: 8, marginTop: 12 },
  stat: { color: MUTED, fontSize: 13, fontWeight: '600' },
  statNum: { color: INK, fontSize: 16, fontVariant: ['tabular-nums'], fontWeight: '900' },
  statDot: { color: FAINT, fontSize: 13 },

  stageBlock: { marginBottom: 14 },
  banner: {
    backgroundColor: '#121815',
    borderRadius: 18,
    marginBottom: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  bannerCurrent: { backgroundColor: MINT },
  foldAway: { color: FAINT, fontSize: 11, fontWeight: '800', marginTop: 10, textAlign: 'center' },
  bannerRow: { alignItems: 'baseline', flexDirection: 'row', justifyContent: 'space-between' },
  bannerTitle: { color: INK, fontSize: 18, fontWeight: '900' },
  bannerTitleCurrent: { color: '#06130d' },
  bannerCount: { color: MUTED, fontSize: 13, fontVariant: ['tabular-nums'], fontWeight: '800' },
  bannerCountCurrent: { color: 'rgba(6,19,13,0.7)' },
  bannerSub: { color: FAINT, fontSize: 12, marginTop: 2 },
  bannerSubCurrent: { color: 'rgba(6,19,13,0.55)' },
  track: {
    backgroundColor: 'rgba(242,245,243,0.08)',
    borderRadius: 999,
    height: 6,
    marginTop: 12,
    overflow: 'hidden',
  },
  trackCurrent: { backgroundColor: 'rgba(6,19,13,0.15)' },
  fill: { backgroundColor: MINT, borderRadius: 999, height: '100%' },
  fillCurrent: { backgroundColor: '#06130d' },

  fold: {
    alignItems: 'center',
    backgroundColor: '#121815',
    borderRadius: 16,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  foldMark: { alignItems: 'center', borderRadius: 999, height: 34, justifyContent: 'center', width: 34 },
  foldMarkDone: { backgroundColor: MINT },
  foldMarkLocked: { backgroundColor: '#232a27' },
  foldCheck: { color: '#06130d', fontSize: 16, fontWeight: '900' },
  foldText: { flex: 1 },
  foldTitle: { color: INK, fontSize: 15, fontWeight: '800' },
  foldTitleLocked: { color: 'rgba(242,245,243,0.7)' },
  foldBody: { color: MUTED, fontSize: 12, marginTop: 1 },
  foldChevron: { color: FAINT, fontSize: 22, fontWeight: '600' },

  coinLayer: {
    borderRadius: COIN_H / 2,
    height: COIN_H,
    left: 0,
    position: 'absolute',
    width: COIN_W,
  },
  coinFace: { alignItems: 'center', justifyContent: 'center' },
  coinOpenRing: { borderColor: 'rgba(94,230,168,0.35)', borderWidth: 2 },
  halo: {
    borderColor: 'rgba(94,230,168,0.4)',
    borderRadius: (COIN_H + 30) / 2,
    borderWidth: 4,
    height: COIN_H + LIP + 18,
    left: -12,
    position: 'absolute',
    top: -9,
    width: COIN_W + 24,
  },
  check: { color: '#06130d', fontSize: 24, fontWeight: '900' },
  play: {
    borderBottomColor: 'transparent',
    borderBottomWidth: 10,
    borderLeftWidth: 16,
    borderTopColor: 'transparent',
    borderTopWidth: 10,
    height: 0,
    marginLeft: 5,
    width: 0,
  },
  mascotRow: { alignItems: 'center', gap: 8, height: 150, marginVertical: 4, paddingHorizontal: 6 },
  mascot: { height: 128, width: 86 },
  mascotWaving: { height: 118, width: 105 },
  bubble: {
    backgroundColor: '#1a2420',
    borderRadius: 16,
    flexShrink: 1,
    maxWidth: 190,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  bubbleLeft: { borderBottomLeftRadius: 4 },
  bubbleRight: { borderBottomRightRadius: 4 },
  bubbleText: { color: INK, fontSize: 13, fontWeight: '700', lineHeight: 18 },
  lock: { alignItems: 'center' },
  lockShackle: {
    borderBottomWidth: 0,
    borderColor: '#4a5550',
    borderTopLeftRadius: 7,
    borderTopRightRadius: 7,
    borderWidth: 2.5,
    height: 9,
    marginBottom: -1,
    width: 12,
  },
  lockBody: { backgroundColor: '#4a5550', borderRadius: 3, height: 11, width: 17 },

  label: { position: 'absolute' },
  labelWord: { color: INK, fontSize: 17, fontWeight: '900' },
  labelWordLocked: { color: FAINT, fontWeight: '700' },
  labelWordDone: { color: MINT },
  labelDetail: { color: MUTED, fontSize: 12, marginTop: 2 },

  hereTag: {
    alignItems: 'center',
    backgroundColor: INK,
    borderRadius: 10,
    paddingVertical: 5,
    position: 'absolute',
    top: 4,
    width: 96,
  },
  hereText: { color: '#06130d', fontSize: 11, fontWeight: '900', letterSpacing: 0.8 },
  hereTail: {
    borderLeftColor: 'transparent',
    borderLeftWidth: 7,
    borderRightColor: 'transparent',
    borderRightWidth: 7,
    borderTopColor: INK,
    borderTopWidth: 7,
    bottom: -7,
    height: 0,
    position: 'absolute',
    width: 0,
  },
});
