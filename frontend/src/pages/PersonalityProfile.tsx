import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { motion } from 'framer-motion';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import { useMediaQuery } from '@/hooks/use-mobile';
import { onboardingProfileFromViewModel } from '@/lib/onboardingPersonalityProfile';
import { normalizeOnboardingChildDataBlob } from '@/lib/onboardingChildData';
import { mergeChildDraft } from '@/lib/onboardingHelpers';
import { generateAvatarDataUri } from '@/lib/avatarUtils';

interface TraitScore {
  label: string;
  score: number;
}
interface FamousPerson {
  name: string;
  image?: string;
  caption?: string;
}
type ProfileType = ReturnType<typeof onboardingProfileFromViewModel>;

const CARD_BG =
  'linear-gradient(180deg, rgba(10,34,84,.55), rgb(var(--constellation-navy-card-rgb) / .35))';
const CARD_BORDER = '1px solid rgb(var(--constellation-blue-line-rgb) / .16)';
const SEC_LABEL: CSSProperties = {
  fontSize: 13,
  letterSpacing: '.34em',
  textTransform: 'uppercase',
  color: '#7cb9ff',
  textAlign: 'center',
  marginBottom: 18,
};

// 6 geometric trait icons matching HTML
function TraitIcon({ index, containerSize = 46 }: { index: number; containerSize?: number }) {
  const innerScale = containerSize / 46;
  const shapes: CSSProperties[] = [
    {
      width: 16,
      height: 16,
      border: '2px solid rgb(var(--constellation-blue-rgb))',
      borderRadius: '50%',
    },
    {
      width: 14,
      height: 14,
      background: 'rgb(var(--constellation-blue-rgb))',
      transform: 'rotate(45deg)',
    },
    {
      width: 18,
      height: 2,
      background: 'rgb(var(--constellation-blue-rgb))',
      boxShadow:
        '0 6px 0 rgb(var(--constellation-blue-rgb)), 0 -6px 0 rgb(var(--constellation-blue-rgb) / .5)',
    },
    {
      width: 16,
      height: 16,
      border: '2px solid rgb(var(--constellation-blue-rgb))',
      borderRadius: 3,
    },
    {
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: 'rgb(var(--constellation-blue-rgb))',
      boxShadow:
        '-10px 0 0 rgb(var(--constellation-blue-rgb) / .45), 10px 0 0 rgb(var(--constellation-blue-rgb) / .45)',
    },
    {
      width: 16,
      height: 16,
      borderRadius: '50%',
      border: '2px solid rgb(var(--constellation-blue-rgb))',
      borderRightColor: 'transparent',
      borderBottomColor: 'transparent',
      transform: 'rotate(45deg)',
    },
  ];
  const shape = shapes[index % 6]!;
  const shapeTransform = shape.transform
    ? `scale(${innerScale}) ${shape.transform}`
    : `scale(${innerScale})`;
  return (
    <div
      style={{
        width: containerSize,
        height: containerSize,
        borderRadius: '50%',
        border: '1px solid rgba(130,195,255,.35)',
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(8,28,72,.55)',
        flexShrink: 0,
      }}
    >
      <div style={{ ...shape, transform: shapeTransform }} />
    </div>
  );
}

// 4 strength icons matching HTML exactly
function StrengthIcon({ index }: { index: number }) {
  if (index === 0)
    return (
      <div
        style={{
          width: 34,
          height: 34,
          border: '2px solid rgb(var(--constellation-gold-light-rgb))',
          borderRadius: 4,
          transform: 'rotate(45deg)',
        }}
      />
    );
  if (index === 1)
    return (
      <div
        style={{
          width: 34,
          height: 34,
          border: '2px solid rgb(var(--constellation-blue-rgb))',
          borderRadius: '50%',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 9,
            borderRadius: '50%',
            background: 'rgb(var(--constellation-gold-light-rgb))',
          }}
        />
      </div>
    );
  if (index === 2)
    return (
      <div
        style={{ width: 34, height: 34, border: '2px solid rgb(var(--constellation-blue-rgb))' }}
      />
    );
  return (
    <div
      style={{
        width: 34,
        height: 34,
        borderRadius: '50%',
        border: '2px solid rgb(var(--constellation-blue-rgb))',
        borderTopColor: 'rgb(var(--constellation-gold-light-rgb))',
        borderRightColor: 'rgb(var(--constellation-gold-light-rgb))',
      }}
    />
  );
}

