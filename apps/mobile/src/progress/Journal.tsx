import { useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import type { SavedWord } from '@loro/core/types';
import { storage } from '@loro/core/storage';
import { cleanWord } from '@loro/core/dictionary';
import { splitFunctionWords, type Streaks, type WeekDay } from '@loro/core/progress';
import { cityArrivals, STAGE_SIZE, TRIP, tripPosition, tripStop, withLevelKnown } from '@loro/core/roadmap';
import { TIERS, TIER_LEARNED, tierForLearned } from '@loro/core/levels';
import { BRAND } from '../onboarding/brand';
import { COUNTRIES, Flag, flagColours } from '../vocab/countries';
import type { Plan } from './plan';

/**
 * PROGRESS AS A TRAVEL JOURNAL (Radek, 2026-10-02: "make the progress page
 * as nice as we did the words page ... putting away the squares and making
 * it smooth like the words page"). One column, no boxes: the page is a
 * read of the trip, in the Words tab's own pieces — its coins, its mint,
 * its Loro, its flags.
 *
 *   TODAY      Loro, the streak as a big number, the week as seven coins
 *              (today's carries a ring that fills toward the goal), the
 *              one thing to do next.
 *   PASSPORT   a stamp per country reached, with the day you got there;
 *              the countries ahead as empty dashed stamps. Tap: the map.
 *   THIS WEEK  the words learned, as one mint line (chips were "super
 *              chaotic", 2026-09-18), and the all-time count.
 *   LEVEL      the six tiers as a short road, Loro on yours.
 *
 * The numbers are the old cards' numbers, computed by ProgressScreen and
 * handed down unchanged; this file only draws them. No emoji (the app's
 * rule), so the old 🔥 and ❄ are gone: the streak is a number and the
 * freeze is a blue coin.
 */

const MINT = '#5ee6a8';
const INK = '#f2f5f3';
const MUTED = 'rgba(242,245,243,0.6)';
const FAINT = 'rgba(242,245,243,0.32)';
const BLUE = '#57b3f2';
const LEARNED_PREVIEW = 12;

function Heading({ children, right }: { children: string; right?: string }) {
  return (
    <View style={styles.heading}>
      <Text style={styles.headingText}>{children}</Text>
      {right ? <Text style={styles.headingRight}>{right}</Text> : null}
    </View>
  );
}

// ------------------------------------------------------------------ TODAY

const COIN = 34;
const RING = COIN + 14;

/** One day of the week, as a coin from the Words path. */
function DayCoin({ day, goalShare }: { day: WeekDay; goalShare: number }) {
  const face = day.active ? MINT : day.frozen ? BLUE : day.isToday ? INK : day.isFuture ? 'transparent' : '#1d2b25';
  const lip = day.active ? '#2a9e6d' : day.frozen ? '#2b79ad' : day.isToday ? '#aab4af' : day.isFuture ? 'transparent' : '#121c18';
  const r = RING / 2 - 2;
  const length = 2 * Math.PI * r;
  return (
    <View style={styles.day}>
      <View style={styles.coinWrap}>
        {/* Today's coin wears the goal as a ring, filling as words come right. */}
        {day.isToday && !day.active && (
          <Svg width={RING} height={RING} style={styles.ring}>
            <Circle cx={RING / 2} cy={RING / 2} r={r} stroke="rgba(242,245,243,0.12)" strokeWidth={3} fill="none" />
            <Circle
              cx={RING / 2}
              cy={RING / 2}
              r={r}
              stroke={MINT}
              strokeWidth={3}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${(length * goalShare).toFixed(1)} ${length.toFixed(1)}`}
              rotation={-90}
              originX={RING / 2}
              originY={RING / 2}
            />
          </Svg>
        )}
        <View style={[styles.coinLip, { backgroundColor: lip }]} />
        <View
          style={[
            styles.coinFace,
            { backgroundColor: face },
            day.isFuture && styles.coinFuture,
          ]}
        >
          {day.active && <Text style={styles.coinTick}>✓</Text>}
          {day.frozen && !day.active && <Text style={styles.coinTick}>✓</Text>}
        </View>
      </View>
      <Text style={[styles.dayLabel, day.isToday && styles.dayLabelToday]}>{day.label}</Text>
    </View>
  );
}

export function TodaySection({
  plan,
  count,
  streaks,
  week,
  words,
  onWords,
  onFeed,
}: {
  plan: Plan;
  count: number;
  streaks: Streaks;
  week: WeekDay[];
  words: readonly SavedWord[];
  /** The Words tab — where the next city is. */
  onWords?: () => void;
  onFeed: () => void;
}) {
  /**
   * THE BUTTON IS THE NEXT CITY, NOT A REVIEW PILE (Radek, 2026-10-02:
   * "Review 151 words" — "throw the user back into the words ... like x
   * words to the y city"). A goal a few words away, and the place to go
   * and do it.
   */
  const pos = useMemo(() => tripPosition(withLevelKnown(words, storage.getLevelKnownWords()).words), [words]);
  const toNext = Math.max(1, STAGE_SIZE - pos.learnedHere);
  const nextCity = tripStop(pos.stage + 1).city;
  const tripLabel = `${toNext} ${toNext === 1 ? 'word' : 'words'} to ${nextCity}`;
  const goal = plan.wordsPerDay;
  const done = count >= goal;
  const remaining = Math.max(0, goal - count);
  const alive = streaks.current > 0;
  const practised = week.filter((d) => d.active).length;
  const frozenThisWeek = week.some((d) => d.frozen);

  const line = done
    ? count > goal
      ? `Día hecho. ${count} right today, everything past ${goal} is a bonus.`
      : `Día hecho. ${count} right today, anything more is a bonus.`
    : `${count} of ${goal} words today. ${remaining} more and the day is done.`;

  return (
    <View style={styles.section}>
      <View style={styles.hero}>
        <Image source={BRAND.parrot} resizeMode="contain" style={styles.heroLoro} />
        <View style={styles.heroText}>
          <Text style={styles.heroKicker}>{alive ? 'YOUR STREAK' : 'TODAY'}</Text>
          <Text style={styles.heroNumber}>
            {alive ? streaks.current : 'Día 1'}
            {alive && <Text style={styles.heroUnit}> {streaks.current === 1 ? 'day' : 'days'} in a row</Text>}
          </Text>
          <Text style={styles.heroSub}>
            {alive
              ? `Longest ${streaks.longest}. ${frozenThisWeek ? 'Freeze used this week.' : streaks.freezeAvailable ? 'Freeze ready.' : 'Freeze back next week.'}`
              : "Finish today's goal to start a streak."}
          </Text>
        </View>
      </View>

      <View
        style={styles.week}
        accessibilityRole="image"
        accessibilityLabel={`This week: practised on ${week.filter((d) => d.active).map((d) => d.label).join(', ') || 'no days yet'}. ${count} of ${goal} words today.`}
      >
        {week.map((day) => (
          <DayCoin key={day.key} day={day} goalShare={Math.min(1, count / Math.max(1, goal))} />
        ))}
      </View>
      <Text style={styles.weekNote}>
        {practised >= plan.daysPerWeek
          ? `${practised} ${practised === 1 ? 'day' : 'days'} this week, plan done`
          : `${practised} of ${plan.daysPerWeek} days this week${plan.paceLabel ? `, ${plan.paceLabel}` : ''}`}
      </Text>

      <Text style={[styles.goalLine, done && styles.goalLineDone]}>{line}</Text>
      <Pressable
        onPress={onWords ?? onFeed}
        accessibilityRole="button"
        accessibilityHint={onWords ? 'Opens your trip in Words' : 'Opens the feed'}
        style={({ pressed }) => [done ? styles.ctaQuiet : styles.cta, pressed && styles.pressed]}
      >
        <Text style={done ? styles.ctaQuietText : styles.ctaText}>{tripLabel}</Text>
      </Pressable>
    </View>
  );
}

// --------------------------------------------------------------- PASSPORT

/** The trip's countries in order, each with the stage of its first city. */
const COUNTRY_ORDER: { country: string; first: number }[] = (() => {
  const out: { country: string; first: number }[] = [];
  TRIP.forEach((t, i) => {
    if (!out.some((c) => c.country === t.country)) out.push({ country: t.country, first: i });
  });
  return out;
})();

function shortDay(ms: number): string {
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** A passport stamp: two rings in the flag's colour, the flag, the date. */
function Stamp({ country, at, size, tilt }: { country: string; at: number | null; size: number; tilt: number }) {
  const reached = at !== null;
  const info = COUNTRIES[country];
  const [a] = flagColours(country);
  const r = size / 2 - 2;
  return (
    <View style={[styles.stamp, { width: size }]}>
      <View style={{ height: size, transform: [{ rotate: `${reached ? tilt : 0}deg` }], width: size }}>
        <Svg width={size} height={size}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill={reached ? 'rgba(242,245,243,0.04)' : 'none'}
            stroke={reached ? a : 'rgba(242,245,243,0.14)'}
            strokeWidth={reached ? 2 : 1.2}
            strokeDasharray={reached ? undefined : '3 4'}
          />
          {reached && (
            <Circle cx={size / 2} cy={size / 2} r={r - 5} fill="none" stroke={a} strokeOpacity={0.55} strokeWidth={1} strokeDasharray="2 3" />
          )}
        </Svg>
        <View style={styles.stampInner}>
          {reached && info ? (
            <>
              <Flag spec={info.flag} height={15} />
              <Text style={[styles.stampDate, { color: a }]}>{shortDay(at!)}</Text>
            </>
          ) : (
            <Text style={styles.stampUnknown}>?</Text>
          )}
        </View>
      </View>
      <Text style={[styles.stampName, reached && styles.stampNameReached]} numberOfLines={1} adjustsFontSizeToFit>
        {country}
      </Text>
    </View>
  );
}

export function PassportSection({ words, onOpen }: { words: readonly SavedWord[]; onOpen?: () => void }) {
  const { width } = useWindowDimensions();
  const trip = useMemo(() => withLevelKnown(words, storage.getLevelKnownWords()).words, [words]);
  const pos = useMemo(() => tripPosition(trip), [trip]);
  const arrivals = useMemo(() => cityArrivals(trip), [trip]);
  const stop = tripStop(pos.stage);
  const next = tripStop(pos.stage + 1);
  const info = COUNTRIES[stop.country];
  // Past Caracas every country has been reached; the stamps keep their first dates.
  const stampAt = (first: number): number | null =>
    first <= pos.stage ? (arrivals[first] ?? arrivals[arrivals.length - 1] ?? Date.now()) : null;
  const reachedCount = COUNTRY_ORDER.filter((c) => c.first <= pos.stage).length;
  const size = Math.min(78, Math.floor((width - 32 - 3 * 14) / 4));

  return (
    <View style={styles.section}>
      <Heading right={`${reachedCount} of ${COUNTRY_ORDER.length} countries`}>PASSPORT</Heading>
      <Pressable
        onPress={onOpen}
        disabled={!onOpen}
        accessibilityRole="button"
        accessibilityLabel={`You're in ${stop.label}. ${pos.learnedHere} of ${STAGE_SIZE} words to ${next.city}.`}
        accessibilityHint="Opens your trip in Words"
        style={({ pressed }) => [styles.here, pressed && styles.pressed]}
      >
        <View style={styles.hereTop}>
          {info && <Flag spec={info.flag} height={22} />}
          <View style={styles.hereText}>
            <Text style={styles.hereKicker}>YOU'RE IN</Text>
            <Text style={styles.hereCity} numberOfLines={1} adjustsFontSizeToFit>
              {stop.label}
            </Text>
          </View>
          {onOpen && <Text style={styles.chevron}>›</Text>}
        </View>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.max(3, (pos.learnedHere / STAGE_SIZE) * 100)}%` }]} />
        </View>
        <Text style={styles.hereNext}>
          {pos.learnedHere} of {STAGE_SIZE} to {next.city}
        </Text>
      </Pressable>

      <View style={styles.stamps}>
        {COUNTRY_ORDER.map((c, i) => (
          <Stamp key={c.country} country={c.country} at={stampAt(c.first)} size={size} tilt={((i * 37) % 13) - 6} />
        ))}
      </View>
    </View>
  );
}

// -------------------------------------------------------------- THIS WEEK

export function LearnedSection({
  week,
  onTheWay,
  allTime,
  onSeeAll,
}: {
  week: SavedWord[];
  onTheWay: number;
  allTime: number;
  onSeeAll?: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const { content, small } = splitFunctionWords(week);
  const ordered = [...content, ...small];
  const shown = showAll ? ordered : ordered.slice(0, LEARNED_PREVIEW);
  const hidden = ordered.length - shown.length;

  return (
    <View style={styles.section}>
      <Heading right={`${allTime} all time`}>LEARNED THIS WEEK</Heading>
      {week.length === 0 ? (
        <Text style={styles.body}>
          Nothing yet this week. Train a word in Words and it lands here.
          {onTheWay > 0 ? ` ${onTheWay} on the way.` : ''}
        </Text>
      ) : (
        <>
          <Text style={styles.bigLine}>
            {week.length}
            <Text style={styles.bigUnit}> {week.length === 1 ? 'word' : 'words'}</Text>
          </Text>
          <Text style={styles.wordsLine}>
            {shown.map((w) => cleanWord(w.text)).join(' · ')}
            {hidden > 0 && (
              <Text style={styles.more} onPress={() => setShowAll(true)} accessibilityRole="button">
                {'  '}+{hidden} more
              </Text>
            )}
          </Text>
          {onTheWay > 0 && <Text style={styles.faintLine}>{onTheWay} more on the way</Text>}
        </>
      )}
      {onSeeAll && allTime > 0 && (
        <Pressable onPress={onSeeAll} accessibilityRole="button" hitSlop={8} style={({ pressed }) => pressed && styles.pressed}>
          <Text style={styles.link}>See all {allTime} learned words ›</Text>
        </Pressable>
      )}
    </View>
  );
}

// ------------------------------------------------------------------ LEVEL

export function LevelRoad({ learned }: { learned: number }) {
  const { tier, next, have, need, meter } = tierForLearned(learned);
  const left = Math.max(0, need - have);
  return (
    <View style={styles.section}>
      <Heading>LEVEL</Heading>
      <View style={styles.road}>
        {/* ONE track behind all six, not a link per rung: a link drawn by
            rung i sat ON TOP of rung i-1 (later siblings paint over earlier
            ones) and cut through its number. The mint runs from the first
            rung to yours, and on toward the next as the words come. */}
        <View pointerEvents="none" style={[styles.roadTrack, { left: `${50 / TIERS.length}%`, right: `${50 / TIERS.length}%` }]} />
        <View
          pointerEvents="none"
          style={[
            styles.roadTrackOn,
            {
              left: `${50 / TIERS.length}%`,
              width: `${((tier.level - 1 + (next ? meter / 100 : 0)) * 100) / TIERS.length}%`,
            },
          ]}
        />
        {TIERS.map((t, i) => {
          const held = t.level < tier.level;
          const here = t.level === tier.level;
          return (
            <View key={t.level} style={styles.rung}>
              {here && <Image source={BRAND.parrot} resizeMode="contain" style={styles.roadLoro} />}
              <View style={[styles.rungDot, held && styles.rungDotHeld, here && styles.rungDotHere]}>
                <Text style={[styles.rungNum, (held || here) && styles.rungNumOn]}>{t.level}</Text>
              </View>
              <Text style={[styles.rungName, here && styles.rungNameHere]} numberOfLines={2}>
                {t.name}
              </Text>
              <Text style={styles.rungNeed}>{TIER_LEARNED[i]}</Text>
            </View>
          );
        })}
      </View>
      <Text style={styles.levelName}>
        {tier.name}
        <Text style={styles.levelMeaning}>  {tier.meaning}</Text>
      </Text>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.max(3, meter)}%` }]} />
      </View>
      <Text style={styles.hereNext}>
        {next ? `${left} more ${left === 1 ? 'word' : 'words'} to ${next.name}` : `The top of the ladder, ${have} words learned`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 38 },
  heading: { alignItems: 'baseline', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  headingText: { color: MINT, fontSize: 11, fontWeight: '900', letterSpacing: 1.6 },
  headingRight: { color: FAINT, fontSize: 12, fontWeight: '700' },
  pressed: { opacity: 0.7 },

  hero: { alignItems: 'center', flexDirection: 'row', gap: 14, marginBottom: 20 },
  heroLoro: { height: 84, width: 58 },
  heroText: { flex: 1 },
  heroKicker: { color: MINT, fontSize: 11, fontWeight: '900', letterSpacing: 1.6 },
  heroNumber: { color: INK, fontSize: 46, fontVariant: ['tabular-nums'], fontWeight: '900', letterSpacing: -1, lineHeight: 52 },
  heroUnit: { color: MUTED, fontSize: 17, fontWeight: '800', letterSpacing: 0 },
  heroSub: { color: MUTED, fontSize: 13, fontWeight: '600', marginTop: 2 },

  week: { flexDirection: 'row', justifyContent: 'space-between' },
  day: { alignItems: 'center', width: RING },
  coinWrap: { alignItems: 'center', height: RING, justifyContent: 'center', width: RING },
  ring: { left: 0, position: 'absolute', top: 0 },
  coinLip: { borderRadius: 999, height: COIN, position: 'absolute', top: (RING - COIN) / 2 + 3, width: COIN },
  coinFace: { alignItems: 'center', borderRadius: 999, height: COIN, justifyContent: 'center', width: COIN },
  coinFuture: { borderColor: 'rgba(242,245,243,0.12)', borderStyle: 'dashed', borderWidth: 1.5 },
  coinTick: { color: '#06130d', fontSize: 15, fontWeight: '900' },
  dayLabel: { color: FAINT, fontSize: 11, fontWeight: '800', marginTop: 4 },
  dayLabelToday: { color: INK },
  weekNote: { color: FAINT, fontSize: 12, fontWeight: '700', marginTop: 8, textAlign: 'center' },
  goalLine: { color: 'rgba(242,245,243,0.8)', fontSize: 15, fontWeight: '700', lineHeight: 21, marginTop: 18 },
  goalLineDone: { color: MINT },
  cta: { alignItems: 'center', backgroundColor: MINT, borderRadius: 16, marginTop: 14, paddingVertical: 14 },
  ctaText: { color: '#06130d', fontSize: 16, fontWeight: '900' },
  ctaQuiet: {
    alignItems: 'center',
    borderColor: 'rgba(94,230,168,0.35)',
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 14,
    paddingVertical: 12,
  },
  ctaQuietText: { color: MINT, fontSize: 15, fontWeight: '800' },

  here: { marginBottom: 20 },
  hereTop: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  hereText: { flex: 1 },
  hereKicker: { color: FAINT, fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
  hereCity: { color: INK, fontSize: 26, fontWeight: '900', letterSpacing: -0.4 },
  chevron: { color: FAINT, fontSize: 28, fontWeight: '300' },
  track: { backgroundColor: 'rgba(242,245,243,0.08)', borderRadius: 999, height: 8, marginTop: 12, overflow: 'hidden' },
  fill: { backgroundColor: MINT, borderRadius: 999, height: '100%' },
  hereNext: { color: MUTED, fontSize: 13, fontWeight: '700', marginTop: 8 },
  stamps: { columnGap: 14, flexDirection: 'row', flexWrap: 'wrap', rowGap: 16 },
  stamp: { alignItems: 'center' },
  stampInner: { alignItems: 'center', bottom: 0, justifyContent: 'center', left: 0, position: 'absolute', right: 0, top: 0 },
  stampDate: { fontSize: 9, fontWeight: '900', letterSpacing: 0.4, marginTop: 4, textTransform: 'uppercase' },
  stampUnknown: { color: 'rgba(242,245,243,0.18)', fontSize: 18, fontWeight: '900' },
  stampName: { color: 'rgba(242,245,243,0.25)', fontSize: 10, fontWeight: '800', marginTop: 5, maxWidth: '100%' },
  stampNameReached: { color: MUTED },

  body: { color: MUTED, fontSize: 14, lineHeight: 20 },
  bigLine: { color: INK, fontSize: 34, fontVariant: ['tabular-nums'], fontWeight: '900' },
  bigUnit: { color: MUTED, fontSize: 16, fontWeight: '800' },
  wordsLine: { color: MINT, fontSize: 16, fontWeight: '800', lineHeight: 25, marginTop: 6 },
  more: { color: FAINT, fontSize: 14, fontWeight: '800' },
  faintLine: { color: FAINT, fontSize: 13, fontWeight: '700', marginTop: 8 },
  link: { color: MINT, fontSize: 14, fontWeight: '800', marginTop: 12 },

  road: { flexDirection: 'row', marginBottom: 18, marginTop: 26 },
  rung: { alignItems: 'center', flex: 1 },
  roadTrack: { backgroundColor: 'rgba(242,245,243,0.12)', borderRadius: 2, height: 4, position: 'absolute', top: 13 },
  roadTrackOn: { backgroundColor: MINT, borderRadius: 2, height: 4, position: 'absolute', top: 13 },
  roadLoro: { height: 34, position: 'absolute', top: -34, width: 24 },
  rungDot: {
    alignItems: 'center',
    backgroundColor: '#1b2320',
    borderColor: 'rgba(242,245,243,0.18)',
    borderRadius: 999,
    borderWidth: 2,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  rungDotHeld: { backgroundColor: MINT, borderColor: MINT },
  rungDotHere: { backgroundColor: INK, borderColor: MINT, borderWidth: 3 },
  rungNum: { color: FAINT, fontSize: 12, fontWeight: '900' },
  rungNumOn: { color: '#06130d' },
  rungName: { color: FAINT, fontSize: 10, fontWeight: '800', lineHeight: 12, marginTop: 6, textAlign: 'center' },
  rungNameHere: { color: INK },
  rungNeed: { color: 'rgba(242,245,243,0.22)', fontSize: 9, fontWeight: '700', marginTop: 2 },
  levelName: { color: INK, fontSize: 22, fontWeight: '900' },
  levelMeaning: { color: MUTED, fontSize: 13, fontWeight: '700' },
});
