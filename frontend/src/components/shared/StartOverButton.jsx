import { useState } from 'react';
import PropTypes from 'prop-types';
import { RotateCcw, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStartOver } from '@/hooks/useStartOver';

export default function StartOverButton({ childId, className = '' }) {
  const { doStartOver, isStartingOver } = useStartOver(childId);
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div
        className={`flex flex-col items-center gap-2.5 rounded-2xl border border-red-500/30 bg-red-500/10 px-5 py-3 ${className}`}
      >
        <div className="flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-red-400" />
          <p className="text-xs font-medium text-red-300">Delete this child&apos;s progress?</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirming(false)}
            className="h-8 rounded-xl border-slate-700 bg-transparent text-slate-300 hover:border-slate-500 hover:text-white"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setConfirming(false);
              doStartOver();
            }}
            disabled={isStartingOver}
            className="h-8 rounded-xl bg-red-600 text-white hover:bg-red-500 disabled:opacity-50"
          >
            {isStartingOver ? 'Deleting…' : 'Yes, delete'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Button
      variant="outline"
      onClick={() => childId && setConfirming(true)}
      disabled={isStartingOver || !childId}
      className={`btn-start-over h-12 rounded-2xl px-6 ${className}`}
    >
      <RotateCcw className="mr-1 h-4 w-4" />
      {isStartingOver ? 'Resetting…' : 'Start Over'}
    </Button>
  );
}

StartOverButton.propTypes = {
  childId: PropTypes.string,
  className: PropTypes.string,
};
