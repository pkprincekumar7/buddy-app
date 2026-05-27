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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
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
          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-red-500/30 bg-red-500/10">
            <AlertTriangle className="h-7 w-7 text-red-400" />
          </div>
        </div>

        {/* Text */}
        <div className="mb-7 space-y-2 text-center">
          <h3 className="text-lg font-bold text-white">Start Over?</h3>
          <p className="text-sm leading-relaxed text-slate-400">
            This will permanently delete all progress for this child, including personality results,
            growth area answers, and goal plans.
          </p>
          <p className="text-xs font-medium text-red-400">This cannot be undone.</p>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={isStartingOver}
            className="btn-secondary h-11 flex-1 rounded-xl"
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isStartingOver}
            className="h-11 flex-1 rounded-xl bg-red-600 text-white hover:bg-red-500 disabled:opacity-50"
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
        variant="outline"
        onClick={() => childId && setConfirming(true)}
        disabled={isStartingOver || !childId}
        className={`btn-start-over h-12 rounded-2xl px-6 ${className}`}
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
