/**
 * Preset avatar art (web PersonalityProfile's CapperSVG…BowSVG + AVATAR_MAP),
 * ported to react-native-svg with the same paths and `--avatar-*` colors.
 */
import React, { type ReactNode } from 'react';
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';
import { color, raw } from '@/theme';

const c = {
  skin: raw['avatar-skin'],
  dark: raw['avatar-dark'],
  darker: raw['avatar-darker'],
  darkest: raw['avatar-darkest'],
  glasses: raw['avatar-glasses'],
  pupil: raw['avatar-pupil'],
  hairDark: raw['avatar-hair-dark'],
  hairMid: raw['avatar-hair-mid'],
  pink: raw['avatar-pink'],
  pinkDeep: raw['avatar-pink-deep'],
};

function Frame({ children }: { children: ReactNode }) {
  return (
    <Svg viewBox="0 0 60 70" fill="none" width="100%" height="100%">
      {children}
    </Svg>
  );
}

function Smile({ d }: { d: string }) {
  return (
    <Path
      d={d}
      stroke={c.dark}
      strokeWidth={1.5}
      fill="none"
      strokeLinecap="round"
    />
  );
}

const CapperSVG = () => (
  <Frame>
    <Circle cx="30" cy="41" r="19" fill={c.skin} />
    <Path d="M10 30 Q10 11 30 11 Q50 11 50 30 Z" fill={c.darker} />
    <Rect x="4" y="27" width="52" height="7" rx="3.5" fill={c.darkest} />
    <Circle cx="23" cy="40" r="2.5" fill={c.dark} />
    <Circle cx="37" cy="40" r="2.5" fill={c.dark} />
    <Smile d="M23 48 Q30 54 37 48" />
  </Frame>
);

const CurlySVG = () => (
  <Frame>
    <Circle cx="30" cy="40" r="19" fill={c.skin} />
    <Path
      d="M13 36 Q13 13 30 13 Q47 13 47 36 Q43 29 30 28 Q17 29 13 36 Z"
      fill={c.hairDark}
    />
    <Circle cx="23" cy="39" r="2.5" fill={c.dark} />
    <Circle cx="37" cy="39" r="2.5" fill={c.dark} />
    <Smile d="M23 47 Q30 53 37 47" />
  </Frame>
);

const SpecsSVG = () => (
  <Frame>
    <Circle cx="30" cy="40" r="19" fill={c.skin} />
    <Path d="M11 36 Q11 15 30 15 Q49 15 49 36" fill={c.darker} />
    <Circle
      cx="22"
      cy="40"
      r="7"
      fill="none"
      stroke={c.glasses}
      strokeWidth={2.5}
    />
    <Circle
      cx="38"
      cy="40"
      r="7"
      fill="none"
      stroke={c.glasses}
      strokeWidth={2.5}
    />
    <Path
      d="M29 40 L31 40"
      stroke={c.glasses}
      strokeWidth={2.5}
      strokeLinecap="round"
    />
    <Path
      d="M9 39 L15 39"
      stroke={c.glasses}
      strokeWidth={2}
      strokeLinecap="round"
    />
    <Path
      d="M45 39 L51 39"
      stroke={c.glasses}
      strokeWidth={2}
      strokeLinecap="round"
    />
    <Circle cx="22" cy="41" r="1.5" fill={c.pupil} />
    <Circle cx="38" cy="41" r="1.5" fill={c.pupil} />
    <Smile d="M24 49 Q30 54 36 49" />
  </Frame>
);

const BraidSVG = () => (
  <Frame>
    <Rect x="3" y="38" width="9" height="20" rx="4.5" fill={c.hairMid} />
    <Rect x="48" y="38" width="9" height="20" rx="4.5" fill={c.hairMid} />
    <Circle cx="30" cy="40" r="19" fill={c.skin} />
    <Path
      d="M13 36 Q13 13 30 13 Q47 13 47 36 Q43 29 30 28 Q17 29 13 36 Z"
      fill={c.hairMid}
    />
    <Circle cx="8" cy="38" r="4" fill={c.pink} />
    <Circle cx="52" cy="38" r="4" fill={c.pink} />
    <Circle cx="23" cy="39" r="2.5" fill={c.dark} />
    <Circle cx="37" cy="39" r="2.5" fill={c.dark} />
    <Smile d="M23 47 Q30 53 37 47" />
  </Frame>
);

const GirlCurlsSVG = () => (
  <Frame>
    <Ellipse cx="30" cy="28" rx="24" ry="22" fill={c.hairMid} />
    <Circle cx="30" cy="40" r="19" fill={c.skin} />
    <Circle cx="23" cy="39" r="2.5" fill={c.dark} />
    <Circle cx="37" cy="39" r="2.5" fill={c.dark} />
    <Smile d="M23 47 Q30 53 37 47" />
  </Frame>
);

const BowSVG = () => (
  <Frame>
    <Circle cx="30" cy="40" r="19" fill={c.skin} />
    <Path
      d="M13 36 Q13 13 30 13 Q47 13 47 36 Q43 29 30 28 Q17 29 13 36 Z"
      fill={c.hairMid}
    />
    <Path d="M20 13 C20 6 29 6 30 13 C29 20 20 20 20 13 Z" fill={c.pink} />
    <Path d="M40 13 C40 6 31 6 30 13 C31 20 40 20 40 13 Z" fill={c.pink} />
    <Circle cx="30" cy="13" r="3" fill={c.pinkDeep} />
    <Circle cx="23" cy="39" r="2.5" fill={c.dark} />
    <Circle cx="37" cy="39" r="2.5" fill={c.dark} />
    <Smile d="M23 47 Q30 53 37 47" />
  </Frame>
);

/** Web AVATAR_MAP — its `hsl(...)` backgrounds are the `--avatar-circle-N` tokens. */
export const AVATAR_MAP: Record<
  string,
  { svg: ReactNode; bg: string } | undefined
> = {
  'capper-boy': { svg: <CapperSVG />, bg: color['avatar-circle-1'] },
  'curly-boy': { svg: <CurlySVG />, bg: color['avatar-circle-2'] },
  'specs-boy': { svg: <SpecsSVG />, bg: color['avatar-circle-3'] },
  'braid-girl': { svg: <BraidSVG />, bg: color['avatar-circle-4'] },
  'curls-girl': { svg: <GirlCurlsSVG />, bg: color['avatar-circle-5'] },
  'bow-girl': { svg: <BowSVG />, bg: color['avatar-circle-6'] },
};
