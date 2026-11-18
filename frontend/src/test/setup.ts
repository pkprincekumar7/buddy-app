import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Each test starts on an empty page.
afterEach(() => cleanup());
