import { StyleSheet, View } from 'react-native';

/**
 * A speaker, drawn from Views — the same reasoning as TabIcons: no icon
 * library (react-native-svg is a native module and not in the binary), and
 * the emoji speakers 🔇/🔊 the band used to show come from the system emoji
 * font, in full colour, at whatever weight Apple drew them — a sticker
 * next to type. This is a glyph: one colour, 2px strokes, crisp at any
 * density.
 *
 * ON:  a body (small rect + cone) and two sound waves, arcs to the right.
 * OFF: the same body and a slash across it.
 */
export function SoundIcon({
  on,
  color,
  size = 14,
}: {
  on: boolean;
  color: string;
  size?: number;
}) {
  const u = size / 14; // everything below is drawn on a 14pt grid
  return (
    <View style={[styles.box, { height: 14 * u, width: 16 * u }]}>
      {/* the body: a rect for the driver, a cone opening to the right */}
      <View
        style={[
          styles.rect,
          { backgroundColor: color, height: 6 * u, width: 3.5 * u, left: 0, top: 4 * u },
        ]}
      />
      <View
        style={[
          styles.cone,
          {
            borderRightColor: color,
            borderRightWidth: 5 * u,
            borderTopWidth: 6.5 * u,
            borderBottomWidth: 6.5 * u,
            left: 3.5 * u,
            top: 0.5 * u,
          },
        ]}
      />
      {on ? (
        <>
          <View
            style={[
              styles.wave,
              { borderRightColor: color, borderWidth: 1.6 * u, height: 6 * u, width: 3.5 * u, left: 9.6 * u, top: 4 * u, borderRadius: 4 * u },
            ]}
          />
          <View
            style={[
              styles.wave,
              { borderRightColor: color, borderWidth: 1.6 * u, height: 11 * u, width: 6 * u, left: 10.4 * u, top: 1.5 * u, borderRadius: 7 * u },
            ]}
          />
        </>
      ) : (
        <View
          style={[
            styles.slash,
            { backgroundColor: color, height: 1.8 * u, width: 15 * u, left: 0.5 * u, top: 6 * u },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { position: 'relative' },
  rect: { borderRadius: 1, position: 'absolute' },
  cone: {
    borderBottomColor: 'transparent',
    borderTopColor: 'transparent',
    height: 0,
    position: 'absolute',
    width: 0,
  },
  /** An arc: a bordered box showing only its right edge. */
  wave: {
    borderBottomColor: 'transparent',
    borderLeftColor: 'transparent',
    borderTopColor: 'transparent',
    position: 'absolute',
  },
  slash: { borderRadius: 999, position: 'absolute', transform: [{ rotate: '-40deg' }] },
});
