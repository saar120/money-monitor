/**
 * Generate the Money Monitor app icons and macOS menu-bar template glyph.
 * Run: node scripts/generate-icons.mjs
 */
import sharp from 'sharp';
import { mkdirSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(new URL(import.meta.url)));
const ROOT = join(__dirname, '..');
const ICONS_DIR = join(ROOT, 'electron/icons');
const PUBLIC_DIR = join(ROOT, 'dashboard/public');
const MOBILE_ASSETS_DIR = join(ROOT, 'mobile/assets');

function appIconSvg({ dark, mac }) {
  const tile = mac
    ? '<rect x="64" y="64" width="896" height="896" rx="218" fill="url(#background)"/><rect x="65" y="65" width="894" height="894" rx="217" fill="none" stroke="url(#edge)" stroke-width="3"/>'
    : '<rect width="1024" height="1024" fill="url(#background)"/>';

  return `
    <svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="background" x1="180" y1="90" x2="830" y2="930" gradientUnits="userSpaceOnUse">
          ${
            dark
              ? '<stop stop-color="#183A5B"/><stop offset="0.46" stop-color="#081B31"/><stop offset="1" stop-color="#020916"/>'
              : '<stop stop-color="#39D8F3"/><stop offset="0.48" stop-color="#0B7EFF"/><stop offset="1" stop-color="#0039D7"/>'
          }
        </linearGradient>
        <radialGradient id="glow" cx="0" cy="0" r="1" gradientTransform="translate(250 120) rotate(48) scale(620 520)" gradientUnits="userSpaceOnUse">
          <stop stop-color="${dark ? '#2D638F' : '#77F3FF'}" stop-opacity="0.62"/>
          <stop offset="1" stop-color="${dark ? '#07182B' : '#0778F8'}" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="edge" x1="190" y1="75" x2="840" y2="950" gradientUnits="userSpaceOnUse">
          <stop stop-color="${dark ? '#83C4FF' : '#B6FFFF'}" stop-opacity="0.9"/>
          <stop offset="0.52" stop-color="#0A84FF" stop-opacity="0.22"/>
          <stop offset="1" stop-color="#007AFF" stop-opacity="0.75"/>
        </linearGradient>
        <linearGradient id="mark" x1="300" y1="310" x2="660" y2="720" gradientUnits="userSpaceOnUse">
          <stop stop-color="#FFFFFF"/>
          <stop offset="0.55" stop-color="#F8FAFF"/>
          <stop offset="1" stop-color="#C9E1FF"/>
        </linearGradient>
        <linearGradient id="bars" x1="705" y1="390" x2="705" y2="760" gradientUnits="userSpaceOnUse">
          <stop stop-color="#66F6F2"/>
          <stop offset="0.5" stop-color="#1BC8FF"/>
          <stop offset="1" stop-color="#0878FF"/>
        </linearGradient>
        <filter id="tileShadow" x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="24" stdDeviation="28" flood-color="#003584" flood-opacity="${dark ? '0.42' : '0.28'}"/>
        </filter>
        <filter id="markShadow" x="-25%" y="-25%" width="150%" height="160%">
          <feDropShadow dx="0" dy="13" stdDeviation="13" flood-color="#001D55" flood-opacity="${dark ? '0.48' : '0.26'}"/>
        </filter>
        <clipPath id="tileClip">
          ${
            mac
              ? '<rect x="64" y="64" width="896" height="896" rx="218"/>'
              : '<rect width="1024" height="1024"/>'
          }
        </clipPath>
      </defs>
      ${mac ? `<g filter="url(#tileShadow)">${tile}</g>` : tile}
      <g clip-path="url(#tileClip)">
        <rect width="1024" height="1024" fill="url(#glow)"/>
      </g>
      <g filter="url(#markShadow)">
        <path d="M262 714V353L451 541L686 317" fill="none" stroke="url(#mark)" stroke-width="96" stroke-linecap="round" stroke-linejoin="round"/>
        <rect x="528" y="580" width="96" height="174" rx="40" fill="url(#bars)"/>
        <rect x="660" y="486" width="96" height="268" rx="40" fill="url(#bars)"/>
        <rect x="792" y="389" width="96" height="365" rx="40" fill="url(#bars)"/>
      </g>
    </svg>`;
}

