// Builds "SearchGPT X.app" for Apple Silicon, ad-hoc signs it and produces
// a drag-to-Applications .dmg plus a .zip fallback. Works on macOS or Linux:
//   macOS: uses codesign + hdiutil
//   Linux: uses rcodesign (cargo install apple-codesign) + scripts/make-dmg.py
import { packager } from '@electron/packager';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Chromium UI languages to keep (others fall back to English). Same idea as
// electron-builder's `electronLanguages`; trims ~30 MB.
const KEEP_LOCALES = ['en', 'en_GB', 'es', 'es_419', 'fr', 'de', 'it', 'nl', 'pl', 'pt_BR', 'pt_PT', 'ru', 'tr', 'ar', 'hi', 'ja', 'ko', 'vi', 'fil', 'zh_CN', 'zh_TW'];
const has = (cmd) => {
  try {
    execFileSync('which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const arch = process.argv[2] || 'arm64';
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

const paths = await packager({
  dir: '.',
  out: 'out',
  overwrite: true,
  platform: 'darwin',
  arch,
  name: 'SearchGPT X',
  executableName: 'SearchGPT X',
  appBundleId: 'app.searchgptx.browser',
  appVersion: pkg.version,
  buildVersion: pkg.version,
  appCategoryType: 'public.app-category.productivity',
  appCopyright: 'SearchGPT X',
  icon: 'build/icon.icns',
  asar: true,
  prune: false,
  // Main, preload and renderer are fully bundled into dist/, so ship only that.
  ignore: (p) => p !== '' && !p.startsWith('/dist') && p !== '/package.json',
  protocols: [{ name: 'Web URL', schemes: ['http', 'https'] }],
  darwinDarkModeSupport: true,
  extendInfo: {
    LSMinimumSystemVersion: '11.0',
    NSCameraUsageDescription: 'Websites you allow can use the camera (for example video calls).',
    NSMicrophoneUsageDescription: 'Websites you allow can use the microphone (for example video calls).',
    NSLocationUsageDescription: 'Websites you allow can request your location.',
    NSDocumentsFolderUsageDescription: 'Lets you choose documents to analyze with the assistant.',
    NSDownloadsFolderUsageDescription: 'Saves files you download.',
    CFBundleDocumentTypes: [
      { CFBundleTypeName: 'HTML document', CFBundleTypeRole: 'Viewer', LSItemContentTypes: ['public.html'] },
      { CFBundleTypeName: 'PDF document', CFBundleTypeRole: 'Viewer', LSItemContentTypes: ['com.adobe.pdf'] }
    ]
  }
});
const outDir = paths[0];
const app = path.join(outDir, 'SearchGPT X.app');
console.log('Packaged:', app);

// 1. Trim locales.
const res = path.join(app, 'Contents/Frameworks/Electron Framework.framework/Versions/A/Resources');
let removed = 0;
for (const d of fs.readdirSync(res)) {
  if (d.endsWith('.lproj') && !KEEP_LOCALES.includes(d.replace('.lproj', ''))) {
    fs.rmSync(path.join(res, d), { recursive: true });
    removed++;
  }
}
console.log(`Removed ${removed} unused Chromium locales`);

// 2. Ad-hoc sign (Apple Silicon refuses to run unsigned code).
if (process.platform === 'darwin') {
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
} else if (has('rcodesign')) {
  execFileSync('rcodesign', ['sign', app], { stdio: ['ignore', 'ignore', 'inherit'] });
} else {
  console.warn('WARNING: rcodesign not found; the app is NOT signed and will not launch on Apple Silicon.');
}
console.log('Signed (ad-hoc)');

// 3. Disk image with an Applications shortcut, plus a zip fallback.
const base = `SearchGPT-X-${pkg.version}-${arch}`;
const stage = path.join('out', 'dmg-staging');
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
execFileSync('cp', ['-a', app, stage]);
fs.symlinkSync('/Applications', path.join(stage, 'Applications'));
const dmg = path.join('out', `${base}.dmg`);
fs.rmSync(dmg, { force: true });
if (process.platform === 'darwin') {
  execFileSync('hdiutil', ['create', '-volname', 'SearchGPT X', '-srcfolder', stage, '-ov', '-format', 'UDZO', dmg], { stdio: 'inherit' });
} else {
  execFileSync('python3', ['scripts/make-dmg.py', stage, 'SearchGPT X', dmg], { stdio: 'inherit' });
}
const zip = path.join('out', `${base}.zip`);
fs.rmSync(zip, { force: true });
if (process.platform === 'darwin') {
  execFileSync('ditto', ['-c', '-k', '--keepParent', app, zip]);
} else {
  execFileSync('zip', ['-qry', path.resolve(zip), 'SearchGPT X.app'], { cwd: outDir });
}
for (const f of [dmg, zip]) console.log(`${f}  ${(fs.statSync(f).size / 1e6).toFixed(1)} MB`);
