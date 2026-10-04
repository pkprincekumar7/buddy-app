import React from 'react';
import { Text, View } from 'react-native';
import { Pressable } from '@/components/ui/pressable';
import Animated from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import { css, rgb } from '@/theme';
import {
  caps,
  cfs,
  openExternal,
  orb,
  rj,
  type AccomplishmentItem,
} from './shared';
import { CARD_PREVIEW_SHADOW, ROW_ACTIVE_FROM, ROW_ACTIVE_TO } from './palette';

const CARD_BG = css(
  'linear-gradient(165deg,rgb(var(--constellation-panel-a-rgb)),rgb(var(--constellation-panel-deep-rgb)))',
);
const GOLD = rgb('constellation-gold');
const DOT_GLOW = css('0 0 12px rgb(var(--constellation-gold-rgb))');
const CONSTELLATION_POINTS: [number, number, number][] = [
  [32, 286, 3],
  [100, 234, 3],
  [160, 260, 3],
  [222, 198, 3],
  [286, 224, 3],
  [330, 168, 4.5],
];

export function AccomplishmentCardPreview({
  kind,
  title,
  caption,
  date,
  childName,
  childAge,
  inviteUrl,
}: {
  kind: string;
  title: string;
  caption: string;
  date: string;
  childName: string;
  childAge: string;
  inviteUrl: string;
}) {
  return (
    // Shadow on an outer wrapper so the inner overflow clip can't swallow it.
    <View
      style={{
        borderRadius: 24,
        boxShadow: `0 30px 80px ${CARD_PREVIEW_SHADOW}`,
      }}
    >
      <View
        style={{
          position: 'relative',
          borderRadius: 24,
          overflow: 'hidden',
          aspectRatio: 4 / 5,
          experimental_backgroundImage: CARD_BG,
          borderWidth: 1,
          borderColor: rgb('constellation-gold', 0.38),
        }}
      >
        <Svg
          viewBox="0 0 360 450"
          preserveAspectRatio="none"
          width="100%"
          height="100%"
          style={{ position: 'absolute', top: 0, left: 0, opacity: 0.5 }}
        >
          <Path
            d="M32 286 L100 234 L160 260 L222 198 L286 224 L330 168"
            fill="none"
            stroke={rgb('constellation-gold', 0.35)}
            strokeWidth={1}
          />
          {CONSTELLATION_POINTS.map(([cx, cy, r]) => (
            <Circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill={GOLD} />
          ))}
        </Svg>
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            padding: 28,
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <View
              style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}
            >
              <View
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 4.5,
                  backgroundColor: GOLD,
                  boxShadow: DOT_GLOW,
                }}
              />
              <Text style={[rj.bold, caps(cfs(10), 0.24), { color: GOLD }]}>
                {kind}
              </Text>
            </View>
            <Text
              style={[
                rj.bold,
                caps(cfs(10), 0.16),
                { color: rgb('constellation-slate-mid') },
              ]}
            >
              {date}
            </Text>
          </View>
          <View>
            <Text
              style={[
                rj.bold,
                caps(cfs(12), 0.2),
                { color: rgb('constellation-slate-mid') },
              ]}
            >
              {childName}
              {childAge ? ` · Age ${childAge}` : ''}
            </Text>
            <Text
              style={[
                orb.black,
                {
                  marginTop: 10,
                  fontSize: cfs(26),
                  lineHeight: 26 * 1.16,
                  color: rgb('constellation-cyan-palest'),
                },
              ]}
            >
              {title}
            </Text>
            <Text
              style={[
                rj.semibold,
                {
                  marginTop: 12,
                  fontSize: cfs(15.5),
                  lineHeight: 15.5 * 1.45,
                  color: rgb('constellation-caption'),
                },
              ]}
            >
              {caption}
            </Text>
          </View>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              paddingTop: 16,
              borderTopWidth: 1,
              borderTopColor: rgb('constellation-gold', 0.22),
            }}
          >
            <Text
              numberOfLines={1}
              style={[
                orb.black,
                {
                  flexShrink: 0,
                  fontSize: cfs(12),
                  letterSpacing: 12 * 0.14,
                  color: rgb('constellation-cyan-palest'),
                },
              ]}
            >
              SUPERPOWER
            </Text>
            {/* The invite URL is one long token — let it shrink and wrap so the
                join link is never clipped by the card. */}
            <Pressable
              onPress={() => openExternal(`https://${inviteUrl}`)}
              accessibilityRole="link"
              accessibilityLabel={`Join for free, ${inviteUrl}`}
              style={{ flexShrink: 1, minWidth: 0 }}
            >
              <Text
                style={[
                  rj.bold,
                  caps(cfs(9.5), 0.1),
                  { color: GOLD, textAlign: 'right', lineHeight: 9.5 * 1.35 },
                ]}
              >
                Join for free{'\n'}
                {inviteUrl}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

const ROW_ACTIVE_BG = `linear-gradient(150deg,${ROW_ACTIVE_FROM},${ROW_ACTIVE_TO})`;
const BADGE_BG = css(
  'linear-gradient(150deg,rgb(var(--constellation-badge-a-rgb)),rgb(var(--constellation-badge-b-rgb)))',
);

export function AccomplishmentRow({
  item,
  active,
  onPick,
}: {
  item: AccomplishmentItem;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <Pressable
      onPress={onPick}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}. ${item.caption}. ${item.when}`}
      accessibilityState={{ selected: active }}
    >
      <Animated.View
        style={{
          flexDirection: 'row',
          gap: 14,
          alignItems: 'center',
          borderRadius: 15,
          paddingVertical: 15,
          paddingHorizontal: 17,
          experimental_backgroundImage: active ? ROW_ACTIVE_BG : undefined,
          backgroundColor: active ? undefined : rgb('constellation-card', 0.6),
          borderWidth: 1,
          borderColor: active
            ? rgb('constellation-gold', 0.55)
            : rgb('constellation-cyan', 0.12),
          transitionProperty: ['borderColor', 'backgroundColor'],
          transitionDuration: 220,
        }}
      >
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 19,
            alignItems: 'center',
            justifyContent: 'center',
            experimental_backgroundImage: BADGE_BG,
            borderWidth: 1.5,
            borderColor: rgb('constellation-gold', 0.55),
          }}
        >
          <Svg
            viewBox="0 0 24 24"
            width={18}
            height={18}
            fill="none"
            stroke={GOLD}
            strokeWidth={1.8}
          >
            <Path d={item.icon} />
          </Svg>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            style={[
              rj.bold,
              { fontSize: cfs(15.5), color: rgb('constellation-cyan-pale') },
            ]}
          >
            {item.title}
          </Text>
          <Text
            style={[
              rj.semibold,
              {
                marginTop: 2,
                fontSize: cfs(13.5),
                color: rgb('constellation-slate-light'),
              },
            ]}
          >
            {item.caption}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Text
            numberOfLines={1}
            style={[
              rj.bold,
              caps(cfs(10), 0.16),
              { color: rgb('constellation-slate') },
            ]}
          >
            {item.when}
          </Text>
          <Animated.View
            style={{
              width: 14,
              height: 14,
              borderRadius: 7,
              borderWidth: 1.5,
              borderColor: active ? GOLD : rgb('constellation-ring-faint', 0.4),
              backgroundColor: active ? GOLD : 'transparent',
              transitionProperty: ['borderColor', 'backgroundColor'],
              transitionDuration: 200,
            }}
          />
        </View>
      </Animated.View>
    </Pressable>
  );
}
