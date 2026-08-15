import { pathToFileURL } from 'node:url';
import { EntityMetadata } from '@mikro-orm/core';
import { MikroORM } from '@mikro-orm/sqlite';

for (let i = 0; i < 20; i++) {
  new EntityMetadata({ className: `Unrelated${i}`, name: `Unrelated${i}` });
}

const artifactPath = process.argv[2];
const [{ default: config, User }, { default: compiledFunctions }] = await Promise.all([
  import('./portable-keys.config.js'),
  import(pathToFileURL(artifactPath).href),
]);
const OriginalFunction = globalThis.Function;
globalThis.Function = function (...args: string[]) {
  if (new Error().stack?.includes('/packages/core/src/utils/Utils.ts')) {
    throw new Error('MikroORM dynamic Function construction is forbidden');
  }

  // better-sqlite3 uses Function internally to create Node-only row factories. The
  // production Durable Object dialect does not, so allow that test-harness call.
  return OriginalFunction(...args);
} as FunctionConstructor;

let orm: MikroORM | undefined;

try {
  orm = new MikroORM({
    ...config,
    compiledFunctions,
    compiledFunctionsMode: 'required',
  });
  await orm.schema.refresh();
  const user = orm.em.create(User, { name: 'Portable' });
  await orm.em.flush();
  orm.em.clear();
  const loaded = await orm.em.findOneOrFail(User, user.id);

  if (loaded.name !== 'Portable') {
    throw new Error(`Unexpected hydrated value: ${loaded.name}`);
  }
} finally {
  globalThis.Function = OriginalFunction;
  await orm?.close(true);
}
