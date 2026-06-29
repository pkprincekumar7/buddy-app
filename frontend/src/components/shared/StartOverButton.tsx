import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

import { RotateCcw, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useStartOver } from '@/hooks/useStartOver';
import { MODAL_BACKDROP, MODAL_SCALE } from '@/lib/animations';

interface ConfirmModalProps {
  onCancel: () => void;
  onConfirm: () => void;
  isStartingOver: boolean;
}

function ConfirmModal({ onCancel, onConfirm, isStartingOver }: ConfirmModalProps) {
  // Close on Escape key
  const handleKey = useCallback(
    (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    },
    [onCancel],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  return createPortal(
    <motion.div
      {...MODAL_BACKDROP}
      className="bg-overlay fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
      onClick={onCancel}
      role="presentation"
    >
      <motion.div
        {...MODAL_SCALE}
        role="dialog"
        aria-modal="true"
        aria-label="Confirm start over"
        className="border-edge-strong w-full max-w-sm rounded-2xl bg-surface-elevated p-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Icon */}
        <div className="mb-5 flex justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-error-medium/30 bg-error-medium/10">
            <AlertTriangle className="h-7 w-7 text-error" />
          </div>
        </div>

        {/* Text */}
        <div className="mb-7 space-y-2 text-center">
          <h3 className="text-lg font-bold text-foreground">Start Over?</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            All progress for this child will be permanently deleted — personality results, growth
            area answers, and goal plans. You will need to restart the onboarding from the
            beginning.
          </p>
          <p className="text-xs font-medium text-error">This cannot be undone.</p>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <Button
            onClick={onConfirm}
            disabled={isStartingOver}
            className="h-11 flex-1 rounded-xl bg-error-strong text-base text-white hover:bg-error-medium disabled:opacity-50"
          >
            {isStartingOver ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Deleting…
              </span>
            ) : (
              'Yes, delete'
            )}
          </Button>
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={isStartingOver}
            className="btn-secondary h-11 flex-1 rounded-xl text-base"
          >
            Cancel
          </Button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

interface StartOverButtonProps {
  childId?: string;
  className?: string;
}

export default function StartOverButton({ childId, className = '' }: StartOverButtonProps) {
  const { doStartOver, isStartingOver } = useStartOver(childId);
  const [confirming, setConfirming] = useState(false);

  const handleConfirm = useCallback(() => {
    setConfirming(false);
    void doStartOver();
  }, [doStartOver]);

  const handleCancel = useCallback(() => setConfirming(false), []);

  return (
    <>
      <Button
        size="xl"
        variant="outline"
        onClick={() => childId && setConfirming(true)}
        disabled={isStartingOver || !childId}
        className={`btn-start-over rounded-2xl ${className}`}
      >
        <RotateCcw className="mr-1 h-4 w-4" />
        {isStartingOver ? 'Resetting…' : 'Start Over'}
      </Button>

      <AnimatePresence>
        {confirming && (
          <ConfirmModal
            onCancel={handleCancel}
            onConfirm={handleConfirm}
            isStartingOver={isStartingOver}
          />
        )}
      </AnimatePresence>
    </>
  );
}
