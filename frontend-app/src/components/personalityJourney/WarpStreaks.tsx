import React, { useState } from 'react';
import {
  Canvas,
  PaintStyle,
  Picture,
  Skia,
  StrokeCap,
  createPicture,
} from '@shopify/react-native-skia';
import { useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { WARP_STAR_PALETTE } from './palette';

const STAR_COUNT = 340;
const DURATION = 4600;

/** Struct-of-arrays star field (mutated in place on the UI thread each frame). */
interface Stars {
  a: number[];
  d: number[];
  z: number[];
  tw: number[];
  col: number[];
}

function makeStars(far: number): Stars {
  const s: Stars = { a: [], d: [], z: [], tw: [], col: [] };
  for (let i = 0; i < STAR_COUNT; i++) {
    s.a.push(Math.random() * Math.PI * 2);
    s.d.push(Math.random() * far + 4);
    s.z.push(Math.random() * 0.85 + 0.15);
    s.tw.push(Math.random() * Math.PI * 2);
    s.col.push(Math.floor(Math.random() * WARP_STAR_PALETTE.length));
  }
  return s;
}

/**
 * The hyperspace-streak canvas from the web warp-enter (same star count,
 * glide curve, alpha envelope and streak math), drawn with Skia on the UI
 * thread instead of a 2D canvas + requestAnimationFrame.
 */
export default function WarpStreaks({
  width,
  height,
}: {
  width: number;
  height: number;
}) {
  const cx = width / 2;
  const cy = height / 2;
  const far = Math.hypot(Math.max(cx, width - cx), Math.max(cy, height - cy));
  const [initialStars] = useState(() => makeStars(far));
  const [emptyPicture] = useState(() => createPicture(() => {}));
  const stars = useSharedValue<Stars>(initialStars);
  const picture = useSharedValue(emptyPicture);
  const t0 = useSharedValue(-1);
  const done = useSharedValue(false);

  useFrameCallback(frame => {
    if (done.value) return;
    if (t0.value < 0) t0.value = frame.timestamp;
    const t = Math.min(1.15, (frame.timestamp - t0.value) / DURATION);
    if (t >= 1.15) {
      picture.value = createPicture(() => {});
      done.value = true;
      return;
    }
    const glide = 0.9 + Math.sin(Math.min(1, t) * Math.PI) * 3.4;
    const alpha =
      t < 0.18 ? t / 0.18 : t > 0.82 ? Math.max(0, (1.02 - t) / 0.2) : 1;

    stars.modify(s => {
      'worklet';
      picture.value = createPicture(
        canvas => {
          const colors = WARP_STAR_PALETTE.map(c => Skia.Color(c));
          const paint = Skia.Paint();
          paint.setAntiAlias(true);
          paint.setStyle(PaintStyle.Stroke);
          paint.setStrokeCap(StrokeCap.Round);
          for (let i = 0; i < STAR_COUNT; i++) {
            const prev = s.d[i] ?? 0;
            const z = s.z[i] ?? 0;
            const d = prev + z * glide * 1.5;
            s.d[i] = d;
            if (d > far * 1.12) {
              s.d[i] = 6 + Math.random() * 30;
              s.a[i] = Math.random() * Math.PI * 2;
              continue;
            }
            const tw = (s.tw[i] ?? 0) + 0.05;
            s.tw[i] = tw;
            const a = s.a[i] ?? 0;
            const ca = Math.cos(a);
            const sa = Math.sin(a);
            const len = Math.min((d - prev) * 5.5, 70);
            const depth = Math.min(1, 0.2 + d / (far * 0.75));
            const col = colors[s.col[i] ?? 0] ?? colors[0];
            if (col) paint.setColor(col);
            paint.setAlphaf(
              Math.max(
                0,
                Math.min(1, alpha * depth * (0.55 + 0.45 * Math.sin(tw))),
              ),
            );
            paint.setStrokeWidth(Math.min(2.2, 0.4 + z * 1.6 * depth));
            canvas.drawLine(
              cx + ca * (d - len),
              cy + sa * (d - len),
              cx + ca * d,
              cy + sa * d,
              paint,
            );
          }
        },
        { width, height },
      );
      return s;
    }, false);
  });

  return (
    <Canvas
      pointerEvents="none"
      style={{ position: 'absolute', left: 0, top: 0, width, height }}
    >
      <Picture picture={picture} />
    </Canvas>
  );
}
