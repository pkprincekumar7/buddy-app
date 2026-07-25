import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Camera, Upload, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

// ── Inline SVG avatar illustrations ──────────────────────────────────────────

const CapperSVG = () => (
  <svg viewBox="0 0 60 70" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-full w-full">
    <circle cx="30" cy="41" r="19" fill="#FDDCB5" />
    {/* Cap crown — flat top */}
    <path d="M10 30 Q10 11 30 11 Q50 11 50 30 Z" fill="#1a1a1a" />
    {/* Wide flat brim */}
    <rect x="4" y="27" width="52" height="7" rx="3.5" fill="#111" />
    <circle cx="23" cy="40" r="2.5" fill="#2C2C2C" />
    <circle cx="37" cy="40" r="2.5" fill="#2C2C2C" />
    <path
      d="M23 48 Q30 54 37 48"
      stroke="#2C2C2C"
      strokeWidth="1.5"
      fill="none"
      strokeLinecap="round"
    />
  </svg>
);

const CurlySVG = () => (
  <svg viewBox="0 0 60 70" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-full w-full">
    <circle cx="30" cy="40" r="19" fill="#FDDCB5" />
    {/* Compact wavy hair — no side puffing */}
    <path d="M13 36 Q13 13 30 13 Q47 13 47 36 Q43 29 30 28 Q17 29 13 36 Z" fill="#8B4513" />
    <circle cx="23" cy="39" r="2.5" fill="#2C2C2C" />
    <circle cx="37" cy="39" r="2.5" fill="#2C2C2C" />
    <path
      d="M23 47 Q30 53 37 47"
      stroke="#2C2C2C"
      strokeWidth="1.5"
      fill="none"
      strokeLinecap="round"
    />
  </svg>
);

const SpecsSVG = () => (
  <svg viewBox="0 0 60 70" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-full w-full">
    <circle cx="30" cy="40" r="19" fill="#FDDCB5" />
    <path d="M11 36 Q11 15 30 15 Q49 15 49 36" fill="#1a1a1a" />
    <circle cx="22" cy="40" r="7" fill="none" stroke="#222" strokeWidth="2.5" />
    <circle cx="38" cy="40" r="7" fill="none" stroke="#222" strokeWidth="2.5" />
    <path d="M29 40 L31 40" stroke="#222" strokeWidth="2.5" strokeLinecap="round" />
    <path d="M9 39 L15 39" stroke="#222" strokeWidth="2" strokeLinecap="round" />
    <path d="M45 39 L51 39" stroke="#222" strokeWidth="2" strokeLinecap="round" />
    <circle cx="22" cy="41" r="1.5" fill="#333" />
    <circle cx="38" cy="41" r="1.5" fill="#333" />
    <path
      d="M24 49 Q30 54 36 49"
      stroke="#2C2C2C"
      strokeWidth="1.5"
      fill="none"
      strokeLinecap="round"
    />
  </svg>
);

const BraidSVG = () => (
  <svg viewBox="0 0 60 70" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-full w-full">
    {/* Narrow pigtail braids — behind face */}
    <rect x="3" y="38" width="9" height="20" rx="4.5" fill="#C8854A" />
    <rect x="48" y="38" width="9" height="20" rx="4.5" fill="#C8854A" />
    <circle cx="30" cy="40" r="19" fill="#FDDCB5" />
    {/* Top hair */}
    <path d="M13 36 Q13 13 30 13 Q47 13 47 36 Q43 29 30 28 Q17 29 13 36 Z" fill="#C8854A" />
    {/* Pink hair ties */}
    <circle cx="8" cy="38" r="4" fill="#FF85B3" />
    <circle cx="52" cy="38" r="4" fill="#FF85B3" />
    <circle cx="23" cy="39" r="2.5" fill="#2C2C2C" />
    <circle cx="37" cy="39" r="2.5" fill="#2C2C2C" />
    <path
      d="M23 47 Q30 53 37 47"
      stroke="#2C2C2C"
      strokeWidth="1.5"
      fill="none"
      strokeLinecap="round"
    />
  </svg>
);

