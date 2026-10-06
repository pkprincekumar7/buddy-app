import React from 'react';
import { Modal, Text, View } from 'react-native';
import { Pressable } from '@/components/ui/pressable';
import Animated from 'react-native-reanimated';
import { MODAL_BACKDROP } from '@/lib/animations';
import { css, font, rgb } from '@/theme';
import { ClockIcon } from './Icons';
import PillButton from './PillButton';
import { bodyText, swapIn } from './styles';

const BACKDROP = css(
  'radial-gradient(ellipse at 50% 40%,rgb(var(--constellation-overlay-rgb) / .72),rgb(var(--constellation-void-rgb) / .94) 72%)',
);
const PANEL_GRADIENT = css(
  'linear-gradient(165deg,rgb(var(--constellation-panel-b-rgb) / .97),rgb(var(--constellation-navy-panel2-rgb) / .97))',
);
const PANEL_SHADOW = css(
  '0 30px 90px rgb(var(--constellation-void-deep-rgb) / .8)',
);
const RING_GLOW = css('0 0 30px rgb(var(--constellation-cyan-rgb) / .22)');

const PANEL_ENTERING = swapIn(300);

/**
 * "Tracking started" confirmation. Built on RN `Modal` directly rather than
 * ui/dialog because the web overlay is a radial-gradient scrim with a custom
 * panel and no close X — Modal still gives Android back + a11y modality.
 */
export default function TrackingStartedModal({
  open,
  onClose,
  line,
}: {
  open: boolean;
  onClose: () => void;
  line: string;
}) {
  return (
    <Modal
      visible={open}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {open ? (
        <Animated.View
          {...MODAL_BACKDROP}
          className="flex-1 items-center justify-center"
          style={{ padding: 26, experimental_backgroundImage: BACKDROP }}
        >
          <Pressable
            className="absolute inset-0"
            accessibilityLabel="Close dialog"
            onPress={onClose}
          />
          <Animated.View
            entering={PANEL_ENTERING}
            accessibilityViewIsModal
            accessibilityLabel="Tracking started"
            className="w-full items-center"
            style={{
              maxWidth: 520,
              borderRadius: 22,
              paddingTop: 30,
              paddingHorizontal: 30,
              paddingBottom: 26,
              experimental_backgroundImage: PANEL_GRADIENT,
              borderWidth: 1,
              borderColor: rgb('constellation-cyan', 0.32),
              boxShadow: PANEL_SHADOW,
            }}
          >
            <View
              className="items-center justify-center rounded-full"
              style={{
                width: 66,
                height: 66,
                backgroundColor: rgb('constellation-cyan', 0.12),
                borderWidth: 1.5,
                borderColor: rgb('constellation-cyan', 0.5),
                boxShadow: RING_GLOW,
              }}
            >
              <ClockIcon />
            </View>
            <Text
              accessibilityRole="header"
              style={{
                ...font('orbitron', 700),
                marginTop: 18,
                fontSize: 19,
                textAlign: 'center',
                color: rgb('constellation-cyan-pale'),
              }}
            >
              Tracking started
            </Text>
            <Text
              style={[
                bodyText(15, 1.5, 'constellation-slate-pale'),
                { marginTop: 10, textAlign: 'center' },
              ]}
            >
              {line}
            </Text>
            <PillButton
              label="Done"
              onPress={onClose}
              marginTop={22}
              paddingVertical={12}
              paddingHorizontal={30}
            />
          </Animated.View>
        </Animated.View>
      ) : null}
    </Modal>
  );
}
