import * as THREE from 'three';

/**
 * Procedural texture and normal map generator for High-End Anime RPG Dungeon Environment
 * Gives stone floors, walls, and doors deep 3D relief, tactile normal mapping,
 * realistic roughness, and mature anime-fantasy aesthetics (Genshin / JRPG / Dark Fantasy).
 */

// Helper to generate a tangent-space Normal Map from a height/grayscale canvas using Sobel filter
export function generateNormalMap(srcCanvas: HTMLCanvasElement, strength: number = 2.2): HTMLCanvasElement {
  const w = srcCanvas.width;
  const h = srcCanvas.height;
  const srcCtx = srcCanvas.getContext('2d')!;
  const srcData = srcCtx.getImageData(0, 0, w, h);
  const srcPixels = srcData.data;

  const normCanvas = document.createElement('canvas');
  normCanvas.width = w;
  normCanvas.height = h;
  const normCtx = normCanvas.getContext('2d')!;
  const normData = normCtx.createImageData(w, h);
  const normPixels = normData.data;

  const heights = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = srcPixels[i * 4];
    const g = srcPixels[i * 4 + 1];
    const b = srcPixels[i * 4 + 2];
    heights[i] = (r * 0.299 + g * 0.587 + b * 0.114) / 255.0;
  }

  for (let y = 0; y < h; y++) {
    const yPrev = (y - 1 + h) % h;
    const yNext = (y + 1) % h;
    for (let x = 0; x < w; x++) {
      const xPrev = (x - 1 + w) % w;
      const xNext = (x + 1) % w;

      const tl = heights[yPrev * w + xPrev];
      const t  = heights[yPrev * w + x];
      const tr = heights[yPrev * w + xNext];
      const l  = heights[y * w + xPrev];
      const r  = heights[y * w + xNext];
      const bl = heights[yNext * w + xPrev];
      const b_ = heights[yNext * w + x];
      const br = heights[yNext * w + xNext];

      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dy = (bl + 2 * b_ + br) - (tl + 2 * t + tr);
      const dz = 1.0 / strength;

      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const nx = -dx / len;
      const ny = -dy / len;
      const nz = dz / len;

      const idx = (y * w + x) * 4;
      normPixels[idx]     = Math.floor(((nx + 1) * 0.5) * 255);
      normPixels[idx + 1] = Math.floor(((ny + 1) * 0.5) * 255);
      normPixels[idx + 2] = Math.floor(((nz + 1) * 0.5) * 255);
      normPixels[idx + 3] = 255;
    }
  }

  normCtx.putImageData(normData, 0, 0);
  return normCanvas;
}

/**
 * 1. HIGH-END ANIME DUNGEON FLOOR TEXTURES
 * Detailed flagstone paving, chiseled ashlar joints, subtle wear,
 * ancient arcane sanctuary circle inlay, roughness, and normal maps.
 */