// ── Avatar SVG components (shared with ChildProfileStep) ────────────────────
const CapperSVG = () => (
  <svg
    viewBox="0 0 60 70"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ width: '100%', height: '100%' }}
  >
    <circle cx="30" cy="41" r="19" className="fill-avatar-skin" />
    <path d="M10 30 Q10 11 30 11 Q50 11 50 30 Z" className="fill-avatar-darker" />
    <rect x="4" y="27" width="52" height="7" rx="3.5" className="fill-avatar-darkest" />
    <circle cx="23" cy="40" r="2.5" className="fill-avatar-dark" />
    <circle cx="37" cy="40" r="2.5" className="fill-avatar-dark" />
    <path
      d="M23 48 Q30 54 37 48"
      className="stroke-avatar-dark"
      strokeWidth="1.5"
      fill="none"
      strokeLinecap="round"
    />
  </svg>
);
const CurlySVG = () => (
  <svg
    viewBox="0 0 60 70"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ width: '100%', height: '100%' }}
  >
    <circle cx="30" cy="40" r="19" className="fill-avatar-skin" />
    <path
      d="M13 36 Q13 13 30 13 Q47 13 47 36 Q43 29 30 28 Q17 29 13 36 Z"
      className="fill-avatar-hair-dark"
    />
    <circle cx="23" cy="39" r="2.5" className="fill-avatar-dark" />
    <circle cx="37" cy="39" r="2.5" className="fill-avatar-dark" />
    <path
      d="M23 47 Q30 53 37 47"
      className="stroke-avatar-dark"
      strokeWidth="1.5"
      fill="none"
      strokeLinecap="round"
    />
  </svg>
);
const SpecsSVG = () => (
  <svg
    viewBox="0 0 60 70"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ width: '100%', height: '100%' }}
  >
    <circle cx="30" cy="40" r="19" className="fill-avatar-skin" />
    <path d="M11 36 Q11 15 30 15 Q49 15 49 36" className="fill-avatar-darker" />
    <circle cx="22" cy="40" r="7" fill="none" className="stroke-avatar-glasses" strokeWidth="2.5" />
    <circle cx="38" cy="40" r="7" fill="none" className="stroke-avatar-glasses" strokeWidth="2.5" />
    <path
      d="M29 40 L31 40"
      className="stroke-avatar-glasses"
      strokeWidth="2.5"
      strokeLinecap="round"
    />
    <path
      d="M9 39 L15 39"
      className="stroke-avatar-glasses"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <path
      d="M45 39 L51 39"
      className="stroke-avatar-glasses"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <circle cx="22" cy="41" r="1.5" className="fill-avatar-pupil" />
    <circle cx="38" cy="41" r="1.5" className="fill-avatar-pupil" />
    <path
      d="M24 49 Q30 54 36 49"
      className="stroke-avatar-dark"
      strokeWidth="1.5"
      fill="none"
      strokeLinecap="round"
    />
  </svg>
);
const BraidSVG = () => (
  <svg
    viewBox="0 0 60 70"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ width: '100%', height: '100%' }}
  >
    <rect x="3" y="38" width="9" height="20" rx="4.5" className="fill-avatar-hair-mid" />
    <rect x="48" y="38" width="9" height="20" rx="4.5" className="fill-avatar-hair-mid" />
    <circle cx="30" cy="40" r="19" className="fill-avatar-skin" />
    <path
      d="M13 36 Q13 13 30 13 Q47 13 47 36 Q43 29 30 28 Q17 29 13 36 Z"
      className="fill-avatar-hair-mid"
    />
    <circle cx="8" cy="38" r="4" className="fill-avatar-pink" />
    <circle cx="52" cy="38" r="4" className="fill-avatar-pink" />
    <circle cx="23" cy="39" r="2.5" className="fill-avatar-dark" />
    <circle cx="37" cy="39" r="2.5" className="fill-avatar-dark" />
    <path
      d="M23 47 Q30 53 37 47"
      className="stroke-avatar-dark"
      strokeWidth="1.5"
      fill="none"
      strokeLinecap="round"
    />
  </svg>
);
const GirlCurlsSVG = () => (
  <svg
    viewBox="0 0 60 70"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ width: '100%', height: '100%' }}
  >
    <ellipse cx="30" cy="28" rx="24" ry="22" className="fill-avatar-hair-mid" />
    <circle cx="30" cy="40" r="19" className="fill-avatar-skin" />
    <circle cx="23" cy="39" r="2.5" className="fill-avatar-dark" />
    <circle cx="37" cy="39" r="2.5" className="fill-avatar-dark" />
    <path
      d="M23 47 Q30 53 37 47"
      className="stroke-avatar-dark"
      strokeWidth="1.5"
      fill="none"
      strokeLinecap="round"
    />
  </svg>
);
const BowSVG = () => (
  <svg
    viewBox="0 0 60 70"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ width: '100%', height: '100%' }}
  >
    <circle cx="30" cy="40" r="19" className="fill-avatar-skin" />
    <path
      d="M13 36 Q13 13 30 13 Q47 13 47 36 Q43 29 30 28 Q17 29 13 36 Z"
      className="fill-avatar-hair-mid"
    />
    <path d="M20 13 C20 6 29 6 30 13 C29 20 20 20 20 13 Z" className="fill-avatar-pink" />
    <path d="M40 13 C40 6 31 6 30 13 C31 20 40 20 40 13 Z" className="fill-avatar-pink" />
    <circle cx="30" cy="13" r="3" className="fill-avatar-pink-deep" />
    <circle cx="23" cy="39" r="2.5" className="fill-avatar-dark" />
    <circle cx="37" cy="39" r="2.5" className="fill-avatar-dark" />
    <path
      d="M23 47 Q30 53 37 47"
      className="stroke-avatar-dark"
      strokeWidth="1.5"
      fill="none"
      strokeLinecap="round"
    />
  </svg>
);

