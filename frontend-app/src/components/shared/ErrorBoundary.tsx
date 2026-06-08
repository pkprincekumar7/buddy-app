import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useTheme } from '@/lib/ThemeContext';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

function ErrorFallback({ onReset }: { onReset: () => void }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.background,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        gap: 16,
      }}
    >
      <Text
        style={{
          color: colors.textMuted,
          textAlign: 'center',
          maxWidth: 320,
          lineHeight: 22,
        }}
      >
        Something went wrong. Please try again.
      </Text>
      <TouchableOpacity
        style={{
          backgroundColor: colors.primaryAction,
          paddingHorizontal: 24,
          paddingVertical: 12,
          borderRadius: 12,
        }}
        onPress={onReset}
      >
        <Text style={{ color: colors.primaryForeground, fontWeight: '600' }}>
          Try again
        </Text>
      </TouchableOpacity>
    </View>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught render error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <ErrorFallback onReset={() => this.setState({ hasError: false })} />
      );
    }
    return this.props.children;
  }
}