const GirlCurlsSVG = () => (
  <svg viewBox="0 0 60 70" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-full w-full">
    {/* Big voluminous curly hair — wide ellipse surrounding face */}
    <ellipse cx="30" cy="28" rx="24" ry="22" fill="#C8854A" />
    <circle cx="30" cy="40" r="19" fill="#FDDCB5" />
    <circle cx="23" cy="39" r="2.5" fill="#2C2C2C" />
    <circle cx="37" cy="39" r="2.5" fill="#2C2C2C" />
    <path
      d="M23 47 Q30 53 37 47"
      stroke="#2C2C2C"
      strokeWidth="1.5"
      fill="none"
      strokeLinecap="round"
    />
  </svg>
);

const BowSVG = () => (
  <svg viewBox="0 0 60 70" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-full w-full">
    <circle cx="30" cy="40" r="19" fill="#FDDCB5" />
    {/* Hair */}
    <path d="M13 36 Q13 13 30 13 Q47 13 47 36 Q43 29 30 28 Q17 29 13 36 Z" fill="#C8854A" />
    {/* Bow left wing */}
    <path d="M20 13 C20 6 29 6 30 13 C29 20 20 20 20 13 Z" fill="#FF85B3" />
    {/* Bow right wing */}
    <path d="M40 13 C40 6 31 6 30 13 C31 20 40 20 40 13 Z" fill="#FF85B3" />
    {/* Bow knot */}
    <circle cx="30" cy="13" r="3" fill="#E0449A" />
    <circle cx="23" cy="39" r="2.5" fill="#2C2C2C" />
    <circle cx="37" cy="39" r="2.5" fill="#2C2C2C" />
    <path
      d="M23 47 Q30 53 37 47"
      stroke="#2C2C2C"
      strokeWidth="1.5"
      fill="none"
      strokeLinecap="round"
    />
  </svg>
);

// ── Avatar definitions ────────────────────────────────────────────────────────

interface AvatarDef {
  id: string;
  label: string;
  bg: string;
  emoji: ReactNode;
}

const BOY_AVATARS: AvatarDef[] = [
  { id: 'capper-boy', label: 'Capper', bg: 'bg-teal-600', emoji: <CapperSVG /> },
  { id: 'curly-boy', label: 'Curly', bg: 'bg-violet-600', emoji: <CurlySVG /> },
  { id: 'specs-boy', label: 'Specs', bg: 'bg-amber-600', emoji: <SpecsSVG /> },
];

const GIRL_AVATARS: AvatarDef[] = [
  { id: 'braid-girl', label: 'Braid', bg: 'bg-pink-600', emoji: <BraidSVG /> },
  { id: 'curls-girl', label: 'Curls', bg: 'bg-rose-600', emoji: <GirlCurlsSVG /> },
  { id: 'bow-girl', label: 'Bow', bg: 'bg-fuchsia-600', emoji: <BowSVG /> },
];

const ALL_AVATARS = [...BOY_AVATARS, ...GIRL_AVATARS];

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChildFormData {
  name: string;
  age: string;
  gender: 'Male' | 'Female' | 'Other' | '';
  school: string;
  avatarId?: string;
  avatarUrl?: string;
}

