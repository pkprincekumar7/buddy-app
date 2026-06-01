import RNToast from 'react-native-toast-message';

// Mirrors the web useToast API so call-sites need minimal changes.

export type ToastProps = {
  variant?: 'default' | 'destructive';
};

export type ToastActionElement = React.ReactNode;

interface ToastOptions {
  title?: string;
  description?: string;
  variant?: 'default' | 'destructive';
  duration?: number;
}

function toast({
  title,
  description,
  variant = 'default',
  duration = 3000,
}: ToastOptions) {
  RNToast.show({
    type: variant === 'destructive' ? 'error' : 'success',
    text1: title,
    text2: description,
    visibilityTime: duration,
  });
}

toast.error = (description: string, opts?: Omit<ToastOptions, 'variant'>) =>
  toast({ ...opts, description, variant: 'destructive' });

toast.success = (description: string, opts?: Omit<ToastOptions, 'variant'>) =>
  toast({ ...opts, description, variant: 'default' });

function useToast() {
  return { toast };
}

export { useToast, toast };
