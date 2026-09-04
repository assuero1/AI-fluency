import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const OUTPUT_DIR = "public/assets/icons/talkito";
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const BRAIN_DIR = "/Users/assueroferreira/.gemini/antigravity/brain/4e00078e-fc01-448a-a584-e632be9010f1";

const ASSETS = [
  // Sheet 1: Gamification
  {
    source: `${BRAIN_DIR}/talkito_2d_game_pack_1788538725233.jpg`,
    name: "streak-flame.png",
    box: { left: 55, top: 45, width: 270, height: 295 }
  },
  {
    source: `${BRAIN_DIR}/talkito_2d_game_pack_1788538725233.jpg`,
    name: "trophy.png",
    box: { left: 340, top: 75, width: 330, height: 265 }
  },
  {
    source: `${BRAIN_DIR}/talkito_2d_game_pack_1788538725233.jpg`,
    name: "target.png",
    box: { left: 680, top: 60, width: 280, height: 280 }
  },
  {
    source: `${BRAIN_DIR}/talkito_2d_game_pack_1788538725233.jpg`,
    name: "lightbulb.png",
    box: { left: 70, top: 385, width: 240, height: 260 }
  },
  {
    source: `${BRAIN_DIR}/talkito_2d_game_pack_1788538725233.jpg`,
    name: "brain.png",
    box: { left: 680, top: 410, width: 275, height: 215 }
  },
  {
    source: `${BRAIN_DIR}/talkito_2d_game_pack_1788538725233.jpg`,
    name: "lightning.png",
    box: { left: 410, top: 690, width: 180, height: 260 }
  },
  {
    source: `${BRAIN_DIR}/talkito_2d_game_pack_1788538725233.jpg`,
    name: "party-popper.png",
    box: { left: 690, top: 680, width: 260, height: 270 }
  },

  // Sheet 2: Audio & Speech
  {
    source: `${BRAIN_DIR}/talkito_2d_audio_pack_1788538769799.jpg`,
    name: "teacher-chameleon.png",
    box: { left: 60, top: 50, width: 460, height: 380 }
  },
  {
    source: `${BRAIN_DIR}/talkito_2d_audio_pack_1788538769799.jpg`,
    name: "microphone.png",
    box: { left: 590, top: 50, width: 360, height: 360 }
  },
  {
    source: `${BRAIN_DIR}/talkito_2d_audio_pack_1788538769799.jpg`,
    name: "listening-bubble.png",
    box: { left: 320, top: 470, width: 360, height: 250 }
  },

  // Sheet 3: Routine & Topics
  {
    source: `${BRAIN_DIR}/talkito_2d_routine_pack_1788538818120.jpg`,
    name: "calendar-desk.png",
    box: { left: 60, top: 120, width: 310, height: 285 }
  },
  {
    source: `${BRAIN_DIR}/talkito_2d_routine_pack_1788538818120.jpg`,
    name: "clock-timer.png",
    box: { left: 395, top: 115, width: 240, height: 295 }
  },
  {
    source: `${BRAIN_DIR}/talkito_2d_routine_pack_1788538818120.jpg`,
    name: "travel-suitcase.png",
    box: { left: 680, top: 110, width: 280, height: 310 }
  },
  {
    source: `${BRAIN_DIR}/talkito_2d_routine_pack_1788538818120.jpg`,
    name: "remote-laptop.png",
    box: { left: 65, top: 565, width: 410, height: 330 }
  },
  {
    source: `${BRAIN_DIR}/talkito_2d_routine_pack_1788538818120.jpg`,
    name: "growth-stairs.png",
    box: { left: 550, top: 535, width: 390, height: 360 }
  },

  // Sheet 4: Rarity Badges & Actions
  {
    source: `${BRAIN_DIR}/talkito_2d_rarity_pack_1788538864972.jpg`,
    name: "badge-essential.png",
    box: { left: 55, top: 70, width: 280, height: 280 }
  },
  {
    source: `${BRAIN_DIR}/talkito_2d_rarity_pack_1788538864972.jpg`,
    name: "badge-native.png",
    box: { left: 360, top: 65, width: 280, height: 290 }
  },
  {
    source: `${BRAIN_DIR}/talkito_2d_rarity_pack_1788538864972.jpg`,
    name: "badge-power.png",
    box: { left: 670, top: 70, width: 290, height: 280 }
  },
  {
    source: `${BRAIN_DIR}/talkito_2d_rarity_pack_1788538864972.jpg`,
    name: "check-stamp.png",
    box: { left: 360, top: 365, width: 280, height: 280 }
  },
  {
    source: `${BRAIN_DIR}/talkito_2d_rarity_pack_1788538864972.jpg`,
    name: "alert-badge.png",
    box: { left: 670, top: 365, width: 280, height: 280 }
  },
  {
    source: `${BRAIN_DIR}/talkito_2d_rarity_pack_1788538864972.jpg`,
    name: "lock-gold.png",
    box: { left: 690, top: 645, width: 240, height: 290 }
  },

  // Sheet 5: Standing Mascot
  {
    source: `${BRAIN_DIR}/.user_uploaded/media_1788538547982.jpg`,
    name: "chameleon-standing.png",
    box: { left: 130, top: 140, width: 340, height: 280 }
  },

  // Sheet 6: Communication & Knowledge
  {
    source: `${BRAIN_DIR}/talkito_2d_comm_pack_1788546620954.jpg`,
    name: "book-open.png",
    box: { left: 50, top: 80, width: 280, height: 280 }
  },
  {
    source: `${BRAIN_DIR}/talkito_2d_comm_pack_1788546620954.jpg`,
    name: "speech-bubble.png",
    box: { left: 360, top: 80, width: 280, height: 280 }
  },
  {
    source: `${BRAIN_DIR}/talkito_2d_comm_pack_1788546620954.jpg`,
    name: "bot-chameleon.png",
    box: { left: 670, top: 80, width: 300, height: 280 }
  },
  {
    source: `${BRAIN_DIR}/talkito_2d_comm_pack_1788546620954.jpg`,
    name: "user-round.png",
    box: { left: 50, top: 380, width: 280, height: 280 }
  },
  {
    source: `${BRAIN_DIR}/talkito_2d_comm_pack_1788546620954.jpg`,
    name: "users.png",
    box: { left: 360, top: 380, width: 300, height: 280 }
  },
  {
    source: `${BRAIN_DIR}/talkito_2d_comm_pack_1788546620954.jpg`,
    name: "sparkles.png",
    box: { left: 670, top: 380, width: 300, height: 280 }
  }
];