export function createAnimeDungeonFloorTextures(): {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
} {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const heightCanvas = document.createElement('canvas');
  heightCanvas.width = size;
  heightCanvas.height = size;
  const hCtx = heightCanvas.getContext('2d')!;

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rCtx = roughCanvas.getContext('2d')!;

  // Base stone background: Dark slate with subtle gradient
  const baseGrad = ctx.createRadialGradient(size / 2, size / 2, 80, size / 2, size / 2, size * 0.65);
  baseGrad.addColorStop(0, '#525866');
  baseGrad.addColorStop(0.5, '#424652');
  baseGrad.addColorStop(1, '#2c2f38');
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, size, size);

  hCtx.fillStyle = '#666666';
  hCtx.fillRect(0, 0, size, size);

  rCtx.fillStyle = '#b8b8b8'; // Moderately rough
  rCtx.fillRect(0, 0, size, size);

  // Micro-stipple for organic stone grain
  ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
  for (let i = 0; i < 900; i++) {
    const rx = Math.random() * size;
    const ry = Math.random() * size;
    const rad = 2 + Math.random() * 8;
    ctx.beginPath();
    ctx.arc(rx, ry, rad, 0, Math.PI * 2);
    ctx.fill();
  }

  // Border frame dimensions
  const borderMargin = 48;
  const innerSize = size - borderMargin * 2;
  const tileSize = innerSize / 3;

  // 3x3 Tile Matrix, each containing interlocking varied ashlar flagstones
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const tx = borderMargin + c * tileSize;
      const ty = borderMargin + r * tileSize;

      // Draw 4-6 natural flagstone sub-blocks per tile with organic cuts
      const subCols = 2;
      const subRows = 2;
      const subW = tileSize / subCols;
      const subH = tileSize / subRows;

      for (let sr = 0; sr < subRows; sr++) {
        for (let sc = 0; sc < subCols; sc++) {
          const px = tx + sc * subW;
          const py = ty + sr * subH;

          // Unique stone tonal variation
          const seed = (c * 17 + r * 31 + sc * 7 + sr * 13) % 11;
          const toneOffset = (seed - 5) * 3;
          const warmOffset = ((seed * 3) % 5) - 2;

          const pGrad = ctx.createLinearGradient(px, py, px + subW, py + subH);
          const rVal = Math.min(255, Math.max(40, 78 + toneOffset + warmOffset * 2));
          const gVal = Math.min(255, Math.max(40, 84 + toneOffset));
          const bVal = Math.min(255, Math.max(40, 96 + toneOffset - warmOffset));
          pGrad.addColorStop(0, `rgb(${rVal + 14}, ${gVal + 14}, ${bVal + 14})`);
          pGrad.addColorStop(0.5, `rgb(${rVal}, ${gVal}, ${bVal})`);
          pGrad.addColorStop(1, `rgb(${rVal - 14}, ${gVal - 14}, ${bVal - 14})`);

          const pad = 5;
          const cr = 7;
          ctx.fillStyle = pGrad;
          ctx.beginPath();
          ctx.roundRect(px + pad, py + pad, subW - pad * 2, subH - pad * 2, cr);
          ctx.fill();

          // Height map for normal generation
          hCtx.fillStyle = `rgb(${140 + toneOffset * 3}, ${140 + toneOffset * 3}, ${140 + toneOffset * 3})`;
          hCtx.beginPath();
          hCtx.roundRect(px + pad, py + pad, subW - pad * 2, subH - pad * 2, cr);
          hCtx.fill();

          // Stone bevel highlights (top-left light catch)
          ctx.strokeStyle = 'rgba(235, 240, 255, 0.38)';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(px + pad + cr, py + pad);
          ctx.lineTo(px + subW - pad - cr, py + pad);
          ctx.moveTo(px + pad, py + pad + cr);
          ctx.lineTo(px + pad, py + subH - pad - cr);
          ctx.stroke();

          // Height bevel
          hCtx.strokeStyle = '#ffffff';
          hCtx.lineWidth = 3;
          hCtx.beginPath();
          hCtx.moveTo(px + pad + cr, py + pad);
          hCtx.lineTo(px + subW - pad - cr, py + pad);
          hCtx.moveTo(px + pad, py + pad + cr);
          hCtx.lineTo(px + pad, py + subH - pad - cr);
          hCtx.stroke();

          // Stone bevel shadow (bottom-right shadow groove)
          ctx.strokeStyle = 'rgba(15, 18, 24, 0.65)';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(px + subW - pad, py + pad + cr);
          ctx.lineTo(px + subW - pad, py + subH - pad - cr);
          ctx.moveTo(px + pad + cr, py + subH - pad);
          ctx.lineTo(px + subW - pad - cr, py + subH - pad);
          ctx.stroke();

          hCtx.strokeStyle = '#222222';
          hCtx.lineWidth = 3;
          hCtx.beginPath();
          hCtx.moveTo(px + subW - pad, py + pad + cr);
          hCtx.lineTo(px + subW - pad, py + subH - pad - cr);
          hCtx.moveTo(px + pad + cr, py + subH - pad);
          hCtx.lineTo(px + subW - pad - cr, py + subH - pad);
          hCtx.stroke();

          // Roughness: stone faces are slightly smoother than joints
          rCtx.fillStyle = '#8a8a8a';
          rCtx.fillRect(px + pad, py + pad, subW - pad * 2, subH - pad * 2);

          // Subtle organic chiseled fissure on some stones
          if (seed % 3 === 0) {
            ctx.strokeStyle = 'rgba(20, 24, 30, 0.45)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(px + subW * 0.25, py + subH * 0.3);
            ctx.lineTo(px + subW * 0.45, py + subH * 0.55);
            ctx.lineTo(px + subW * 0.4, py + subH * 0.75);
            ctx.stroke();

            hCtx.strokeStyle = '#222222';
            hCtx.lineWidth = 2;
            hCtx.beginPath();
            hCtx.moveTo(px + subW * 0.25, py + subH * 0.3);
            hCtx.lineTo(px + subW * 0.45, py + subH * 0.55);
            hCtx.lineTo(px + subW * 0.4, py + subH * 0.75);
            hCtx.stroke();
          }

          // Subtle moss in damp crevices
          if (c === 0 || r === 0) {
            ctx.fillStyle = 'rgba(74, 98, 68, 0.2)';
            ctx.beginPath();
            ctx.arc(px + pad + 6, py + pad + 6, 8, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // Elegant anime dungeon tile boundary accents (refined bronze/gold corner brackets)
      ctx.strokeStyle = 'rgba(212, 175, 55, 0.5)';
      ctx.lineWidth = 2;
      const cornerLen = 22;
      const cPad = 10;

      // Top-Left
      ctx.beginPath();
      ctx.moveTo(tx + cPad, ty + cPad + cornerLen);
      ctx.lineTo(tx + cPad, ty + cPad);
      ctx.lineTo(tx + cPad + cornerLen, ty + cPad);
      ctx.stroke();

      // Top-Right
      ctx.beginPath();
      ctx.moveTo(tx + tileSize - cPad - cornerLen, ty + cPad);
      ctx.lineTo(tx + tileSize - cPad, ty + cPad);
      ctx.lineTo(tx + tileSize - cPad, ty + cPad + cornerLen);
      ctx.stroke();

      // Bottom-Right
      ctx.beginPath();
      ctx.moveTo(tx + tileSize - cPad, ty + tileSize - cPad - cornerLen);
      ctx.lineTo(tx + tileSize - cPad, ty + tileSize - cPad);
      ctx.lineTo(tx + tileSize - cPad - cornerLen, ty + tileSize - cPad);
      ctx.stroke();

      // Bottom-Left
      ctx.beginPath();
      ctx.moveTo(tx + cPad + cornerLen, ty + tileSize - cPad);
      ctx.lineTo(tx + cPad, ty + tileSize - cPad);
      ctx.lineTo(tx + cPad, ty + tileSize - cPad - cornerLen);
      ctx.stroke();

      // Soft grout border lines
      ctx.strokeStyle = 'rgba(18, 20, 26, 0.85)';
      ctx.lineWidth = 4;
      ctx.strokeRect(tx + 2, ty + 2, tileSize - 4, tileSize - 4);

      hCtx.strokeStyle = '#111111';
      hCtx.lineWidth = 5;
      hCtx.strokeRect(tx + 2, ty + 2, tileSize - 4, tileSize - 4);
    }
  }

  // Central Arcane Sanctuary Runic Inlay (High fantasy JRPG / Anime style)
  const cx = size / 2;
  const cy = size / 2;
  ctx.save();

  // Outer rune ring
  ctx.strokeStyle = 'rgba(165, 214, 255, 0.5)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(cx, cy, 96, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(245, 208, 100, 0.4)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, 84, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(165, 214, 255, 0.35)';
  ctx.beginPath();
  ctx.arc(cx, cy, 64, 0, Math.PI * 2);
  ctx.stroke();

  // Intricate 8-pointed arcane star
  ctx.strokeStyle = 'rgba(212, 175, 55, 0.45)';
  ctx.lineWidth = 1.8;
  for (let i = 0; i < 8; i++) {
    const a1 = (i * Math.PI) / 4;
    const a2 = ((i + 3) * Math.PI) / 4;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a1) * 78, cy + Math.sin(a1) * 78);
    ctx.lineTo(cx + Math.cos(a2) * 78, cy + Math.sin(a2) * 78);
    ctx.stroke();
  }

  // Arcane glyph marks along outer ring
  ctx.fillStyle = 'rgba(245, 208, 100, 0.5)';
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI * 2) / 16;
    const gx = cx + Math.cos(a) * 90;
    const gy = cy + Math.sin(a) * 90;
    ctx.beginPath();
    ctx.arc(gx, gy, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Central glowing core emblem
  const centerGrad = ctx.createRadialGradient(cx, cy, 2, cx, cy, 32);
  centerGrad.addColorStop(0, 'rgba(56, 189, 248, 0.35)');
  centerGrad.addColorStop(0.7, 'rgba(56, 189, 248, 0.1)');
  centerGrad.addColorStop(1, 'rgba(56, 189, 248, 0)');
  ctx.fillStyle = centerGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, 32, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  // Height map for arcane inlay (chiseled into stone)
  hCtx.strokeStyle = '#ffffff';
  hCtx.lineWidth = 2;
  hCtx.beginPath();
  hCtx.arc(cx, cy, 96, 0, Math.PI * 2);
  hCtx.arc(cx, cy, 84, 0, Math.PI * 2);
  hCtx.stroke();

  // Plinth outer curbing stone border
  ctx.fillStyle = '#3a3e4a';
  ctx.fillRect(0, 0, size, borderMargin);
  ctx.fillRect(0, size - borderMargin, size, borderMargin);
  ctx.fillRect(0, 0, borderMargin, size);
  ctx.fillRect(size - borderMargin, 0, borderMargin, size);

  // Outer curb masonry dividers
  ctx.strokeStyle = 'rgba(18, 20, 26, 0.85)';
  ctx.lineWidth = 3.5;
  for (let i = 0; i <= 3; i++) {
    const pos = borderMargin + i * tileSize;
    ctx.beginPath();
    ctx.moveTo(pos, 0);
    ctx.lineTo(pos, borderMargin);
    ctx.moveTo(pos, size - borderMargin);
    ctx.lineTo(pos, size);
    ctx.moveTo(0, pos);
    ctx.lineTo(borderMargin, pos);
    ctx.moveTo(size - borderMargin, pos);
    ctx.lineTo(size, pos);
    ctx.stroke();
  }

  // Outer curb bevel highlight
  ctx.strokeStyle = 'rgba(235, 240, 255, 0.3)';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(borderMargin + 1, borderMargin + 1, innerSize - 2, innerSize - 2);

  const normalCanvas = generateNormalMap(heightCanvas, 2.6);

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;

  const normalMap = new THREE.CanvasTexture(normalCanvas);

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);

  return { map, normalMap, roughnessMap };
}

