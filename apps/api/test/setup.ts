// Test-only secrets. Never used outside jest.
process.env.STORAGE_SIGNING_SECRET ??= 'test-signing-secret-at-least-32-chars-long';
process.env.LIVEKIT_API_KEY ??= 'test-key';
process.env.LIVEKIT_API_SECRET ??= 'test-secret-at-least-32-characters-long';
process.env.LIVEKIT_URL ??= 'wss://livekit.test';
