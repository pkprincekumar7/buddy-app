import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Button } from '@/components/ui/Button';

describe('Button', () => {
  it('renders its children', () => {
    const { getByText } = render(<Button>Press me</Button>);
    expect(getByText('Press me')).toBeTruthy();
  });

  it('calls onPress when tapped', () => {
    const onPress = jest.fn();
    const { getByText } = render(<Button onPress={onPress}>Tap</Button>);
    fireEvent.press(getByText('Tap'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not call onPress when disabled', () => {
    const onPress = jest.fn();
    const { getByText } = render(
      <Button onPress={onPress} disabled>
        Disabled
      </Button>,
    );
    fireEvent.press(getByText('Disabled'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('shows ActivityIndicator when loading=true', () => {
    const { UNSAFE_getByType } = render(
      <Button loading>Loading</Button>,
    );
    const { ActivityIndicator } = require('react-native');
    expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
  });

  it('renders outline variant without throwing', () => {
    expect(() =>
      render(<Button variant="outline">Outline</Button>),
    ).not.toThrow();
  });

  it('renders destructive variant without throwing', () => {
    expect(() =>
      render(<Button variant="destructive">Delete</Button>),
    ).not.toThrow();
  });

  it('renders large size without throwing', () => {
    expect(() =>
      render(<Button size="lg">Large</Button>),
    ).not.toThrow();
  });
});