interface Props {
  onContinue: (data: ChildFormData, photoFile?: File) => void | Promise<void>;
  initialData?: Partial<ChildFormData>;
  isLoading?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ChildProfileStep({ onContinue, initialData, isLoading }: Props) {
  const [form, setForm] = useState<ChildFormData>({
    name: initialData?.name ?? '',
    age: initialData?.age ?? '',
    gender: initialData?.gender ?? '',
    school: initialData?.school ?? '',
    avatarId: initialData?.avatarId ?? '',
  });
  const [avatarTab, setAvatarTab] = useState<'boy' | 'girl'>(
    GIRL_AVATARS.some((a) => a.id === initialData?.avatarId) ? 'girl' : 'boy',
  );
  const [errors, setErrors] = useState<Partial<Record<keyof ChildFormData, string>>>({});
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(initialData?.avatarUrl ?? null);
  const fileRef = useRef<HTMLInputElement>(null);
  const prefillApplied = useRef(false);

  // Sync initialData into form when it arrives after mount (async prefill)
  useEffect(() => {
    if (!initialData || Object.keys(initialData).length === 0) return;
    if (prefillApplied.current) return;
    prefillApplied.current = true;
    setForm({
      name: initialData.name ?? '',
      age: initialData.age ?? '',
      gender: initialData.gender ?? '',
      school: initialData.school ?? '',
      avatarId: initialData.avatarId ?? '',
    });
    if (initialData.avatarId) {
      setAvatarTab(GIRL_AVATARS.some((a) => a.id === initialData.avatarId) ? 'girl' : 'boy');
    }
    if (initialData.avatarUrl) {
      setPhotoPreview(initialData.avatarUrl);
    }
  }, [initialData]);

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => {
      setPhotoPreview((ev.target?.result as string) ?? null);
    };
    reader.readAsDataURL(file);
    // Clear emoji avatar selection when a photo is chosen
    setForm((f) => ({ ...f, avatarId: '' }));
    // Reset input so the same file can be re-selected if needed
    e.target.value = '';
  };

  const avatars = avatarTab === 'boy' ? BOY_AVATARS : GIRL_AVATARS;
  const selected = ALL_AVATARS.find((a) => a.id === form.avatarId);

