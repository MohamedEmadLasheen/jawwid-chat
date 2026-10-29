/**
 * The integration project's default timeout, for every test AND every hook:
 * 60 s. Under CI load a beforeEach that truncates and reseeds outran jest's
 * 5 s hook default in more than one spec (G-19: pd031-scheduling, pd012-s2).
 * It is set here because Jest 29 reads `testTimeout` from the GLOBAL config
 * only, so a per-project `testTimeout` would be ignored. A spec that calls
 * jest.setTimeout itself still wins.
 */
jest.setTimeout(60_000);
