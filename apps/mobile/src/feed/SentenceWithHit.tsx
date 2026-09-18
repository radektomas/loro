import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';

/**
 * A spoken sentence with the word in question lit up. Radek, 2026-09-18:
 * "the word currently picked should be green or glowing somehow, so it's
 * visible which word the user is thinking about and where it is in the
 * example sentence." Both word sheets render their sentences through this:
 * the feed's sheet lights the tapped word, the Words tab's sheet lights the
 * saved word wherever an example says it.
 */
export function SentenceWithHit({
  words,
  isHit,
  style,
}: {
  words: readonly { text: string }[];
  isHit: (word: { text: string }, index: number) => boolean;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text style={style}>
      {words.map((word, i) => (
        <Text key={i}>
          {i > 0 ? ' ' : ''}
          <Text style={isHit(word, i) ? styles.hit : undefined}>{word.text}</Text>
        </Text>
      ))}
    </Text>
  );
}

const styles = StyleSheet.create({
  hit: {
    color: '#5ee6a8',
    fontWeight: '800',
    textShadowColor: 'rgba(94,230,168,0.55)',
    textShadowOffset: { height: 0, width: 0 },
    textShadowRadius: 10,
  },
});
