import { StyleSheet, View } from 'react-native';

/**
 * Tab-bar icons, drawn from plain Views.
 *
 * NO ICON LIBRARY, AND NOT BY PREFERENCE. react-native-svg is not a dependency
 * of this app, and it is a NATIVE module — so even if it were present in
 * node_modules it would not be in the EAS binary, and importing it would crash
 * rather than render. Every other option (vector-icons, lucide-react-native)
 * lands on react-native-svg too. Views cost nothing, need no rebuild, and are
 * crisp at any density because they are real layers rather than a font glyph.
 *
 * The previous glyphs (▶ ◆ ▲) were Unicode characters, which is why they looked
 * mismatched: each comes from a different part of the font with its own weight,
 * baseline and optical size, and none of that is controllable.
 *
 * ONE GRID FOR ALL THREE: an 18×18 box, 2px strokes, same corner radius. That
 * shared geometry is what makes them read as a set.
 */

const BOX = 18;
const STROKE = 2;

/** Feed — a play mark inside a rounded frame: "video". */
export function FeedIcon({ color, active }: { color: string; active: boolean }) {
  return (
    <View style={styles.box}>
      <View
        style={[
          styles.frame,
          { borderColor: color, borderWidth: active ? STROKE : 1.5 },
        ]}
      >
        {/* A triangle from borders — the standard zero-width/zero-height
            trick. Nudged right by 1px because a triangle's optical centre sits
            left of its bounding box. */}
        <View style={[styles.play, { borderLeftColor: color }]} />
      </View>
    </View>
  );
}

/** Words — three stacked lines of uneven length: a list of saved words. */
export function WordsIcon({ color, active }: { color: string; active: boolean }) {
  const h = active ? STROKE : 1.5;
  return (
    <View style={[styles.box, styles.stack]}>
      <View style={[styles.line, { backgroundColor: color, height: h, width: 16 }]} />
      <View style={[styles.line, { backgroundColor: color, height: h, width: 11 }]} />
      <View style={[styles.line, { backgroundColor: color, height: h, width: 14 }]} />
    </View>
  );
}

/** Progress — three rising bars. Reads as "climbing", which is the tier ladder. */
export function ProgressIcon({ color, active }: { color: string; active: boolean }) {
  const w = active ? 4 : 3;
  return (
    <View style={[styles.box, styles.bars]}>
      <View style={[styles.bar, { backgroundColor: color, height: 7, width: w }]} />
      <View style={[styles.bar, { backgroundColor: color, height: 12, width: w }]} />
      <View style={[styles.bar, { backgroundColor: color, height: 17, width: w }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    height: BOX,
    justifyContent: 'center',
    width: BOX,
  },
  frame: {
    alignItems: 'center',
    borderRadius: 5,
    height: BOX,
    justifyContent: 'center',
    width: BOX,
  },
  play: {
    borderBottomColor: 'transparent',
    borderBottomWidth: 3.5,
    borderLeftWidth: 6,
    borderTopColor: 'transparent',
    borderTopWidth: 3.5,
    height: 0,
    marginLeft: 2,
    width: 0,
  },
  stack: { gap: 3, justifyContent: 'center' },
  line: { borderRadius: 999 },
  bars: { alignItems: 'flex-end', flexDirection: 'row', gap: 3 },
  bar: { borderRadius: 999 },
});
