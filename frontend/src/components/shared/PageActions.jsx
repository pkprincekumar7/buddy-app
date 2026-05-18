import PropTypes from 'prop-types';
import { cn } from '@/lib/utils';

export default function PageActions({ left, center, right, className }) {
  return (
    <div className={cn('grid w-full grid-cols-1 gap-3 sm:grid-cols-3 sm:items-center', className)}>
      <div className="flex w-full sm:justify-start">{left}</div>
      <div className="flex w-full sm:justify-center">{center}</div>
      <div className="flex w-full sm:justify-end">{right}</div>
    </div>
  );
}

PageActions.propTypes = {
  left: PropTypes.node,
  center: PropTypes.node,
  right: PropTypes.node,
  className: PropTypes.string,
};
