import React from 'react';
import { Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SPINNER } from '@/lib/animations';
import { font, rgb } from '@/theme';
import { CTA, CTA_TEXT, PathIcon, Pill, fadeUp } from './shared';

/** Generation state of one question set, as reported by the caller's hook. */
export type SetStatus = 'idle' | 'loading' | 'ready' | 'error';

const ENTER = fadeUp(10, 340);
const WARNING_PATH = 'M12 8v5M12 16.5v.01M12 3l9 17H3z';

/**
 * Stands in for a question set that is still being written, or could not be.
 *
 * The failure path offers a retry rather than the hardcoded questions, on
 * purpose: the entire value of the set is that it was written for this child
 * from their profile, so generic questions would quietly produce a generic plan
 * while looking like they had worked.
 */
export default function SetGate({
  status,
  progress,
  onRetry,
  waiting,
}: {
  status: SetStatus;
  progress: string;
  onRetry: () => void;
  waiting: string;
}) {
  const failed = status === 'error';
  return (
    <Animated.View
      entering={ENTER}
      accessibilityLiveRegion="polite"
      style={{
        marginTop: 30,
        marginBottom: 14,
        alignItems: 'center',
        minHeight: 150,
      }}
    >
      {failed ? (
        <PathIcon
          d={WARNING_PATH}
          size={30}
          stroke={rgb('constellation-gold')}
          strokeWidth={1.7}
        />
      ) : (
        <Animated.View
          accessibilityRole="progressbar"
          accessibilityLabel="Loading"
          style={[
            {
              width: 34,
              height: 34,
              borderRadius: 17,
              borderWidth: 2,
              borderColor: rgb('constellation-cyan', 0.28),
              borderTopColor: rgb('constellation-cyan'),
            },
            SPINNER,
          ]}
        />
      )}
      <Text
        style={[
          font('orbitron', 500),
          {
            marginTop: 16,
            fontSize: 15.5,
            lineHeight: 15.5 * 1.45,
            textAlign: 'center',
            color: rgb('constellation-cyan-pale'),
          },
        ]}
      >
        {failed ? 'We couldn’t write these questions just now.' : waiting}
      </Text>
      <View style={{ marginTop: 9, maxWidth: 400, minHeight: 20 }}>
        <Text
          style={{
            fontSize: 13.5,
            fontWeight: '600',
            textAlign: 'center',
            color: rgb('constellation-slate-dark'),
          }}
        >
          {failed ? 'Nothing has been lost — give it another go.' : progress}
        </Text>
      </View>
      {failed && (
        <Pill
          label="Try again"
          onPress={onRetry}
          textColor={CTA_TEXT}
          style={[
            CTA,
            { marginTop: 20, paddingVertical: 11, paddingHorizontal: 28 },
          ]}
        />
      )}
    </Animated.View>
  );
}