  const validate = (): boolean => {
    const e: Partial<Record<keyof ChildFormData, string>> = {};
    if (!form.name.trim()) e.name = 'Name is required';
    const ageNum = Number(form.age);
    if (!form.age.trim()) e.age = 'Age is required';
    else if (isNaN(ageNum) || ageNum < 8 || ageNum > 30) e.age = 'Age must be between 8 and 30';
    if (!form.gender) e.gender = 'Please select a gender';
    if (!form.avatarId && !photoFile && !initialData?.avatarUrl)
      e.avatarId = 'Please upload a photo or pick an avatar';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleContinue = () => {
    if (!validate()) return;
    void onContinue(form, photoFile ?? undefined);
  };

  const setField = <K extends keyof ChildFormData>(key: K, val: ChildFormData[K]) => {
    setForm((f) => ({ ...f, [key]: val }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 48 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -48 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="mx-auto max-w-lg"
    >
      <div className="space-y-6 rounded-2xl border border-white/[0.08] bg-card p-6 sm:p-8">
        {/* Header */}
        <div className="space-y-1 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
            Let's start with the basics
          </p>
          <h2 className="text-2xl font-bold text-foreground">Tell us about your child</h2>
          <p className="text-sm text-muted-foreground">
            A photo or fun avatar makes the journey feel personal. Just a few quick fields.
          </p>
        </div>

        {/* Avatar preview circle */}
        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-primary/40 bg-surface-elevated transition-colors hover:border-primary/70 focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            {photoPreview ? (
              <img src={photoPreview} alt="Profile photo" className="h-full w-full object-cover" />
            ) : selected ? (
              <div
                className={`flex h-full w-full items-center justify-center ${selected.bg} select-none text-4xl`}
              >
                {selected.emoji}
              </div>
            ) : (
              <div className="pointer-events-none flex flex-col items-center gap-0.5">
                <Camera className="h-6 w-6 text-primary" />
                <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Add Photo
                </span>
                <span className="text-[8px] text-muted-foreground/50">or pick an avatar</span>
              </div>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handlePhotoChange}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
            className="gap-1.5 rounded-full border-white/[0.12] px-4 text-xs"
          >
            <Upload className="h-3 w-3" />
            Upload photo
          </Button>
        </div>

        {/* Avatar picker */}
        <div className="space-y-3 rounded-xl border border-white/[0.07] bg-surface-elevated/40 p-4">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              <span className="text-base">🎭</span> Or pick an avatar
            </span>
            <div className="flex overflow-hidden rounded-lg border border-white/[0.1]">
              {(['boy', 'girl'] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setAvatarTab(g)}
                  className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                    avatarTab === g
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {avatars.map((av) => (
              <motion.button
                key={av.id}
                type="button"
                whileTap={{ scale: 0.94 }}
                onClick={() => {
                  setField('avatarId', av.id);
                  if (photoPreview) URL.revokeObjectURL(photoPreview);
                  setPhotoFile(null);
                  setPhotoPreview(null);
                }}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-xl border p-3 transition-all focus:outline-none',
                  form.avatarId === av.id
                    ? 'border-primary bg-primary/10 ring-1 ring-primary/30'
                    : 'border-white/[0.07] bg-surface-elevated hover:border-primary/40',
                )}
              >
                <div
                  className={`relative flex h-14 w-14 items-center justify-center rounded-full ${av.bg} select-none text-2xl`}
                >
                  {av.emoji}
                  {form.avatarId === av.id && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary shadow-md"
                    >
                      <Check className="h-3 w-3 text-white" />
                    </motion.div>
                  )}
                </div>
                <span className="text-xs font-medium text-foreground">{av.label}</span>
              </motion.button>
            ))}
          </div>
        </div>

        {errors.avatarId && (
          <p className="-mt-2 text-center text-xs text-destructive">{errors.avatarId}</p>
        )}

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-white/[0.06]" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
            About your child
          </span>
          <div className="h-px flex-1 bg-white/[0.06]" />
        </div>

        {/* Form fields */}
        <div className="space-y-4">
          {/* Name + Age */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Child's Name <span className="text-primary">*</span>
              </label>
              <input
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
                placeholder="Arjun"
                className={cn(
                  'w-full rounded-xl border bg-surface-input px-4 py-2.5 text-sm text-foreground outline-none ring-primary/40 transition-all placeholder:text-muted-foreground/40 focus:ring-1',
                  errors.name ? 'border-red-500/50' : 'border-white/[0.1]',
                )}
              />
              {errors.name && <p className="text-[10px] text-red-400">{errors.name}</p>}
            </div>

            <div className="space-y-1.5">
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Age <span className="text-primary">*</span>
              </label>
              <input
                value={form.age}
                onChange={(e) => setField('age', e.target.value)}
                placeholder="8"
                type="number"
                min={8}
                max={30}
                className={cn(
                  'w-full rounded-xl border bg-surface-input px-4 py-2.5 text-sm text-foreground outline-none ring-primary/40 transition-all placeholder:text-muted-foreground/40 focus:ring-1',
                  errors.age ? 'border-red-500/50' : 'border-white/[0.1]',
                )}
              />
              {errors.age && <p className="text-[10px] text-red-400">{errors.age}</p>}
            </div>
          </div>

          {/* Gender */}
          <div className="space-y-1.5">
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Gender <span className="text-primary">*</span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['Male', 'Female', 'Other'] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setField('gender', g)}
                  className={cn(
                    'rounded-xl border py-2.5 text-sm font-medium transition-all',
                    form.gender === g
                      ? 'border-primary bg-primary/15 text-primary'
                      : 'border-white/[0.1] text-muted-foreground hover:border-primary/30 hover:text-foreground',
                  )}
                >
                  {g}
                </button>
              ))}
            </div>
            {errors.gender && <p className="text-[10px] text-red-400">{errors.gender}</p>}
          </div>

          {/* School */}
          <div className="space-y-1.5">
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              School{' '}
              <span className="font-normal normal-case tracking-normal text-muted-foreground/40">
                (optional)
              </span>
            </label>
            <input
              value={form.school}
              onChange={(e) => setField('school', e.target.value)}
              placeholder="Greenfield International"
              className="w-full rounded-xl border border-white/[0.1] bg-surface-input px-4 py-2.5 text-sm text-foreground outline-none ring-primary/40 transition-all placeholder:text-muted-foreground/40 focus:ring-1"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-1">
          <p className="text-xs text-muted-foreground/40">* Required</p>
          <Button
            type="button"
            onClick={handleContinue}
            disabled={isLoading}
            className="h-11 gap-2 rounded-full bg-primary px-8 font-semibold text-primary-foreground shadow-[0_0_16px_rgba(45,212,191,0.2)] transition-all hover:bg-primary/90"
          >
            {isLoading ? (
              <span className="flex items-center gap-2">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Saving…
              </span>
            ) : (
              'Continue →'
            )}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
