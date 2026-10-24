/**
 * PD-29: an uploaded HTML5 package is validated before anyone can play it.
 * Every hostile shape refuses the WHOLE package; only what was fully checked
 * is indexed, and only indexed paths are ever served.
 */
import { checkEntryPath, contentTypeOf, PackageRefused, readEntryBytes, validatePackage } from '../../../src/materials/package-validation';
import { buildZip, sampleActivity } from '../../support/zip-fixture';

function refusal(zip: Buffer): string {
  try {
    validatePackage(zip);
  } catch (e) {
    if (e instanceof PackageRefused) return e.message;
    throw e;
  }
  throw new Error('expected the package to be refused');
}

describe('PD-29 package validation', () => {
  it('indexes a valid package, finds its start page, and every entry reads back byte for byte', () => {
    const zip = sampleActivity();
    const pkg = validatePackage(zip);
    expect(pkg.entry).toBe('index.html');
    expect(pkg.entries.map((e) => e.path).sort()).toEqual(['css/app.css', 'img/star.png', 'index.html', 'js/app.js']);
    const js = pkg.entries.find((e) => e.path === 'js/app.js')!;
    expect(js.method).toBe(8);
    const bytes = readEntryBytes(zip.subarray(js.dataOffset, js.dataOffset + js.compressedSize), js.method, js.size);
    expect(bytes.toString()).toBe('document.title = "activity";');
  });

  it('accepts one top folder holding index.html (the usual export shape)', () => {
    expect(validatePackage(sampleActivity('naba-game/')).entry).toBe('naba-game/index.html');
  });

  it.each([
    ['../escape.html', 'leaves its folder'],
    ['a/../../etc/passwd.txt', 'leaves its folder'],
    ['/abs/index.html', 'absolute'],
    ['C:/windows/x.js', 'drive letter'],
    ['a\\b.js', 'backslash'],
    ['a//b.js', 'leaves its folder'],
    ['./index.html', 'leaves its folder'],
  ])('refuses the whole package for the path %j', (name, why) => {
    expect(refusal(buildZip([{ name: 'index.html', data: '<p>x</p>' }, { name, data: 'x' }]))).toContain(why);
  });

  it('refuses a control character in a path', () => {
    expect(refusal(buildZip([{ name: 'index.html', data: 'x' }, { name: 'a\u0001.js', data: 'x' }]))).toContain('control character');
  });

  it('refuses a symbolic link, an encrypted entry and a duplicate name', () => {
    expect(refusal(buildZip([{ name: 'index.html', data: 'x' }, { name: 'link.js', data: '/etc/passwd', symlink: true }]))).toContain('symbolic link');
    expect(refusal(buildZip([{ name: 'index.html', data: 'x', encrypted: true }]))).toContain('encrypted');
    expect(refusal(buildZip([{ name: 'index.html', data: 'x' }, { name: 'INDEX.html', data: 'y' }]))).toContain('twice');
  });

  it('refuses a lying size or checksum (the zip-bomb and tampering guard)', () => {
    expect(refusal(buildZip([{ name: 'index.html', data: 'hello world', deflate: true, declaredSize: 3 }]))).toMatch(/checksum|inflate/);
    expect(refusal(buildZip([{ name: 'index.html', data: 'hello', declaredCrc: 1234 }]))).toMatch(/checksum|size mismatch/);
  });

  it('refuses an entry that expands suspiciously and a package too large once unpacked', () => {
    const big = Buffer.alloc(5 * 1024 * 1024, 0x61);
    expect(refusal(buildZip([{ name: 'index.html', data: 'x' }, { name: 'a.txt', data: big, deflate: true }]))).toContain('expands suspiciously');
    const limits = { maxEntries: 2000, maxTotalBytes: 10, maxEntryBytes: 1000, maxRatio: 200 };
    expect(() => validatePackage(buildZip([{ name: 'index.html', data: 'more than ten bytes' }]), limits)).toThrow(/once unpacked/);
  });

  it('refuses too many entries', () => {
    const limits = { maxEntries: 2, maxTotalBytes: 1e9, maxEntryBytes: 1e9, maxRatio: 200 };
    expect(() => validatePackage(buildZip([{ name: 'index.html', data: 'x' }, { name: 'a.js', data: 'x' }, { name: 'b.js', data: 'x' }]), limits)).toThrow(/more than 2 files/);
  });

  it('skips (never indexes) files a web page does not need, and junk silently', () => {
    const pkg = validatePackage(buildZip([
      { name: 'index.html', data: 'x' },
      { name: 'server.php', data: '<?php ?>' },
      { name: 'run.exe', data: 'MZ' },
      { name: '__MACOSX/._index.html', data: 'x' },
      { name: '.DS_Store', data: 'x' },
    ]));
    expect(pkg.entries.map((e) => e.path)).toEqual(['index.html']);
    expect(pkg.skipped.sort()).toEqual(['run.exe', 'server.php']);
  });

  it('needs an index.html; a raw .h5p is told to export as HTML', () => {
    expect(refusal(buildZip([{ name: 'page.html', data: 'x' }]))).toContain('no index.html');
    expect(refusal(buildZip([{ name: 'h5p.json', data: '{}' }, { name: 'content/content.json', data: '{}' }]))).toContain('export it as HTML');
  });

  it('refuses what is not a zip', () => {
    expect(refusal(Buffer.from('<html>not a zip</html>'))).toContain('not a zip');
  });

  it('paths and content types', () => {
    expect(checkEntryPath('a/b/c.js')).toEqual({ ok: true });
    expect(checkEntryPath('a/../b').ok).toBe(false);
    expect(contentTypeOf('a/b.HTML')).toBe('text/html; charset=utf-8');
    expect(contentTypeOf('a.php')).toBeNull();
    expect(contentTypeOf('folder.js/noext')).toBeNull();
  });
});
