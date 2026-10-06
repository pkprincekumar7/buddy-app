import React from 'react';
import { Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { fillTemplate } from '@/lib/growthAreaData';
import { font, rgb } from '@/theme';
import { ShieldIcon } from './Icons';
import { NEXT_STEPS } from './protocol';
import { SECTION_LABEL, bodyText, fadeUp } from './styles';

/** "What you can do with this" — the three next-step cards and the privacy note. */
export default function NextSteps({
  childName,
  childGender,
}: {
  childName: string;
  childGender: string;
}) {
  return (
    <Animated.View {...fadeUp(0.32)} style={{ marginTop: 44 }}>
      <Text accessibilityRole="header" style={SECTION_LABEL}>
        What you can do with this
      </Text>
      <View style={{ gap: 14, marginTop: 16 }}>
        {NEXT_STEPS.map(next => (
          <View
            key={next.title}
            style={{
              borderRadius: 16,
              paddingVertical: 19,
              paddingHorizontal: 20,
              backgroundColor: rgb('constellation-card', 0.6),
              borderWidth: 1,
              borderColor: rgb('constellation-cyan', 0.12),
            }}
          >
            <Text
              style={{
                ...font('rajdhani', 700),
                fontSize: 15.5,
                color: rgb('constellation-cyan-pale'),
              }}
            >
              {fillTemplate(next.title, childName, childGender)}
            </Text>
            <Text
              style={[
                bodyText(14, 1.5, 'constellation-slate-light'),
                { marginTop: 7 },
              ]}
            >
              {fillTemplate(next.body, childName, childGender)}
            </Text>
          </View>
        ))}
      </View>
      <View
        className="flex-row items-start"
        style={{ marginTop: 20, gap: 9, maxWidth: 760 }}
      >
        <ShieldIcon />
        <Text style={[bodyText(13, 1.5, 'constellation-slate'), { flex: 1 }]}>
          Notes stay in your account and are never shared unless you share them.
          Superpower records what you notice. It draws no conclusions and labels
          nothing.
        </Text>
      </View>
    </Animated.View>
  );
}
