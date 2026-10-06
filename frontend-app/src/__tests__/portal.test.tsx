import React, { useState } from 'react';
import { Text } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { Portal, PortalHost } from '@/components/ui/portal';

function Harness({ show }: { show: boolean }) {
  const [n, setN] = useState(0);
  return (
    <PortalHost>
      <Text onPress={() => setN(c => c + 1)}>screen</Text>
      {show && (
        <Portal>
          <Text>overlay {n}</Text>
        </Portal>
      )}
    </PortalHost>
  );
}

describe('Portal', () => {
  it('renders into the host, stays live, and is removed on unmount', () => {
    const { queryByText, getByText, rerender } = render(<Harness show />);
    expect(getByText('overlay 0')).toBeTruthy();
    act(() => {
      getByText('screen').props.onPress();
    });
    expect(getByText('overlay 1')).toBeTruthy();
    rerender(<Harness show={false} />);
    expect(queryByText(/overlay/)).toBeNull();
  });
});
