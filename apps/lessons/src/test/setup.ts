import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// The engine uses the platform's WebCrypto (browsers, and Node 24 under jsdom).
if (!globalThis.crypto?.subtle) throw new Error('these tests need WebCrypto (crypto.subtle)');
afterEach(() => cleanup());
