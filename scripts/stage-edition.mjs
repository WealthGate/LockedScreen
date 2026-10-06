import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const edition = process.env.LOCKEDSCREEN_EDITION;
if (!['student', 'teacher'].includes(edition)) throw new Error('Select a valid edition.');
const desktop = resolve(root, 'apps/desktop');
const stagingRoot = resolve(desktop, 'build/edition-app');
const stage = resolve(process.env.LOCKEDSCREEN_STAGE ?? resolve(stagingRoot, edition));
if (!stage.startsWith(stagingRoot + sep)) throw new Error('Invalid staging directory.');
const pkg = JSON.parse(await readFile(resolve(desktop, 'package.json'), 'utf8'));
const parser = JSON.parse(await readFile(resolve(root, 'packages/parser/package.json'), 'utf8'));
const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'));
const names = ['electron-updater'];
if (edition === 'teacher') names.push(...Object.keys(parser.dependencies).filter(name => !name.startsWith('@lockedscreen/')));
const dependencies = Object.fromEntries(names.map(name => {
  const version = lock.packages[`node_modules/${name}`]?.version;
  if (!version) throw new Error(`Missing locked dependency: ${name}`);
  return [name, version];
}));
// Each build uses a fresh staging directory so older outputs cannot leak into it.
await mkdir(stage, { recursive: true });
await cp(resolve(desktop, 'out'), resolve(stage, 'out'), { recursive: true });
await writeFile(resolve(stage, 'package.json'), JSON.stringify({
  name: edition === 'student' ? 'lockedscreen-student' : pkg.name,
  version: pkg.version, description: pkg.description, author: pkg.author,
  type: pkg.type, main: pkg.main, dependencies
}, null, 2) + '\n');
console.log(`Staged ${edition} edition with ${names.length} direct runtime dependencies.`);
