// Test-only secrets. Never used outside jest.
process.env.STORAGE_SIGNING_SECRET ??= 'test-signing-secret-at-least-32-chars-long';
// RT-037: media links are signed with a key derived from this (MediaUrlSigner).
process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.LIVEKIT_API_KEY ??= 'test-key';
process.env.LIVEKIT_API_SECRET ??= 'test-secret-at-least-32-characters-long';
process.env.LIVEKIT_URL ??= 'wss://livekit.test';
