import { defineConfig, defineEntity, p, SqliteDriver } from '@mikro-orm/sqlite';

export const User = defineEntity({
  name: 'CompiledFunctionUser',
  properties: {
    id: p.integer().primary(),
    name: p.string(),
  },
});

export default defineConfig({
  driver: SqliteDriver,
  entities: [User],
  dbName: ':memory:',
});
