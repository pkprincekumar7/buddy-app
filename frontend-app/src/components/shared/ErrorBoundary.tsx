import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
}

/** Top-level render-error boundary — same fallback and retry as the web App.tsx boundary. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught render error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View className="flex-1 items-center justify-center gap-4 bg-background p-6">
          <Text className="max-w-lg text-center text-foreground">
            Something went wrong. Please restart the app.
          </Text>
          <Button
            variant="action"
            onPress={() => this.setState({ hasError: false })}
          >
            Try again
          </Button>
        </View>
      );
    }
    return this.props.children;
  }
}