const trayGlyphSvg = `
  <svg width="1024" height="1024" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
    <path d="M2.2 14.8V4.2L7.5 9.4L12.7 4.3" fill="none" stroke="#000" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="9.1" y="11.7" width="2.2" height="3.3" rx="0.9" fill="#000"/>
    <rect x="12.2" y="8.7" width="2.2" height="6.3" rx="0.9" fill="#000"/>
    <rect x="15.3" y="5.7" width="2.2" height="9.3" rx="0.9" fill="#000"/>
  </svg>`;

async function png(source, size, outputPath) {
  await sharp(Buffer.from(source))
    .resize(size, size)
    .withIccProfile('/System/Library/ColorSync/Profiles/sRGB Profile.icc')
    .png()
    .toFile(outputPath);
  console.log(`  generated ${size}x${size} -> ${outputPath}`);
}

async function assertTransparentCorner(path) {
  const pixel = await sharp(path)
    .extract({ left: 0, top: 0, width: 1, height: 1 })
    .raw()
    .toBuffer();
  if (pixel[3] !== 0) throw new Error(`${path} must have a transparent corner`);
}

async function main() {
  console.log('Generating Money Monitor brand assets...\n');

  const macLight = appIconSvg({ dark: false, mac: true });
  const macDark = appIconSvg({ dark: true, mac: true });
  const iosLight = appIconSvg({ dark: false, mac: false });
  const iosDark = appIconSvg({ dark: true, mac: false });

  await png(macLight, 1024, join(ICONS_DIR, 'icon-master.png'));
  await png(macDark, 1024, join(ICONS_DIR, 'icon-dark.png'));
  await png(iosLight, 1024, join(MOBILE_ASSETS_DIR, 'icon.png'));
  await png(iosDark, 1024, join(MOBILE_ASSETS_DIR, 'icon-dark.png'));

  const electronSizes = [16, 32, 64, 128, 256, 512, 1024];
  for (const size of electronSizes) {
    await png(macLight, size, join(ICONS_DIR, `icon-${size}.png`));
  }

  await png(macLight, 32, join(PUBLIC_DIR, 'favicon-32x32.png'));
  await png(macLight, 16, join(PUBLIC_DIR, 'favicon-16x16.png'));
  await png(macLight, 180, join(PUBLIC_DIR, 'apple-touch-icon.png'));
  await png(macLight, 192, join(PUBLIC_DIR, 'icon-192.png'));
  await png(macLight, 512, join(PUBLIC_DIR, 'icon-512.png'));

  if (process.platform === 'darwin') {
    const iconsetDir = join(ICONS_DIR, 'icon.iconset');
    if (!existsSync(iconsetDir)) mkdirSync(iconsetDir, { recursive: true });

    for (const [name, size] of [
      ['icon_16x16.png', 16],
      ['icon_16x16@2x.png', 32],
      ['icon_32x32.png', 32],
      ['icon_32x32@2x.png', 64],
      ['icon_128x128.png', 128],
      ['icon_128x128@2x.png', 256],
      ['icon_256x256.png', 256],
      ['icon_256x256@2x.png', 512],
      ['icon_512x512.png', 512],
      ['icon_512x512@2x.png', 1024],
    ]) {
      await png(macLight, size, join(iconsetDir, name));
    }

    execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', join(ICONS_DIR, 'icon.icns')]);
    rmSync(iconsetDir, { recursive: true, force: true });
    console.log('  generated icon.icns');
  }

  await png(trayGlyphSvg, 18, join(ICONS_DIR, 'trayTemplate.png'));
  await png(trayGlyphSvg, 36, join(ICONS_DIR, 'trayTemplate@2x.png'));

  await assertTransparentCorner(join(ICONS_DIR, 'icon-master.png'));
  await assertTransparentCorner(join(ICONS_DIR, 'trayTemplate.png'));

  console.log('\nAll brand assets generated successfully.');
}

main().catch((error) => {
  console.error('Error generating icons:', error);
  process.exit(1);
});
