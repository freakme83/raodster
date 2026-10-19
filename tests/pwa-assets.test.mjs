import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFile(path.join(root, name));
const expectedPngs = new Map([
  ['icons/icon-512.png', [512, 512]],
  ['icons/icon-192.png', [192, 192]],
  ['icons/apple-touch-icon.png', [180, 180]],
  ['icons/favicon-32.png', [32, 32]],
  ['icons/favicon-16.png', [16, 16]],
  ['icons/icon-maskable-512.png', [512, 512]],
]);

function pngSize(buffer) {
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(buffer.toString('ascii', 12, 16), 'IHDR');
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

test('PWA PNG assets have valid signatures and exact dimensions', async () => {
  for (const [file, dimensions] of expectedPngs) {
    assert.deepEqual(pngSize(await read(file)), dimensions, file);
  }
});

test('favicon.ico contains 16px and 32px icon entries', async () => {
  const ico = await read('icons/favicon.ico');
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  const count = ico.readUInt16LE(4);
  assert.ok(count >= 2);
  const sizes = new Set();
  for (let i = 0; i < count; i += 1) {
    const offset = 6 + i * 16;
    sizes.add(ico[offset] || 256);
  }
  assert.ok(sizes.has(16));
  assert.ok(sizes.has(32));
});

test('manifest icons are unique, local, present, and declared with correct purposes', async () => {
  const manifest = JSON.parse((await read('manifest.webmanifest')).toString());
  assert.equal(manifest.name, 'AIRSHIFT');
  assert.equal(manifest.short_name, 'AIRSHIFT');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  const paths = manifest.icons.map((icon) => icon.src);
  assert.equal(new Set(paths).size, paths.length);
  assert.deepEqual(manifest.icons.map(({sizes, type, purpose}) => [sizes, type, purpose]), [
    ['192x192', 'image/png', 'any'],
    ['512x512', 'image/png', 'any'],
    ['512x512', 'image/png', 'maskable'],
  ]);
  for (const icon of manifest.icons) {
    assert.equal(icon.type, 'image/png');
    assert.ok(icon.src.startsWith('./icons/'));
    await read(icon.src.slice(2));
  }
});

test('HTML links to the local favicons, Apple touch icon, and manifest once each', async () => {
  const html = (await read('index.html')).toString();
  for (const href of [
    './icons/favicon-32.png',
    './icons/favicon-16.png',
    './icons/favicon.ico',
    './icons/apple-touch-icon.png',
    './manifest.webmanifest',
  ]) {
    assert.equal(html.split(href).length - 1, 1, href);
  }
  assert.doesNotMatch(html, /icon\.svg/);
});
