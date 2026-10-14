/** Settings shared by the Playwright config, the database preparation and the tests. */
export const E2E_PORT = 3201;
export const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5544/frontline_e2e';
/** Signs the local demo identity cookie; local only, never a real secret. */
export const E2E_SECRET = 'e2e-local-secret';
