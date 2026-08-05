import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Video } from '@loro/core/types';

/**
 * The attribution line, ported from components/Feed.tsx's AuthorLine.
 *
 * NOT COSMETIC — an embed-terms requirement. For a 'youtube' author the channel
 * name must link OUT to the channel (never to an internal Loro profile), the
 * licence chip and the watch link travel with it, and the whole line stays
 * visible. docs/rn-port-map.md §5c: "This must be preserved in RN."
 *
 * The web's shape is kept exactly: ONE switch over the author union with EVERY
 * case rendering something, so no slide can end up with a blank attribution and
 * no case is reachable through a null check on an optional field. The
 * data-shape backstop is kept too — `author` is required on Video, but a cast
 * around a raw JSON import once produced authorless videos and crashed this
 * component for every onboarding user.
 *
 * In the live catalog this is the common path, not an edge case: 203 of 208
 * embeds are CC BY, 5 are standard YouTube licence.
 */
export function AuthorLine({ video }: { video: Video }) {
  const author = video.author;
  if (!author) return null;

  if (author.kind === 'youtube') {
    return (
      <View style={styles.row}>
        <Pressable onPress={() => void Linking.openURL(author.channelUrl)}>
          <Text style={styles.channel}>{author.channelTitle}</Text>
        </Pressable>
        {author.license === 'creativeCommon' && (
          <Pressable
            onPress={() =>
              void Linking.openURL('https://creativecommons.org/licenses/by/3.0/')
            }
          >
            <Text style={styles.chip}>CC BY</Text>
          </Pressable>
        )}
        <Pressable onPress={() => void Linking.openURL(author.videoUrl)}>
          <Text style={styles.watch}>YouTube ↗</Text>
        </Pressable>
      </View>
    );
  }

  if (author.kind === 'creator') {
    return (
      <View style={styles.row}>
        <Text style={styles.channel}>@{author.handle}</Text>
      </View>
    );
  }

  // 'none' — a seed clip. The name still shows; it just isn't a link.
  return (
    <View style={styles.row}>
      <Text style={styles.plain}>{video.creator}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  channel: {
    color: 'rgba(242,245,243,0.8)',
    fontSize: 14,
    fontWeight: '500',
    textDecorationLine: 'underline',
  },
  plain: { color: 'rgba(242,245,243,0.8)', fontSize: 14, fontWeight: '500' },
  chip: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 4,
    color: 'rgba(242,245,243,0.7)',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  watch: { color: 'rgba(242,245,243,0.5)', fontSize: 12 },
});
