import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db.ts',
  out: '../../infra/drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://postgres:pulse@localhost:55432/pulse',
  },
  strict: true,
  verbose: true,
});
