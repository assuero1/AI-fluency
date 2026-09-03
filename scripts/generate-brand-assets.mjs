// Gera os assets de marca do Talkkito a partir das imagens originais do usuário em logo/.
// Uso: node scripts/generate-brand-assets.mjs
//
// Saídas em public/: mascot.png (recorte transparente), icon-192/512.png,
// icon-maskable-192/512.png, apple-touch-icon.png e icon.svg (raster embutido).
// As fontes em logo/ e assets/ são arquivos do usuário (não versionados).

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");
const sourcePath = path.join(root, "logo", "Captura de Tela 2026-09-03 às 18.18.17.png");

// Corte do fundo: flood-fill a partir das bordas. Fundo = branco puro ou sombra
// cinza-clara (pouca saturação). O interior fechado (branco dos olhos) não é alcançado.
function isBackground(r, g, b) {
  const min = Math.min(r, g, b);
  const max = Math.max(r, g, b);
  return (min >= 232 && max - min <= 14) || (min >= 190 && max - min <= 24);
}

function cutout(raw, width, height) {
  const pixels = new Uint8ClampedArray(raw); // RGBA
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  const push = (x, y) => {
    const idx = y * width + x;
    if (visited[idx]) return;
    const o = idx * 4;
    if (!isBackground(pixels[o], pixels[o + 1], pixels[o + 2])) return;
    visited[idx] = 1;
    pixels[o + 3] = 0;
    queue[tail++] = idx;
  };

  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }

  while (head < tail) {
    const idx = queue[head++];
    const x = idx % width;
    const y = (idx / width) | 0;
    if (x > 0) push(x - 1, y);
    if (x < width - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < height - 1) push(x, y + 1);
  }
  return pixels;
}

function bounds(pixels, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, minY, maxX, maxY };
}

// Mantém apenas o maior bloco opaco (o mascote) e apaga ilhas soltas que
// sobraram da sombra nos pés.
function keepLargestComponent(pixels, width, height) {
  const label = new Int32Array(width * height).fill(-1);
  const queue = new Int32Array(width * height);
  let bestLabel = -1;
  let bestSize = 0;
  let nextLabel = 0;

  for (let start = 0; start < width * height; start++) {
    if (label[start] !== -1 || pixels[start * 4 + 3] === 0) continue;
    let head = 0;
    let tail = 0;
    let size = 0;
    label[start] = nextLabel;
    queue[tail++] = start;
    while (head < tail) {
      const idx = queue[head++];
      size++;
      const x = idx % width;
      const y = (idx / width) | 0;
      const neighbors = [];
      if (x > 0) neighbors.push(idx - 1);
      if (x < width - 1) neighbors.push(idx + 1);
      if (y > 0) neighbors.push(idx - width);
      if (y < height - 1) neighbors.push(idx + width);
      for (const n of neighbors) {
        if (label[n] === -1 && pixels[n * 4 + 3] > 0) {
          label[n] = nextLabel;
          queue[tail++] = n;
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      bestLabel = nextLabel;
    }
    nextLabel++;
  }

  for (let idx = 0; idx < width * height; idx++) {
    if (pixels[idx * 4 + 3] > 0 && label[idx] !== bestLabel) pixels[idx * 4 + 3] = 0;
  }
  return bestSize;
}

async function main() {
  const padding = 8;
  const { data, info } = await sharp(sourcePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const cut = cutout(data, info.width, info.height);
  const kept = keepLargestComponent(cut, info.width, info.height);
  console.log(`componente principal: ${kept} px`);
  const box = bounds(cut, info.width, info.height);
  const left = Math.max(0, box.minX - padding);
  const top = Math.max(0, box.minY - padding);
  const width = Math.min(info.width, box.maxX + padding) - left;
  const height = Math.min(info.height, box.maxY + padding) - top;
  console.log(`recorte: ${width}x${height} em (${left}, ${top})`);

  const pngOptions = { palette: true, quality: 90, compressionLevel: 9 };
  const mascot = await sharp(cut, { raw: { width: info.width, height: info.height, channels: 4 } })
    .extract({ left, top, width, height })
    .png(pngOptions)
    .toBuffer();
  await sharp(mascot).toFile(path.join(publicDir, "mascot.png"));

  // Ícones: fundo branco, mascote em alturas diferentes. Maskable usa zona de
  // segurança (~64% do lado) para o recorte circular do Android.
  const icons = [
    { file: "icon-512.png", size: 512, mascotHeight: 400 },
    { file: "icon-192.png", size: 192, mascotHeight: 150 },
    { file: "icon-maskable-512.png", size: 512, mascotHeight: 316 },
    { file: "icon-maskable-192.png", size: 192, mascotHeight: 118 },
    { file: "apple-touch-icon.png", size: 180, mascotHeight: 144 }
  ];
  for (const { file, size, mascotHeight } of icons) {
    const scaled = await sharp(mascot)
      .resize({ height: mascotHeight })
      .png()
      .toBuffer();
    const meta = await sharp(scaled).metadata();
    await sharp({ create: { width: size, height: size, channels: 4, background: "#ffffff" } })
      .composite([{ input: scaled, left: Math.round((size - meta.width) / 2), top: Math.round((size - mascotHeight) / 2) }])
      .png(pngOptions)
      .toFile(path.join(publicDir, file));
    console.log(`${file}: mascote ${meta.width}x${meta.height}`);
  }

  // icon.svg: mesmo visual do ícone 512 com o raster embutido (mantido porque o
  // middleware e o teste de auth o listam como arquivo público).
  const svgIcon = await sharp(mascot)
    .resize({ height: 400 })
    .png()
    .toBuffer();
  const meta = await sharp(svgIcon).metadata();
  const embedded = await sharp({ create: { width: 512, height: 512, channels: 4, background: "#ffffff" } })
    .composite([{ input: svgIcon, left: Math.round((512 - meta.width) / 2), top: Math.round((512 - 400) / 2) }])
    .png(pngOptions)
    .toBuffer();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-labelledby="title">
  <title id="title">Talkkito</title>
  <image width="512" height="512" href="data:image/png;base64,${embedded.toString("base64")}" />
</svg>
`;
  writeFileSync(path.join(publicDir, "icon.svg"), svg);
  console.log(`icon.svg: ${(svg.length / 1024).toFixed(0)} KB`);
}

await main();
