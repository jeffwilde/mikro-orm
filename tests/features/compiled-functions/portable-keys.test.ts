import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(testDir, '../../..');
const configPath = join(testDir, 'fixtures', 'portable-keys.config.ts');
const runtimePath = join(testDir, 'fixtures', 'portable-keys.runtime.ts');
const cliPath = join(rootDir, 'packages', 'cli', 'src', 'cli.ts');

describe('portable compiled function artifacts', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'mikro-orm-portable-functions-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('standalone compilation survives unrelated entity imports in an eval-free runtime', () => {
    const artifactPath = join(tempDir, 'compiled-functions.js');

    execFileSync(
      process.execPath,
      ['--import=tsx', cliPath, 'compile', '--config', configPath, '--out', artifactPath],
      { cwd: rootDir, stdio: 'pipe' },
    );
    expect(existsSync(artifactPath)).toBe(true);

    execFileSync(process.execPath, ['--import=tsx', runtimePath, artifactPath], {
      cwd: rootDir,
      stdio: 'pipe',
    });
  });
});
