/* eslint-disable */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const BLUE = '#3182F6';

const iconSvg = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#3182F6"/>
      <stop offset="100%" stop-color="#5B9BFD"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="40%" r="50%">
      <stop offset="0%" stop-color="rgba(255,255,255,0.25)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
    </radialGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <rect width="1024" height="1024" fill="url(#glow)"/>
  <circle cx="512" cy="512" r="240" fill="none" stroke="#FFFFFF" stroke-width="56"/>
  <circle cx="512" cy="512" r="100" fill="#FFFFFF"/>
  <circle cx="780" cy="280" r="40" fill="#FF5C5C"/>
</svg>`;

const adaptiveSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="#3182F6"/>
  <circle cx="512" cy="512" r="240" fill="none" stroke="#FFFFFF" stroke-width="56"/>
  <circle cx="512" cy="512" r="100" fill="#FFFFFF"/>
</svg>`;

const splashSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="2048" viewBox="0 0 2048 2048">
  <rect width="2048" height="2048" fill="#3182F6"/>
  <g transform="translate(1024 1024)">
    <circle cx="0" cy="-80" r="180" fill="none" stroke="#FFFFFF" stroke-width="40"/>
    <circle cx="0" cy="-80" r="80" fill="#FFFFFF"/>
    <text y="240" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif" font-size="160" font-weight="900" fill="#FFFFFF" letter-spacing="-4">지금·여기</text>
    <text y="350" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif" font-size="56" font-weight="700" fill="rgba(255,255,255,0.85)">내 동네 짧은 만남</text>
  </g>
</svg>`;

const outDir = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

(async () => {
  await sharp(Buffer.from(iconSvg(1024)))
    .resize(1024, 1024)
    .png()
    .toFile(path.join(outDir, 'icon.png'));
  console.log('✓ icon.png');

  await sharp(Buffer.from(adaptiveSvg))
    .resize(1024, 1024)
    .png()
    .toFile(path.join(outDir, 'adaptive-icon.png'));
  console.log('✓ adaptive-icon.png');

  await sharp(Buffer.from(splashSvg))
    .resize(2048, 2048)
    .png()
    .toFile(path.join(outDir, 'splash.png'));
  console.log('✓ splash.png');

  await sharp(Buffer.from(adaptiveSvg))
    .resize(196, 196)
    .png()
    .toFile(path.join(outDir, 'favicon.png'));
  console.log('✓ favicon.png');
})();