/**
 * 2. HIGH-END ANIME DUNGEON WALL TEXTURES
 * Realistic coursed ashlar masonry with hand-painted anime depth,
 * multi-sized blocks, chiseled bevels, mortar depths, and water/moss gradients.
 */
export function createAnimeDungeonWallTextures(): {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
} {
  const width = 1024;
  const height = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const heightCanvas = document.createElement('canvas');
  heightCanvas.width = width;
  heightCanvas.height = height;
  const hCtx = heightCanvas.getContext('2d')!;

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = width;
  roughCanvas.height = height;
  const rCtx = roughCanvas.getContext('2d')!;

  // Base wall gradient: Darker at bottom and top (natural dungeon ambient occlusion)
  const wallGrad = ctx.createLinearGradient(0, 0, 0, height);
  wallGrad.addColorStop(0, '#2e323b'); // Dark top under cornice
  wallGrad.addColorStop(0.25, '#444955');
  wallGrad.addColorStop(0.7, '#4e5462');
  wallGrad.addColorStop(1, '#2c3038'); // Dark base near floor
  ctx.fillStyle = wallGrad;
  ctx.fillRect(0, 0, width, height);

  hCtx.fillStyle = '#666666';
  hCtx.fillRect(0, 0, width, height);

  rCtx.fillStyle = '#b0b0b0';
  rCtx.fillRect(0, 0, width, height);

  // Micro stone texture
  ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
  for (let i = 0; i < 700; i++) {
    const rx = Math.random() * width;
    const ry = Math.random() * height;
    ctx.beginPath();
    ctx.arc(rx, ry, 2 + Math.random() * 6, 0, Math.PI * 2);
    ctx.fill();
  }

  // 8 Courses of ashlar masonry with varied stone lengths
  const numRows = 8;
  const rowH = height / numRows;

  // Varied column proportions per row
  const rowBlockPatterns = [
    [0.26, 0.38, 0.36],
    [0.34, 0.32, 0.34],
    [0.22, 0.44, 0.34],
    [0.40, 0.28, 0.32],
    [0.30, 0.36, 0.34],
    [0.35, 0.42, 0.23],
    [0.28, 0.34, 0.38],
    [0.42, 0.30, 0.28]
  ];

  for (let r = 0; r < numRows; r++) {
    const y = r * rowH;
    const pattern = rowBlockPatterns[r % rowBlockPatterns.length];
    let currX = 0;

    for (let c = 0; c < pattern.length; c++) {
      const bWidth = pattern[c] * width;
      const pad = 4;
      const cr = 5;

      const seed = (r * 19 + c * 23) % 9;
      const tone = (seed - 4) * 4;

      // Realistic anime stone gradient for each block
      const bGrad = ctx.createLinearGradient(currX, y, currX, y + rowH);
      const baseR = Math.min(255, Math.max(45, 78 + tone));
      const baseG = Math.min(255, Math.max(45, 84 + tone));
      const baseB = Math.min(255, Math.max(50, 96 + tone));

      bGrad.addColorStop(0, `rgb(${baseR + 18}, ${baseG + 18}, ${baseB + 20})`);
      bGrad.addColorStop(0.6, `rgb(${baseR}, ${baseG}, ${baseB})`);
      bGrad.addColorStop(1, `rgb(${baseR - 16}, ${baseG - 16}, ${baseB - 14})`);

      ctx.fillStyle = bGrad;
      ctx.beginPath();
      ctx.roundRect(currX + pad, y + pad, bWidth - pad * 2, rowH - pad * 2, cr);
      ctx.fill();

      // Height map for stone relief
      hCtx.fillStyle = `rgb(${145 + tone * 2}, ${145 + tone * 2}, ${145 + tone * 2})`;
      hCtx.beginPath();
      hCtx.roundRect(currX + pad, y + pad, bWidth - pad * 2, rowH - pad * 2, cr);
      hCtx.fill();

      // Top light catch bevel
      ctx.strokeStyle = 'rgba(235, 242, 255, 0.35)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(currX + pad + cr, y + pad);
      ctx.lineTo(currX + bWidth - pad - cr, y + pad);
      ctx.stroke();

      hCtx.strokeStyle = '#ffffff';
      hCtx.lineWidth = 3;
      hCtx.beginPath();
      hCtx.moveTo(currX + pad + cr, y + pad);
      hCtx.lineTo(currX + bWidth - pad - cr, y + pad);
      hCtx.stroke();

      // Left light catch
      ctx.beginPath();
      ctx.moveTo(currX + pad, y + pad + cr);
      ctx.lineTo(currX + pad, y + rowH - pad - cr);
      ctx.stroke();

      // Bottom shadow groove
      ctx.strokeStyle = 'rgba(15, 18, 25, 0.7)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(currX + pad + cr, y + rowH - pad);
      ctx.lineTo(currX + bWidth - pad - cr, y + rowH - pad);
      ctx.stroke();

      hCtx.strokeStyle = '#1a1a1a';
      hCtx.lineWidth = 3.5;
      hCtx.beginPath();
      hCtx.moveTo(currX + pad + cr, y + rowH - pad);
      hCtx.lineTo(currX + bWidth - pad - cr, y + rowH - pad);
      hCtx.stroke();

      // Right shadow
      ctx.beginPath();
      ctx.moveTo(currX + bWidth - pad, y + pad + cr);
      ctx.lineTo(currX + bWidth - pad, y + rowH - pad - cr);
      ctx.stroke();

      // Fissure / crack detail on select blocks
      if (seed === 3 || seed === 7) {
        ctx.strokeStyle = 'rgba(20, 24, 32, 0.4)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(currX + bWidth * 0.3, y + pad + 6);
        ctx.lineTo(currX + bWidth * 0.45, y + rowH * 0.5);
        ctx.lineTo(currX + bWidth * 0.4, y + rowH - pad - 6);
        ctx.stroke();

        hCtx.strokeStyle = '#222222';
        hCtx.lineWidth = 2;
        hCtx.beginPath();
        hCtx.moveTo(currX + bWidth * 0.3, y + pad + 6);
        hCtx.lineTo(currX + bWidth * 0.45, y + rowH * 0.5);
        hCtx.lineTo(currX + bWidth * 0.4, y + rowH - pad - 6);
        hCtx.stroke();
      }

      // Moss / dampness near floor (bottom rows)
      if (r >= numRows - 2) {
        ctx.fillStyle = 'rgba(64, 88, 60, 0.22)';
        ctx.beginPath();
        ctx.ellipse(currX + bWidth * 0.5, y + rowH - pad - 4, bWidth * 0.35, 10, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      currX += bWidth;
    }

    // Heavy mortar seam between rows
    ctx.strokeStyle = 'rgba(16, 18, 24, 0.85)';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();

    hCtx.strokeStyle = '#111111';
    hCtx.lineWidth = 4;
    hCtx.beginPath();
    hCtx.moveTo(0, y);
    hCtx.lineTo(width, y);
    hCtx.stroke();
  }

  const normalCanvas = generateNormalMap(heightCanvas, 2.8);

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;

  const normalMap = new THREE.CanvasTexture(normalCanvas);
  const roughnessMap = new THREE.CanvasTexture(roughCanvas);

  return { map, normalMap, roughnessMap };
}

/**
 * 3. HIGH-END ANIME DUNGEON DOOR TEXTURES
 * Aged dark ironwood / medieval timber gate with deep grain,
 * hand-forged dark wrought iron strap hinges, iron rivets,
 * viewing grille, and aged dark metal patina (No cheap bright cartoon colors).
 */
export function createAnimeDungeonDoorTextures(): {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
} {
  const width = 512;
  const height = 768;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const heightCanvas = document.createElement('canvas');
  heightCanvas.width = width;
  heightCanvas.height = height;
  const hCtx = heightCanvas.getContext('2d')!;

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = width;
  roughCanvas.height = height;
  const rCtx = roughCanvas.getContext('2d')!;

  // Deep dark aged ironwood timber base
  const woodBase = ctx.createLinearGradient(0, 0, width, 0);
  woodBase.addColorStop(0, '#221611');
  woodBase.addColorStop(0.5, '#301f18');
  woodBase.addColorStop(1, '#1e130e');
  ctx.fillStyle = woodBase;
  ctx.fillRect(0, 0, width, height);

  hCtx.fillStyle = '#555555';
  hCtx.fillRect(0, 0, width, height);

  rCtx.fillStyle = '#a0a0a0';
  rCtx.fillRect(0, 0, width, height);

  // 4 Heavy vertical oak planks
  const numPlanks = 4;
  const plankW = width / numPlanks;

  for (let i = 0; i < numPlanks; i++) {
    const px = i * plankW;
    const tone = 36 + (i % 2) * 6;

    const pGrad = ctx.createLinearGradient(px, 0, px + plankW, 0);
    pGrad.addColorStop(0, `rgb(${tone + 6}, ${Math.floor(tone * 0.68) + 4}, ${Math.floor(tone * 0.48) + 2})`);
    pGrad.addColorStop(0.5, `rgb(${tone + 18}, ${Math.floor(tone * 0.78) + 12}, ${Math.floor(tone * 0.58) + 8})`);
    pGrad.addColorStop(1, `rgb(${tone}, ${Math.floor(tone * 0.62)}, ${Math.floor(tone * 0.42)})`);

    ctx.fillStyle = pGrad;
    ctx.fillRect(px + 2, 0, plankW - 4, height);

    hCtx.fillStyle = `rgb(${110 + tone}, ${110 + tone}, ${110 + tone})`;
    hCtx.fillRect(px + 2, 0, plankW - 4, height);

    // Deep wood grain lines
    ctx.strokeStyle = 'rgba(16, 10, 6, 0.4)';
    ctx.lineWidth = 1.5;
    for (let k = 0; k < 6; k++) {
      const gx = px + 10 + k * 18;
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.bezierCurveTo(gx - 8, height * 0.35, gx + 8, height * 0.65, gx - 2, height);
      ctx.stroke();

      hCtx.strokeStyle = '#333333';
      hCtx.lineWidth = 2;
      hCtx.beginPath();
      hCtx.moveTo(gx, 0);
      hCtx.bezierCurveTo(gx - 8, height * 0.35, gx + 8, height * 0.65, gx - 2, height);
      hCtx.stroke();
    }

    // Deep shadow gap between planks
    ctx.strokeStyle = 'rgba(10, 6, 4, 0.95)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, height);
    ctx.stroke();

    hCtx.strokeStyle = '#050505';
    hCtx.lineWidth = 5;
    hCtx.beginPath();
    hCtx.moveTo(px, 0);
    hCtx.lineTo(px, height);
    hCtx.stroke();
  }

  // Heavy Forged Dark Wrought Iron Strap Hinges (Realistic Dark Anime Gothic Design)
  const drawForgedIronStrap = (yPos: number) => {
    const sH = 38;
    const strapGrad = ctx.createLinearGradient(0, yPos, 0, yPos + sH);
    strapGrad.addColorStop(0, '#4b5563'); // Dark slate iron highlight
    strapGrad.addColorStop(0.35, '#333b47');
    strapGrad.addColorStop(0.7, '#232932');
    strapGrad.addColorStop(1, '#181d24'); // Bottom dark iron shadow

    ctx.fillStyle = strapGrad;
    ctx.beginPath();
    ctx.roundRect(16, yPos, width - 32, sH, 6);
    ctx.fill();

    // Iron border bevel
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Height map for iron strap
    hCtx.fillStyle = '#e0e0e0';
    hCtx.beginPath();
    hCtx.roundRect(16, yPos, width - 32, sH, 6);
    hCtx.fill();

    // Roughness for iron: semi-satin metal
    rCtx.fillStyle = '#555555';
    rCtx.beginPath();
    rCtx.roundRect(16, yPos, width - 32, sH, 6);
    rCtx.fill();

    // Gothic spearhead finials at strap ends
    ctx.fillStyle = '#232932';
    // Left spearhead
    ctx.beginPath();
    ctx.moveTo(16, yPos + sH / 2);
    ctx.lineTo(4, yPos + sH / 2 - 8);
    ctx.lineTo(0, yPos + sH / 2);
    ctx.lineTo(4, yPos + sH / 2 + 8);
    ctx.closePath();
    ctx.fill();

    // Heavy forged pyramid iron rivets across the strap
    const rivetPositions = [36, 110, 190, 256, 322, 402, 476];
    rivetPositions.forEach(rx => {
      // Dark rivet shadow
      ctx.fillStyle = '#0f1318';
      ctx.beginPath();
      ctx.arc(rx, yPos + sH / 2 + 1, 7, 0, Math.PI * 2);
      ctx.fill();

      // Metallic rivet head
      const rGrad = ctx.createRadialGradient(rx - 2, yPos + sH / 2 - 2, 1, rx, yPos + sH / 2, 6);
      rGrad.addColorStop(0, '#94a3b8');
      rGrad.addColorStop(0.5, '#475569');
      rGrad.addColorStop(1, '#1e293b');
      ctx.fillStyle = rGrad;
      ctx.beginPath();
      ctx.arc(rx, yPos + sH / 2, 6, 0, Math.PI * 2);
      ctx.fill();

      hCtx.fillStyle = '#ffffff';
      hCtx.beginPath();
      hCtx.arc(rx, yPos + sH / 2, 6, 0, Math.PI * 2);
      hCtx.fill();
    });
  };

  // Top and bottom heavy forged straps
  drawForgedIronStrap(110);
  drawForgedIronStrap(590);

  // Middle Dungeon Peep Grate / Iron Lattice Window (Recessed)
  const gw = 120;
  const gh = 100;
  const gx = (width - gw) / 2;
  const gy = 290;

  // Recessed frame
  ctx.fillStyle = '#0d0f14';
  ctx.beginPath();
  ctx.roundRect(gx, gy, gw, gh, 8);
  ctx.fill();

  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 3;
  ctx.stroke();

  hCtx.fillStyle = '#111111';
  hCtx.beginPath();
  hCtx.roundRect(gx, gy, gw, gh, 8);
  hCtx.fill();

  // Iron crossbars inside grille
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 4;
  for (let bx = gx + 24; bx < gx + gw; bx += 24) {
    ctx.beginPath();
    ctx.moveTo(bx, gy);
    ctx.lineTo(bx, gy + gh);
    ctx.stroke();
  }
  for (let by = gy + 25; by < gy + gh; by += 25) {
    ctx.beginPath();
    ctx.moveTo(gx, by);
    ctx.lineTo(gx + gw, by);
    ctx.stroke();
  }

  // Heavy Forged Iron Ring Pull & Latch Plate
  const plateX = width * 0.36;
  const plateY = 440;
  ctx.fillStyle = '#1e242c';
  ctx.beginPath();
  ctx.roundRect(plateX - 24, plateY - 24, 48, 48, 8);
  ctx.fill();

  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Ring pull
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(plateX, plateY + 22, 22, 0, Math.PI * 2);
  ctx.stroke();

  hCtx.fillStyle = '#e8e8e8';
  hCtx.beginPath();
  hCtx.roundRect(plateX - 24, plateY - 24, 48, 48, 8);
  hCtx.fill();

  const normalCanvas = generateNormalMap(heightCanvas, 2.5);

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;

  const normalMap = new THREE.CanvasTexture(normalCanvas);
  const roughnessMap = new THREE.CanvasTexture(roughCanvas);

  return { map, normalMap, roughnessMap };
}
