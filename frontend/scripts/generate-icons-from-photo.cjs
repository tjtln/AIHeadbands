// Generates the PWA/app icon set from a source photo (auto-rotates via EXIF,
// then does an attention-weighted square crop so the face stays centered).
// Run with: node scripts/generate-icons-from-photo.cjs <path-to-photo>
const path = require('path');
const sharp = require('sharp');

const sourcePath = process.argv[2];
if (!sourcePath) {
  console.error('Usage: node generate-icons-from-photo.cjs <path-to-photo>');
  process.exit(1);
}

const outDir = path.join(__dirname, '..', 'public', 'icons');

const targets = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'icon-512-maskable.png', size: 512 },
  { file: 'apple-touch-icon.png', size: 180 },
  { file: 'favicon-32.png', size: 32 }
];

async function run() {
  const upright = sharp(sourcePath).rotate(); // auto-rotates per EXIF orientation

  for (const target of targets) {
    await upright
      .clone()
      .resize(target.size, target.size, {
        fit: 'cover',
        position: sharp.strategy.attention
      })
      .png()
      .toFile(path.join(outDir, target.file));
    console.log(`Wrote ${target.file} (${target.size}x${target.size})`);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
