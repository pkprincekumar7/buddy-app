import React from 'react';
import { ScrollView, type ScrollViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cn } from '@/lib/utils';
import PageBackRow from './PageBackRow';

interface PageScrollProps extends ScrollViewProps {
  className?: string;
  contentContainerClassName?: string;
  /** Omit the Back row (e.g. Login/Register, which render outside the web Layout). */
  hideBackRow?: boolean;
  children: React.ReactNode;
}

/**
 * The document-scroll stand-in for a web page: a full-height ScrollView on
 * `bg-background` that starts with the Layout's Back row and pads the bottom
 * for the home indicator. Pages whose web layout is a full-viewport fixed
 * scene (no document scroll) should render <PageBackRow /> themselves instead.
 */
const PageScroll = React.forwardRef<ScrollView, PageScrollProps>(
  (
    {
      className,
      contentContainerClassName,
      hideBackRow,
      children,
      contentContainerStyle,
      ...props
    },
    ref,
  ) => {
    const insets = useSafeAreaInsets();
    return (
      <ScrollView
        ref={ref}
        className={cn('flex-1 bg-background', className)}
        contentContainerClassName={contentContainerClassName}
        contentContainerStyle={[
          { paddingBottom: insets.bottom + 16 },
          contentContainerStyle,
        ]}
        keyboardShouldPersistTaps="handled"
        {...props}
      >
        {hideBackRow ? null : <PageBackRow />}
        {children}
      </ScrollView>
    );
  },
);
PageScroll.displayName = 'PageScroll';
export default PageScroll;
