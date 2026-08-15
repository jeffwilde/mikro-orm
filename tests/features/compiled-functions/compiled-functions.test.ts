import { MikroORM, ObjectHydrator, Utils } from '@mikro-orm/sqlite';
import { CompileCommand } from '../../../packages/cli/src/commands/CompileCommand.js';
import {
  Embeddable,
  Embedded,
  Entity,
  PrimaryKey,
  Property,
  ReflectMetadataProvider,
} from '@mikro-orm/decorators/legacy';

@Embeddable()
class Address {
  @Property()
  street!: string;

  @Property()
  city!: string;
}

@Entity()
class Author {
  @PrimaryKey()
  id!: number;

  @Property()
  name!: string;

  @Embedded(() => Address)
  address!: Address;
}

@Entity()
class Book {
  @PrimaryKey()
  id!: number;

  @Property()
  title!: string;

  @Property()
  price!: number;
}

const initOptions = {
  metadataProvider: ReflectMetadataProvider,
  entities: [Author, Book, Address],
  dbName: ':memory:' as const,
};

describe('compiled functions', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init(initOptions);
    await orm.schema.refresh();
  });

  afterAll(() => orm.close(true));

  function generateCompiledFunctions(fromOrm: MikroORM): Record<string, (...args: any[]) => any> {
    const captured = CompileCommand.capture(fromOrm.getMetadata(), fromOrm.config);
    const result: Record<string, (...args: any[]) => any> = {};

    for (const { key, contextKeys, code } of captured) {
      // eslint-disable-next-line no-new-func
      const fn = new Function(...contextKeys, `'use strict';\n` + code) as (...args: any[]) => any;
      result[key] = fn;
    }

    (result as any).__version = Utils.getORMVersion();

    return result;
  }

  test('Utils.createFunction uses compiledFunctions when key matches', () => {
    const context = new Map<string, any>([
      ['a', 1],
      ['b', 2],
    ]);
    const mockFn = vi.fn((...args: any[]) => 'pregenerated');
    const compiledFunctions = { 'test-key': mockFn };

    const result = Utils.createFunction(context, 'return a + b;', compiledFunctions, 'test-key');

    expect(result).toBe('pregenerated');
    expect(mockFn).toHaveBeenCalledWith(1, 2);
  });

  test('Utils.createFunction prefers the portable content key', () => {
    const context = new Map<string, any>([
      ['a', 1],
      ['b', 2],
    ]);
    const code = 'return a + b;';
    const key = Utils.getCompiledFunctionKey(context, code);
    const mockFn = vi.fn((...args: any[]) => 'pregenerated');

    const result = Utils.createFunction(context, code, { [key]: mockFn }, 'legacy-process-local-key');

    expect(key).toMatch(/^compiled-[a-f0-9]{16}$/);
    expect(result).toBe('pregenerated');
    expect(mockFn).toHaveBeenCalledWith(1, 2);
  });

  test('portable keys include generated code and ordered context names', () => {
    const context = new Map<string, any>([
      ['a', 1],
      ['b', 2],
    ]);

    expect(Utils.getCompiledFunctionKey(context, 'return a + b;')).not.toBe(
      Utils.getCompiledFunctionKey(context, 'return a - b;'),
    );
    expect(Utils.getCompiledFunctionKey(context, 'return a + b;')).not.toBe(
      Utils.getCompiledFunctionKey(
        new Map<string, any>([
          ['b', 2],
          ['a', 1],
        ]),
        'return a + b;',
      ),
    );
  });

  test('Utils.createFunction falls back to new Function when key does not match', () => {
    const context = new Map<string, any>([
      ['a', 1],
      ['b', 2],
    ]);
    const compiledFunctions = { 'other-key': vi.fn() };

    const result = Utils.createFunction(context, 'return a + b;', compiledFunctions, 'test-key');

    expect(result).toBe(3);
  });

  test('Utils.createFunction falls back to new Function when compiledFunctions is undefined', () => {
    const context = new Map<string, any>([
      ['a', 1],
      ['b', 2],
    ]);

    const result = Utils.createFunction(context, 'return a + b;', undefined, 'test-key');

    expect(result).toBe(3);
  });

  test('Utils.createFunction falls back to new Function when key is undefined', () => {
    const context = new Map<string, any>([
      ['a', 1],
      ['b', 2],
    ]);
    const compiledFunctions = { 'test-key': vi.fn() };

    const result = Utils.createFunction(context, 'return a + b;', compiledFunctions);

    expect(result).toBe(3);
  });

  test('Utils.createFunction throws instead of falling back in required mode', () => {
    const context = new Map<string, any>([
      ['a', 1],
      ['b', 2],
    ]);

    expect(() => Utils.createFunction(context, 'return a + b;', {}, 'test-key', 'required')).toThrow(
      /No pre-compiled function found.*Regenerate the artifact/,
    );
  });

  test('generated keys do not depend on process-local metadata ids', () => {
    const before = CompileCommand.capture(orm.getMetadata(), orm.config).map(item => item.key);
    const metadata = [...orm.getMetadata()];
    const originalIds = metadata.map(meta => meta._id);

    metadata.forEach((meta, index) => ((meta as any)._id = 100_000 + index * 1000));

    try {
      const after = CompileCommand.capture(orm.getMetadata(), orm.config).map(item => item.key);
      expect(after).toEqual(before);
      expect(after.every(key => /^compiled-[a-f0-9]{16}$/.test(key))).toBe(true);
    } finally {
      metadata.forEach((meta, index) => ((meta as any)._id = originalIds[index]));
    }
  });

  test('compiled functions produce identical results to JIT path', async () => {
    const compiledFunctions = generateCompiledFunctions(orm);

    const orm2 = await MikroORM.init({ ...initOptions, compiledFunctions });

    try {
      await orm2.schema.refresh();

      // Insert test data via orm (JIT path)
      const author = orm.em.create(Author, {
        name: 'John',
        address: { street: '123 Main St', city: 'Springfield' },
      });
      await orm.em.flush();

      // Insert same data via orm2 (compiled functions path)
      const author2 = orm2.em.create(Author, {
        name: 'John',
        address: { street: '123 Main St', city: 'Springfield' },
      });
      await orm2.em.flush();

      // Test comparator - both ORMs should produce same snapshot
      const comparator1 = orm.config.getComparator(orm.getMetadata());
      const comparator2 = orm2.config.getComparator(orm2.getMetadata());
      const meta = orm.getMetadata().get(Author);
      const meta2 = orm2.getMetadata().get(Author);

      const snapshot1 = comparator1.prepareEntity(author);
      const snapshot2 = comparator2.prepareEntity(author2);

      expect(snapshot1).toEqual(snapshot2);

      // Test result mapper - both should map DB rows identically
      const mapper1 = comparator1.getResultMapper(meta);
      const mapper2 = comparator2.getResultMapper(meta2);
      const testRow = { id: 1, name: 'John', address_street: '123 Main St', address_city: 'Springfield' };
      expect(mapper1(testRow)).toEqual(mapper2(testRow));

      // Test PK getter
      const pkGetter1 = comparator1.getPkGetter(meta);
      const pkGetter2 = comparator2.getPkGetter(meta2);
      expect(pkGetter1(author)).toEqual(pkGetter2(author2));

      // Test PK serializer
      const pkSerializer1 = comparator1.getPkSerializer(meta);
      const pkSerializer2 = comparator2.getPkSerializer(meta2);
      expect(pkSerializer1(author)).toEqual(pkSerializer2(author2));
    } finally {
      await orm2.close(true);
    }
  });

  test('no new Function calls when compiledFunctions covers all entities', async () => {
    const compiledFunctions = generateCompiledFunctions(orm);

    const orm2 = await MikroORM.init({ ...initOptions, compiledFunctions });

    try {
      // Wrap createFunction to track if new Function is ever called (JIT fallback)
      let jitFallbackCalled = false;
      const original = Utils.createFunction;
      Utils.createFunction = (context, code, cf, key) => {
        const result = original.call(Utils, context, code, cf, key);

        const compiledKey = Utils.getCompiledFunctionKey(context, code);

        if (!cf?.[compiledKey] && (!key || !cf?.[key])) {
          jitFallbackCalled = true;
        }

        return result;
      };

      try {
        // Trigger all compiled function paths
        const metadata = orm2.getMetadata();
        const comparator = orm2.config.getComparator(metadata);
        const hydrator = orm2.config.getHydrator(metadata) as ObjectHydrator;

        for (const meta of metadata) {
          if (meta.abstract) {
            continue;
          }

          hydrator.getEntityHydrator(meta, 'full', false);
          hydrator.getEntityHydrator(meta, 'full', true);
          comparator.getEntityComparator(meta.class);
          comparator.getSnapshotGenerator(meta.class);
          comparator.getResultMapper(meta);

          if (!meta.embeddable && !meta.virtual) {
            hydrator.getEntityHydrator(meta, 'reference', false);
            hydrator.getEntityHydrator(meta, 'reference', true);
          }

          if (meta.primaryKeys.length > 0) {
            comparator.getPkGetter(meta);
            comparator.getPkGetterConverted(meta);
            comparator.getPkSerializer(meta);
          }
        }
      } finally {
        Utils.createFunction = original;
      }

      // No JIT fallback should have occurred
      expect(jitFallbackCalled).toBe(false);
    } finally {
      await orm2.close(true);
    }
  });

  test('driver comparator uses compiledFunctions for all read operations', async () => {
    const compiledFunctions = generateCompiledFunctions(orm);

    const orm2 = await MikroORM.init({ ...initOptions, compiledFunctions });

    try {
      await orm2.schema.refresh();

      // Insert test data
      orm2.em.create(Book, { title: 'Test Book', price: 19.99 });
      await orm2.em.flush();
      orm2.em.clear();

      // Wrap createFunction to track if new Function is ever called (JIT fallback)
      let jitFallbackCalled = false;
      const original = Utils.createFunction;
      Utils.createFunction = (context, code, cf, key) => {
        const result = original.call(Utils, context, code, cf, key);

        const compiledKey = Utils.getCompiledFunctionKey(context, code);

        if (!cf?.[compiledKey] && (!key || !cf?.[key])) {
          jitFallbackCalled = true;
        }

        return result;
      };

      try {
        // All read operations (find, findOne, stream, em.map, etc.) go through
        // the driver's own EntityComparator — not the one from config.getComparator().
        // Before the fix, this comparator was created without config, so
        // compiledFunctions were ignored and new Function() was called.
        const loaded = await orm2.em.findOneOrFail(Book, { title: 'Test Book' });
        expect(loaded.title).toBe('Test Book');
        expect(loaded.price).toBe(19.99);
      } finally {
        Utils.createFunction = original;
      }

      expect(jitFallbackCalled).toBe(false);
    } finally {
      await orm2.close(true);
    }
  });

  test('falls back to JIT when compiledFunctions is empty', async () => {
    const orm2 = await MikroORM.init({ ...initOptions, compiledFunctions: {} });

    try {
      await orm2.schema.refresh();

      const book = orm2.em.create(Book, { title: 'Test', price: 9.99 });
      await orm2.em.flush();
      orm2.em.clear();

      const loaded = await orm2.em.findOneOrFail(Book, book.id);
      expect(loaded.title).toBe('Test');
      expect(loaded.price).toBe(9.99);
    } finally {
      await orm2.close(true);
    }
  });

  test('required mode validates complete coverage during initialization', async () => {
    await expect(
      MikroORM.init({
        ...initOptions,
        compiledFunctions: {},
        compiledFunctionsMode: 'required',
      }),
    ).rejects.toThrow(/generated with MikroORM vunknown/);

    await expect(
      MikroORM.init({
        ...initOptions,
        compiledFunctions: { __version: '0.0.0' } as any,
        compiledFunctionsMode: 'required',
      }),
    ).rejects.toThrow(/generated with MikroORM v0\.0\.0/);

    await expect(
      MikroORM.init({
        ...initOptions,
        compiledFunctions: { __version: Utils.getORMVersion() } as any,
        compiledFunctionsMode: 'required',
      }),
    ).rejects.toThrow(/No pre-compiled function found/);

    const compiledFunctions = generateCompiledFunctions(orm);
    const orm2 = await MikroORM.init({
      ...initOptions,
      compiledFunctions,
      compiledFunctionsMode: 'required',
    });

    await orm2.close(true);
  });
});