async function extractIcon(asset) {
  const { source, name, box } = asset;
  const image = sharp(source).extract(box);
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;

  // Amostrar a cor do fundo no canto superior esquerdo
  let bgR = 0, bgG = 0, bgB = 0, count = 0;
  for (let y = 0; y < Math.min(5, h); y++) {
    for (let x = 0; x < Math.min(5, w); x++) {
      const idx = (y * w + x) * 4;
      bgR += data[idx];
      bgG += data[idx + 1];
      bgB += data[idx + 2];
      count++;
    }
  }
  bgR /= count; bgG /= count; bgB /= count;

  // BFS flood-fill a partir de todas as bordas externas
  const visited = new Uint8Array(w * h);
  const queue = [];

  function tryEnqueue(x, y) {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    const p = y * w + x;
    if (visited[p]) return;
    const idx = p * 4;
    const dist = Math.hypot(data[idx] - bgR, data[idx + 1] - bgG, data[idx + 2] - bgB);
    if (dist < 42) {
      visited[p] = 1;
      queue.push(x, y);
    }
  }

  for (let x = 0; x < w; x++) { tryEnqueue(x, 0); tryEnqueue(x, h - 1); }
  for (let y = 0; y < h; y++) { tryEnqueue(0, y); tryEnqueue(w - 1, y); }

  let head = 0;
  while (head < queue.length) {
    const x = queue[head++];
    const y = queue[head++];
    const p = y * w + x;
    const idx = p * 4;
    data[idx + 3] = 0; // Transparente

    const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    for (const [nx, ny] of neighbors) {
      if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
        const np = ny * w + nx;
        if (!visited[np]) {
          const nidx = np * 4;
          const dist = Math.hypot(data[nidx] - bgR, data[nidx + 1] - bgG, data[nidx + 2] - bgB);
          if (dist < 42) {
            visited[np] = 1;
            queue.push(nx, ny);
          }
        }
      }
    }
  }

  const outPath = path.join(OUTPUT_DIR, name);
  await sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .trim()
    .png()
    .toFile(outPath);

  console.log(`✓ Extraído: ${name}`);
}

async function main() {
  console.log("Iniciando extração dos ícones 2D Talkito...");
  for (const asset of ASSETS) {
    try {
      await extractIcon(asset);
    } catch (err) {
      console.error(`Erro ao extrair ${asset.name}:`, err.message);
    }
  }
  console.log("Todos os ícones foram extraídos para", OUTPUT_DIR);
}

main();