const AVATAR_MAP: Record<string, { svg: ReactNode; bg: string }> = {
  'capper-boy': { svg: <CapperSVG />, bg: 'hsl(174, 84%, 32%)' },
  'curly-boy': { svg: <CurlySVG />, bg: 'hsl(262, 83%, 58%)' },
  'specs-boy': { svg: <SpecsSVG />, bg: 'hsl(32, 95%, 44%)' },
  'braid-girl': { svg: <BraidSVG />, bg: 'hsl(333, 71%, 51%)' },
  'curls-girl': { svg: <GirlCurlsSVG />, bg: 'hsl(347, 89%, 44%)' },
  'bow-girl': { svg: <BowSVG />, bg: 'hsl(293, 69%, 49%)' },
};

// Falling sparks for reveal
const SPARKS = [
  {
    left: '8%',
    delay: '.1s',
    size: 9,
    color: 'rgb(var(--constellation-blue-bright-rgb))',
    glow: 'rgb(var(--constellation-blue-sky-rgb) / .9)',
    dur: '3.4s',
  },
  {
    left: '20%',
    delay: '.9s',
    size: 6,
    color: 'rgb(var(--constellation-gold-light-rgb))',
    glow: 'rgb(var(--constellation-gold-light-rgb) / .8)',
    dur: '4.2s',
  },
  {
    left: '33%',
    delay: '1.6s',
    size: 8,
    color: 'rgb(var(--constellation-gold-soft-rgb))',
    glow: 'rgb(var(--constellation-gold-light-rgb) / .9)',
    dur: '3.8s',
  },
  {
    left: '47%',
    delay: '.4s',
    size: 5,
    color: 'rgb(var(--constellation-blue-vivid-rgb))',
    glow: 'rgb(var(--constellation-blue-sky-rgb) / .8)',
    dur: '4.6s',
  },
  {
    left: '62%',
    delay: '1.2s',
    size: 9,
    color: 'rgb(var(--constellation-blue-bright-rgb))',
    glow: 'rgb(var(--constellation-blue-sky-rgb) / .9)',
    dur: '3.2s',
  },
  {
    left: '74%',
    delay: '2.1s',
    size: 7,
    color: 'rgb(var(--constellation-gold-soft-rgb))',
    glow: 'rgb(var(--constellation-gold-light-rgb) / .85)',
    dur: '4.4s',
  },
  {
    left: '86%',
    delay: '.7s',
    size: 8,
    color: 'rgb(var(--constellation-blue-vivid-rgb))',
    glow: 'rgb(var(--constellation-blue-sky-rgb) / .8)',
    dur: '3.6s',
  },
  {
    left: '94%',
    delay: '1.9s',
    size: 5,
    color: 'rgb(var(--constellation-gold-light-rgb))',
    glow: 'rgb(var(--constellation-gold-light-rgb) / .9)',
    dur: '4.0s',
  },
];

