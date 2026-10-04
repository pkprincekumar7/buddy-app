/**
 * toast — the web's `sonner` API (`toast.error('…')`, `toast.success('…')`,
 * `toast('…')`) over react-native-toast-message, styled like the web's
 * <Toaster /> (bg-background, border-border, text-foreground,
 * muted-foreground description, bottom-center). Ported code keeps
 * `import { toast } from '@/lib/toast'` exactly where the web imported sonner.
 */
import React from 'react';
import { Text, View } from 'react-native';
import RNToast, { type ToastConfig } from 'react-native-toast-message';
import { CircleAlert, CircleCheck, Info } from 'lucide-react-native';
import { color } from '@/theme';

interface ToastOptions {
  description?: string;
  duration?: number;
}

type Kind = 'default' | 'success' | 'error' | 'info';

function show(kind: Kind, message: string, opts: ToastOptions = {}) {
  RNToast.show({
    type: kind,
    text1: message,
    text2: opts.description,
    position: 'bottom',
    visibilityTime: opts.duration ?? 4000,
  });
}

export const toast = Object.assign(
  (message: string, opts?: ToastOptions) => show('default', message, opts),
  {
    success: (message: string, opts?: ToastOptions) =>
      show('success', message, opts),
    error: (message: string, opts?: ToastOptions) =>
      show('error', message, opts),
    info: (message: string, opts?: ToastOptions) => show('info', message, opts),
    message: (message: string, opts?: ToastOptions) =>
      show('default', message, opts),
    dismiss: () => RNToast.hide(),
  },
);

const ICONS: Record<Kind, React.ReactNode> = {
  default: null,
  success: <CircleCheck size={16} color={color['success-bright']} />,
  error: <CircleAlert size={16} color={color.error} />,
  info: <Info size={16} color={color.info} />,
};

function ToastCard({
  kind,
  text1,
  text2,
}: {
  kind: Kind;
  text1?: string;
  text2?: string;
}) {
  return (
    <View
      className="mx-4 flex-row items-start gap-2 rounded-lg border border-border bg-background px-4 py-3"
      style={{ boxShadow: '0 10px 15px rgba(0,0,0,0.25)', width: '92%' }}
      accessibilityRole="alert"
    >
      {ICONS[kind] ? <View className="mt-0.5">{ICONS[kind]}</View> : null}
      <View className="flex-1">
        {text1 ? (
          <Text className="text-sm font-medium text-foreground">{text1}</Text>
        ) : null}
        {text2 ? (
          <Text className="mt-0.5 text-sm text-muted-foreground">{text2}</Text>
        ) : null}
      </View>
    </View>
  );
}

const config: ToastConfig = {
  default: p => <ToastCard kind="default" text1={p.text1} text2={p.text2} />,
  success: p => <ToastCard kind="success" text1={p.text1} text2={p.text2} />,
  error: p => <ToastCard kind="error" text1={p.text1} text2={p.text2} />,
  info: p => <ToastCard kind="info" text1={p.text1} text2={p.text2} />,
};

/** Mount once at the app root — the web's `<SonnerToaster position="bottom-center" />`. */
export function Toaster() {
  return <RNToast config={config} position="bottom" bottomOffset={48} />;
}
