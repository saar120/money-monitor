/**
 * Generate all app icon sizes from the master PNG.
 * Run: node scripts/generate-icons.mjs [source.png]
 */
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ICONS_DIR = join(ROOT, 'electron/icons');
const PUBLIC_DIR = join(ROOT, 'dashboard/public');

// Accept source path as CLI arg, default to electron/icons/icon-master.png
const sourcePath = process.argv[2] || join(ICONS_DIR, 'icon-master.png');
const sourceBuffer = readFileSync(sourcePath);

async function generatePng(size, outputPath) {
  await sharp(sourceBuffer)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(outputPath);
  console.log(`  generated ${size}x${size} -> ${outputPath}`);
}

async function main() {
  console.log(`Generating icons from ${sourcePath}...\n`);

  // 1. Generate PNGs for electron/icons/
  const electronSizes = [16, 32, 64, 128, 256, 512, 1024];
  for (const size of electronSizes) {
    await generatePng(size, join(ICONS_DIR, `icon-${size}.png`));
  }

  // 2. Generate web favicons and apple-touch-icon
  await generatePng(32, join(PUBLIC_DIR, 'favicon-32x32.png'));
  await generatePng(16, join(PUBLIC_DIR, 'favicon-16x16.png'));
  await generatePng(180, join(PUBLIC_DIR, 'apple-touch-icon.png'));
  await generatePng(192, join(PUBLIC_DIR, 'icon-192.png'));
  await generatePng(512, join(PUBLIC_DIR, 'icon-512.png'));

  // 3. Generate .ico for Windows (contains 16, 32, 48, 64, 128, 256)
  const icoSizes = [16, 32, 48, 64, 128, 256];
  const icoBuffers = [];
  for (const size of icoSizes) {
    const buf = await sharp(sourceBuffer)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    icoBuffers.push(buf);
  }
  const icoBuffer = await pngToIco(icoBuffers);
  writeFileSync(join(ICONS_DIR, 'icon.ico'), icoBuffer);
  console.log(`  generated icon.ico`);

  // 4. Generate .icns for macOS using iconutil
  const iconsetDir = join(ICONS_DIR, 'icon.iconset');
  if (!existsSync(iconsetDir)) mkdirSync(iconsetDir, { recursive: true });

  const icnsSizes = [
    { name: 'icon_16x16.png', size: 16 },
    { name: 'icon_16x16@2x.png', size: 32 },
    { name: 'icon_32x32.png', size: 32 },
    { name: 'icon_32x32@2x.png', size: 64 },
    { name: 'icon_128x128.png', size: 128 },
    { name: 'icon_128x128@2x.png', size: 256 },
    { name: 'icon_256x256.png', size: 256 },
    { name: 'icon_256x256@2x.png', size: 512 },
    { name: 'icon_512x512.png', size: 512 },
    { name: 'icon_512x512@2x.png', size: 1024 },
  ];

  for (const { name, size } of icnsSizes) {
    await generatePng(size, join(iconsetDir, name));
  }

  // Convert iconset to icns using iconutil (macOS built-in)
  execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', join(ICONS_DIR, 'icon.icns')]);
  console.log(`  generated icon.icns`);

  // Clean up iconset directory
  rmSync(iconsetDir, { recursive: true, force: true });

  console.log('\nAll icons generated successfully!');
}

main().catch(err => {
  console.error('Error generating icons:', err);
  process.exit(1);
});