export default function PersonalityProfile() {
  const navigate = useNavigate();
  const { childId } = useParams();
  const { isAuthenticated, isLoadingAuth } = useAuth();
  const [profile, setProfile] = useState<ProfileType>(null);
  const [childName, setChildName] = useState('');
  const [childAge, setChildAge] = useState('');
  const [isInitializing, setIsInitializing] = useState(true);
  const [initError, setInitError] = useState(false);
  const [vmProfile, setVmProfile] = useState<Record<string, unknown> | null>(null);
  const [vmScores, setVmScores] = useState<Record<string, number> | null>(null);
  const [avatarId, setAvatarId] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [displayPhase, setDisplayPhase] = useState<'reveal' | 'profile'>('reveal');
  const isWide = useMediaQuery('(min-width: 700px)');
  const [diagAvailW, setDiagAvailW] = useState(() => Math.min(window.innerWidth - 68, 748));
  const diagramRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = diagramRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setDiagAvailW(e.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (isLoadingAuth) return;
    if (!isAuthenticated) {
      void navigate('/Onboarding', { replace: true });
      return;
    }
    if (!childId) {
      void navigate('/Home', { replace: true });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const child = await api.entities.Child.get(childId);
        if (cancelled) return;
        if (!child) {
          void navigate('/Home', { replace: true });
          return;
        }
        const vm = child.personality?.view_model;
        if (!vm?.profile?.name) {
          void navigate(`/PersonalityJourney/${childId}`, { replace: true });
          return;
        }
        const merged = mergeChildDraft(normalizeOnboardingChildDataBlob(child) ?? {});
        setChildName(merged.name || '');
        setChildAge(String(((merged as Record<string, unknown>).age as string | number) ?? ''));
        setVmProfile(vm.profile);
        setVmScores((vm.scores as Record<string, number>) ?? null);
        setAvatarId(typeof child.avatar_id === 'string' ? child.avatar_id : '');
        setAvatarUrl(typeof child.avatar_url === 'string' ? child.avatar_url : '');
        setProfile(onboardingProfileFromViewModel(vm));
        setIsInitializing(false);
      } catch (err) {
        console.warn('[PersonalityProfile] Load failed:', err);
        if (!cancelled) {
          setInitError(true);
          setIsInitializing(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoadingAuth, isAuthenticated, childId, navigate]);

  // Auto-advance reveal → profile
  useEffect(() => {
    if (isLoadingAuth || isInitializing) return;
    const t = setTimeout(() => setDisplayPhase('profile'), 5500);
    return () => clearTimeout(t);
  }, [isLoadingAuth, isInitializing]);

  const status = isLoadingAuth || isInitializing ? 'loading' : initError ? 'error' : 'ready';

  if (status === 'loading') {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgb(var(--constellation-navy-black-rgb))',
        }}
      >
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            border: '2px solid rgb(var(--constellation-gold-light-rgb) / 0.55)',
            borderTopColor: 'transparent',
          }}
        />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          background: 'rgb(var(--constellation-navy-black-rgb))',
          padding: 24,
        }}
      >
        <p style={{ color: 'rgb(var(--constellation-blue-mid-rgb))' }}>
          Something went wrong. Please try again.
        </p>
        <button
          onClick={() => void navigate('/Home')}
          style={{
            padding: '10px 32px',
            borderRadius: 100,
            border: '1px solid rgb(var(--constellation-gold-light-rgb) / .6)',
            background: 'rgb(var(--constellation-blue-royal-rgb) / .45)',
            color: 'rgb(var(--constellation-gold-hazy-rgb))',
            cursor: 'pointer',
            fontSize: 14,
            fontFamily: 'Barlow, sans-serif',
          }}
        >
          Go Back
        </button>
      </div>
    );
  }

  const personalityType = profile?.personality_type ?? '';
  const typeTitle = personalityType?.split(' - ')[1] ?? personalityType ?? 'Unique';
  const summary = profile?.summary ?? '';
  const traits = (vmProfile?.traits as string[] | undefined) ?? [];
  const strengths = (profile?.top_strengths as string[] | undefined) ?? [];
  const famousPeople = (vmProfile?.famous_people as FamousPerson[] | undefined) ?? [];
  const traitScoresFromProfile = (vmProfile?.trait_scores as TraitScore[] | undefined) ?? [];
  // Fallback: derive from view_model.scores when profile.trait_scores is absent (older data)
  const traitScores: TraitScore[] =
    traitScoresFromProfile.length > 0
      ? traitScoresFromProfile
      : Object.entries(vmScores ?? {})
          .map(([label, score]) => ({ label, score }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 5);
  const childQuote = typeof vmProfile?.child_quote === 'string' ? vmProfile.child_quote : '';
  const parentNote = typeof vmProfile?.parent_note === 'string' ? vmProfile.parent_note : '';
  const initials = childName
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  // Diagram scale — proportional to available container width (748px = design width)
  const dScale = Math.min(1, diagAvailW / 748);
  const circleD = Math.round(272 * dScale);
  const ringD = Math.round(432 * dScale);
  const diagH = Math.round(520 * dScale);
  const iconContainerSize = Math.max(28, Math.round(46 * dScale));
  const traitFontSize = Math.max(11, Math.round(14 * dScale));
  const traitGap = Math.max(4, Math.round(8 * dScale));
  const traitPosScaled: CSSProperties[] = [
    { left: `calc(50% - ${Math.round(90 * dScale)}px)`, top: 0, width: Math.round(180 * dScale) },
    { left: 0, top: Math.round(120 * dScale), width: Math.round(190 * dScale) },
    { right: 0, top: Math.round(120 * dScale), width: Math.round(190 * dScale) },
    {
      left: Math.round(6 * dScale),
      bottom: Math.round(96 * dScale),
      width: Math.round(190 * dScale),
    },
    {
      right: Math.round(6 * dScale),
      bottom: Math.round(96 * dScale),
      width: Math.round(190 * dScale),
    },
    {
      left: `calc(50% - ${Math.round(100 * dScale)}px)`,
      bottom: 0,
      width: Math.round(200 * dScale),
    },
  ];

  function handleShare(platform: 'instagram' | 'whatsapp') {
    const text = `${childName}'s personality analysis is in — ${typeTitle}!`;
    const url = window.location.href;
    if (platform === 'whatsapp') {
      window.open(`https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}`, '_blank');
      return;
    }
    // Instagram: no direct URL share — use Web Share API or clipboard
    if (navigator.share) {
      void navigator.share({ title: `${childName} the ${typeTitle}`, text, url });
      return;
    }
    if (navigator.clipboard) void navigator.clipboard.writeText(`${text} ${url}`);
  }

  // ── REVEAL PHASE ────────────────────────────────────────────────────────────
  if (displayPhase === 'reveal') {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          overflow: 'hidden',
          fontFamily: 'Barlow, sans-serif',
          color: 'rgb(var(--constellation-blue-frost-rgb))',
          background:
            'radial-gradient(80% 60% at 50% 45%, rgba(30,100,220,.55) 0%, rgba(3,10,32,0) 70%), linear-gradient(180deg,rgb(var(--constellation-navy-black-rgb)),#01040e)',
        }}
      >
        {/* Dot grid */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            opacity: 0.4,
            backgroundImage:
              'radial-gradient(rgb(var(--constellation-blue-sky-rgb) / .4) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
            maskImage: 'radial-gradient(50% 45% at 50% 45%, #000, transparent 80%)',
          }}
        />

        {/* Pulsing rings */}
        {([0, 0.55, 1.1] as const).map((delay, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: '50%',
              top: '44%',
              width: 320,
              height: 320,
              margin: '-160px 0 0 -160px',
              borderRadius: '50%',
              border:
                i === 0
                  ? '2px solid rgb(var(--constellation-blue-pastel-rgb) / .7)'
                  : `1px solid ${i === 1 ? 'rgb(var(--constellation-gold-light-rgb) / .45)' : 'rgb(var(--constellation-blue-pastel-rgb) / .35)'}`,
              animation: `ppRingOut 2.6s ease-out ${delay}s infinite`,
            }}
          />
        ))}

        {/* Falling sparks */}
        {SPARKS.map((s, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: s.left,
              top: 0,
              width: s.size,
              height: s.size,
              background: s.color,
              boxShadow: `0 0 ${s.size + 5}px ${Math.ceil(s.size * 0.4)}px ${s.glow}`,
              animation: `ppSparkFall ${s.dur} linear ${s.delay} infinite`,
            }}
          />
        ))}

        {/* Center content */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'clamp(14px, 3.5vw, 22px)',
            textAlign: 'center',
            padding: '40px 20px',
          }}
        >
          <div
            style={{
              fontSize: 13,
              letterSpacing: '.5em',
              textTransform: 'uppercase',
              color: 'rgb(var(--constellation-blue-strong-rgb))',
              animation: 'ppRiseIn .8s ease-out both',
            }}
          >
            Personality Analysis
          </div>
          <div
            style={{
              fontSize: 'clamp(16px, 5vw, 22px)',
              letterSpacing: '.06em',
              color: 'rgb(var(--constellation-gold-light-rgb))',
              textShadow: '0 0 24px rgb(var(--constellation-gold-light-rgb) / .5)',
              animation: 'ppRiseIn .9s ease-out .25s both',
            }}
          >
            {childName}'s results are in!
          </div>

          {/* Badge */}
          <div
            style={{
              position: 'relative',
              padding: 'clamp(16px, 4vw, 26px) clamp(20px, 6vw, 54px)',
              border: '1px solid rgb(var(--constellation-gold-light-rgb) / .55)',
              borderRadius: 18,
              overflow: 'hidden',
              background:
                'linear-gradient(180deg, rgba(14,44,104,.7), rgb(var(--constellation-navy-card-rgb) / .5))',
              boxShadow:
                '0 0 60px rgba(50,130,240,.45), 0 0 34px rgb(var(--constellation-gold-light-rgb) / .3)',
              animation: 'ppBadgePop .8s cubic-bezier(.2,.9,.2,1) .7s both',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: 0,
                width: 70,
                background:
                  'linear-gradient(90deg, transparent, rgba(250,226,164,.65), transparent)',
                animation: 'ppBadgeSweep 2.4s ease-in-out 1.4s infinite',
              }}
            />
            <div
              style={{
                position: 'relative',
                fontFamily: "'Playfair Display', serif",
                fontSize: 'clamp(26px, 7vw, 64px)',
                lineHeight: 1.05,
                color: 'rgb(var(--constellation-blue-pale-rgb))',
                textShadow: '0 0 34px rgba(80,160,255,.9)',
              }}
            >
              {childName} is a<br />
              <span
                style={{ fontStyle: 'italic', color: 'rgb(var(--constellation-blue-deep-rgb))' }}
              >
                {typeTitle}
              </span>
            </div>
          </div>

          <div
            style={{
              fontSize: 'clamp(14px, 4vw, 17px)',
              color: 'rgb(var(--constellation-blue-mid-rgb))',
              maxWidth: 420,
              lineHeight: 1.55,
              animation: 'ppRiseIn .9s ease-out 1.2s both',
            }}
          >
            {summary ||
              `Curious and full of ideas — here's what the answers reveal about how ${childName} thinks.`}
          </div>

          <button
            onClick={() => setDisplayPhase('profile')}
            style={{
              marginTop: 6,
              padding: 'clamp(10px, 3vw, 14px) clamp(20px, 6vw, 30px)',
              borderRadius: 999,
              border: '1px solid rgb(var(--constellation-gold-light-rgb) / .7)',
              background: 'rgb(var(--constellation-blue-royal-rgb) / .55)',
              color: 'rgb(var(--constellation-gold-hazy-rgb))',
              fontSize: 'clamp(13px, 3.5vw, 16px)',
              letterSpacing: '.12em',
              textTransform: 'uppercase',
              boxShadow: '0 0 28px rgb(var(--constellation-blue-electric-rgb) / .4)',
              cursor: 'pointer',
              animation: 'ppRiseIn .8s ease-out 1.6s both',
              fontFamily: 'Barlow, sans-serif',
            }}
          >
            See {childName}'s results
          </button>
        </div>
      </div>
    );
  }

  // ── PROFILE PHASE ──────────────────────────────────────────────────────────
  const pad = isWide ? 36 : 18;

  return (
    <div
      style={{
        minHeight: '100vh',
        background:
          'linear-gradient(180deg,rgb(var(--constellation-navy-black-rgb)) 0%, rgb(var(--constellation-black-navy-rgb)) 50%, rgb(var(--constellation-black-navy2-rgb)) 100%)',
        padding: `40px 16px 80px`,
        fontFamily: 'Barlow, sans-serif',
        color: 'rgb(var(--constellation-blue-frost-rgb))',
      }}
    >
      <div
        style={{
          maxWidth: 820,
          margin: '0 auto',
          padding: pad,
          background:
            'radial-gradient(120% 80% at 50% -10%, rgba(24,86,190,.55) 0%, rgb(var(--constellation-navy-glow-rgb) / 0) 60%), radial-gradient(90% 60% at 50% 108%, rgba(20,72,170,.45) 0%, rgb(var(--constellation-navy-glow-rgb) / 0) 65%), linear-gradient(180deg,rgb(var(--constellation-navy-black-rgb)) 0%, rgb(var(--constellation-black-navy-rgb)) 50%, rgb(var(--constellation-black-navy2-rgb)) 100%)',
          border: '1px solid rgb(var(--constellation-blue-line-rgb) / .28)',
          borderRadius: isWide ? 22 : 14,
          boxShadow: '0 24px 80px rgba(0,0,0,.5)',
          animation: 'ppPageIn .7s ease-out both',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
          {/* ── Share row ──────────────────────────────────────────────────── */}
          <div
            style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10 }}
          >
            <div
              style={{
                fontSize: 11,
                letterSpacing: '.22em',
                textTransform: 'uppercase',
                color: 'rgb(var(--constellation-blue-mid-rgb))',
                whiteSpace: 'nowrap',
              }}
            >
              Share on
            </div>
            <button
              onClick={() => handleShare('instagram')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: isWide ? 8 : 0,
                cursor: 'pointer',
                padding: isWide ? '9px 16px' : '9px 12px',
                borderRadius: 999,
                border: '1px solid rgb(var(--constellation-gold-light-rgb) / .6)',
                background: 'rgb(var(--constellation-blue-royal-rgb) / .45)',
                color: 'rgb(var(--constellation-gold-hazy-rgb))',
                fontFamily: 'Barlow, sans-serif',
                fontSize: 12,
                letterSpacing: '.16em',
                textTransform: 'uppercase',
                boxShadow: '0 0 18px rgb(var(--constellation-gold-light-rgb) / .16)',
              }}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
              </svg>
              {isWide && 'Instagram'}
            </button>
            <button
              onClick={() => handleShare('whatsapp')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: isWide ? 8 : 0,
                cursor: 'pointer',
                padding: isWide ? '9px 16px' : '9px 12px',
                borderRadius: 999,
                border: '1px solid rgb(var(--constellation-gold-light-rgb) / .6)',
                background: 'rgb(var(--constellation-blue-royal-rgb) / .45)',
                color: 'rgb(var(--constellation-gold-hazy-rgb))',
                fontFamily: 'Barlow, sans-serif',
                fontSize: 12,
                letterSpacing: '.16em',
                textTransform: 'uppercase',
                boxShadow: '0 0 18px rgb(var(--constellation-gold-light-rgb) / .16)',
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
                <path d="M11.99 1C5.925 1 1 5.925 1 11.99c0 2.096.541 4.063 1.485 5.775L1 23l5.39-1.455A10.93 10.93 0 0 0 11.99 23C18.055 23 23 18.075 23 12.01 23 5.945 18.055 1 11.99 1zm0 19.956a8.927 8.927 0 0 1-4.556-1.243l-.326-.194-3.199.863.864-3.112-.213-.338A8.955 8.955 0 0 1 3.044 12.01C3.044 7.05 7.04 3.044 11.99 3.044c4.95 0 8.956 3.996 8.956 8.956s-3.996 8.956-8.956 8.956z" />
              </svg>
              {isWide && 'WhatsApp'}
            </button>
          </div>

          {/* ── Header ─────────────────────────────────────────────────────── */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
              marginTop: -14,
            }}
          >
            <div
              style={{
                fontSize: 13,
                letterSpacing: '.42em',
                textTransform: 'uppercase',
                color: 'rgb(var(--constellation-blue-strong-rgb))',
              }}
            >
              Personality Analysis
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                flexWrap: 'wrap',
                justifyContent: 'center',
              }}
            >
              <div
                style={{
                  fontFamily: "'Playfair Display', serif",
                  fontSize: isWide ? 54 : 32,
                  lineHeight: 1,
                  color: 'rgb(var(--constellation-blue-pale-rgb))',
                  textShadow: '0 0 26px rgba(70,150,255,.75)',
                  textAlign: 'center',
                }}
              >
                {childName} the{' '}
                <span
                  style={{ fontStyle: 'italic', color: 'rgb(var(--constellation-blue-deep-rgb))' }}
                >
                  {typeTitle}
                </span>
              </div>
              <div
                style={{
                  width: 14,
                  height: 14,
                  background: 'rgb(var(--constellation-gold-light-rgb))',
                  borderRadius: 2,
                  transform: 'rotate(45deg)',
                  boxShadow: '0 0 18px 5px rgb(var(--constellation-gold-light-rgb) / .65)',
                  flexShrink: 0,
                }}
              />
            </div>
            <div
              style={{
                width: 120,
                height: 1,
                background:
                  'linear-gradient(90deg, transparent, rgb(var(--constellation-gold-light-rgb) / .85), transparent)',
                margin: '4px 0 2px',
              }}
            />
            <div
              style={{
                fontSize: 14,
                letterSpacing: '.18em',
                textTransform: 'uppercase',
                color: '#d8b96f',
                textAlign: 'center',
              }}
            >
              {[childName, childAge ? `Age ${childAge}` : '', typeTitle]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>

          {/* ── Trait diagram — scales proportionally to available width ──────── */}
          {traits.length > 0 && (
            <div ref={diagramRef} style={{ position: 'relative', height: diagH }}>
              {/* Outer ring */}
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  width: ringD,
                  height: ringD,
                  margin: `${-ringD / 2}px 0 0 ${-ringD / 2}px`,
                  border: '1px solid rgb(var(--constellation-blue-haze-rgb) / .16)',
                  borderRadius: '50%',
                }}
              />
              {/* Profile circle with gradient border */}
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  width: circleD,
                  height: circleD,
                  margin: `${-circleD / 2}px 0 0 ${-circleD / 2}px`,
                  borderRadius: '50%',
                  padding: Math.max(3, Math.round(7 * dScale)),
                  background: 'linear-gradient(150deg, #4aa0ff, #f7e0a3 55%, #2b76e0)',
                  boxShadow: '0 0 34px rgb(var(--constellation-blue-electric-rgb) / .4)',
                }}
              >
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={childName}
                    style={{
                      width: '100%',
                      height: '100%',
                      display: 'block',
                      borderRadius: '50%',
                      objectFit: 'cover',
                      objectPosition: '50% 15%',
                    }}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : AVATAR_MAP[avatarId] ? (
                  <div
                    style={{
                      width: '100%',
                      height: '100%',
                      borderRadius: '50%',
                      background: AVATAR_MAP[avatarId].bg,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                    }}
                  >
                    {AVATAR_MAP[avatarId].svg}
                  </div>
                ) : (
                  <div
                    style={{
                      width: '100%',
                      height: '100%',
                      borderRadius: '50%',
                      background:
                        'radial-gradient(circle at 38% 32%, rgba(60,120,200,0.5), rgb(var(--constellation-navy-glow-rgb) / 0.96))',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "'Playfair Display', serif",
                        fontSize: Math.max(24, Math.round(72 * dScale)),
                        fontWeight: 700,
                        color: 'rgb(var(--constellation-blue-pale-rgb))',
                      }}
                    >
                      {initials}
                    </span>
                  </div>
                )}
              </div>
              {/* 6 trait items */}
              {traits.slice(0, 6).map((trait, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.25 + i * 0.1 }}
                  style={{
                    position: 'absolute',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: traitGap,
                    ...traitPosScaled[i],
                  }}
                >
                  <TraitIcon index={i} containerSize={iconContainerSize} />
                  <div
                    style={{
                      fontSize: traitFontSize,
                      lineHeight: 1.3,
                      textAlign: 'center',
                      color: 'rgb(var(--constellation-blue-soft-rgb))',
                    }}
                  >
                    {trait}
                  </div>
                </motion.div>
              ))}
            </div>
          )}

          {/* ── How mind works ──────────────────────────────────────────────── */}
          {traitScores.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              style={{
                border: CARD_BORDER,
                borderRadius: 16,
                padding: '22px 26px 24px',
                background: CARD_BG,
              }}
            >
              <div style={SEC_LABEL}>How {childName}'s Mind Works</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {traitScores.map((ts, i) => (
                  <div
                    key={ts.label}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '150px 1fr 58px',
                      alignItems: 'center',
                      gap: 14,
                    }}
                  >
                    <div style={{ fontSize: 15, color: 'rgb(var(--constellation-blue-soft-rgb))' }}>
                      {ts.label}
                    </div>
                    <div
                      style={{
                        height: 12,
                        borderRadius: 8,
                        background: 'rgba(20,50,110,.7)',
                        overflow: 'hidden',
                      }}
                    >
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${ts.score}%` }}
                        transition={{ delay: 0.5 + i * 0.1, duration: 0.75, ease: 'easeOut' }}
                        style={{
                          height: '100%',
                          borderRadius: 8,
                          background: 'linear-gradient(90deg,#c9962f,#f4d68d 70%,#fff3cf)',
                        }}
                      />
                    </div>
                    <div
                      style={{
                        fontSize: 15,
                        textAlign: 'right',
                        color: 'rgb(var(--constellation-gold-light-rgb))',
                      }}
                    >
                      {ts.score}%
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* ── Thinkers ────────────────────────────────────────────────────── */}
          {famousPeople.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              style={{
                border: CARD_BORDER,
                borderRadius: 16,
                padding: '22px 26px 26px',
                background: CARD_BG,
              }}
            >
              <div style={SEC_LABEL}>Thinkers Like {childName}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
                {famousPeople.slice(0, 2).map((person, i) => (
                  <motion.div
                    key={person.name}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.6 + i * 0.1 }}
                    style={{
                      position: 'relative',
                      height: 150,
                      border: '1px solid rgb(var(--constellation-blue-haze-rgb) / .22)',
                      borderRadius: 12,
                      overflow: 'hidden',
                      background: 'rgba(4,16,44,.7)',
                    }}
                  >
                    <img
                      src={`/app-assets/famous_people/${person.name.replace(/ /g, '_')}.png`}
                      alt={person.name}
                      style={{
                        position: 'absolute',
                        inset: 0,
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                      }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = generateAvatarDataUri(person.name);
                      }}
                    />
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        background:
                          'linear-gradient(0deg, rgb(var(--constellation-void-panel-rgb) / .92) 0%, rgb(var(--constellation-void-panel-rgb) / .25) 55%, rgb(var(--constellation-void-panel-rgb) / 0) 100%)',
                      }}
                    />
                    <div
                      style={{
                        position: 'absolute',
                        left: 16,
                        bottom: 14,
                        right: 12,
                        fontSize: 13,
                        letterSpacing: '.14em',
                        textTransform: 'uppercase',
                        color: '#a9cef5',
                        lineHeight: 1.4,
                      }}
                    >
                      {person.name}
                      {person.caption ? ` · ${person.caption}` : ''}
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {/* ── Strengths ────────────────────────────────────────────────────── */}
          {strengths.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              style={{
                border: CARD_BORDER,
                borderRadius: 16,
                padding: '20px 26px 22px',
                background: CARD_BG,
              }}
            >
              <div style={{ ...SEC_LABEL, marginBottom: 16 }}>Strengths</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                {strengths.slice(0, 4).map((strength, i) => {
                  const sep = strength.match(/[:—–-](.+)/);
                  const title = sep ? strength.slice(0, strength.indexOf(sep[0])).trim() : strength;
                  return (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.7 + i * 0.07 }}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 10,
                      }}
                    >
                      <StrengthIcon index={i} />
                      <div
                        style={{
                          fontSize: 14,
                          color: 'rgb(var(--constellation-blue-soft-rgb))',
                          textAlign: 'center',
                          lineHeight: 1.3,
                        }}
                      >
                        {title}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          )}

          {/* ── In own words ─────────────────────────────────────────────────── */}
          {childQuote && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.7 }}
              style={{
                border: CARD_BORDER,
                borderRadius: 16,
                padding: '18px 30px 22px',
                background: CARD_BG,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={SEC_LABEL}>In {childName}'s Own Words</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div
                  style={{
                    fontFamily: "'Playfair Display', serif",
                    fontSize: 48,
                    lineHeight: 0.6,
                    color: 'rgb(var(--constellation-gold-dark-rgb))',
                    opacity: 0.9,
                    flexShrink: 0,
                  }}
                >
                  {'“'}
                </div>
                <div
                  style={{
                    flex: 1,
                    fontFamily: "'Playfair Display', serif",
                    fontStyle: 'italic',
                    fontSize: 24,
                    lineHeight: 1.4,
                    textAlign: 'center',
                    color: '#e6f2ff',
                  }}
                >
                  {childQuote}
                </div>
                <div
                  style={{
                    fontFamily: "'Playfair Display', serif",
                    fontSize: 48,
                    lineHeight: 0.6,
                    alignSelf: 'flex-end',
                    color: 'rgb(var(--constellation-gold-dark-rgb))',
                    opacity: 0.9,
                    flexShrink: 0,
                  }}
                >
                  {'”'}
                </div>
              </div>
            </motion.div>
          )}

          {/* ── Parent note ───────────────────────────────────────────────────── */}
          {parentNote && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.8 }}
              style={{ alignSelf: 'center', maxWidth: 600 }}
            >
              <p style={{ textAlign: 'center', fontSize: 15, lineHeight: 1.5, color: '#a9c4e6' }}>
                {parentNote}
              </p>
            </motion.div>
          )}

          {/* ── Replay link ───────────────────────────────────────────────────── */}
          <div style={{ textAlign: 'center' }}>
            <button
              onClick={() => setDisplayPhase('reveal')}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: 13,
                letterSpacing: '.22em',
                textTransform: 'uppercase',
                color: '#8a7a4e',
                padding: '6px 10px',
                fontFamily: 'Barlow, sans-serif',
              }}
            >
              Replay the reveal
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
