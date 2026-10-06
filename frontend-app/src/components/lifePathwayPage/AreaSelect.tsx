import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Pressable } from '@/components/ui/pressable';
import Svg, { Path } from 'react-native-svg';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import type { GrowthArea } from '@/lib/growthAreaData';
import { css } from '@/theme';
import { LP_PALETTE } from './palette';
import { CYAN, em, rajdhani } from './styles';

const PILL_BG = css('rgb(var(--constellation-overlay-rgb) / .9)');
const PILL_BORDER = css('rgb(var(--constellation-cyan-rgb) / .34)');
const PILL_BORDER_ACTIVE = css('rgb(var(--constellation-cyan-rgb) / .7)');
const CYAN_PALE = css('rgb(var(--constellation-cyan-pale-rgb))');
const OPTION_ACTIVE_BG = css('rgb(var(--constellation-cyan-rgb) / .12)');
const SLATE = css('rgb(var(--constellation-slate-rgb))');

interface AreaSelectProps {
  label: string;
  options: { area: GrowthArea }[];
  selectedIdx: number;
  onSelect: (idx: number) => void;
}

/**
 * The web page's native `<select>` pill. RN has no select element, so the pill
 * opens a dialog listing the same options (the phone-browser equivalent is the
 * OS picker sheet).
 */
export default function AreaSelect({
  label,
  options,
  selectedIdx,
  onSelect,
}: AreaSelectProps) {
  const [open, setOpen] = useState(false);
  const current =
    options[Math.min(selectedIdx, Math.max(0, options.length - 1))]?.area
      .name ?? '';

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: current }}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 10,
          paddingLeft: 16,
          paddingRight: 40,
          borderRadius: 999,
          backgroundColor: PILL_BG,
          borderWidth: 1,
          borderColor: pressed || open ? PILL_BORDER_ACTIVE : PILL_BORDER,
        })}
      >
        <Text
          style={[
            rajdhani(14, 700),
            { letterSpacing: em(14, 0.04), color: CYAN_PALE },
          ]}
        >
          {current}
        </Text>
        <View pointerEvents="none" style={{ position: 'absolute', right: 15 }}>
          <Svg
            width={13}
            height={13}
            viewBox="0 0 24 24"
            fill="none"
            stroke={CYAN}
            strokeWidth={2.4}
          >
            <Path d="M6 9l6 6 6-6" />
          </Svg>
        </View>
      </Pressable>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          hideClose
          style={{
            backgroundColor: LP_PALETTE.optionBg,
            borderColor: PILL_BORDER,
            borderRadius: 16,
            padding: 12,
            boxShadow: css(
              '0 30px 90px rgb(var(--constellation-void-deep-rgb) / .7)',
            ),
          }}
        >
          <DialogTitle
            style={[
              rajdhani(10.5, 700),
              {
                letterSpacing: em(10.5, 0.2),
                textTransform: 'uppercase',
                color: SLATE,
                paddingVertical: 6,
              },
            ]}
          >
            {label}
          </DialogTitle>
          <View style={{ gap: 4 }}>
            {options.map(({ area }, i) => {
              const on = i === selectedIdx;
              return (
                <Pressable
                  key={area.id}
                  accessibilityRole="button"
                  accessibilityLabel={area.name}
                  accessibilityState={{ selected: on }}
                  onPress={() => {
                    onSelect(i);
                    setOpen(false);
                  }}
                  style={{
                    paddingVertical: 12,
                    paddingHorizontal: 16,
                    borderRadius: 10,
                    backgroundColor: on ? OPTION_ACTIVE_BG : 'transparent',
                  }}
                >
                  <Text
                    style={[
                      rajdhani(15, 700),
                      { letterSpacing: em(15, 0.04), color: CYAN_PALE },
                    ]}
                  >
                    {area.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </DialogContent>
      </Dialog>
    </>
  );
}
