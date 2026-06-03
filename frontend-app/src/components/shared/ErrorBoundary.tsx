import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
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
        <View
          style={{
            flex: 1,
            backgroundColor: '#0a0a0a',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            gap: 16,
          }}
        >
          <Text
            style={{
              color: '#cbd5e1',
              textAlign: 'center',
              maxWidth: 320,
              lineHeight: 22,
            }}
          >
            Something went wrong. Please try again.
          </Text>
          <TouchableOpacity
            style={{
              backgroundColor: '#0d9488',
              paddingHorizontal: 24,
              paddingVertical: 12,
              borderRadius: 12,
            }}
            onPress={() => this.setState({ hasError: false })}
          >
            <Text style={{ color: '#ffffff', fontWeight: '600' }}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}
