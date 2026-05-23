import PropTypes from 'prop-types';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStartOver } from '@/hooks/useStartOver';

export default function StartOverButton({ childId, className = '' }) {
  const { startOver, isStartingOver } = useStartOver(childId);
  return (
    <Button
      variant="outline"
      onClick={startOver}
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
