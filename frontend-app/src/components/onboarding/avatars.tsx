// Inline SVG avatar illustrations — RN port of the ones defined inline in
// web frontend/src/components/onboarding/ChildProfileStep.tsx (same paths/viewBox).
import React from 'react';
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';
import { raw } from '@/theme';

const skin = raw['avatar-skin'];
const dark = raw['avatar-dark'];
const darker = raw['avatar-darker'];
const darkest = raw['avatar-darkest'];
const glasses = raw['avatar-glasses'];
const pupil = raw['avatar-pupil'];
const hairDark = raw['avatar-hair-dark'];
const hairMid = raw['avatar-hair-mid'];
const pink = raw['avatar-pink'];
const pinkDeep = raw['avatar-pink-deep'];

function Frame({ children }: { children: React.ReactNode }) {
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
      stroke={dark}
      strokeWidth={1.5}
      fill="none"
      strokeLinecap="round"
    />
  );
}

export const CapperSVG = () => (
  <Frame>
    <Circle cx={30} cy={41} r={19} fill={skin} />
    <Path d="M10 30 Q10 11 30 11 Q50 11 50 30 Z" fill={darker} />
    <Rect x={4} y={27} width={52} height={7} rx={3.5} fill={darkest} />
    <Circle cx={23} cy={40} r={2.5} fill={dark} />
    <Circle cx={37} cy={40} r={2.5} fill={dark} />
    <Smile d="M23 48 Q30 54 37 48" />
  </Frame>
);

export const CurlySVG = () => (
  <Frame>
    <Circle cx={30} cy={40} r={19} fill={skin} />
    <Path
      d="M13 36 Q13 13 30 13 Q47 13 47 36 Q43 29 30 28 Q17 29 13 36 Z"
      fill={hairDark}
    />
    <Circle cx={23} cy={39} r={2.5} fill={dark} />
    <Circle cx={37} cy={39} r={2.5} fill={dark} />
    <Smile d="M23 47 Q30 53 37 47" />
  </Frame>
);

export const SpecsSVG = () => (
  <Frame>
    <Circle cx={30} cy={40} r={19} fill={skin} />
    <Path d="M11 36 Q11 15 30 15 Q49 15 49 36" fill={darker} />
    <Circle
      cx={22}
      cy={40}
      r={7}
      fill="none"
      stroke={glasses}
      strokeWidth={2.5}
    />
    <Circle
      cx={38}
      cy={40}
      r={7}
      fill="none"
      stroke={glasses}
      strokeWidth={2.5}
    />
    <Path
      d="M29 40 L31 40"
      stroke={glasses}
      strokeWidth={2.5}
      strokeLinecap="round"
    />
    <Path
      d="M9 39 L15 39"
      stroke={glasses}
      strokeWidth={2}
      strokeLinecap="round"
    />
    <Path
      d="M45 39 L51 39"
      stroke={glasses}
      strokeWidth={2}
      strokeLinecap="round"
    />
    <Circle cx={22} cy={41} r={1.5} fill={pupil} />
    <Circle cx={38} cy={41} r={1.5} fill={pupil} />
    <Smile d="M24 49 Q30 54 36 49" />
  </Frame>
);

export const BraidSVG = () => (
  <Frame>
    <Rect x={3} y={38} width={9} height={20} rx={4.5} fill={hairMid} />
    <Rect x={48} y={38} width={9} height={20} rx={4.5} fill={hairMid} />
    <Circle cx={30} cy={40} r={19} fill={skin} />
    <Path
      d="M13 36 Q13 13 30 13 Q47 13 47 36 Q43 29 30 28 Q17 29 13 36 Z"
      fill={hairMid}
    />
    <Circle cx={8} cy={38} r={4} fill={pink} />
    <Circle cx={52} cy={38} r={4} fill={pink} />
    <Circle cx={23} cy={39} r={2.5} fill={dark} />
    <Circle cx={37} cy={39} r={2.5} fill={dark} />
    <Smile d="M23 47 Q30 53 37 47" />
  </Frame>
);

export const GirlCurlsSVG = () => (
  <Frame>
    <Ellipse cx={30} cy={28} rx={24} ry={22} fill={hairMid} />
    <Circle cx={30} cy={40} r={19} fill={skin} />
    <Circle cx={23} cy={39} r={2.5} fill={dark} />
    <Circle cx={37} cy={39} r={2.5} fill={dark} />
    <Smile d="M23 47 Q30 53 37 47" />
  </Frame>
);

export const BowSVG = () => (
  <Frame>
    <Circle cx={30} cy={40} r={19} fill={skin} />
    <Path
      d="M13 36 Q13 13 30 13 Q47 13 47 36 Q43 29 30 28 Q17 29 13 36 Z"
      fill={hairMid}
    />
    <Path d="M20 13 C20 6 29 6 30 13 C29 20 20 20 20 13 Z" fill={pink} />
    <Path d="M40 13 C40 6 31 6 30 13 C31 20 40 20 40 13 Z" fill={pink} />
    <Circle cx={30} cy={13} r={3} fill={pinkDeep} />
    <Circle cx={23} cy={39} r={2.5} fill={dark} />
    <Circle cx={37} cy={39} r={2.5} fill={dark} />
    <Smile d="M23 47 Q30 53 37 47" />
  </Frame>
);

export interface AvatarDef {
  id: string;
  label: string;
  bg: string;
  emoji: React.ReactNode;
}

export const BOY_AVATARS: AvatarDef[] = [
  {
    id: 'capper-boy',
    label: 'Capper',
    bg: 'bg-avatar-circle-1',
    emoji: <CapperSVG />,
  },
  {
    id: 'curly-boy',
    label: 'Curly',
    bg: 'bg-avatar-circle-2',
    emoji: <CurlySVG />,
  },
  {
    id: 'specs-boy',
    label: 'Specs',
    bg: 'bg-avatar-circle-3',
    emoji: <SpecsSVG />,
  },
];

export const GIRL_AVATARS: AvatarDef[] = [
  {
    id: 'braid-girl',
    label: 'Braid',
    bg: 'bg-avatar-circle-4',
    emoji: <BraidSVG />,
  },
  {
    id: 'curls-girl',
    label: 'Curls',
    bg: 'bg-avatar-circle-5',
    emoji: <GirlCurlsSVG />,
  },
  { id: 'bow-girl', label: 'Bow', bg: 'bg-avatar-circle-6', emoji: <BowSVG /> },
];

export const ALL_AVATARS = [...BOY_AVATARS, ...GIRL_AVATARS];
