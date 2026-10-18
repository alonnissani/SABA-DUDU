import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, 'migrations'));
  return {
    plugins: [
      cloudflareTest({
        main: './worker/index.ts',
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: { SETUP_TOKEN: 'test-setup-token-123', TEST_MIGRATIONS: migrations },
          r2Buckets: ['MEDIA', 'BACKUP'],
        },
      }),
    ],
    test: {
      include: ['tests/api/**/*.test.ts'],
      setupFiles: ['./tests/api/setup.ts'],
    },
  };
});
