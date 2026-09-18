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

/**
 * THE TRANSLATION, WITH THE ENGLISH WORD LIT TOO (Radek: "also show the
 * translated word in the English glowing the same way"). A gloss is a
 * string like "beach" or "to go, to leave" and the sentence translation is
 * free text, so this is a best-effort match: the whole gloss first, then
 * each comma/slash alternative, then the first word of each — whole words,
 * case-insensitive. Every occurrence of the first needle that matches is
 * lit; when nothing matches the line is plain, never wrong.
 */
export function TranslationWithHit({
  text,
  gloss,
  style,
}: {
  text: string;
  /** The word's translation or gloss; null lights nothing. */
  gloss: string | null;
  style?: StyleProp<TextStyle>;
}) {
  const match = gloss ? findNeedle(text, gloss) : null;
  if (!match) return <Text style={style}>{text}</Text>;
  const parts: { text: string; hit: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(match)) {
    // Group 1 is the boundary character (or nothing); group 2 the word.
    const at = (m.index ?? 0) + m[1].length;
    if (at > last) parts.push({ text: text.slice(last, at), hit: false });
    parts.push({ text: m[2], hit: true });
    last = at + m[2].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), hit: false });
  return (
    <Text style={style}>
      {parts.map((p, i) => (
        <Text key={i} style={p.hit ? styles.hit : undefined}>
          {p.text}
        </Text>
      ))}
    </Text>
  );
}

function findNeedle(text: string, gloss: string): RegExp | null {
  const alternatives = gloss
    .split(/[,;/]|\bor\b/)
    .map((s) => s.trim().replace(/^(to|a|an|the)\s+/i, ''))
    .filter(Boolean);
  const candidates = [
    ...alternatives,
    ...alternatives.map((s) => s.split(/\s+/)[0]).filter((s) => s.length > 2),
  ];
  for (const c of candidates) {
    const escaped = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // No lookbehind (Hermes): the boundary is captured and skipped by the caller.
    const re = new RegExp(`(^|[^\\p{L}])(${escaped})(?![\\p{L}])`, 'giu');
    if (re.test(text)) return new RegExp(re.source, 'giu');
  }
  return null;
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
