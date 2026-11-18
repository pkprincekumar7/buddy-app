import React from 'react';
import { render } from '@testing-library/react-native';

// The Back row names the child whose page this is, in parent view only.
const mockParams = { childId: 'a' as string | undefined };
jest.mock('@/lib/router', () => ({
  navigate: jest.fn(),
  useParams: () => mockParams,
}));
const mockView = { mode: 'parent' as 'parent' | 'child' };
jest.mock('@/lib/ViewModeContext', () => ({
  useViewMode: () => ({ view: mockView }),
}));
jest.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true, user: { role: 'parent' } }),
}));
jest.mock('@/hooks/useChildren', () => ({
  useChildren: () => ({
    list: [
      { id: 'a', name: 'Aarav' },
      { id: 'b', name: 'Meera' },
    ],
  }),
}));
jest.mock('@/lib/appBar', () => ({
  useAppBarHidden: () => false,
  appBarFade: () => ({}),
}));

import PageBackRow from '@/components/layout/PageBackRow';

beforeEach(() => {
  mockParams.childId = 'a';
  mockView.mode = 'parent';
});

describe('PageBackRow', () => {
  it("names the page's child opposite Back, in parent view", () => {
    const view = render(<PageBackRow />);
    expect(view.getByLabelText('Back')).toBeTruthy();
    expect(view.getByTestId('page-child-name').props.children).toBe('Aarav');
    expect(view.getByLabelText('Child: Aarav')).toBeTruthy();
  });

  it('follows the page: another child, another name', () => {
    mockParams.childId = 'b';
    const view = render(<PageBackRow />);
    expect(view.getByTestId('page-child-name').props.children).toBe('Meera');
  });

  it("names no one on a page that isn't a child's", () => {
    mockParams.childId = undefined;
    const view = render(<PageBackRow />);
    expect(view.getByLabelText('Back')).toBeTruthy();
    expect(view.queryByTestId('page-child')).toBeNull();
  });

  it("names no one in child view: every page is the child's own", () => {
    mockView.mode = 'child';
    const view = render(<PageBackRow />);
    expect(view.queryByTestId('page-child')).toBeNull();
  });
});
