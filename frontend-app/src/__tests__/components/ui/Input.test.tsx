import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Input } from '@/components/ui/Input';

describe('Input', () => {
  it('renders without throwing', () => {
    expect(() => render(<Input />)).not.toThrow();
  });

  it('shows the provided placeholder', () => {
    const { getByPlaceholderText } = render(
      <Input placeholder="Enter your name" />,
    );
    expect(getByPlaceholderText('Enter your name')).toBeTruthy();
  });

  it('displays a value', () => {
    const { getByDisplayValue } = render(<Input value="hello" onChangeText={jest.fn()} />);
    expect(getByDisplayValue('hello')).toBeTruthy();
  });

  it('calls onChangeText when text changes', () => {
    const onChangeText = jest.fn();
    const { getByPlaceholderText } = render(
      <Input placeholder="type here" onChangeText={onChangeText} />,
    );
    fireEvent.changeText(getByPlaceholderText('type here'), 'new value');
    expect(onChangeText).toHaveBeenCalledWith('new value');
  });

  it('is not editable when disabled prop is set', () => {
    const { getByPlaceholderText } = render(
      <Input placeholder="disabled input" editable={false} />,
    );
    const input = getByPlaceholderText('disabled input');
    expect(input.props.editable).toBe(false);
  });
});
