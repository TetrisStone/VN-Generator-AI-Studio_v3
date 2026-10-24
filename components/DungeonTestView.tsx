import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { 
  ArrowLeft, RotateCcw, Upload, Compass, Shield, User, 
  ChevronDown, ChevronUp, Footprints, Sparkles, Check, 
  Trash2, Sliders, Film, HelpCircle, Layers, Box, Grid, Square, DoorClosed, Layers as LayersIcon
} from 'lucide-react';
import { Character } from '../types';
import { getItem, setItem } from '../utils/db';
import { loadImage } from '../utils/imageStorage';

interface DungeonTestViewProps {
  onExit: () => void;
  characters?: Character[];
}

interface TileCoord {
  col: number; // 0, 1, 2 (West to East)
  row: number; // 0, 1, 2 (North to South)
}

type Direction = 'NORTH' | 'EAST' | 'SOUTH' | 'WEST';

const TILE_SIZE = 2.4; // Default procedural world units per tile (total 7.2m)
const BLENDER_CHUNK_SIZE = 8.0; // Blender Floor Chunk is 8m x 8m
const BLENDER_TILE_SIZE = 8.0 / 3; // ~2.6667m per tile for 3x3 grid
const PLATFORM_HALF = (3 * TILE_SIZE) / 2; // 3.6 units from center to edge
const WALL_HEIGHT = 3.8;
const WALL_THICKNESS = 0.55;

const STORAGE_KEY_CHAR_GLB = 'dungeon_custom_glb_config';
const STORAGE_KEY_FLOOR_GLB = 'dungeon_custom_floor_glb';
const STORAGE_KEY_WALL_GLB = 'dungeon_custom_wall_glb';
const STORAGE_KEY_DOOR_GLB = 'dungeon_custom_door_glb';

interface StoredGLBConfig {
  fileName: string;
  fileSize: number;
  dataBase64: string;
  scale?: number;
  useRawScale?: boolean;
  offsetY?: number;
  rotationY?: number;
  idleClipName?: string;
  runClipName?: string;
}

interface StoredEnvironmentGLBConfig {
  fileName: string;
  fileSize: number;
  dataBase64: string;
  scale?: number;
  offsetX?: number;
  offsetY?: number;
  offsetZ?: number;
  rotationY?: number;
  showLeftWall?: boolean;
  showUpperWall?: boolean;
  showSecondWall?: boolean;
  showLeftDoor?: boolean;
  showUpperDoor?: boolean;
  wallLayout?: 'diorama' | 'single' | 'three' | 'four';
}

// Convert tile coordinate to world coordinates with dynamic tile size & surface height
function tileToWorld(col: number, row: number, tileSize: number = TILE_SIZE, surfaceY: number = 0.05): THREE.Vector3 {
  const x = (col - 1) * tileSize;
  const z = (row - 1) * tileSize;
  return new THREE.Vector3(x, surfaceY, z);
}

// Helper: Convert ArrayBuffer to Base64 Data URL
function arrayBufferToDataUrl(buffer: ArrayBuffer, mimeType: string = 'model/gltf-binary'): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([buffer], { type: mimeType });
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Helper: Convert Base64 Data URL to ArrayBuffer
function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const base64 = dataUrl.split(',')[1];
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// =========================================================================
// TEXTURE GENERATORS (Matching the Stylized Anime Character from image.png)
// =========================================================================

function createStylizedFloorCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;

  const bgGrad = ctx.createRadialGradient(512, 512, 100, 512, 512, 700);
  bgGrad.addColorStop(0, '#989793');
  bgGrad.addColorStop(0.6, '#86847f');
  bgGrad.addColorStop(1, '#6c6a66');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, 1024, 1024);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
  for (let i = 0; i < 600; i++) {
    const rx = Math.random() * 1024;
    const ry = Math.random() * 1024;
    ctx.beginPath();
    ctx.arc(rx, ry, 12 + Math.random() * 24, 0, Math.PI * 2);
    ctx.fill();
  }

  const borderWidth = 64;
  const innerSize = 1024 - borderWidth * 2;
  const tileSize = innerSize / 3;

  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const tx = borderWidth + c * tileSize;
      const ty = borderWidth + r * tileSize;

      const subPaver = tileSize / 2;
      for (let sr = 0; sr < 2; sr++) {
        for (let sc = 0; sc < 2; sc++) {
          const px = tx + sc * subPaver;
          const py = ty + sr * subPaver;

          const tint = ((c * 7 + r * 13 + sc * 3 + sr * 5) % 9) - 4;
          const pGrad = ctx.createLinearGradient(px, py, px + subPaver, py + subPaver);
          pGrad.addColorStop(0, `rgb(${145 + tint * 2}, ${143 + tint * 2}, ${138 + tint})`);
          pGrad.addColorStop(1, `rgb(${125 + tint * 2}, ${123 + tint * 2}, ${118 + tint})`);

          const pad = 4;
          const radius = 8;
          ctx.fillStyle = pGrad;
          ctx.beginPath();
          ctx.roundRect(px + pad, py + pad, subPaver - pad * 2, subPaver - pad * 2, radius);
          ctx.fill();

          ctx.strokeStyle = 'rgba(240, 238, 230, 0.45)';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(px + pad + radius, py + pad);
          ctx.lineTo(px + subPaver - pad - radius, py + pad);
          ctx.moveTo(px + pad, py + pad + radius);
          ctx.lineTo(px + pad, py + subPaver - pad - radius);
          ctx.stroke();

          ctx.strokeStyle = 'rgba(40, 38, 35, 0.45)';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(px + subPaver - pad, py + pad + radius);
          ctx.lineTo(px + subPaver - pad, py + subPaver - pad - radius);
          ctx.moveTo(px + pad + radius, py + subPaver - pad);
          ctx.lineTo(px + subPaver - pad - radius, py + subPaver - pad);
          ctx.stroke();
        }
      }

      ctx.strokeStyle = 'rgba(45, 42, 38, 0.65)';
      ctx.lineWidth = 4;
      ctx.strokeRect(tx + 2, ty + 2, tileSize - 4, tileSize - 4);

      ctx.strokeStyle = 'rgba(190, 165, 120, 0.35)';
      ctx.lineWidth = 2;
      const cornerL = 20;
      ctx.beginPath();
      ctx.moveTo(tx + 12, ty + 12 + cornerL);
      ctx.lineTo(tx + 12, ty + 12);
      ctx.lineTo(tx + 12 + cornerL, ty + 12);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(tx + tileSize - 12 - cornerL, ty + 12);
      ctx.lineTo(tx + tileSize - 12, ty + 12);
      ctx.lineTo(tx + tileSize - 12, ty + 12 + cornerL);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(tx + tileSize - 12, ty + tileSize - 12 - cornerL);
      ctx.lineTo(tx + tileSize - 12, ty + tileSize - 12);
      ctx.lineTo(tx + tileSize - 12 - cornerL, ty + tileSize - 12);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(tx + 12 + cornerL, ty + tileSize - 12);
      ctx.lineTo(tx + 12, ty + tileSize - 12);
      ctx.lineTo(tx + 12, ty + tileSize - 12 - cornerL);
      ctx.stroke();
    }
  }

  const cx = 512;
  const cy = 512;
  ctx.save();
  ctx.strokeStyle = 'rgba(195, 175, 130, 0.4)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(cx, cy, 70, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(195, 175, 130, 0.25)';
  ctx.beginPath();
  ctx.arc(cx, cy, 84, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = 'rgba(195, 175, 130, 0.45)';
  [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].forEach(angle => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, -96);
    ctx.lineTo(8, -80);
    ctx.lineTo(0, -72);
    ctx.lineTo(-8, -80);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  });
  ctx.restore();

  ctx.fillStyle = '#6e6b66';
  ctx.fillRect(0, 0, 1024, borderWidth);
  ctx.fillRect(0, 1024 - borderWidth, 1024, borderWidth);
  ctx.fillRect(0, 0, borderWidth, 1024);
  ctx.fillRect(1024 - borderWidth, 0, borderWidth, 1024);

  ctx.strokeStyle = 'rgba(40, 38, 35, 0.6)';
  ctx.lineWidth = 3;
  for (let i = 0; i <= 3; i++) {
    const pos = borderWidth + i * tileSize;
    ctx.beginPath();
    ctx.moveTo(pos, 0);
    ctx.lineTo(pos, borderWidth);
    ctx.moveTo(pos, 1024 - borderWidth);
    ctx.lineTo(pos, 1024);
    ctx.moveTo(0, pos);
    ctx.lineTo(borderWidth, pos);
    ctx.moveTo(1024 - borderWidth, pos);
    ctx.lineTo(1024, pos);
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(borderWidth, borderWidth);
  ctx.moveTo(1024, 0);
  ctx.lineTo(1024 - borderWidth, borderWidth);
  ctx.moveTo(1024, 1024);
  ctx.lineTo(1024 - borderWidth, 1024 - borderWidth);
  ctx.moveTo(0, 1024);
  ctx.lineTo(borderWidth, 1024 - borderWidth);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(230, 225, 215, 0.4)';
  ctx.lineWidth = 3;
  ctx.strokeRect(3, 3, 1018, 1018);

  return canvas;
}

function createStylizedWallCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, 0, 1024);
  grad.addColorStop(0, '#555452');
  grad.addColorStop(0.3, '#6f6c68');
  grad.addColorStop(0.8, '#62605b');
  grad.addColorStop(1, '#4d4b47');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 1024);

  const numRows = 7;
  const rowHeight = 1024 / numRows;

  for (let r = 0; r < numRows; r++) {
    const y = r * rowHeight;
    const numCols = 4;
    const colWidth = 1024 / numCols;
    const offset = r % 2 === 0 ? 0 : colWidth / 2;

    for (let c = -1; c <= numCols; c++) {
      const x = c * colWidth + offset;
      const toneOffset = ((r * 11 + c * 17) % 7) - 3;

      const pad = 5;
      const bGrad = ctx.createLinearGradient(x, y, x, y + rowHeight);
      bGrad.addColorStop(0, `rgb(${118 + toneOffset * 2}, ${115 + toneOffset * 2}, ${110 + toneOffset})`);
      bGrad.addColorStop(1, `rgb(${98 + toneOffset * 2}, ${95 + toneOffset * 2}, ${90 + toneOffset})`);

      ctx.fillStyle = bGrad;
      ctx.beginPath();
      ctx.roundRect(x + pad, y + pad, colWidth - pad * 2, rowHeight - pad * 2, 6);
      ctx.fill();

      ctx.strokeStyle = 'rgba(235, 230, 220, 0.28)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x + pad + 6, y + pad);
      ctx.lineTo(x + colWidth - pad - 6, y + pad);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(30, 28, 25, 0.4)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x + pad + 6, y + rowHeight - pad);
      ctx.lineTo(x + colWidth - pad - 6, y + rowHeight - pad);
      ctx.stroke();
    }
  }

  ctx.strokeStyle = 'rgba(35, 33, 30, 0.6)';
  ctx.lineWidth = 4;
  for (let r = 1; r < numRows; r++) {
    const y = r * rowHeight;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(1024, y);
    ctx.stroke();
  }

  return canvas;
}

function createStylizedDoorCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 768;
  const ctx = canvas.getContext('2d')!;

  const woodGrad = ctx.createLinearGradient(0, 0, 512, 0);
  woodGrad.addColorStop(0, '#3f2518');
  woodGrad.addColorStop(0.5, '#4e2f1f');
  woodGrad.addColorStop(1, '#3a2114');
  ctx.fillStyle = woodGrad;
  ctx.fillRect(0, 0, 512, 768);

  const numPlanks = 4;
  const plankW = 512 / numPlanks;
  for (let i = 0; i < numPlanks; i++) {
    const px = i * plankW;
    const tone = 75 + (i % 2) * 8;

    const pGrad = ctx.createLinearGradient(px, 0, px + plankW, 0);
    pGrad.addColorStop(0, `rgb(${tone + 8}, ${Math.floor(tone * 0.65)}, ${Math.floor(tone * 0.45)})`);
    pGrad.addColorStop(0.5, `rgb(${tone + 20}, ${Math.floor(tone * 0.75)}, ${Math.floor(tone * 0.5)})`);
    pGrad.addColorStop(1, `rgb(${tone}, ${Math.floor(tone * 0.6)}, ${Math.floor(tone * 0.4)})`);

    ctx.fillStyle = pGrad;
    ctx.beginPath();
    ctx.roundRect(px + 3, 4, plankW - 6, 760, 4);
    ctx.fill();

    ctx.strokeStyle = 'rgba(25, 12, 6, 0.25)';
    ctx.lineWidth = 1.5;
    for (let k = 0; k < 4; k++) {
      const gx = px + 12 + k * 18;
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.bezierCurveTo(gx - 6, 250, gx + 6, 500, gx, 768);
      ctx.stroke();
    }
  }

  ctx.strokeStyle = 'rgba(20, 10, 5, 0.7)';
  ctx.lineWidth = 4;
  for (let i = 1; i < numPlanks; i++) {
    ctx.beginPath();
    ctx.moveTo(i * plankW, 0);
    ctx.lineTo(i * plankW, 768);
    ctx.stroke();
  }

  const drawOrnateStrap = (yPos: number) => {
    const strapGrad = ctx.createLinearGradient(0, yPos, 0, yPos + 36);
    strapGrad.addColorStop(0, '#e2e8f0');
    strapGrad.addColorStop(0.5, '#cbd5e1');
    strapGrad.addColorStop(1, '#94a3b8');
    ctx.fillStyle = strapGrad;
    ctx.beginPath();
    ctx.roundRect(24, yPos, 464, 36, 8);
    ctx.fill();

    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(80, yPos + 18, 10, 0, Math.PI * 2);
    ctx.moveTo(80, yPos + 18);
    ctx.bezierCurveTo(120, yPos + 6, 160, yPos + 30, 200, yPos + 18);
    ctx.arc(256, yPos + 18, 10, 0, Math.PI * 2);
    ctx.moveTo(256, yPos + 18);
    ctx.bezierCurveTo(296, yPos + 6, 336, yPos + 30, 376, yPos + 18);
    ctx.arc(432, yPos + 18, 10, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#fbbf24';
    [40, 140, 256, 370, 472].forEach(rx => {
      ctx.beginPath();
      ctx.arc(rx, yPos + 18, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#92400e';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
  };

  drawOrnateStrap(120);
  drawOrnateStrap(600);

  const kx = 180;
  const ky = 380;
  ctx.fillStyle = '#cbd5e1';
  ctx.beginPath();
  ctx.arc(kx, ky, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(kx, ky, 18, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(kx, ky + 42, 34, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(kx - 3, ky + 39, 32, -Math.PI / 2, Math.PI / 4);
  ctx.stroke();

  return canvas;
}

export const DungeonTestView: React.FC<DungeonTestViewProps> = ({ onExit, characters = [] }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const charFileInputRef = useRef<HTMLInputElement>(null);
  const floorFileInputRef = useRef<HTMLInputElement>(null);
  const wallFileInputRef = useRef<HTMLInputElement>(null);
  const doorFileInputRef = useRef<HTMLInputElement>(null);

  // Active Asset Tab in Dock
  const [activeTab, setActiveTab] = useState<'character' | 'floor' | 'wall' | 'door'>('character');

  // Gameplay state
  const [characterCoord, setCharacterCoord] = useState<TileCoord>({ col: 1, row: 1 });
  const [hoveredCoord, setHoveredCoord] = useState<TileCoord | null>(null);
  const [facingDir, setFacingDir] = useState<Direction>('SOUTH');
  const [animState, setAnimState] = useState<'IDLE' | 'RUN'>('IDLE');
  const [moveSpeed, setMoveSpeed] = useState<number>(3.6);
  const [isDockCollapsed, setIsDockCollapsed] = useState<boolean>(false);
  const [audioEnabled, setAudioEnabled] = useState<boolean>(true);
  const audioEnabledRef = useRef<boolean>(true);
  useEffect(() => {
    audioEnabledRef.current = audioEnabled;
  }, [audioEnabled]);

  // GLB Custom Model state
  const [customModelLoaded, setCustomModelLoaded] = useState<boolean>(false);
  const [customModelName, setCustomModelName] = useState<string>('');
  const [customModelSize, setCustomModelSize] = useState<number>(0);
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);
  const [dragHoverTarget, setDragHoverTarget] = useState<'character' | 'floor' | 'wall' | 'door' | null>(null);
  const [isLoadingModel, setIsLoadingModel] = useState<boolean>(false);
  const [loadingMessage, setLoadingMessage] = useState<string>('3D-Modell wird geladen...');

  // Character Fine-Tuning state
  const [useRawCharacterScale, setUseRawCharacterScale] = useState<boolean>(true); // 1:1 Blender scale
  const [modelScale, setModelScale] = useState<number>(1.0);
  const [modelOffsetY, setModelOffsetY] = useState<number>(0.0);
  const [modelRotationY, setModelRotationY] = useState<number>(0); // in degrees: 0, 90, 180, 270

  // Floor Chunk GLB state (8m x 8m in Blender, center pivot)
  const [customFloorLoaded, setCustomFloorLoaded] = useState<boolean>(false);
  const [customFloorName, setCustomFloorName] = useState<string>('');
  const [customFloorSize, setCustomFloorSize] = useState<number>(0);
  const [floorScale, setFloorScale] = useState<number>(1.0);
  const [floorOffsetX, setFloorOffsetX] = useState<number>(0.0);
  const [floorOffsetY, setFloorOffsetY] = useState<number>(0.0);
  const [floorOffsetZ, setFloorOffsetZ] = useState<number>(0.0);
  const [floorRotationY, setFloorRotationY] = useState<number>(0);

  // Wall GLB state (8m x 0.5m x 4m in Blender, center-floor pivot)
  const [customWallLoaded, setCustomWallLoaded] = useState<boolean>(false);
  const [customWallName, setCustomWallName] = useState<string>('');
  const [customWallSize, setCustomWallSize] = useState<number>(0);
  const [wallScale, setWallScale] = useState<number>(1.0);
  const [wallOffsetX, setWallOffsetX] = useState<number>(0.0);
  const [wallOffsetY, setWallOffsetY] = useState<number>(0.0);
  const [wallOffsetZ, setWallOffsetZ] = useState<number>(0.0);
  const [wallRotationY, setWallRotationY] = useState<number>(0);
  const [showLeftWall, setShowLeftWall] = useState<boolean>(true);
  const [showUpperWall, setShowUpperWall] = useState<boolean>(true);

  // Door GLB state (center of left wall at 0°, center of upper wall at -90°)
  const [customDoorLoaded, setCustomDoorLoaded] = useState<boolean>(false);
  const [customDoorName, setCustomDoorName] = useState<string>('');
  const [customDoorSize, setCustomDoorSize] = useState<number>(0);
  const [doorScale, setDoorScale] = useState<number>(1.0);
  const [doorOffsetX, setDoorOffsetX] = useState<number>(0.0);
  const [doorOffsetY, setDoorOffsetY] = useState<number>(0.0);
  const [doorOffsetZ, setDoorOffsetZ] = useState<number>(0.0);
  const [doorRotationY, setDoorRotationY] = useState<number>(0);
  const [showLeftDoor, setShowLeftDoor] = useState<boolean>(true);
  const [showUpperDoor, setShowUpperDoor] = useState<boolean>(false);

  const customFloorLoadedRef = useRef<boolean>(false);
  useEffect(() => {
    customFloorLoadedRef.current = customFloorLoaded;
  }, [customFloorLoaded]);

  const floorOffsetYRef = useRef<number>(0.0);
  useEffect(() => {
    floorOffsetYRef.current = floorOffsetY;
  }, [floorOffsetY]);

  // Animation clips found in GLB
  const [availableClips, setAvailableClips] = useState<string[]>([]);
  const [selectedIdleClip, setSelectedIdleClip] = useState<string>('');
  const [selectedRunClip, setSelectedRunClip] = useState<string>('');
  const selectedIdleClipRef = useRef<string>('');
  const selectedRunClipRef = useRef<string>('');
  const moveSpeedRef = useRef<number>(3.6);

  useEffect(() => {
    moveSpeedRef.current = moveSpeed;
  }, [moveSpeed]);

  // Dynamic Tile and Surface parameters
  const currentTileSizeRef = useRef<number>(TILE_SIZE);
  const currentSurfaceYRef = useRef<number>(0.05);

  useEffect(() => {
    currentTileSizeRef.current = customFloorLoaded ? BLENDER_TILE_SIZE : TILE_SIZE;
    currentSurfaceYRef.current = customFloorLoaded ? (0.25 + floorOffsetY) : 0.05;
  }, [customFloorLoaded, floorOffsetY]);

  // Three.js mutable references
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const characterRootRef = useRef<THREE.Group | null>(null);
  const customModelInnerRef = useRef<THREE.Group | null>(null);
  const characterNaturalHeightRef = useRef<number>(1.85);
  const tileMeshesRef = useRef<THREE.Mesh[]>([]);
  const hoverIndicatorRef = useRef<THREE.Group | null>(null);

  // Scene Group References
  const proceduralFloorGroupRef = useRef<THREE.Group | null>(null);
  const proceduralWallGroupRef = useRef<THREE.Group | null>(null);
  const customFloorGroupRef = useRef<THREE.Group | null>(null);
  const customWallGroupRef = useRef<THREE.Group | null>(null);
  const customDoorGroupRef = useRef<THREE.Group | null>(null);
  const floorGltfSceneRef = useRef<THREE.Group | null>(null);
  const wallGltfSceneRef = useRef<THREE.Group | null>(null);
  const doorGltfSceneRef = useRef<THREE.Group | null>(null);

  // Animation mixer & clips
  const animationMixerRef = useRef<THREE.AnimationMixer | null>(null);
  const gltfClipsMapRef = useRef<Map<string, THREE.AnimationClip>>(new Map());
  const activeActionRef = useRef<THREE.AnimationAction | null>(null);
  const activeActionNameRef = useRef<'idle' | 'run'>('idle');

  // Movement queue & navigation
  const moveQueueRef = useRef<TileCoord[]>([]);
  const currentTileRef = useRef<TileCoord>({ col: 1, row: 1 });
  const characterPosRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0.05, 0));
  const targetWorldPosRef = useRef<THREE.Vector3 | null>(null);
  const currentFacingAngleRef = useRef<number>(0);
  const targetFacingAngleRef = useRef<number>(0);

  // Procedural dummy reference for fallback
  const animeKnightRef = useRef<{
    torso?: THREE.Group;
    head?: THREE.Group;
    hair?: THREE.Group;
    leftArm?: THREE.Group;
    rightArm?: THREE.Group;
    leftLeg?: THREE.Group;
    rightLeg?: THREE.Group;
  }>({});

  // Sound Synthesizer for tactile feedback
  const playTactileSfx = useCallback((type: 'click' | 'step' | 'hover' | 'success') => {
    if (!audioEnabledRef.current) return;
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'hover') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(560, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(740, ctx.currentTime + 0.04);
        gain.gain.setValueAtTime(0.015, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);
        osc.start();
        osc.stop(ctx.currentTime + 0.04);
      } else if (type === 'click') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.08);
        gain.gain.setValueAtTime(0.07, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
        osc.start();
        osc.stop(ctx.currentTime + 0.08);
      } else if (type === 'step') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(130, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.06);
        gain.gain.setValueAtTime(0.04, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
        osc.start();
        osc.stop(ctx.currentTime + 0.06);
      } else if (type === 'success') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
        osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1); // E5
        osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.2); // G5
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
      }
    } catch {
      // Audio fallback
    }
  }, []);

  // Create built-in anime knight dummy
  const createAnimeKnightDummy = useCallback((): THREE.Group => {
    const root = new THREE.Group();
    root.name = 'AnimeKnightDummy';

    const armorMat = new THREE.MeshLambertMaterial({ color: 0xedf2f7 });
    const armorDarkMat = new THREE.MeshLambertMaterial({ color: 0xcfd8dc });
    const blueTabardMat = new THREE.MeshLambertMaterial({ color: 0x2563eb });
    const blueDarkMat = new THREE.MeshLambertMaterial({ color: 0x1d4ed8 });
    const redHairMat = new THREE.MeshLambertMaterial({ color: 0xdc2626 });
    const skinMat = new THREE.MeshLambertMaterial({ color: 0xffe4d6 });
    const leatherMat = new THREE.MeshLambertMaterial({ color: 0x6b4423 });
    const goldMat = new THREE.MeshLambertMaterial({ color: 0xf59e0b });
    const eyeMat = new THREE.MeshLambertMaterial({ color: 0x0284c7 });

    const pelvis = new THREE.Group();
    pelvis.position.y = 0.95;
    root.add(pelvis);

    const torsoGroup = new THREE.Group();
    const breastplateGeo = new THREE.CylinderGeometry(0.28, 0.22, 0.55, 24);
    const breastplate = new THREE.Mesh(breastplateGeo, armorMat);
    breastplate.position.y = 0.32;
    torsoGroup.add(breastplate);

    const gorgetGeo = new THREE.CylinderGeometry(0.18, 0.24, 0.14, 20);
    const gorget = new THREE.Mesh(gorgetGeo, armorDarkMat);
    gorget.position.y = 0.62;
    torsoGroup.add(gorget);

    const beltGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.1, 24);
    const belt = new THREE.Mesh(beltGeo, leatherMat);
    belt.position.y = 0.06;
    torsoGroup.add(belt);

    const buckleGeo = new THREE.BoxGeometry(0.1, 0.12, 0.12);
    const buckle = new THREE.Mesh(buckleGeo, goldMat);
    buckle.position.set(0, 0.06, 0.21);
    torsoGroup.add(buckle);

    const skirtGroup = new THREE.Group();
    const skirtGeo = new THREE.CylinderGeometry(0.24, 0.42, 0.55, 24, 1, true);
    const skirt = new THREE.Mesh(skirtGeo, blueTabardMat);
    skirt.position.y = -0.22;
    skirtGroup.add(skirt);

    const flapGeo = new THREE.PlaneGeometry(0.22, 0.52);
    const flap = new THREE.Mesh(flapGeo, blueDarkMat);
    flap.position.set(0, -0.22, 0.28);
    skirtGroup.add(flap);

    torsoGroup.add(skirtGroup);
    pelvis.add(torsoGroup);
    animeKnightRef.current.torso = torsoGroup;

    const headGroup = new THREE.Group();
    headGroup.position.y = 0.76;
    const headGeo = new THREE.SphereGeometry(0.25, 24, 20);
    headGeo.scale(1, 1.12, 1);
    const head = new THREE.Mesh(headGeo, skinMat);
    headGroup.add(head);

    const eyeGeo = new THREE.PlaneGeometry(0.08, 0.12);
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-0.09, 0.02, 0.24);
    leftEye.rotation.y = -0.15;
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(0.09, 0.02, 0.24);
    rightEye.rotation.y = 0.15;
    headGroup.add(leftEye);
    headGroup.add(rightEye);

    const hairGroup = new THREE.Group();
    const hairCrownGeo = new THREE.SphereGeometry(0.28, 20, 16);
    hairCrownGeo.scale(1.05, 1.05, 1.08);
    const hairCrown = new THREE.Mesh(hairCrownGeo, redHairMat);
    hairCrown.position.set(0, 0.06, -0.05);
    hairGroup.add(hairCrown);

    const hairBackGeo = new THREE.CylinderGeometry(0.28, 0.38, 0.85, 16);
    const hairBack = new THREE.Mesh(hairBackGeo, redHairMat);
    hairBack.position.set(0, -0.32, -0.18);
    hairBack.rotation.x = -0.12;
    hairGroup.add(hairBack);

    const bangGeo = new THREE.ConeGeometry(0.12, 0.32, 12);
    bangGeo.rotateZ(0.25);
    const bangLeft = new THREE.Mesh(bangGeo, redHairMat);
    bangLeft.position.set(-0.1, 0.12, 0.2);
    const bangRight = new THREE.Mesh(bangGeo, redHairMat);
    bangRight.position.set(0.12, 0.12, 0.19);
    bangRight.rotation.z = -0.4;
    hairGroup.add(bangLeft);
    hairGroup.add(bangRight);

    headGroup.add(hairGroup);
    animeKnightRef.current.hair = hairGroup;
    animeKnightRef.current.head = headGroup;
    torsoGroup.add(headGroup);

    const leftArmGroup = new THREE.Group();
    leftArmGroup.position.set(-0.35, 0.52, 0);
    const pauldronGeo = new THREE.SphereGeometry(0.18, 16, 12, 0, Math.PI);
    pauldronGeo.rotateZ(Math.PI / 2);
    const leftPauldron = new THREE.Mesh(pauldronGeo, armorMat);
    leftPauldron.position.set(-0.06, 0.05, 0);
    leftArmGroup.add(leftPauldron);

    const armGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.45, 16);
    const leftArm = new THREE.Mesh(armGeo, armorDarkMat);
    leftArm.position.y = -0.22;
    leftArmGroup.add(leftArm);

    const handGeo = new THREE.SphereGeometry(0.09, 14, 12);
    const leftHand = new THREE.Mesh(handGeo, armorMat);
    leftHand.position.y = -0.46;
    leftArmGroup.add(leftHand);

    torsoGroup.add(leftArmGroup);
    animeKnightRef.current.leftArm = leftArmGroup;

    const rightArmGroup = new THREE.Group();
    rightArmGroup.position.set(0.35, 0.52, 0);
    const rightPauldron = new THREE.Mesh(pauldronGeo, armorMat);
    rightPauldron.position.set(0.06, 0.05, 0);
    rightPauldron.rotation.y = Math.PI;
    rightArmGroup.add(rightPauldron);

    const rightArm = new THREE.Mesh(armGeo, armorDarkMat);
    rightArm.position.y = -0.22;
    rightArmGroup.add(rightArm);

    const rightHand = new THREE.Mesh(handGeo, armorMat);
    rightHand.position.y = -0.46;
    rightArmGroup.add(rightHand);

    torsoGroup.add(rightArmGroup);
    animeKnightRef.current.rightArm = rightArmGroup;

    const leftLegGroup = new THREE.Group();
    leftLegGroup.position.set(-0.16, 0, 0);
    const legGeo = new THREE.CylinderGeometry(0.11, 0.09, 0.55, 16);
    const leftLeg = new THREE.Mesh(legGeo, armorMat);
    leftLeg.position.y = -0.28;
    leftLegGroup.add(leftLeg);

    const bootGeo = new THREE.BoxGeometry(0.14, 0.18, 0.26);
    const leftBoot = new THREE.Mesh(bootGeo, armorDarkMat);
    leftBoot.position.set(0, -0.62, 0.05);
    leftLegGroup.add(leftBoot);

    pelvis.add(leftLegGroup);
    animeKnightRef.current.leftLeg = leftLegGroup;

    const rightLegGroup = new THREE.Group();
    rightLegGroup.position.set(0.16, 0, 0);
    const rightLeg = new THREE.Mesh(legGeo, armorMat);
    rightLeg.position.y = -0.28;
    rightLegGroup.add(rightLeg);

    const rightBoot = new THREE.Mesh(bootGeo, armorDarkMat);
    rightBoot.position.set(0, -0.62, 0.05);
    rightLegGroup.add(rightBoot);

    pelvis.add(rightLegGroup);
    animeKnightRef.current.rightLeg = rightLegGroup;

    const shadowGeo = new THREE.PlaneGeometry(0.95, 0.95);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x111111,
      transparent: true,
      opacity: 0.45,
      depthWrite: false
    });
    const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    shadowMesh.rotation.x = -Math.PI / 2;
    shadowMesh.position.y = 0.01;
    root.add(shadowMesh);

    return root;
  }, []);

  // Update Procedural Character Kinematics
  const updateCharacterPose = useCallback((delta: number, elapsed: number, moving: boolean) => {
    // If using GLTF AnimationMixer
    if (animationMixerRef.current) {
      animationMixerRef.current.update(delta);
      return;
    }

    // If GLB loaded but has no skeletal animation: apply gentle procedural walk/idle bob to model
    if (customModelInnerRef.current) {
      if (moving) {
        customModelInnerRef.current.position.y = modelOffsetY + Math.abs(Math.sin(elapsed * 12)) * 0.06;
        customModelInnerRef.current.rotation.z = Math.sin(elapsed * 12) * 0.04;
      } else {
        customModelInnerRef.current.position.y = modelOffsetY + Math.sin(elapsed * 2.4) * 0.015;
        customModelInnerRef.current.rotation.z = 0;
      }
      return;
    }

    // Procedural Dummy Animation
    const limbs = animeKnightRef.current;
    if (!limbs.leftLeg || !limbs.rightLeg || !limbs.leftArm || !limbs.rightArm || !limbs.torso) return;

    if (moving) {
      const runSpeed = 13;
      const legCycle = Math.sin(elapsed * runSpeed);
      const armCycle = Math.cos(elapsed * runSpeed);

      limbs.leftLeg.rotation.x = legCycle * 0.72;
      limbs.rightLeg.rotation.x = -legCycle * 0.72;
      limbs.leftArm.rotation.x = -armCycle * 0.65;
      limbs.rightArm.rotation.x = armCycle * 0.65;

      limbs.torso.position.y = 0.32 + Math.abs(Math.sin(elapsed * runSpeed * 2)) * 0.06;
      limbs.torso.rotation.x = 0.14;
      limbs.torso.rotation.y = legCycle * 0.1;

      if (limbs.hair) {
        limbs.hair.rotation.x = Math.sin(elapsed * runSpeed * 2) * 0.08 - 0.05;
      }
    } else {
      const idleSpeed = 2.4;
      const breath = Math.sin(elapsed * idleSpeed);

      limbs.leftLeg.rotation.x = THREE.MathUtils.damp(limbs.leftLeg.rotation.x, 0, 8, delta);
      limbs.rightLeg.rotation.x = THREE.MathUtils.damp(limbs.rightLeg.rotation.x, 0, 8, delta);
      limbs.leftArm.rotation.x = THREE.MathUtils.damp(limbs.leftArm.rotation.x, Math.sin(elapsed * idleSpeed) * 0.06, 6, delta);
      limbs.rightArm.rotation.x = THREE.MathUtils.damp(limbs.rightArm.rotation.x, -Math.sin(elapsed * idleSpeed) * 0.06, 6, delta);

      limbs.torso.position.y = 0.32 + breath * 0.02;
      limbs.torso.rotation.x = THREE.MathUtils.damp(limbs.torso.rotation.x, 0, 8, delta);
      limbs.torso.rotation.y = THREE.MathUtils.damp(limbs.torso.rotation.y, Math.sin(elapsed * 1.2) * 0.03, 6, delta);

      if (limbs.hair) {
        limbs.hair.rotation.x = Math.sin(elapsed * 2.2) * 0.02;
      }
    }
  }, [modelOffsetY]);

  // Set Character Animation Clip
  const playAnimationClip = useCallback((clipName: string, fadeDuration: number = 0.25) => {
    if (!animationMixerRef.current || !clipName) return;
    const clip = gltfClipsMapRef.current.get(clipName);
    if (!clip) return;

    const nextAction = animationMixerRef.current.clipAction(clip);
    const currentAction = activeActionRef.current;

    if (currentAction === nextAction) {
      if (!currentAction.isRunning()) {
        currentAction.reset().play();
      }
      return;
    }

    if (currentAction) {
      currentAction.fadeOut(fadeDuration);
    }

    nextAction.reset().fadeIn(fadeDuration).play();
    activeActionRef.current = nextAction;
  }, []);

  // Switch animation between Idle and Run using always-fresh clip refs
  const updateMovementAnimation = useCallback((moving: boolean) => {
    if (!animationMixerRef.current) return;
    const clipName = moving ? selectedRunClipRef.current : selectedIdleClipRef.current;
    if (clipName) {
      playAnimationClip(clipName);
    }
  }, [playAnimationClip]);

  const updateMovementAnimationRef = useRef(updateMovementAnimation);
  useEffect(() => {
    updateMovementAnimationRef.current = updateMovementAnimation;
  }, [updateMovementAnimation]);

  // Instantiate and mount GLB Scene into Three.js
  const mountGLBModel = useCallback((gltf: any, config?: Partial<StoredGLBConfig>) => {
    if (!sceneRef.current) return;

    // Clear existing character
    if (characterRootRef.current && sceneRef.current) {
      sceneRef.current.remove(characterRootRef.current);
    }

    const model = gltf.scene;
    model.name = 'UserCustomGLB';

    // Normalize materials and skinning
    model.traverse((child: any) => {
      if (child.isMesh) {
        child.castShadow = false;
        child.receiveShadow = false;
        child.frustumCulled = false;

        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m: any) => {
          if (m) {
            if ('roughness' in m) m.roughness = 0.85;
            if ('metalness' in m) m.metalness = 0.05;
            if (m.map) {
              m.map.colorSpace = THREE.SRGBColorSpace;
              m.map.needsUpdate = true;
            }
          }
        });
      }
    });

    // Compute bounding box and normalize scale & pivot to bottom-center
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    // Standard character height ~1.85m or true 1:1 Blender scale
    const naturalHeight = size.y || 1;
    characterNaturalHeightRef.current = naturalHeight;
    const isRawScale = config?.useRawScale !== undefined ? config.useRawScale : useRawCharacterScale;
    const baseScale = isRawScale ? 1.0 : (1.85 / naturalHeight);

    // Center model at its feet
    model.position.set(-center.x, -box.min.y, -center.z);

    // Inner wrapper for user scale, offset, and rotation adjustments
    const innerWrapper = new THREE.Group();
    innerWrapper.name = 'GLBInnerAdjuster';
    innerWrapper.add(model);

    const userScale = config?.scale ?? modelScale;
    const userOffsetY = config?.offsetY ?? modelOffsetY;
    const userRotY = (config?.rotationY ?? modelRotationY) * (Math.PI / 180);

    innerWrapper.scale.set(baseScale * userScale, baseScale * userScale, baseScale * userScale);
    innerWrapper.position.set(0, userOffsetY, 0);
    innerWrapper.rotation.y = userRotY;
    customModelInnerRef.current = innerWrapper;

    // Root wrapper for dungeon tile navigation and cardinal directions
    const root = new THREE.Group();
    root.name = 'CharacterRoot';
    root.add(innerWrapper);

    // Soft grounded shadow beneath character
    const shadowGeo = new THREE.PlaneGeometry(0.95, 0.95);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x111111,
      transparent: true,
      opacity: 0.45,
      depthWrite: false
    });
    const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    shadowMesh.rotation.x = -Math.PI / 2;
    shadowMesh.position.y = 0.01;
    root.add(shadowMesh);

    // Apply current position and facing angle
    root.position.copy(characterPosRef.current);
    root.rotation.y = currentFacingAngleRef.current;

    sceneRef.current.add(root);
    characterRootRef.current = root;

    // Process Animations
    const clips = gltf.animations || [];
    gltfClipsMapRef.current.clear();
    const clipNames: string[] = [];

    clips.forEach((clip: THREE.AnimationClip) => {
      gltfClipsMapRef.current.set(clip.name, clip);
      clipNames.push(clip.name);
    });

    setAvailableClips(clipNames);

    if (clips.length > 0) {
      const mixer = new THREE.AnimationMixer(model);
      animationMixerRef.current = mixer;

      // Auto-detect Idle & Run clips or use config
      let idleName = config?.idleClipName || clipNames.find(n => /idle|stand|wait|pose/i.test(n)) || clipNames[0];
      let runName = config?.runClipName || clipNames.find(n => /run|walk|move|jog/i.test(n)) || clipNames[1] || clipNames[0];

      setSelectedIdleClip(idleName);
      setSelectedRunClip(runName);
      selectedIdleClipRef.current = idleName;
      selectedRunClipRef.current = runName;

      const idleClip = gltfClipsMapRef.current.get(idleName);
      if (idleClip) {
        const action = mixer.clipAction(idleClip);
        action.play();
        activeActionRef.current = action;
        activeActionNameRef.current = 'idle';
      }
    } else {
      animationMixerRef.current = null;
      activeActionRef.current = null;
      setSelectedIdleClip('');
      setSelectedRunClip('');
      selectedIdleClipRef.current = '';
      selectedRunClipRef.current = '';
    }

    setCustomModelLoaded(true);
    playTactileSfx('success');
  }, [modelScale, modelOffsetY, modelRotationY, useRawCharacterScale, playTactileSfx]);

  // Mount Custom Floor GLB (Blender 8m x 8m, center pivot)
  const mountFloorGLB = useCallback((gltf: any, config?: Partial<StoredEnvironmentGLBConfig>) => {
    if (!sceneRef.current || !customFloorGroupRef.current) return;

    while (customFloorGroupRef.current.children.length > 0) {
      customFloorGroupRef.current.remove(customFloorGroupRef.current.children[0]);
    }

    const model = gltf.scene;
    model.name = 'UserCustomFloorScene';
    floorGltfSceneRef.current = model;

    model.traverse((child: any) => {
      if (child.isMesh) {
        child.castShadow = false;
        child.receiveShadow = false;
        child.frustumCulled = false;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m: any) => {
          if (m && m.map) {
            m.map.colorSpace = THREE.SRGBColorSpace;
            m.map.needsUpdate = true;
          }
        });
      }
    });

    customFloorGroupRef.current.add(model);
    customFloorGroupRef.current.visible = true;

    const posX = config?.offsetX ?? floorOffsetX;
    const posY = config?.offsetY ?? floorOffsetY;
    const posZ = config?.offsetZ ?? floorOffsetZ;
    const rotY = ((config?.rotationY ?? floorRotationY) * Math.PI) / 180;
    const scale = config?.scale ?? floorScale;

    customFloorGroupRef.current.position.set(posX, posY, posZ);
    customFloorGroupRef.current.rotation.y = rotY;
    customFloorGroupRef.current.scale.setScalar(scale);

    // Hide procedural floor diorama
    if (proceduralFloorGroupRef.current) {
      proceduralFloorGroupRef.current.visible = false;
    }

    setCustomFloorLoaded(true);
    playTactileSfx('success');
  }, [floorOffsetX, floorOffsetY, floorOffsetZ, floorRotationY, floorScale, playTactileSfx]);

  // Mount Custom Wall GLB (Blender 8m x 0.5m x 4m, floor-center pivot)
  const mountWallGLB = useCallback((gltf: any, config?: Partial<StoredEnvironmentGLBConfig>) => {
    if (!sceneRef.current || !customWallGroupRef.current) return;

    while (customWallGroupRef.current.children.length > 0) {
      customWallGroupRef.current.remove(customWallGroupRef.current.children[0]);
    }

    const baseModel = gltf.scene;
    baseModel.name = 'UserCustomWallBase';
    wallGltfSceneRef.current = baseModel;

    baseModel.traverse((child: any) => {
      if (child.isMesh) {
        child.castShadow = false;
        child.receiveShadow = false;
        child.frustumCulled = false;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m: any) => {
          if (m && m.map) {
            m.map.colorSpace = THREE.SRGBColorSpace;
            m.map.needsUpdate = true;
          }
        });
      }
    });

    const posX = config?.offsetX ?? wallOffsetX;
    const posY = config?.offsetY ?? wallOffsetY;
    const posZ = config?.offsetZ ?? wallOffsetZ;
    const baseRotY = ((config?.rotationY ?? wallRotationY) * Math.PI) / 180;
    const scale = config?.scale ?? wallScale;
    const leftActive = config?.showLeftWall !== undefined ? config.showLeftWall : showLeftWall;
    const upperActive = config?.showUpperWall !== undefined ? config.showUpperWall : showUpperWall;

    // 1. Left_Wall: stands on the left side (rotation 0)
    if (leftActive) {
      const leftWall = baseModel.clone(true);
      leftWall.name = 'Left_Wall';
      leftWall.position.set(0, 0, 0);
      leftWall.rotation.set(0, 0, 0);
      customWallGroupRef.current.add(leftWall);
    }

    // 2. Upper_Wall: rotated -90° (-Math.PI / 2) around floor center pivot to stand on the upper side
    if (upperActive) {
      const upperWall = baseModel.clone(true);
      upperWall.name = 'Upper_Wall';
      upperWall.position.set(0, 0, 0);
      upperWall.rotation.set(0, -Math.PI / 2, 0);
      customWallGroupRef.current.add(upperWall);
    }

    customWallGroupRef.current.position.set(posX, posY, posZ);
    customWallGroupRef.current.rotation.y = baseRotY;
    customWallGroupRef.current.scale.setScalar(scale);
    customWallGroupRef.current.visible = true;

    // Hide procedural walls
    if (proceduralWallGroupRef.current) {
      proceduralWallGroupRef.current.visible = false;
    }

    setCustomWallLoaded(true);
    playTactileSfx('success');
  }, [wallOffsetX, wallOffsetY, wallOffsetZ, wallRotationY, wallScale, showLeftWall, showUpperWall, playTactileSfx]);

  const mountFloorGLBRef = useRef(mountFloorGLB);
  useEffect(() => {
    mountFloorGLBRef.current = mountFloorGLB;
  }, [mountFloorGLB]);

  const mountWallGLBRef = useRef(mountWallGLB);
  useEffect(() => {
    mountWallGLBRef.current = mountWallGLB;
  }, [mountWallGLB]);

  // Mount Custom Door GLB (in center of left wall at 0°, rotated -90° for upper wall)
  const mountDoorGLB = useCallback((gltf: any, config?: Partial<StoredEnvironmentGLBConfig>) => {
    if (!sceneRef.current || !customDoorGroupRef.current) return;

    while (customDoorGroupRef.current.children.length > 0) {
      customDoorGroupRef.current.remove(customDoorGroupRef.current.children[0]);
    }

    const baseModel = gltf.scene;
    baseModel.name = 'UserCustomDoorBase';
    doorGltfSceneRef.current = baseModel;

    baseModel.traverse((child: any) => {
      if (child.isMesh) {
        child.castShadow = false;
        child.receiveShadow = false;
        child.frustumCulled = false;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m: any) => {
          if (m && m.map) {
            m.map.colorSpace = THREE.SRGBColorSpace;
            m.map.needsUpdate = true;
          }
        });
      }
    });

    const posX = config?.offsetX ?? doorOffsetX;
    const posY = config?.offsetY ?? doorOffsetY;
    const posZ = config?.offsetZ ?? doorOffsetZ;
    const baseRotY = ((config?.rotationY ?? doorRotationY) * Math.PI) / 180;
    const scale = config?.scale ?? doorScale;
    const leftActive = config?.showLeftDoor !== undefined ? config.showLeftDoor : showLeftDoor;
    const upperActive = config?.showUpperDoor !== undefined ? config.showUpperDoor : showUpperDoor;

    // 1. Left_Door: positioned in the center of the left wall (rotation 0)
    if (leftActive) {
      const leftDoor = baseModel.clone(true);
      leftDoor.name = 'Left_Door';
      leftDoor.position.set(0, 0, 0);
      leftDoor.rotation.set(0, 0, 0);
      customDoorGroupRef.current.add(leftDoor);
    }

    // 2. Upper_Door: rotated -90° around floor center pivot to appear in the center of the upper wall
    if (upperActive) {
      const upperDoor = baseModel.clone(true);
      upperDoor.name = 'Upper_Door';
      upperDoor.position.set(0, 0, 0);
      upperDoor.rotation.set(0, -Math.PI / 2, 0);
      customDoorGroupRef.current.add(upperDoor);
    }

    customDoorGroupRef.current.position.set(posX, posY, posZ);
    customDoorGroupRef.current.rotation.y = baseRotY;
    customDoorGroupRef.current.scale.setScalar(scale);
    customDoorGroupRef.current.visible = true;

    setCustomDoorLoaded(true);
    playTactileSfx('success');
  }, [doorOffsetX, doorOffsetY, doorOffsetZ, doorRotationY, doorScale, showLeftDoor, showUpperDoor, playTactileSfx]);

  const mountDoorGLBRef = useRef(mountDoorGLB);
  useEffect(() => {
    mountDoorGLBRef.current = mountDoorGLB;
  }, [mountDoorGLB]);

  // Load Character GLB File
  const processGLBFile = useCallback(async (file: File) => {
    setIsLoadingModel(true);
    setLoadingMessage(`Lade Charakter-Modell "${file.name}"...`);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const base64DataUrl = await arrayBufferToDataUrl(arrayBuffer);

      const loader = new GLTFLoader();
      loader.parse(arrayBuffer, '', async (gltf) => {
        mountGLBModel(gltf, {
          fileName: file.name,
          fileSize: file.size,
          scale: 1.0,
          useRawScale: useRawCharacterScale,
          offsetY: 0.0,
          rotationY: 0.0
        });

        setCustomModelName(file.name);
        setCustomModelSize(file.size);
        setModelScale(1.0);
        setModelOffsetY(0.0);
        setModelRotationY(0);

        try {
          await setItem(STORAGE_KEY_CHAR_GLB, {
            fileName: file.name,
            fileSize: file.size,
            dataBase64: base64DataUrl,
            scale: 1.0,
            useRawScale: useRawCharacterScale,
            offsetY: 0.0,
            rotationY: 0.0
          });
        } catch (storageErr) {
          console.warn("Could not save GLB to IndexedDB:", storageErr);
        }

        setIsLoadingModel(false);
      }, (err) => {
        console.error("GLTF Loader parse error:", err);
        alert("Fehler beim Einlesen der .glb Datei. Bitte prüfe, ob die Datei intakt ist.");
        setIsLoadingModel(false);
      });
    } catch (err: any) {
      console.error("GLB file read error:", err);
      alert("Fehler beim Laden der Datei: " + err.message);
      setIsLoadingModel(false);
    }
  }, [mountGLBModel, useRawCharacterScale]);

  // Load Floor Chunk GLB File (8m x 8m)
  const processFloorGLBFile = useCallback(async (file: File) => {
    setIsLoadingModel(true);
    setLoadingMessage(`Lade Bodenplatte "${file.name}" (8x8m)...`);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const base64DataUrl = await arrayBufferToDataUrl(arrayBuffer);

      const loader = new GLTFLoader();
      loader.parse(arrayBuffer, '', async (gltf) => {
        mountFloorGLB(gltf, {
          fileName: file.name,
          fileSize: file.size,
          scale: 1.0,
          offsetX: 0.0,
          offsetY: 0.0,
          offsetZ: 0.0,
          rotationY: 0.0
        });

        setCustomFloorName(file.name);
        setCustomFloorSize(file.size);
        setFloorScale(1.0);
        setFloorOffsetX(0.0);
        setFloorOffsetY(0.0);
        setFloorOffsetZ(0.0);
        setFloorRotationY(0);

        try {
          await setItem(STORAGE_KEY_FLOOR_GLB, {
            fileName: file.name,
            fileSize: file.size,
            dataBase64: base64DataUrl,
            scale: 1.0,
            offsetX: 0.0,
            offsetY: 0.0,
            offsetZ: 0.0,
            rotationY: 0.0
          });
        } catch (storageErr) {
          console.warn("Could not save Floor GLB to IndexedDB:", storageErr);
        }

        setIsLoadingModel(false);
      }, (err) => {
        console.error("Floor GLTF parse error:", err);
        alert("Fehler beim Einlesen der Bodenplatten-GLB: " + err.message);
        setIsLoadingModel(false);
      });
    } catch (err: any) {
      console.error("Floor file read error:", err);
      alert("Fehler beim Laden der Datei: " + err.message);
      setIsLoadingModel(false);
    }
  }, [mountFloorGLB]);

  // Load Wall GLB File (8m length, 4m height)
  const processWallGLBFile = useCallback(async (file: File) => {
    setIsLoadingModel(true);
    setLoadingMessage(`Lade Wand "${file.name}" (8m)...`);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const base64DataUrl = await arrayBufferToDataUrl(arrayBuffer);

      const loader = new GLTFLoader();
      loader.parse(arrayBuffer, '', async (gltf) => {
        mountWallGLB(gltf, {
          fileName: file.name,
          fileSize: file.size,
          scale: 1.0,
          offsetX: 0.0,
          offsetY: 0.0,
          offsetZ: 0.0,
          rotationY: 0.0,
          showLeftWall: showLeftWall,
          showUpperWall: showUpperWall
        });

        setCustomWallName(file.name);
        setCustomWallSize(file.size);
        setWallScale(1.0);
        setWallOffsetX(0.0);
        setWallOffsetY(0.0);
        setWallOffsetZ(0.0);
        setWallRotationY(0);

        try {
          await setItem(STORAGE_KEY_WALL_GLB, {
            fileName: file.name,
            fileSize: file.size,
            dataBase64: base64DataUrl,
            scale: 1.0,
            offsetX: 0.0,
            offsetY: 0.0,
            offsetZ: 0.0,
            rotationY: 0.0,
            showLeftWall: showLeftWall,
            showUpperWall: showUpperWall
          });
        } catch (storageErr) {
          console.warn("Could not save Wall GLB to IndexedDB:", storageErr);
        }

        setIsLoadingModel(false);
      }, (err) => {
        console.error("Wall GLTF parse error:", err);
        alert("Fehler beim Einlesen der Wand-GLB: " + err.message);
        setIsLoadingModel(false);
      });
    } catch (err: any) {
      console.error("Wall file read error:", err);
      alert("Fehler beim Laden der Datei: " + err.message);
      setIsLoadingModel(false);
    }
  }, [mountWallGLB, showLeftWall, showUpperWall]);

  // Load Door GLB File (center of left wall at 0°, center of upper wall at -90°)
  const processDoorGLBFile = useCallback(async (file: File) => {
    setIsLoadingModel(true);
    setLoadingMessage(`Lade Tür-Modell "${file.name}"...`);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const base64DataUrl = await arrayBufferToDataUrl(arrayBuffer);

      const loader = new GLTFLoader();
      loader.parse(arrayBuffer, '', async (gltf) => {
        mountDoorGLB(gltf, {
          fileName: file.name,
          fileSize: file.size,
          scale: 1.0,
          offsetX: 0.0,
          offsetY: 0.0,
          offsetZ: 0.0,
          rotationY: 0.0,
          showLeftDoor: showLeftDoor,
          showUpperDoor: showUpperDoor
        });

        setCustomDoorName(file.name);
        setCustomDoorSize(file.size);
        setDoorScale(1.0);
        setDoorOffsetX(0.0);
        setDoorOffsetY(0.0);
        setDoorOffsetZ(0.0);
        setDoorRotationY(0);

        try {
          await setItem(STORAGE_KEY_DOOR_GLB, {
            fileName: file.name,
            fileSize: file.size,
            dataBase64: base64DataUrl,
            scale: 1.0,
            offsetX: 0.0,
            offsetY: 0.0,
            offsetZ: 0.0,
            rotationY: 0.0,
            showLeftDoor: showLeftDoor,
            showUpperDoor: showUpperDoor
          });
        } catch (storageErr) {
          console.warn("Could not save Door GLB to IndexedDB:", storageErr);
        }

        setIsLoadingModel(false);
      }, (err) => {
        console.error("Door GLTF parse error:", err);
        alert("Fehler beim Einlesen der Tür-GLB: " + err.message);
        setIsLoadingModel(false);
      });
    } catch (err: any) {
      console.error("Door file read error:", err);
      alert("Fehler beim Laden der Tür-Datei: " + err.message);
      setIsLoadingModel(false);
    }
  }, [mountDoorGLB, showLeftDoor, showUpperDoor]);

  // Load a character's 3D model from the project
  const loadCharacterFromProject = useCallback(async (char: Character) => {
    if (!char.model3dSrc) {
      alert(`Für "${char.name}" ist noch kein 3D-Modell im Charakter-Editor hinterlegt. Du kannst direkt eine .glb Datei hochladen.`);
      return;
    }
    setIsLoadingModel(true);
    setLoadingMessage(`Lade 3D-Modell für ${char.name}...`);
    try {
      const dataUrl = await loadImage(char.model3dSrc);
      if (!dataUrl) {
        alert("3D-Modell im Speicher nicht gefunden.");
        setIsLoadingModel(false);
        return;
      }
      const buffer = dataUrlToArrayBuffer(dataUrl);
      const loader = new GLTFLoader();
      loader.parse(buffer, '', (gltf) => {
        mountGLBModel(gltf, {
          fileName: `${char.name}.glb`,
          scale: char.model3dScale ?? 1.0,
          useRawScale: useRawCharacterScale,
          offsetY: char.model3dOffsetY ?? 0.0,
          rotationY: char.model3dRotationY ?? 0.0,
        });
        setCustomModelName(`${char.name}.glb`);
        setCustomModelSize(0);
        setIsLoadingModel(false);
      });
    } catch (err: any) {
      console.error("Failed to load character GLB:", err);
      setIsLoadingModel(false);
    }
  }, [mountGLBModel, useRawCharacterScale]);

  // Revert to built-in Anime Knight Dummy
  const handleResetToDummy = useCallback(async () => {
    try {
      await setItem(STORAGE_KEY_CHAR_GLB, null);
    } catch (e) {
      console.warn("IDB clear error", e);
    }

    if (characterRootRef.current && sceneRef.current) {
      sceneRef.current.remove(characterRootRef.current);
    }

    animationMixerRef.current = null;
    gltfClipsMapRef.current.clear();
    customModelInnerRef.current = null;

    const dummy = createAnimeKnightDummy();
    dummy.position.copy(characterPosRef.current);
    dummy.rotation.y = currentFacingAngleRef.current;
    sceneRef.current?.add(dummy);
    characterRootRef.current = dummy;

    setCustomModelLoaded(false);
    setCustomModelName('');
    setCustomModelSize(0);
    setAvailableClips([]);
    setSelectedIdleClip('');
    setSelectedRunClip('');
    selectedIdleClipRef.current = '';
    selectedRunClipRef.current = '';
    setModelScale(1.0);
    setModelOffsetY(0.0);
    setModelRotationY(0);
    playTactileSfx('click');
  }, [createAnimeKnightDummy, playTactileSfx]);

  // Revert Floor to procedural diorama
  const handleResetFloor = useCallback(async () => {
    try {
      await setItem(STORAGE_KEY_FLOOR_GLB, null);
    } catch (e) {
      console.warn("IDB clear error", e);
    }
    if (customFloorGroupRef.current) {
      while (customFloorGroupRef.current.children.length > 0) {
        customFloorGroupRef.current.remove(customFloorGroupRef.current.children[0]);
      }
      customFloorGroupRef.current.visible = false;
    }
    if (proceduralFloorGroupRef.current) {
      proceduralFloorGroupRef.current.visible = true;
    }
    floorGltfSceneRef.current = null;
    setCustomFloorLoaded(false);
    setCustomFloorName('');
    setCustomFloorSize(0);
    setFloorScale(1.0);
    setFloorOffsetX(0.0);
    setFloorOffsetY(0.0);
    setFloorOffsetZ(0.0);
    setFloorRotationY(0);
    playTactileSfx('click');
  }, [playTactileSfx]);

  // Revert Wall to procedural walls
  const handleResetWall = useCallback(async () => {
    try {
      await setItem(STORAGE_KEY_WALL_GLB, null);
    } catch (e) {
      console.warn("IDB clear error", e);
    }
    if (customWallGroupRef.current) {
      while (customWallGroupRef.current.children.length > 0) {
        customWallGroupRef.current.remove(customWallGroupRef.current.children[0]);
      }
      customWallGroupRef.current.visible = false;
    }
    if (proceduralWallGroupRef.current) {
      proceduralWallGroupRef.current.visible = true;
    }
    wallGltfSceneRef.current = null;
    setCustomWallLoaded(false);
    setCustomWallName('');
    setCustomWallSize(0);
    setWallScale(1.0);
    setWallOffsetX(0.0);
    setWallOffsetY(0.0);
    setWallOffsetZ(0.0);
    setWallRotationY(0);
    setShowLeftWall(true);
    setShowUpperWall(true);
    playTactileSfx('click');
  }, [playTactileSfx]);

  // Toggle individual walls (Left_Wall and Upper_Wall)
  const toggleLeftWall = useCallback(() => {
    setShowLeftWall(prev => {
      const next = !prev;
      getItem<StoredEnvironmentGLBConfig>(STORAGE_KEY_WALL_GLB).then(stored => {
        if (stored) setItem(STORAGE_KEY_WALL_GLB, { ...stored, showLeftWall: next });
      }).catch(err => console.warn(err));
      return next;
    });
    playTactileSfx('click');
  }, [playTactileSfx]);

  const toggleUpperWall = useCallback(() => {
    setShowUpperWall(prev => {
      const next = !prev;
      getItem<StoredEnvironmentGLBConfig>(STORAGE_KEY_WALL_GLB).then(stored => {
        if (stored) setItem(STORAGE_KEY_WALL_GLB, { ...stored, showUpperWall: next });
      }).catch(err => console.warn(err));
      return next;
    });
    playTactileSfx('click');
  }, [playTactileSfx]);

  // Remove Door GLB
  const handleResetDoor = useCallback(async () => {
    try {
      await setItem(STORAGE_KEY_DOOR_GLB, null);
    } catch (e) {
      console.warn("IDB clear door error", e);
    }
    if (customDoorGroupRef.current) {
      while (customDoorGroupRef.current.children.length > 0) {
        customDoorGroupRef.current.remove(customDoorGroupRef.current.children[0]);
      }
      customDoorGroupRef.current.visible = false;
    }
    doorGltfSceneRef.current = null;
    setCustomDoorLoaded(false);
    setCustomDoorName('');
    setCustomDoorSize(0);
    setDoorScale(1.0);
    setDoorOffsetX(0.0);
    setDoorOffsetY(0.0);
    setDoorOffsetZ(0.0);
    setDoorRotationY(0);
    setShowLeftDoor(true);
    setShowUpperDoor(false);
    playTactileSfx('click');
  }, [playTactileSfx]);

  // Toggle individual doors (Left_Door and Upper_Door)
  const toggleLeftDoor = useCallback(() => {
    setShowLeftDoor(prev => {
      const next = !prev;
      getItem<StoredEnvironmentGLBConfig>(STORAGE_KEY_DOOR_GLB).then(stored => {
        if (stored) setItem(STORAGE_KEY_DOOR_GLB, { ...stored, showLeftDoor: next });
      }).catch(err => console.warn(err));
      return next;
    });
    playTactileSfx('click');
  }, [playTactileSfx]);

  const toggleUpperDoor = useCallback(() => {
    setShowUpperDoor(prev => {
      const next = !prev;
      getItem<StoredEnvironmentGLBConfig>(STORAGE_KEY_DOOR_GLB).then(stored => {
        if (stored) setItem(STORAGE_KEY_DOOR_GLB, { ...stored, showUpperDoor: next });
      }).catch(err => console.warn(err));
      return next;
    });
    playTactileSfx('click');
  }, [playTactileSfx]);

  // Apply real-time Model Adjustments (Scale, Offset Y, Rotation Y)
  useEffect(() => {
    if (!customModelInnerRef.current) return;
    const baseScale = useRawCharacterScale ? 1.0 : (1.85 / (characterNaturalHeightRef.current || 1.85));
    customModelInnerRef.current.scale.setScalar(baseScale * modelScale);
    customModelInnerRef.current.position.y = modelOffsetY;
    customModelInnerRef.current.rotation.y = (modelRotationY * Math.PI) / 180;
  }, [modelScale, modelOffsetY, modelRotationY, useRawCharacterScale]);

  // Synchronize Floor transform in real time
  useEffect(() => {
    if (!customFloorGroupRef.current) return;
    customFloorGroupRef.current.position.set(floorOffsetX, floorOffsetY, floorOffsetZ);
    customFloorGroupRef.current.rotation.y = (floorRotationY * Math.PI) / 180;
    customFloorGroupRef.current.scale.setScalar(floorScale);
  }, [floorOffsetX, floorOffsetY, floorOffsetZ, floorRotationY, floorScale]);

  // Synchronize Wall transform in real time
  useEffect(() => {
    if (!customWallGroupRef.current) return;
    customWallGroupRef.current.position.set(wallOffsetX, wallOffsetY, wallOffsetZ);
    customWallGroupRef.current.rotation.y = (wallRotationY * Math.PI) / 180;
    customWallGroupRef.current.scale.setScalar(wallScale);
  }, [wallOffsetX, wallOffsetY, wallOffsetZ, wallRotationY, wallScale]);

  // Re-build wall instances if showLeftWall or showUpperWall changes
  useEffect(() => {
    if (!wallGltfSceneRef.current || !customWallLoaded) return;
    mountWallGLBRef.current({ scene: wallGltfSceneRef.current });
  }, [showLeftWall, showUpperWall, customWallLoaded]);

  // Synchronize Door transform in real time
  useEffect(() => {
    if (!customDoorGroupRef.current) return;
    customDoorGroupRef.current.position.set(doorOffsetX, doorOffsetY, doorOffsetZ);
    customDoorGroupRef.current.rotation.y = (doorRotationY * Math.PI) / 180;
    customDoorGroupRef.current.scale.setScalar(doorScale);
  }, [doorOffsetX, doorOffsetY, doorOffsetZ, doorRotationY, doorScale]);

  // Re-build door instances if showLeftDoor or showUpperDoor changes
  useEffect(() => {
    if (!doorGltfSceneRef.current || !customDoorLoaded) return;
    mountDoorGLBRef.current({ scene: doorGltfSceneRef.current });
  }, [showLeftDoor, showUpperDoor, customDoorLoaded]);

  // Dynamic Tile Position Helper based on active Floor Size (8m vs 7.2m) and Surface Height
  const getTileWorldPos = useCallback((col: number, row: number) => {
    const tSize = customFloorLoadedRef.current ? (8.0 / 3) : TILE_SIZE;
    const sY = customFloorLoadedRef.current ? (0.25 + floorOffsetYRef.current) : 0.05;
    return new THREE.Vector3((col - 1) * tSize, sY, (row - 1) * tSize);
  }, []);

  const getTileWorldPosRef = useRef(getTileWorldPos);
  useEffect(() => {
    getTileWorldPosRef.current = getTileWorldPos;
  }, [getTileWorldPos]);

  // Synchronize 3x3 clickable floor tiles when custom floor is loaded or offset Y changes
  useEffect(() => {
    const tSize = customFloorLoaded ? (8.0 / 3) : TILE_SIZE;
    const sY = customFloorLoaded ? (0.25 + floorOffsetY) : 0.05;

    tileMeshesRef.current.forEach((tMesh) => {
      const col = tMesh.userData.col;
      const row = tMesh.userData.row;
      const x = (col - 1) * tSize;
      const z = (row - 1) * tSize;
      tMesh.position.set(x, sY + 0.015, z);
      tMesh.geometry.dispose();
      tMesh.geometry = new THREE.PlaneGeometry(tSize - 0.06, tSize - 0.06);
    });

    // If standing still, update character Y position so it rests flush on the floor surface
    if (characterRootRef.current && targetWorldPosRef.current === null) {
      const col = currentTileRef.current.col;
      const row = currentTileRef.current.row;
      const x = (col - 1) * tSize;
      const z = (row - 1) * tSize;
      characterPosRef.current.set(x, sY, z);
      characterRootRef.current.position.set(x, sY, z);
    }
  }, [customFloorLoaded, floorOffsetY]);

  // Compute direction angle (in radians) between 2 tiles
  const getCardinalAngle = (from: TileCoord, to: TileCoord): { angle: number; dir: Direction } => {
    const dCol = to.col - from.col;
    const dRow = to.row - from.row;

    if (dRow < 0) {
      return { angle: Math.PI, dir: 'NORTH' };
    } else if (dRow > 0) {
      return { angle: 0, dir: 'SOUTH' };
    } else if (dCol > 0) {
      return { angle: Math.PI / 2, dir: 'EAST' };
    } else {
      return { angle: -Math.PI / 2, dir: 'WEST' };
    }
  };

  // Plan path on 3x3 grid (step-by-step cardinal waypoints)
  const planPath = (start: TileCoord, end: TileCoord): TileCoord[] => {
    const path: TileCoord[] = [];
    let curCol = start.col;
    let curRow = start.row;

    while (curCol !== end.col) {
      curCol += end.col > curCol ? 1 : -1;
      path.push({ col: curCol, row: curRow });
    }

    while (curRow !== end.row) {
      curRow += end.row > curRow ? 1 : -1;
      path.push({ col: curCol, row: curRow });
    }

    return path;
  };

  // Handle Tile Click: 4-way turn, run anim, step-by-step movement
  const handleTileClick = useCallback((targetCol: number, targetRow: number) => {
    const current = currentTileRef.current;
    if (current.col === targetCol && current.row === targetRow) {
      return;
    }

    const waypoints = planPath(current, { col: targetCol, row: targetRow });
    if (waypoints.length === 0) return;

    moveQueueRef.current = waypoints;
    const firstStep = waypoints[0];
    const { angle, dir } = getCardinalAngle(current, firstStep);

    targetFacingAngleRef.current = angle;
    currentFacingAngleRef.current = angle;
    if (characterRootRef.current) {
      characterRootRef.current.rotation.y = angle;
    }

    setFacingDir(dir);
    setAnimState('RUN');
    updateMovementAnimation(true);

    targetWorldPosRef.current = getTileWorldPos(firstStep.col, firstStep.row);
  }, [playTactileSfx, updateMovementAnimation, getTileWorldPos]);

  // Reset character to (1,1) Center Tile
  const resetToCenter = useCallback(() => {
    moveQueueRef.current = [];
    currentTileRef.current = { col: 1, row: 1 };
    targetWorldPosRef.current = null;
    const centerPos = getTileWorldPos(1, 1);
    characterPosRef.current.copy(centerPos);
    targetFacingAngleRef.current = 0;
    currentFacingAngleRef.current = 0;

    if (characterRootRef.current) {
      characterRootRef.current.position.copy(centerPos);
      characterRootRef.current.rotation.y = 0;
    }

    setCharacterCoord({ col: 1, row: 1 });
    setFacingDir('SOUTH');
    setAnimState('IDLE');
    updateMovementAnimation(false);
    playTactileSfx('click');
  }, [playTactileSfx, updateMovementAnimation, getTileWorldPos]);

  const handleTileClickRef = useRef(handleTileClick);
  useEffect(() => {
    handleTileClickRef.current = handleTileClick;
  }, [handleTileClick]);

  const mountGLBModelRef = useRef(mountGLBModel);
  useEffect(() => {
    mountGLBModelRef.current = mountGLBModel;
  }, [mountGLBModel]);

  const updateCharacterPoseRef = useRef(updateCharacterPose);
  useEffect(() => {
    updateCharacterPoseRef.current = updateCharacterPose;
  }, [updateCharacterPose]);

  // =========================================================================
  // INITIAL MOUNT & THREE.JS SETUP
  // =========================================================================
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // 1. Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x18181b);
    sceneRef.current = scene;

    // 2. Camera: Fixed Isometric Orthographic Camera at 45° tilt
    const frustumSize = 11.2;
    const aspect = container.clientWidth / container.clientHeight;
    const camera = new THREE.OrthographicCamera(
      (-frustumSize * aspect) / 2,
      (frustumSize * aspect) / 2,
      frustumSize / 2,
      -frustumSize / 2,
      0.1,
      1000
    );

    const camDist = 24;
    camera.position.set(-camDist, camDist * 1.15, camDist);
    camera.lookAt(0, 0.45, 0);
    cameraRef.current = camera;

    // 3. Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = false;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 4. Soft Studio Lighting (Diffuse Ambient + Directional Key)
    const hemiLight = new THREE.HemisphereLight(0xfff6ea, 0x475569, 1.1);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight.position.set(-15, 25, 15);
    scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x93c5fd, 0.4);
    fillLight.position.set(15, 10, -15);
    scene.add(fillLight);

    // 5. Stylized Diorama Platform Slab & Floor
    const proceduralFloorGroup = new THREE.Group();
    proceduralFloorGroup.name = 'ProceduralFloorGroup';

    const plinthHeight = 1.1;
    const plinthGeo = new THREE.CylinderGeometry(
      PLATFORM_HALF * Math.SQRT2,
      PLATFORM_HALF * Math.SQRT2 + 0.15,
      plinthHeight,
      4,
      1,
      false,
      Math.PI / 4
    );
    const plinthMat = new THREE.MeshLambertMaterial({ color: 0x3d3b38 });
    const plinthMesh = new THREE.Mesh(plinthGeo, plinthMat);
    plinthMesh.position.y = -plinthHeight / 2;
    proceduralFloorGroup.add(plinthMesh);

    const curbGeo = new THREE.BoxGeometry(PLATFORM_HALF * 2 + 0.16, 0.22, PLATFORM_HALF * 2 + 0.16);
    const curbMat = new THREE.MeshLambertMaterial({ color: 0x4a4744 });
    const curbMesh = new THREE.Mesh(curbGeo, curbMat);
    curbMesh.position.y = -0.11;
    proceduralFloorGroup.add(curbMesh);

    const floorCanvas = createStylizedFloorCanvas();
    const floorTexture = new THREE.CanvasTexture(floorCanvas);
    floorTexture.colorSpace = THREE.SRGBColorSpace;

    const floorGeo = new THREE.PlaneGeometry(PLATFORM_HALF * 2, PLATFORM_HALF * 2);
    const floorMat = new THREE.MeshLambertMaterial({ map: floorTexture });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = 0.005;
    proceduralFloorGroup.add(floorMesh);

    scene.add(proceduralFloorGroup);
    proceduralFloorGroupRef.current = proceduralFloorGroup;

    // Custom 3D Floor Group (for user Blender 8x8m GLB)
    const customFloorGroup = new THREE.Group();
    customFloorGroup.name = 'CustomFloorGroup';
    scene.add(customFloorGroup);
    customFloorGroupRef.current = customFloorGroup;

    // Custom 3D Wall Group (for user Blender 8m GLB, Left & Upper)
    const customWallGroup = new THREE.Group();
    customWallGroup.name = 'CustomWallGroup';
    scene.add(customWallGroup);
    customWallGroupRef.current = customWallGroup;

    // Custom 3D Door Group (for user Blender Door GLB, Left & Upper)
    const customDoorGroup = new THREE.Group();
    customDoorGroup.name = 'CustomDoorGroup';
    scene.add(customDoorGroup);
    customDoorGroupRef.current = customDoorGroup;

    // 6. 3x3 Clickable Floor Tile Grid
    tileMeshesRef.current = [];
    const tilesGroup = new THREE.Group();
    tilesGroup.name = 'TileGridGroup';

    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const tileMeshGeo = new THREE.PlaneGeometry(TILE_SIZE - 0.06, TILE_SIZE - 0.06);
        const tileMeshMat = new THREE.MeshBasicMaterial({
          color: 0x38bdf8,
          transparent: true,
          opacity: 0.0,
          depthWrite: false
        });
        const tMesh = new THREE.Mesh(tileMeshGeo, tileMeshMat);
        tMesh.rotation.x = -Math.PI / 2;
        const wPos = tileToWorld(c, r);
        tMesh.position.set(wPos.x, 0.02, wPos.z);
        tMesh.userData = { col: c, row: r };

        tilesGroup.add(tMesh);
        tileMeshesRef.current.push(tMesh);
      }
    }
    scene.add(tilesGroup);

    // 7. Dynamic Hover Indicator: Transparent Light-Blue Surface (2.67m x 2.67m tile)
    const hoverGroup = new THREE.Group();
    hoverGroup.visible = false;
    hoverIndicatorRef.current = hoverGroup;

    // Tile Wash Plane: Exactly 2.67m x 2.67m (2.64m with 3cm margin)
    const tileWashGeo = new THREE.PlaneGeometry(2.64, 2.64);
    const tileWashMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.16,
      depthWrite: false
    });
    const tileWash = new THREE.Mesh(tileWashGeo, tileWashMat);
    tileWash.rotation.x = -Math.PI / 2;
    hoverGroup.add(tileWash);

    hoverGroup.position.y = 0.035;
    scene.add(hoverGroup);

    // 8. Architectural Walls & Arched Doorway (North & East Walls)
    const proceduralWallGroup = new THREE.Group();
    proceduralWallGroup.name = 'ProceduralWallGroup';

    const wallCanvas = createStylizedWallCanvas();
    const wallTexture = new THREE.CanvasTexture(wallCanvas);
    wallTexture.colorSpace = THREE.SRGBColorSpace;
    const wallMat = new THREE.MeshLambertMaterial({ map: wallTexture });
    const trimStoneMat = new THREE.MeshLambertMaterial({ color: 0x5a5752 });

    const northWallGeo = new THREE.BoxGeometry(PLATFORM_HALF * 2, WALL_HEIGHT, WALL_THICKNESS);
    const northWall = new THREE.Mesh(northWallGeo, wallMat);
    northWall.position.set(0, WALL_HEIGHT / 2, -PLATFORM_HALF - WALL_THICKNESS / 2);
    proceduralWallGroup.add(northWall);

    const baseboardGeo = new THREE.BoxGeometry(PLATFORM_HALF * 2 + 0.1, 0.28, 0.18);
    const northBaseboard = new THREE.Mesh(baseboardGeo, trimStoneMat);
    northBaseboard.position.set(0, 0.14, -PLATFORM_HALF + 0.09);
    proceduralWallGroup.add(northBaseboard);

    const northCorniceGeo = new THREE.BoxGeometry(PLATFORM_HALF * 2 + 0.35, 0.35, WALL_THICKNESS + 0.35);
    const northCornice = new THREE.Mesh(northCorniceGeo, trimStoneMat);
    northCornice.position.set(0, WALL_HEIGHT + 0.175, -PLATFORM_HALF - WALL_THICKNESS / 2);
    proceduralWallGroup.add(northCornice);

    const jambColGeo = new THREE.CylinderGeometry(0.18, 0.22, 2.7, 24);
    const jambL = new THREE.Mesh(jambColGeo, trimStoneMat);
    jambL.position.set(-0.95, 1.35, -PLATFORM_HALF + 0.08);
    const jambR = new THREE.Mesh(jambColGeo, trimStoneMat);
    jambR.position.set(0.95, 1.35, -PLATFORM_HALF + 0.08);
    proceduralWallGroup.add(jambL);
    proceduralWallGroup.add(jambR);

    const archShape = new THREE.Shape();
    const outerR = 1.15;
    const innerR = 0.95;
    archShape.absarc(0, 0, outerR, 0, Math.PI, false);
    archShape.lineTo(-innerR, 0);
    archShape.absarc(0, 0, innerR, Math.PI, 0, true);
    archShape.lineTo(outerR, 0);

    const extrudeSettings = {
      depth: 0.22,
      bevelEnabled: true,
      bevelSegments: 4,
      steps: 1,
      bevelSize: 0.04,
      bevelThickness: 0.04
    };
    const archGeo = new THREE.ExtrudeGeometry(archShape, extrudeSettings);
    const archMesh = new THREE.Mesh(archGeo, trimStoneMat);
    archMesh.position.set(0, 2.7, -PLATFORM_HALF + 0.02);
    proceduralWallGroup.add(archMesh);

    const keystoneGeo = new THREE.BoxGeometry(0.32, 0.42, 0.28);
    const keystone = new THREE.Mesh(keystoneGeo, trimStoneMat);
    keystone.position.set(0, 3.82, -PLATFORM_HALF + 0.12);
    proceduralWallGroup.add(keystone);

    const doorCanvas = createStylizedDoorCanvas();
    const doorTexture = new THREE.CanvasTexture(doorCanvas);
    doorTexture.colorSpace = THREE.SRGBColorSpace;
    const doorMat = new THREE.MeshLambertMaterial({ map: doorTexture });

    const doorShape = new THREE.Shape();
    doorShape.moveTo(-0.92, 0);
    doorShape.lineTo(-0.92, 2.65);
    doorShape.absarc(0, 2.65, 0.92, Math.PI, 0, true);
    doorShape.lineTo(0.92, 0);
    doorShape.closePath();

    const doorGeo = new THREE.ShapeGeometry(doorShape, 32);
    const posAttr = doorGeo.attributes.position;
    const uvs = new Float32Array(posAttr.count * 2);
    for (let i = 0; i < posAttr.count; i++) {
      const u = (posAttr.getX(i) + 0.92) / 1.84;
      const v = posAttr.getY(i) / 3.57;
      uvs[i * 2] = u;
      uvs[i * 2 + 1] = v;
    }
    doorGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    const doorMesh = new THREE.Mesh(doorGeo, doorMat);
    doorMesh.position.set(0, 0, -PLATFORM_HALF + 0.02);
    proceduralWallGroup.add(doorMesh);

    const ringGeo = new THREE.TorusGeometry(0.12, 0.025, 16, 24);
    const ringMat = new THREE.MeshLambertMaterial({ color: 0x475569 });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.position.set(-0.35, 1.35, -PLATFORM_HALF + 0.08);
    proceduralWallGroup.add(ringMesh);

    // East Wall
    const eastWallGeo = new THREE.BoxGeometry(WALL_THICKNESS, WALL_HEIGHT, PLATFORM_HALF * 2 + WALL_THICKNESS);
    const eastWall = new THREE.Mesh(eastWallGeo, wallMat);
    eastWall.position.set(PLATFORM_HALF + WALL_THICKNESS / 2, WALL_HEIGHT / 2, -WALL_THICKNESS / 2);
    proceduralWallGroup.add(eastWall);

    const eastBaseboardGeo = new THREE.BoxGeometry(0.18, 0.28, PLATFORM_HALF * 2 + 0.1);
    const eastBaseboard = new THREE.Mesh(eastBaseboardGeo, trimStoneMat);
    eastBaseboard.position.set(PLATFORM_HALF - 0.09, 0.14, 0);
    proceduralWallGroup.add(eastBaseboard);

    const eastCorniceGeo = new THREE.BoxGeometry(WALL_THICKNESS + 0.35, 0.35, PLATFORM_HALF * 2 + WALL_THICKNESS + 0.35);
    const eastCornice = new THREE.Mesh(eastCorniceGeo, trimStoneMat);
    eastCornice.position.set(PLATFORM_HALF + WALL_THICKNESS / 2, WALL_HEIGHT + 0.175, -WALL_THICKNESS / 2);
    proceduralWallGroup.add(eastCornice);

    const pilasterGeo = new THREE.CylinderGeometry(0.24, 0.28, WALL_HEIGHT, 24);
    const pilaster = new THREE.Mesh(pilasterGeo, trimStoneMat);
    pilaster.position.set(PLATFORM_HALF - 0.14, WALL_HEIGHT / 2, 0);
    proceduralWallGroup.add(pilaster);

    const capGeo = new THREE.CylinderGeometry(0.34, 0.26, 0.32, 24);
    const pilasterCap = new THREE.Mesh(capGeo, trimStoneMat);
    pilasterCap.position.set(PLATFORM_HALF - 0.14, WALL_HEIGHT - 0.16, 0);
    proceduralWallGroup.add(pilasterCap);

    const sconceArmCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(PLATFORM_HALF - 0.02, 2.1, 0),
      new THREE.Vector3(PLATFORM_HALF - 0.28, 2.15, 0),
      new THREE.Vector3(PLATFORM_HALF - 0.38, 2.35, 0)
    ]);
    const sconceTubeGeo = new THREE.TubeGeometry(sconceArmCurve, 16, 0.035, 12, false);
    const sconceMat = new THREE.MeshLambertMaterial({ color: 0x334155 });
    const sconceArm = new THREE.Mesh(sconceTubeGeo, sconceMat);
    proceduralWallGroup.add(sconceArm);

    const brazierGeo = new THREE.ConeGeometry(0.14, 0.18, 16, 1, true);
    const brazier = new THREE.Mesh(brazierGeo, sconceMat);
    brazier.position.set(PLATFORM_HALF - 0.38, 2.44, 0);
    proceduralWallGroup.add(brazier);

    const flameGeo = new THREE.OctahedronGeometry(0.14, 2);
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
    const flameMesh = new THREE.Mesh(flameGeo, flameMat);
    flameMesh.position.set(PLATFORM_HALF - 0.38, 2.58, 0);
    proceduralWallGroup.add(flameMesh);

    const torchLight = new THREE.PointLight(0xf59e0b, 1.2, 7.5);
    torchLight.position.set(PLATFORM_HALF - 0.45, 2.65, 0);
    proceduralWallGroup.add(torchLight);

    const cornerColGeo = new THREE.CylinderGeometry(0.42, 0.46, WALL_HEIGHT + 0.35, 24);
    const cornerCol = new THREE.Mesh(cornerColGeo, trimStoneMat);
    cornerCol.position.set(PLATFORM_HALF + WALL_THICKNESS / 2, (WALL_HEIGHT + 0.35) / 2, -PLATFORM_HALF - WALL_THICKNESS / 2);
    proceduralWallGroup.add(cornerCol);

    scene.add(proceduralWallGroup);
    proceduralWallGroupRef.current = proceduralWallGroup;

    // Check IndexedDB for previously stored custom Character GLB
    const initCharacter = async () => {
      try {
        const storedGLB = await getItem<StoredGLBConfig>(STORAGE_KEY_CHAR_GLB);
        if (storedGLB?.dataBase64) {
          const buffer = dataUrlToArrayBuffer(storedGLB.dataBase64);
          const loader = new GLTFLoader();
          loader.parse(buffer, '', (gltf) => {
            setCustomModelName(storedGLB.fileName || 'custom_model.glb');
            setCustomModelSize(storedGLB.fileSize || 0);
            if (storedGLB.scale !== undefined) setModelScale(storedGLB.scale);
            if (storedGLB.useRawScale !== undefined) setUseRawCharacterScale(storedGLB.useRawScale);
            if (storedGLB.offsetY !== undefined) setModelOffsetY(storedGLB.offsetY);
            if (storedGLB.rotationY !== undefined) setModelRotationY(storedGLB.rotationY);

            mountGLBModelRef.current(gltf, storedGLB);
          });
          return;
        }
      } catch (err) {
        console.warn("Failed to restore stored GLB:", err);
      }

      // Fallback: Mount default Anime Knight Dummy
      const dummy = createAnimeKnightDummy();
      dummy.position.set(0, 0.05, 0);
      dummy.rotation.y = 0;
      scene.add(dummy);
      characterRootRef.current = dummy;
    };

    // Check IndexedDB for previously stored Floor and Wall GLB
    const initEnvironment = async () => {
      // 1. Restore Custom Floor (8m x 8m)
      try {
        const storedFloor = await getItem<StoredEnvironmentGLBConfig>(STORAGE_KEY_FLOOR_GLB);
        if (storedFloor?.dataBase64) {
          const buffer = dataUrlToArrayBuffer(storedFloor.dataBase64);
          new GLTFLoader().parse(buffer, '', (gltf) => {
            setCustomFloorName(storedFloor.fileName || 'custom_floor.glb');
            setCustomFloorSize(storedFloor.fileSize || 0);
            if (storedFloor.offsetX !== undefined) setFloorOffsetX(storedFloor.offsetX);
            if (storedFloor.offsetY !== undefined) setFloorOffsetY(storedFloor.offsetY);
            if (storedFloor.offsetZ !== undefined) setFloorOffsetZ(storedFloor.offsetZ);
            if (storedFloor.rotationY !== undefined) setFloorRotationY(storedFloor.rotationY);
            if (storedFloor.scale !== undefined) setFloorScale(storedFloor.scale);
            mountFloorGLBRef.current(gltf, storedFloor);
          });
        }
      } catch (err) {
        console.warn("Failed to restore custom floor:", err);
      }

      // 2. Restore Custom Wall (8m, North & East)
      try {
        const storedWall = await getItem<StoredEnvironmentGLBConfig>(STORAGE_KEY_WALL_GLB);
        if (storedWall?.dataBase64) {
          const buffer = dataUrlToArrayBuffer(storedWall.dataBase64);
          new GLTFLoader().parse(buffer, '', (gltf) => {
            setCustomWallName(storedWall.fileName || 'custom_wall.glb');
            setCustomWallSize(storedWall.fileSize || 0);
            if (storedWall.offsetX !== undefined) setWallOffsetX(storedWall.offsetX);
            if (storedWall.offsetY !== undefined) setWallOffsetY(storedWall.offsetY);
            if (storedWall.offsetZ !== undefined) setWallOffsetZ(storedWall.offsetZ);
            if (storedWall.rotationY !== undefined) setWallRotationY(storedWall.rotationY);
            if (storedWall.scale !== undefined) setWallScale(storedWall.scale);
            if (storedWall.showLeftWall !== undefined) setShowLeftWall(storedWall.showLeftWall);
            if (storedWall.showUpperWall !== undefined) setShowUpperWall(storedWall.showUpperWall);
            mountWallGLBRef.current(gltf, storedWall);
          });
        }
      } catch (err) {
        console.warn("Failed to restore custom wall:", err);
      }

      // 3. Restore Custom Door (center of left wall, upper wall)
      try {
        const storedDoor = await getItem<StoredEnvironmentGLBConfig>(STORAGE_KEY_DOOR_GLB);
        if (storedDoor?.dataBase64) {
          const buffer = dataUrlToArrayBuffer(storedDoor.dataBase64);
          new GLTFLoader().parse(buffer, '', (gltf) => {
            setCustomDoorName(storedDoor.fileName || 'custom_door.glb');
            setCustomDoorSize(storedDoor.fileSize || 0);
            if (storedDoor.offsetX !== undefined) setDoorOffsetX(storedDoor.offsetX);
            if (storedDoor.offsetY !== undefined) setDoorOffsetY(storedDoor.offsetY);
            if (storedDoor.offsetZ !== undefined) setDoorOffsetZ(storedDoor.offsetZ);
            if (storedDoor.rotationY !== undefined) setDoorRotationY(storedDoor.rotationY);
            if (storedDoor.scale !== undefined) setDoorScale(storedDoor.scale);
            if (storedDoor.showLeftDoor !== undefined) setShowLeftDoor(storedDoor.showLeftDoor);
            if (storedDoor.showUpperDoor !== undefined) setShowUpperDoor(storedDoor.showUpperDoor);
            mountDoorGLBRef.current(gltf, storedDoor);
          });
        }
      } catch (err) {
        console.warn("Failed to restore custom door:", err);
      }
    };

    initCharacter();
    initEnvironment();

    // Raycaster for Tile Hover and Click
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const handlePointerMove = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(tileMeshesRef.current, false);

      if (intersects.length > 0) {
        const hitTile = intersects[0].object as THREE.Mesh;
        const col = hitTile.userData.col;
        const row = hitTile.userData.row;

        setHoveredCoord({ col, row });

        if (hoverIndicatorRef.current) {
          const wPos = getTileWorldPosRef.current(col, row);
          hoverIndicatorRef.current.position.set(wPos.x, wPos.y + 0.005, wPos.z);
          hoverIndicatorRef.current.visible = true;
        }
        renderer.domElement.style.cursor = 'pointer';
      } else {
        setHoveredCoord(null);
        if (hoverIndicatorRef.current) {
          hoverIndicatorRef.current.visible = false;
        }
        renderer.domElement.style.cursor = 'default';
      }
    };

    const handlePointerDown = (e: MouseEvent) => {
      if (e.button !== 0) return;

      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(tileMeshesRef.current, false);

      if (intersects.length > 0) {
        const hitTile = intersects[0].object as THREE.Mesh;
        handleTileClickRef.current(hitTile.userData.col, hitTile.userData.row);
      }
    };

    renderer.domElement.addEventListener('pointermove', handlePointerMove);
    renderer.domElement.addEventListener('pointerdown', handlePointerDown);

    const handleResize = () => {
      if (!container || !rendererRef.current || !cameraRef.current) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      const newAspect = w / h;

      cameraRef.current.left = (-frustumSize * newAspect) / 2;
      cameraRef.current.right = (frustumSize * newAspect) / 2;
      cameraRef.current.top = frustumSize / 2;
      cameraRef.current.bottom = -frustumSize / 2;
      cameraRef.current.updateProjectionMatrix();

      rendererRef.current.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    // Animation Loop
    let animationFrameId: number;
    const timer = new THREE.Timer();

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      timer.update();
      const delta = Math.min(timer.getDelta(), 0.1);
      const elapsed = timer.getElapsed();

      // Step-by-step Movement Engine
      const charRoot = characterRootRef.current;
      const queue = moveQueueRef.current;

      if (charRoot && targetWorldPosRef.current) {
        const currentPos = characterPosRef.current;
        const targetPos = targetWorldPosRef.current;
        const dist = currentPos.distanceTo(targetPos);

        const step = moveSpeedRef.current * delta;

        if (dist <= step) {
          currentPos.copy(targetPos);
          charRoot.position.copy(targetPos);

          if (queue.length > 0) {
            const nextStep = queue.shift()!;
            currentTileRef.current = nextStep;
            setCharacterCoord(nextStep);

            if (queue.length > 0) {
              const upcoming = queue[0];
              const { angle, dir } = getCardinalAngle(nextStep, upcoming);
              targetFacingAngleRef.current = angle;
              setFacingDir(dir);
              targetWorldPosRef.current = getTileWorldPosRef.current(upcoming.col, upcoming.row);
            } else {
              targetWorldPosRef.current = null;
              setAnimState('IDLE');
              updateMovementAnimationRef.current(false);
            }
          } else {
            targetWorldPosRef.current = null;
            setAnimState('IDLE');
            updateMovementAnimationRef.current(false);
          }
        } else {
          const dirVec = new THREE.Vector3().subVectors(targetPos, currentPos).normalize();
          currentPos.addScaledVector(dirVec, step);
          charRoot.position.copy(currentPos);
        }

        currentFacingAngleRef.current = THREE.MathUtils.damp(
          currentFacingAngleRef.current,
          targetFacingAngleRef.current,
          20,
          delta
        );
        charRoot.rotation.y = currentFacingAngleRef.current;
      }

      const moving = targetWorldPosRef.current !== null || moveQueueRef.current.length > 0;
      updateCharacterPoseRef.current(delta, elapsed, moving);

      if (flameMesh) {
        flameMesh.rotation.y += delta * 2;
        flameMesh.scale.setScalar(0.92 + Math.sin(elapsed * 14) * 0.08);
      }
      if (torchLight) {
        torchLight.intensity = 1.2 + Math.sin(elapsed * 16) * 0.15;
      }


      renderer.render(scene, camera);
    };

    animate();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('pointermove', handlePointerMove);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      if (renderer.domElement && renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
      renderer.dispose();
      scene.clear();
    };
  }, [createAnimeKnightDummy, playTactileSfx]);

  // Drag & Drop handlers on viewport
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);

    const file = e.dataTransfer.files?.[0];
    if (file && (file.name.endsWith('.glb') || file.name.endsWith('.gltf'))) {
      const lower = file.name.toLowerCase();
      if (lower.includes('floor') || lower.includes('boden') || lower.includes('chunk')) {
        setActiveTab('floor');
        processFloorGLBFile(file);
      } else if (lower.includes('door') || lower.includes('tuer') || lower.includes('tür') || lower.includes('gate') || lower.includes('portal')) {
        setActiveTab('door');
        processDoorGLBFile(file);
      } else if (lower.includes('wall') || lower.includes('wand') || lower.includes('mauer')) {
        setActiveTab('wall');
        processWallGLBFile(file);
      } else if (activeTab === 'floor') {
        processFloorGLBFile(file);
      } else if (activeTab === 'wall') {
        processWallGLBFile(file);
      } else if (activeTab === 'door') {
        processDoorGLBFile(file);
      } else {
        setActiveTab('character');
        processGLBFile(file);
      }
    } else {
      alert("Bitte ziehe eine 3D-Modelldatei im .glb- oder .gltf-Format auf die Bühne.");
    }
  };

  const handleCharFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processGLBFile(file);
    }
  };

  const handleFloorFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFloorGLBFile(file);
    }
  };

  const handleWallFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processWallGLBFile(file);
    }
  };

  const handleDoorFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processDoorGLBFile(file);
    }
  };

  return (
    <div 
      className="relative w-full h-screen bg-gray-950 select-none overflow-hidden font-sans"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Hidden File Inputs for 4 Assets */}
      <input
        ref={charFileInputRef}
        type="file"
        accept=".glb,.gltf"
        onChange={handleCharFileInputChange}
        className="hidden"
      />
      <input
        ref={floorFileInputRef}
        type="file"
        accept=".glb,.gltf"
        onChange={handleFloorFileInputChange}
        className="hidden"
      />
      <input
        ref={wallFileInputRef}
        type="file"
        accept=".glb,.gltf"
        onChange={handleWallFileInputChange}
        className="hidden"
      />
      <input
        ref={doorFileInputRef}
        type="file"
        accept=".glb,.gltf"
        onChange={handleDoorFileInputChange}
        className="hidden"
      />

      {/* 3D WebGL Canvas */}
      <div ref={mountRef} className="absolute inset-0 w-full h-full" />

      {/* DRAG & DROP OVERLAY WITH 4 TARGETS */}
      {isDraggingFile && (
        <div className="absolute inset-0 z-50 bg-black/85 backdrop-blur-md flex flex-col items-center justify-center p-6 border-4 border-dashed border-cyan-400">
          <Upload size={54} className="text-cyan-400 mb-4 animate-bounce" />
          <h2 className="text-2xl font-bold text-white tracking-wide mb-2">GLB-Datei hier ablegen</h2>
          <p className="text-gray-300 text-sm mb-6 text-center max-w-lg">
            Dateien mit &apos;floor&apos;/&apos;boden&apos;, &apos;wall&apos;/&apos;wand&apos; oder &apos;door&apos;/&apos;tür&apos; im Namen werden automatisch erkannt, oder entsprechend des aktiven Tabs geladen.
          </p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full max-w-3xl">
            <div className={`p-4 rounded-xl border flex flex-col items-center text-center transition-all ${
              activeTab === 'character' ? 'bg-cyan-950/60 border-cyan-400 text-cyan-200' : 'bg-gray-900/60 border-gray-700 text-gray-300'
            }`}>
              <User size={28} className="text-cyan-400 mb-2" />
              <span className="font-bold text-sm">Charakter (.glb)</span>
              <span className="text-[11px] text-gray-400 mt-1">1:1 Originalmaßstab mit Animationen</span>
            </div>

            <div className={`p-4 rounded-xl border flex flex-col items-center text-center transition-all ${
              activeTab === 'floor' ? 'bg-emerald-950/60 border-emerald-400 text-emerald-200' : 'bg-gray-900/60 border-gray-700 text-gray-300'
            }`}>
              <Square size={28} className="text-emerald-400 mb-2" />
              <span className="font-bold text-sm">Bodenplatte (8x8m)</span>
              <span className="text-[11px] text-gray-400 mt-1">Ersetzt prozeduralen Boden (0.5m Dicke)</span>
            </div>

            <div className={`p-4 rounded-xl border flex flex-col items-center text-center transition-all ${
              activeTab === 'wall' ? 'bg-amber-950/60 border-amber-400 text-amber-200' : 'bg-gray-900/60 border-gray-700 text-gray-300'
            }`}>
              <Box size={28} className="text-amber-400 mb-2" />
              <span className="font-bold text-sm">Wand (8m)</span>
              <span className="text-[11px] text-gray-400 mt-1">Left_Wall &amp; Upper_Wall (4m Höhe)</span>
            </div>

            <div className={`p-4 rounded-xl border flex flex-col items-center text-center transition-all ${
              activeTab === 'door' ? 'bg-purple-950/60 border-purple-400 text-purple-200' : 'bg-gray-900/60 border-gray-700 text-gray-300'
            }`}>
              <DoorClosed size={28} className="text-purple-400 mb-2" />
              <span className="font-bold text-sm">Tür (.glb)</span>
              <span className="text-[11px] text-gray-400 mt-1">Mitte linke Wand / 90° obere Wand</span>
            </div>
          </div>
        </div>
      )}

      {/* LOADING OVERLAY */}
      {isLoadingModel && (
        <div className="absolute inset-0 z-50 bg-black/75 backdrop-blur-sm flex flex-col items-center justify-center pointer-events-none">
          <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mb-4" />
          <h3 className="text-lg font-bold text-white">{loadingMessage}</h3>
        </div>
      )}

      {/* TOP BAR */}
      <div className="absolute top-0 left-0 right-0 p-3 md:p-5 flex items-center justify-between pointer-events-none z-20">
        <button
          onClick={onExit}
          className="pointer-events-auto flex items-center gap-2 px-3.5 py-2 bg-gray-900/95 hover:bg-gray-800 text-gray-200 hover:text-white border border-gray-700/80 rounded-xl shadow-xl transition-all font-semibold text-xs group active:scale-95"
          title="Zurück zum Editor Hauptmenü"
        >
          <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform text-emerald-400" />
          <span>Zurück zum Editor</span>
        </button>

        {/* Central 3-Asset Badges (Click to switch tab in dock) */}
        <div className="pointer-events-auto hidden sm:flex items-center gap-2 px-3 py-1.5 bg-gray-900/90 border border-gray-800 rounded-2xl text-xs shadow-xl backdrop-blur-md">
          <button
            onClick={() => { setActiveTab('character'); setIsDockCollapsed(false); playTactileSfx('click'); }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'character'
                ? 'bg-cyan-900/70 text-cyan-200 border border-cyan-500/80 shadow'
                : 'text-gray-300 hover:text-white hover:bg-gray-800'
            }`}
          >
            <User size={13} className="text-cyan-400" />
            <span>Charakter:</span>
            <span className="font-mono text-[11px] text-cyan-300 font-bold max-w-[100px] truncate">
              {customModelLoaded ? customModelName : 'Dummy'}
            </span>
          </button>

          <span className="text-gray-700">|</span>

          <button
            onClick={() => { setActiveTab('floor'); setIsDockCollapsed(false); playTactileSfx('click'); }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'floor'
                ? 'bg-emerald-900/70 text-emerald-200 border border-emerald-500/80 shadow'
                : 'text-gray-300 hover:text-white hover:bg-gray-800'
            }`}
          >
            <Square size={13} className="text-emerald-400" />
            <span>Boden (8x8m):</span>
            <span className="font-mono text-[11px] text-emerald-300 font-bold max-w-[100px] truncate">
              {customFloorLoaded ? customFloorName : 'Prozedural'}
            </span>
          </button>

          <span className="text-gray-700">|</span>

          <button
            onClick={() => { setActiveTab('wall'); setIsDockCollapsed(false); playTactileSfx('click'); }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'wall'
                ? 'bg-amber-900/70 text-amber-200 border border-amber-500/80 shadow'
                : 'text-gray-300 hover:text-white hover:bg-gray-800'
            }`}
          >
            <Box size={13} className="text-amber-400" />
            <span>Wand (8m):</span>
            <span className="font-mono text-[11px] text-amber-300 font-bold max-w-[90px] truncate">
              {customWallLoaded ? customWallName : 'Prozedural'}
            </span>
          </button>

          <span className="text-gray-700">|</span>

          <button
            onClick={() => { setActiveTab('door'); setIsDockCollapsed(false); playTactileSfx('click'); }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'door'
                ? 'bg-purple-900/70 text-purple-200 border border-purple-500/80 shadow'
                : 'text-gray-300 hover:text-white hover:bg-gray-800'
            }`}
          >
            <DoorClosed size={13} className="text-purple-400" />
            <span>Tür:</span>
            <span className="font-mono text-[11px] text-purple-300 font-bold max-w-[90px] truncate">
              {customDoorLoaded ? customDoorName : 'Keine'}
            </span>
          </button>
        </div>

        {/* Right Status Pill */}
        <div className="pointer-events-auto flex items-center gap-2">
          <div className="flex items-center gap-2.5 px-3 py-1.5 bg-gray-900/90 border border-gray-800 rounded-xl text-xs shadow-xl">
            <div className="flex items-center gap-1.5">
              <span className="text-gray-400">Kachel:</span>
              <span className="font-mono font-bold text-cyan-300 bg-gray-800 px-1.5 py-0.5 rounded">
                [{characterCoord.col}, {characterCoord.row}]
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-gray-400">Blick:</span>
              <span className="font-mono font-semibold text-amber-400">
                {facingDir}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                animState === 'RUN' ? 'bg-emerald-950 text-emerald-400 border border-emerald-700' : 'bg-gray-800 text-gray-300'
              }`}>
                {animState}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* TILE HOVER FLOATER */}
      {hoveredCoord && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 pointer-events-none z-10 transition-all duration-150">
          <div className="bg-gray-900/90 border border-cyan-500/40 px-3.5 py-1 rounded-full text-xs text-cyan-300 font-mono shadow-2xl flex items-center gap-2">
            <Footprints size={14} className="text-cyan-400" />
            <span>Klick: Schritt nach Kachel <strong>[{hoveredCoord.col}, {hoveredCoord.row}]</strong></span>
          </div>
        </div>
      )}

      {/* UNIFIED COLLAPSIBLE BOTTOM DOCK */}
      <div
        className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 transition-all duration-300 ease-out flex flex-col items-center"
        style={{ width: 'min(980px, 95vw)' }}
      >
        <button
          onClick={() => setIsDockCollapsed(!isDockCollapsed)}
          className="mb-1 px-4 py-1.5 bg-gray-900 text-gray-300 hover:text-white rounded-t-xl border-t border-x border-gray-700/80 text-xs font-semibold flex items-center gap-1.5 shadow-lg transition-colors"
        >
          {isDockCollapsed ? (
            <>
              <ChevronUp size={14} className="text-cyan-400" /> Assets & Dungeon-Steuerung öffnen
            </>
          ) : (
            <>
              <ChevronDown size={14} /> Steuerung minimieren
            </>
          )}
        </button>

        {!isDockCollapsed && (
          <div className="w-full bg-gray-900/95 border border-gray-800 rounded-2xl p-4 shadow-2xl space-y-3.5 backdrop-blur-md">
            {/* Top row: Tab Navigation for Character, Floor, Wall, Door */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-gray-800">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setActiveTab('character'); playTactileSfx('click'); }}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                    activeTab === 'character'
                      ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-950/50 border border-cyan-400'
                      : 'bg-gray-800 text-gray-400 hover:text-gray-200 border border-gray-700/80'
                  }`}
                >
                  <User size={14} className={activeTab === 'character' ? 'text-white' : 'text-cyan-400'} />
                  <span>1. Charakter</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                    customModelLoaded ? 'bg-cyan-950 text-cyan-300 border border-cyan-700' : 'bg-gray-900 text-gray-500'
                  }`}>
                    {customModelLoaded ? 'GLB' : 'Dummy'}
                  </span>
                </button>

                <button
                  onClick={() => { setActiveTab('floor'); playTactileSfx('click'); }}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                    activeTab === 'floor'
                      ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950/50 border border-emerald-400'
                      : 'bg-gray-800 text-gray-400 hover:text-gray-200 border border-gray-700/80'
                  }`}
                >
                  <Square size={14} className={activeTab === 'floor' ? 'text-white' : 'text-emerald-400'} />
                  <span>2. Boden</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                    customFloorLoaded ? 'bg-emerald-950 text-emerald-300 border border-emerald-700' : 'bg-gray-900 text-gray-500'
                  }`}>
                    {customFloorLoaded ? '8x8m' : 'Prozedural'}
                  </span>
                </button>

                <button
                  onClick={() => { setActiveTab('wall'); playTactileSfx('click'); }}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                    activeTab === 'wall'
                      ? 'bg-amber-600 text-white shadow-lg shadow-amber-950/50 border border-amber-400'
                      : 'bg-gray-800 text-gray-400 hover:text-gray-200 border border-gray-700/80'
                  }`}
                >
                  <Box size={14} className={activeTab === 'wall' ? 'text-white' : 'text-amber-400'} />
                  <span>3. Wand</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                    customWallLoaded ? 'bg-amber-950 text-amber-300 border border-amber-700' : 'bg-gray-900 text-gray-500'
                  }`}>
                    {customWallLoaded ? '8m' : 'Prozedural'}
                  </span>
                </button>

                <button
                  onClick={() => { setActiveTab('door'); playTactileSfx('click'); }}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                    activeTab === 'door'
                      ? 'bg-purple-600 text-white shadow-lg shadow-purple-950/50 border border-purple-400'
                      : 'bg-gray-800 text-gray-400 hover:text-gray-200 border border-gray-700/80'
                  }`}
                >
                  <DoorClosed size={14} className={activeTab === 'door' ? 'text-white' : 'text-purple-400'} />
                  <span>4. Tür</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                    customDoorLoaded ? 'bg-purple-950 text-purple-300 border border-purple-700' : 'bg-gray-900 text-gray-500'
                  }`}>
                    {customDoorLoaded ? 'GLB' : 'Keine'}
                  </span>
                </button>
              </div>

              {/* Quick Action in Tab Header */}
              <div className="flex items-center gap-2">
                {activeTab === 'character' && (
                  <button
                    onClick={() => charFileInputRef.current?.click()}
                    className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white border border-cyan-400/40 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors shadow"
                  >
                    <Upload size={13} />
                    <span>{customModelLoaded ? 'Anderen Charakter wählen' : 'Charakter GLB laden'}</span>
                  </button>
                )}

                {activeTab === 'floor' && (
                  <button
                    onClick={() => floorFileInputRef.current?.click()}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-400/40 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors shadow"
                  >
                    <Upload size={13} />
                    <span>{customFloorLoaded ? 'Andere Bodenplatte wählen' : 'Bodenplatte GLB (8x8m) laden'}</span>
                  </button>
                )}

                {activeTab === 'wall' && (
                  <button
                    onClick={() => wallFileInputRef.current?.click()}
                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white border border-amber-400/40 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors shadow"
                  >
                    <Upload size={13} />
                    <span>{customWallLoaded ? 'Andere Wand wählen' : 'Wand GLB (8m) laden'}</span>
                  </button>
                )}

                {activeTab === 'door' && (
                  <button
                    onClick={() => doorFileInputRef.current?.click()}
                    className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white border border-purple-400/40 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors shadow"
                  >
                    <Upload size={13} />
                    <span>{customDoorLoaded ? 'Andere Tür wählen' : 'Tür GLB laden'}</span>
                  </button>
                )}
              </div>
            </div>

            {/* TAB 1: CHARACTER CONTROLS */}
            {activeTab === 'character' && (
              <div className="space-y-3">
                {/* Character Status Row */}
                <div className="flex flex-wrap items-center justify-between gap-3 bg-gray-950/60 p-2.5 rounded-xl border border-gray-800">
                  <div className="flex items-center gap-2.5">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                      <User size={14} className="text-cyan-400" /> Charakter:
                    </span>
                    {customModelLoaded ? (
                      <div className="flex items-center gap-2 bg-cyan-950/50 border border-cyan-600/50 px-2.5 py-1 rounded-lg text-xs text-cyan-200">
                        <Check size={14} className="text-cyan-400" />
                        <span className="font-semibold truncate max-w-[220px]" title={customModelName}>
                          {customModelName}
                        </span>
                        {customModelSize > 0 && (
                          <span className="text-[10px] text-gray-400">
                            ({(customModelSize / (1024 * 1024)).toFixed(2)} MB)
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-300 bg-gray-800 px-2 py-0.5 rounded-lg border border-gray-700">
                        Standard Anime-Kriegerin (Dummy)
                      </span>
                    )}

                    <span className="hidden lg:inline text-[11px] text-emerald-400 font-mono bg-emerald-950/40 border border-emerald-800/40 px-2 py-0.5 rounded-lg">
                      1:1 Originalmaßstab aktiv (Körper: 1.36m, Kopf: 0.538m)
                    </span>
                  </div>

                  {customModelLoaded && (
                    <button
                      onClick={handleResetToDummy}
                      className="px-2.5 py-1 bg-red-950/40 hover:bg-red-900/60 text-red-300 hover:text-white border border-red-800/50 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors"
                      title="GLB entfernen und Dummy wiederherstellen"
                    >
                      <Trash2 size={13} />
                      <span>Dummy wiederherstellen</span>
                    </button>
                  )}
                </div>

                {/* Project Characters Bar */}
                {characters && characters.length > 0 && (
                  <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
                    <span className="text-[11px] text-gray-500 font-semibold uppercase tracking-wider flex-shrink-0 flex items-center gap-1">
                      <Layers size={13} /> Aus Projekt:
                    </span>
                    <button
                      onClick={handleResetToDummy}
                      className={`px-2.5 py-1 rounded-lg border text-xs font-semibold transition-all flex-shrink-0 ${
                        !customModelLoaded
                          ? 'bg-purple-900/60 text-purple-200 border-purple-500 shadow'
                          : 'bg-gray-800/80 text-gray-400 border-gray-700 hover:text-gray-200'
                      }`}
                    >
                      Standard-Dummy
                    </button>
                    {characters.map(char => (
                      <button
                        key={char.id}
                        onClick={() => {
                          if (char.model3dSrc) {
                            loadCharacterFromProject(char);
                          } else {
                            charFileInputRef.current?.click();
                          }
                        }}
                        className={`px-2.5 py-1 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-all flex-shrink-0 ${
                          customModelName.startsWith(char.name)
                            ? 'bg-cyan-900/60 text-cyan-200 border-cyan-500 shadow'
                            : 'bg-gray-800/80 text-gray-300 border-gray-700 hover:bg-gray-700'
                        }`}
                        title={char.model3dSrc ? `3D-Modell von ${char.name} laden` : `Eigenen GLB für ${char.name} hochladen`}
                      >
                        <span style={{ color: char.rpgColor || '#38bdf8' }}>●</span>
                        <span>{char.name}</span>
                        {char.model3dSrc ? (
                          <span className="text-[9px] bg-cyan-950 text-cyan-400 border border-cyan-700/60 px-1 rounded font-mono font-bold">
                            3D
                          </span>
                        ) : (
                          <span className="text-[9px] text-gray-500">
                            (+GLB)
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {/* Character Adjustments (Scale, Offset Y, Rotation, Animations) */}
                {customModelLoaded && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-gray-950/70 p-3 rounded-xl border border-gray-800/80 text-xs">
                    {/* Scale & Offset */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center text-gray-400">
                        <span className="flex items-center gap-1 font-semibold">
                          <Sliders size={13} className="text-amber-400" /> Skalierung: {modelScale.toFixed(2)}x
                        </span>
                        <button 
                          onClick={() => setModelScale(1.0)} 
                          className="text-[10px] text-cyan-400 hover:underline"
                        >
                          1:1 Original
                        </button>
                      </div>
                      <input
                        type="range"
                        min="0.3"
                        max="2.5"
                        step="0.05"
                        value={modelScale}
                        onChange={(e) => setModelScale(parseFloat(e.target.value))}
                        className="w-full accent-cyan-500 cursor-pointer"
                      />

                      <div className="flex justify-between items-center text-gray-400 pt-1">
                        <span className="font-semibold">Höhe (Y): {modelOffsetY.toFixed(2)}m</span>
                        <button 
                          onClick={() => setModelOffsetY(0.0)} 
                          className="text-[10px] text-gray-500 hover:text-gray-300 underline"
                        >
                          Reset (0m)
                        </button>
                      </div>
                      <input
                        type="range"
                        min="-0.6"
                        max="0.6"
                        step="0.02"
                        value={modelOffsetY}
                        onChange={(e) => setModelOffsetY(parseFloat(e.target.value))}
                        className="w-full accent-cyan-500 cursor-pointer"
                      />
                    </div>

                    {/* 4-Way Model Direction Offset (Rotation Y) */}
                    <div className="space-y-2">
                      <div className="text-gray-400 font-semibold flex items-center gap-1">
                        <RotateCcw size={13} className="text-blue-400" /> Ausrichtung (Blender-Offset):
                      </div>
                      <div className="grid grid-cols-4 gap-1">
                        {[0, 90, 180, 270].map(deg => (
                          <button
                            key={deg}
                            onClick={() => setModelRotationY(deg)}
                            className={`py-1.5 rounded-lg border text-xs font-mono font-bold transition-all ${
                              modelRotationY === deg
                                ? 'bg-cyan-600 text-white border-cyan-400'
                                : 'bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700'
                            }`}
                          >
                            {deg}°
                          </button>
                        ))}
                      </div>
                      <p className="text-[10px] text-gray-500 leading-tight">
                        Wähle 180°, falls das Modell in Blender mit dem Rücken nach vorne exportiert wurde.
                      </p>
                    </div>

                    {/* Animation Clip Selectors */}
                    <div className="space-y-2">
                      <div className="text-gray-400 font-semibold flex items-center gap-1">
                        <Film size={13} className="text-purple-400" /> Animationen ({availableClips.length} gefunden):
                      </div>

                      {availableClips.length > 0 ? (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-gray-400 w-10">Idle:</span>
                            <select
                              value={selectedIdleClip}
                              onChange={(e) => {
                                const newIdle = e.target.value;
                                setSelectedIdleClip(newIdle);
                                selectedIdleClipRef.current = newIdle;
                                if (animState === 'IDLE') {
                                  playAnimationClip(newIdle);
                                }
                              }}
                              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-white outline-none focus:border-cyan-500 font-mono"
                            >
                              {availableClips.map(clip => (
                                <option key={clip} value={clip}>{clip}</option>
                              ))}
                            </select>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-gray-400 w-10">Lauf:</span>
                            <select
                              value={selectedRunClip}
                              onChange={(e) => {
                                const newRun = e.target.value;
                                setSelectedRunClip(newRun);
                                selectedRunClipRef.current = newRun;
                                if (animState === 'RUN') {
                                  playAnimationClip(newRun);
                                }
                              }}
                              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-white outline-none focus:border-cyan-500 font-mono"
                            >
                              {availableClips.map(clip => (
                                <option key={clip} value={clip}>{clip}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      ) : (
                        <div className="p-2 bg-gray-900 border border-gray-800 rounded-lg text-[11px] text-gray-400">
                          Keine Skelettanimationen in der Datei. Das Modell wird beim Laufen prozedural bewegt.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: FLOOR CONTROLS (8x8m CHUNK) */}
            {activeTab === 'floor' && (
              <div className="space-y-3">
                {/* Floor Status Row */}
                <div className="flex flex-wrap items-center justify-between gap-3 bg-gray-950/60 p-2.5 rounded-xl border border-gray-800">
                  <div className="flex items-center gap-2.5">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Square size={14} className="text-emerald-400" /> Boden-Grafik:
                    </span>
                    {customFloorLoaded ? (
                      <div className="flex items-center gap-2 bg-emerald-950/50 border border-emerald-600/50 px-2.5 py-1 rounded-lg text-xs text-emerald-200">
                        <Check size={14} className="text-emerald-400" />
                        <span className="font-semibold truncate max-w-[220px]" title={customFloorName}>
                          {customFloorName}
                        </span>
                        <span className="text-[10px] bg-emerald-900/60 text-emerald-300 px-1.5 py-0.5 rounded font-mono font-bold">
                          8x8m Chunk aktiv
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-300 bg-gray-800 px-2 py-0.5 rounded-lg border border-gray-700">
                        Prozeduraler Diorama-Boden (7.2m)
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => floorFileInputRef.current?.click()}
                      className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors shadow"
                    >
                      <Upload size={13} />
                      <span>{customFloorLoaded ? 'Anderen Boden laden' : 'Bodenplatte (.glb) laden'}</span>
                    </button>

                    {customFloorLoaded && (
                      <button
                        onClick={handleResetFloor}
                        className="px-2.5 py-1 bg-red-950/40 hover:bg-red-900/60 text-red-300 hover:text-white border border-red-800/50 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors"
                        title="Eigene Bodenplatte entfernen und Standardboden wiederherstellen"
                      >
                        <Trash2 size={13} />
                        <span>Prozeduralen Boden wiederherstellen</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Blender Blueprint Specification Box */}
                <div className="bg-emerald-950/30 border border-emerald-800/40 rounded-xl p-3 text-xs text-emerald-200 flex flex-col md:flex-row md:items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="font-bold flex items-center gap-1.5 text-emerald-300">
                      <span>📐 Blender Floor_chunk Maße:</span>
                      <span className="font-mono bg-emerald-900/60 px-2 py-0.5 rounded text-white font-semibold">
                        X = 8m | Y = 8m | Z = 0.5m
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-300 leading-relaxed">
                      Der Pivot-Punkt liegt genau in der Mitte. Die Begehfläche schmiegt sich bei <strong>Y = +0.25m</strong> bündig an. Das 3x3 Kachel-Raster passt sich automatisch nahtlos an (je 2.67m pro Schritt).
                    </p>
                  </div>
                </div>

                {/* Fine-Tuning Controls for Floor Chunk */}
                {customFloorLoaded && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-gray-950/70 p-3 rounded-xl border border-gray-800/80 text-xs">
                    {/* Height Offset Y & Scale */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center text-gray-400">
                        <span className="font-semibold text-emerald-300">Höhe (Y): {floorOffsetY.toFixed(2)}m</span>
                        <button 
                          onClick={() => setFloorOffsetY(0.0)} 
                          className="text-[10px] text-gray-500 hover:text-gray-300 underline"
                        >
                          Reset (0m)
                        </button>
                      </div>
                      <input
                        type="range"
                        min="-0.5"
                        max="0.5"
                        step="0.02"
                        value={floorOffsetY}
                        onChange={(e) => setFloorOffsetY(parseFloat(e.target.value))}
                        className="w-full accent-emerald-500 cursor-pointer"
                      />

                      <div className="flex justify-between items-center text-gray-400 pt-1">
                        <span className="font-semibold">Skalierung: {floorScale.toFixed(2)}x</span>
                        <button 
                          onClick={() => setFloorScale(1.0)} 
                          className="text-[10px] text-gray-500 hover:text-gray-300 underline"
                        >
                          1.0x (8m)
                        </button>
                      </div>
                      <input
                        type="range"
                        min="0.5"
                        max="2.0"
                        step="0.05"
                        value={floorScale}
                        onChange={(e) => setFloorScale(parseFloat(e.target.value))}
                        className="w-full accent-emerald-500 cursor-pointer"
                      />
                    </div>

                    {/* Position X & Z Offsets */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center text-gray-400">
                        <span className="font-semibold">Verschiebung X: {floorOffsetX.toFixed(2)}m</span>
                        <button 
                          onClick={() => setFloorOffsetX(0.0)} 
                          className="text-[10px] text-gray-500 hover:text-gray-300 underline"
                        >
                          0m
                        </button>
                      </div>
                      <input
                        type="range"
                        min="-1.5"
                        max="1.5"
                        step="0.05"
                        value={floorOffsetX}
                        onChange={(e) => setFloorOffsetX(parseFloat(e.target.value))}
                        className="w-full accent-emerald-500 cursor-pointer"
                      />

                      <div className="flex justify-between items-center text-gray-400 pt-1">
                        <span className="font-semibold">Verschiebung Z: {floorOffsetZ.toFixed(2)}m</span>
                        <button 
                          onClick={() => setFloorOffsetZ(0.0)} 
                          className="text-[10px] text-gray-500 hover:text-gray-300 underline"
                        >
                          0m
                        </button>
                      </div>
                      <input
                        type="range"
                        min="-1.5"
                        max="1.5"
                        step="0.05"
                        value={floorOffsetZ}
                        onChange={(e) => setFloorOffsetZ(parseFloat(e.target.value))}
                        className="w-full accent-emerald-500 cursor-pointer"
                      />
                    </div>

                    {/* Floor Rotation Y */}
                    <div className="space-y-2">
                      <div className="text-gray-400 font-semibold flex items-center gap-1">
                        <RotateCcw size={13} className="text-emerald-400" /> Bodenplatten-Drehung (Y):
                      </div>
                      <div className="grid grid-cols-4 gap-1">
                        {[0, 90, 180, 270].map(deg => (
                          <button
                            key={deg}
                            onClick={() => setFloorRotationY(deg)}
                            className={`py-1.5 rounded-lg border text-xs font-mono font-bold transition-all ${
                              floorRotationY === deg
                                ? 'bg-emerald-600 text-white border-emerald-400'
                                : 'bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700'
                            }`}
                          >
                            {deg}°
                          </button>
                        ))}
                      </div>
                      <p className="text-[10px] text-gray-500 leading-tight">
                        Dreht die Textur bzw. Ausrichtung der 8x8m Bodenplatte um das Zentrum.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: WALL CONTROLS (8m WALL) */}
            {activeTab === 'wall' && (
              <div className="space-y-3">
                {/* Wall Status Row */}
                <div className="flex flex-wrap items-center justify-between gap-3 bg-gray-950/60 p-2.5 rounded-xl border border-gray-800">
                  <div className="flex items-center gap-2.5">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Box size={14} className="text-amber-400" /> Wand-Grafik:
                    </span>
                    {customWallLoaded ? (
                      <div className="flex items-center gap-2 bg-amber-950/50 border border-amber-600/50 px-2.5 py-1 rounded-lg text-xs text-amber-200">
                        <Check size={14} className="text-amber-400" />
                        <span className="font-semibold truncate max-w-[220px]" title={customWallName}>
                          {customWallName}
                        </span>
                        <span className="text-[10px] bg-amber-900/60 text-amber-300 px-1.5 py-0.5 rounded font-mono font-bold">
                          8m Wand aktiv
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-300 bg-gray-800 px-2 py-0.5 rounded-lg border border-gray-700">
                        Prozedurale Wände mit Torbogen & Fackeln
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => wallFileInputRef.current?.click()}
                      className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors shadow"
                    >
                      <Upload size={13} />
                      <span>{customWallLoaded ? 'Andere Wand laden' : 'Wand (.glb) laden'}</span>
                    </button>

                    {customWallLoaded && (
                      <button
                        onClick={handleResetWall}
                        className="px-2.5 py-1 bg-red-950/40 hover:bg-red-900/60 text-red-300 hover:text-white border border-red-800/50 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors"
                        title="Eigene Wand entfernen und prozedurale Wände wiederherstellen"
                      >
                        <Trash2 size={13} />
                        <span>Prozedurale Wände wiederherstellen</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Blender Blueprint Specification Box */}
                <div className="bg-amber-950/30 border border-amber-800/40 rounded-xl p-3 text-xs text-amber-200 flex flex-col md:flex-row md:items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="font-bold flex items-center gap-1.5 text-amber-300">
                      <span>📐 Blender Wand Maße:</span>
                      <span className="font-mono bg-amber-900/60 px-2 py-0.5 rounded text-white font-semibold">
                        X = 8m | Y = 0.5m | Z = 4m
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-300 leading-relaxed">
                      Wände werden <strong>ausschließlich links (Left_Wall)</strong> und <strong>oben (Upper_Wall)</strong> aufgestellt. Die vordere und rechte Seite bleiben immer frei, damit Charaktere niemals von einer Wand verdeckt werden.
                    </p>
                  </div>
                </div>

                {/* Left_Wall & Upper_Wall Controls */}
                {customWallLoaded && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* Left_Wall Card */}
                      <div className={`p-3 rounded-xl border flex items-center justify-between transition-all ${
                        showLeftWall
                          ? 'bg-amber-950/40 border-amber-500/80 text-white shadow-md'
                          : 'bg-gray-900/60 border-gray-800 text-gray-400'
                      }`}>
                        <div className="flex items-center gap-2.5">
                          <div className={`w-3 h-3 rounded-full ${showLeftWall ? 'bg-amber-400 shadow-sm shadow-amber-400' : 'bg-gray-700'}`} />
                          <div>
                            <div className="font-bold text-xs text-white">Left_Wall (Linke Wand)</div>
                            <div className="text-[10px] text-gray-400">Steht links am Rand (0° Standard)</div>
                          </div>
                        </div>
                        <button
                          onClick={toggleLeftWall}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                            showLeftWall
                              ? 'bg-amber-600 hover:bg-amber-500 text-white shadow'
                              : 'bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700'
                          }`}
                        >
                          {showLeftWall ? 'Aktiv (An)' : 'Aus'}
                        </button>
                      </div>

                      {/* Upper_Wall Card */}
                      <div className={`p-3 rounded-xl border flex items-center justify-between transition-all ${
                        showUpperWall
                          ? 'bg-amber-950/40 border-amber-500/80 text-white shadow-md'
                          : 'bg-gray-900/60 border-gray-800 text-gray-400'
                      }`}>
                        <div className="flex items-center gap-2.5">
                          <div className={`w-3 h-3 rounded-full ${showUpperWall ? 'bg-amber-400 shadow-sm shadow-amber-400' : 'bg-gray-700'}`} />
                          <div>
                            <div className="font-bold text-xs text-white">Upper_Wall (Obere Wand)</div>
                            <div className="text-[10px] text-gray-400">Um -90° gedreht oben am Rand</div>
                          </div>
                        </div>
                        <button
                          onClick={toggleUpperWall}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                            showUpperWall
                              ? 'bg-amber-600 hover:bg-amber-500 text-white shadow'
                              : 'bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700'
                          }`}
                        >
                          {showUpperWall ? 'Aktiv (An)' : 'Aus'}
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-gray-950/70 p-3 rounded-xl border border-gray-800/80 text-xs">
                      {/* Presets */}
                      <div className="space-y-2">
                        <div className="text-gray-400 font-semibold flex items-center gap-1">
                          <Layers size={13} className="text-amber-400" /> Schnellauswahl:
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          <button
                            onClick={() => {
                              setShowLeftWall(true);
                              setShowUpperWall(true);
                              playTactileSfx('click');
                            }}
                            className={`px-2 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                              showLeftWall && showUpperWall
                                ? 'bg-amber-600 text-white border-amber-400 shadow'
                                : 'bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700'
                            }`}
                          >
                            Beide Wände
                          </button>
                          <button
                            onClick={() => {
                              setShowLeftWall(true);
                              setShowUpperWall(false);
                              playTactileSfx('click');
                            }}
                            className={`px-2 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                              showLeftWall && !showUpperWall
                                ? 'bg-amber-600 text-white border-amber-400 shadow'
                                : 'bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700'
                            }`}
                          >
                            Nur Left_Wall
                          </button>
                          <button
                            onClick={() => {
                              setShowLeftWall(false);
                              setShowUpperWall(true);
                              playTactileSfx('click');
                            }}
                            className={`px-2 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                              !showLeftWall && showUpperWall
                                ? 'bg-amber-600 text-white border-amber-400 shadow'
                                : 'bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700'
                            }`}
                          >
                            Nur Upper_Wall
                          </button>
                          <button
                            onClick={() => {
                              setShowLeftWall(false);
                              setShowUpperWall(false);
                              playTactileSfx('click');
                            }}
                            className={`px-2 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                              !showLeftWall && !showUpperWall
                                ? 'bg-amber-600 text-white border-amber-400 shadow'
                                : 'bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700'
                            }`}
                          >
                            Keine Wände
                          </button>
                        </div>
                      </div>

                    {/* Height & Scale */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center text-gray-400">
                        <span className="font-semibold text-amber-300">Höhe (Y): {wallOffsetY.toFixed(2)}m</span>
                        <button 
                          onClick={() => setWallOffsetY(0.0)} 
                          className="text-[10px] text-gray-500 hover:text-gray-300 underline"
                        >
                          Reset (0m)
                        </button>
                      </div>
                      <input
                        type="range"
                        min="-0.5"
                        max="0.5"
                        step="0.02"
                        value={wallOffsetY}
                        onChange={(e) => setWallOffsetY(parseFloat(e.target.value))}
                        className="w-full accent-amber-500 cursor-pointer"
                      />

                      <div className="flex justify-between items-center text-gray-400 pt-1">
                        <span className="font-semibold">Skalierung: {wallScale.toFixed(2)}x</span>
                        <button 
                          onClick={() => setWallScale(1.0)} 
                          className="text-[10px] text-gray-500 hover:text-gray-300 underline"
                        >
                          1.0x (8m)
                        </button>
                      </div>
                      <input
                        type="range"
                        min="0.5"
                        max="2.0"
                        step="0.05"
                        value={wallScale}
                        onChange={(e) => setWallScale(parseFloat(e.target.value))}
                        className="w-full accent-amber-500 cursor-pointer"
                      />
                    </div>

                    {/* Position X & Z Offsets */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center text-gray-400">
                        <span className="font-semibold">Verschiebung X: {wallOffsetX.toFixed(2)}m</span>
                        <button 
                          onClick={() => setWallOffsetX(0.0)} 
                          className="text-[10px] text-gray-500 hover:text-gray-300 underline"
                        >
                          0m
                        </button>
                      </div>
                      <input
                        type="range"
                        min="-1.5"
                        max="1.5"
                        step="0.05"
                        value={wallOffsetX}
                        onChange={(e) => setWallOffsetX(parseFloat(e.target.value))}
                        className="w-full accent-amber-500 cursor-pointer"
                      />

                      <div className="flex justify-between items-center text-gray-400 pt-1">
                        <span className="font-semibold">Verschiebung Z: {wallOffsetZ.toFixed(2)}m</span>
                        <button 
                          onClick={() => setWallOffsetZ(0.0)} 
                          className="text-[10px] text-gray-500 hover:text-gray-300 underline"
                        >
                          0m
                        </button>
                      </div>
                      <input
                        type="range"
                        min="-1.5"
                        max="1.5"
                        step="0.05"
                        value={wallOffsetZ}
                        onChange={(e) => setWallOffsetZ(parseFloat(e.target.value))}
                        className="w-full accent-amber-500 cursor-pointer"
                      />
                    </div>
                  </div>
                </div>
              )}
              </div>
            )}

            {/* TAB 4: DOOR CONTROLS (BLENDER DOOR GLB) */}
            {activeTab === 'door' && (
              <div className="space-y-3">
                {/* Door Status Row */}
                <div className="flex flex-wrap items-center justify-between gap-3 bg-gray-950/60 p-2.5 rounded-xl border border-gray-800">
                  <div className="flex items-center gap-2.5">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                      <DoorClosed size={14} className="text-purple-400" /> Tür-Grafik:
                    </span>
                    {customDoorLoaded ? (
                      <div className="flex items-center gap-2 bg-purple-950/50 border border-purple-600/50 px-2.5 py-1 rounded-lg text-xs text-purple-200">
                        <Check size={14} className="text-purple-400" />
                        <span className="font-semibold truncate max-w-[220px]" title={customDoorName}>
                          {customDoorName}
                        </span>
                        <span className="text-[10px] bg-purple-900/60 text-purple-300 px-1.5 py-0.5 rounded font-mono font-bold">
                          Tür aktiv
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400 bg-gray-800/80 px-2.5 py-1 rounded-lg border border-gray-700">
                        Noch keine eigene Tür geladen
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => doorFileInputRef.current?.click()}
                      className="px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors shadow"
                    >
                      <Upload size={13} />
                      <span>{customDoorLoaded ? 'Andere Tür (.glb) laden' : 'Tür (.glb) laden'}</span>
                    </button>

                    {customDoorLoaded && (
                      <button
                        onClick={handleResetDoor}
                        className="px-2.5 py-1 bg-red-950/40 hover:bg-red-900/60 text-red-300 hover:text-white border border-red-800/50 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors"
                        title="Eigene Tür entfernen"
                      >
                        <Trash2 size={13} />
                        <span>Tür entfernen</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Blender Blueprint Specification Box */}
                <div className="bg-purple-950/30 border border-purple-800/40 rounded-xl p-3 text-xs text-purple-200 flex flex-col md:flex-row md:items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="font-bold flex items-center gap-1.5 text-purple-300">
                      <span>📐 Blender Tür Spezifikation:</span>
                      <span className="font-mono bg-purple-900/60 px-2 py-0.5 rounded text-white font-semibold">
                        Drehpunkt: Mitte des Bodens | 0°: Linke Wand | -90°: Obere Wand
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-300 leading-relaxed">
                      Die Tür nutzt denselben Drehpunkt wie Boden und Wand. Bei <strong>0°</strong> sitzt sie exakt mittig in der <strong>Left_Wall</strong>. Bei <strong>-90°</strong> Drehung liegt sie passgenau mittig in der <strong>Upper_Wall</strong>.
                    </p>
                  </div>
                </div>

                {/* Left_Door & Upper_Door Controls */}
                {customDoorLoaded ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* Left_Door Card */}
                      <div className={`p-3 rounded-xl border flex items-center justify-between transition-all ${
                        showLeftDoor
                          ? 'bg-purple-950/40 border-purple-500/80 text-white shadow-md'
                          : 'bg-gray-900/60 border-gray-800 text-gray-400'
                      }`}>
                        <div className="flex items-center gap-2.5">
                          <div className={`w-3 h-3 rounded-full ${showLeftDoor ? 'bg-purple-400 shadow-sm shadow-purple-400' : 'bg-gray-700'}`} />
                          <div>
                            <div className="font-bold text-xs text-white">Left_Door (Linke Wand-Tür)</div>
                            <div className="text-[10px] text-gray-400">Sitzt in der Mitte der linken Wand (0°)</div>
                          </div>
                        </div>
                        <button
                          onClick={toggleLeftDoor}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                            showLeftDoor
                              ? 'bg-purple-600 hover:bg-purple-500 text-white shadow'
                              : 'bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700'
                          }`}
                        >
                          {showLeftDoor ? 'Aktiv (An)' : 'Aus'}
                        </button>
                      </div>

                      {/* Upper_Door Card */}
                      <div className={`p-3 rounded-xl border flex items-center justify-between transition-all ${
                        showUpperDoor
                          ? 'bg-purple-950/40 border-purple-500/80 text-white shadow-md'
                          : 'bg-gray-900/60 border-gray-800 text-gray-400'
                      }`}>
                        <div className="flex items-center gap-2.5">
                          <div className={`w-3 h-3 rounded-full ${showUpperDoor ? 'bg-purple-400 shadow-sm shadow-purple-400' : 'bg-gray-700'}`} />
                          <div>
                            <div className="font-bold text-xs text-white">Upper_Door (Obere Wand-Tür)</div>
                            <div className="text-[10px] text-gray-400">Um -90° gedreht in der oberen Wand</div>
                          </div>
                        </div>
                        <button
                          onClick={toggleUpperDoor}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                            showUpperDoor
                              ? 'bg-purple-600 hover:bg-purple-500 text-white shadow'
                              : 'bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700'
                          }`}
                        >
                          {showUpperDoor ? 'Aktiv (An)' : 'Aus'}
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-gray-950/70 p-3 rounded-xl border border-gray-800/80 text-xs">
                      {/* Presets */}
                      <div className="space-y-2">
                        <div className="text-gray-400 font-semibold flex items-center gap-1">
                          <Layers size={13} className="text-purple-400" /> Schnellauswahl:
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          <button
                            onClick={() => {
                              setShowLeftDoor(true);
                              setShowUpperDoor(false);
                              playTactileSfx('click');
                            }}
                            className={`px-2 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                              showLeftDoor && !showUpperDoor
                                ? 'bg-purple-600 text-white border-purple-400 shadow'
                                : 'bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700'
                            }`}
                          >
                            Nur Left_Door
                          </button>
                          <button
                            onClick={() => {
                              setShowLeftDoor(false);
                              setShowUpperDoor(true);
                              playTactileSfx('click');
                            }}
                            className={`px-2 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                              !showLeftDoor && showUpperDoor
                                ? 'bg-purple-600 text-white border-purple-400 shadow'
                                : 'bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700'
                            }`}
                          >
                            Nur Upper_Door
                          </button>
                          <button
                            onClick={() => {
                              setShowLeftDoor(true);
                              setShowUpperDoor(true);
                              playTactileSfx('click');
                            }}
                            className={`px-2 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                              showLeftDoor && showUpperDoor
                                ? 'bg-purple-600 text-white border-purple-400 shadow'
                                : 'bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700'
                            }`}
                          >
                            Beide Türen
                          </button>
                          <button
                            onClick={() => {
                              setShowLeftDoor(false);
                              setShowUpperDoor(false);
                              playTactileSfx('click');
                            }}
                            className={`px-2 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                              !showLeftDoor && !showUpperDoor
                                ? 'bg-purple-600 text-white border-purple-400 shadow'
                                : 'bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700'
                            }`}
                          >
                            Keine Tür
                          </button>
                        </div>
                      </div>

                      {/* Height & Scale */}
                      <div className="space-y-2">
                        <div className="flex justify-between items-center text-gray-400">
                          <span className="font-semibold text-purple-300">Höhe (Y): {doorOffsetY.toFixed(2)}m</span>
                          <button 
                            onClick={() => setDoorOffsetY(0.0)} 
                            className="text-[10px] text-gray-500 hover:text-gray-300 underline"
                          >
                            Reset (0m)
                          </button>
                        </div>
                        <input
                          type="range"
                          min="-0.5"
                          max="0.5"
                          step="0.02"
                          value={doorOffsetY}
                          onChange={(e) => setDoorOffsetY(parseFloat(e.target.value))}
                          className="w-full accent-purple-500 cursor-pointer"
                        />

                        <div className="flex justify-between items-center text-gray-400 pt-1">
                          <span className="font-semibold">Skalierung: {doorScale.toFixed(2)}x</span>
                          <button 
                            onClick={() => setDoorScale(1.0)} 
                            className="text-[10px] text-gray-500 hover:text-gray-300 underline"
                          >
                            1.0x
                          </button>
                        </div>
                        <input
                          type="range"
                          min="0.5"
                          max="2.0"
                          step="0.05"
                          value={doorScale}
                          onChange={(e) => setDoorScale(parseFloat(e.target.value))}
                          className="w-full accent-purple-500 cursor-pointer"
                        />
                      </div>

                      {/* Position X & Z Offsets */}
                      <div className="space-y-2">
                        <div className="flex justify-between items-center text-gray-400">
                          <span className="font-semibold">Verschiebung X: {doorOffsetX.toFixed(2)}m</span>
                          <button 
                            onClick={() => setDoorOffsetX(0.0)} 
                            className="text-[10px] text-gray-500 hover:text-gray-300 underline"
                          >
                            0m
                          </button>
                        </div>
                        <input
                          type="range"
                          min="-1.5"
                          max="1.5"
                          step="0.05"
                          value={doorOffsetX}
                          onChange={(e) => setDoorOffsetX(parseFloat(e.target.value))}
                          className="w-full accent-purple-500 cursor-pointer"
                        />

                        <div className="flex justify-between items-center text-gray-400 pt-1">
                          <span className="font-semibold">Verschiebung Z: {doorOffsetZ.toFixed(2)}m</span>
                          <button 
                            onClick={() => setDoorOffsetZ(0.0)} 
                            className="text-[10px] text-gray-500 hover:text-gray-300 underline"
                          >
                            0m
                          </button>
                        </div>
                        <input
                          type="range"
                          min="-1.5"
                          max="1.5"
                          step="0.05"
                          value={doorOffsetZ}
                          onChange={(e) => setDoorOffsetZ(parseFloat(e.target.value))}
                          className="w-full accent-purple-500 cursor-pointer"
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="bg-gray-950/40 border border-gray-800 rounded-xl p-6 text-center">
                    <DoorClosed size={36} className="text-purple-400/80 mx-auto mb-2" />
                    <h4 className="text-sm font-bold text-gray-200 mb-1">Keine eigene Tür importiert</h4>
                    <p className="text-xs text-gray-400 max-w-md mx-auto mb-4">
                      Lade deine Blender Tür-Datei (.glb) hoch. Sie wird automatisch zentriert in der linken Wand platziert (0°) und kann zusätzlich oder alternativ für die obere Wand (-90°) aktiviert werden.
                    </p>
                    <button
                      onClick={() => doorFileInputRef.current?.click()}
                      className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-xl inline-flex items-center gap-2 transition-colors shadow"
                    >
                      <Upload size={14} />
                      <span>Tür (.glb) jetzt importieren</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Bottom Row Actions & Quick Help */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-gray-800/80">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setMoveSpeed(prev => (prev === 3.6 ? 5.4 : 3.6))}
                  className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-medium rounded-xl border border-gray-700 transition-colors"
                  title="Geschwindigkeit umschalten"
                >
                  Tempo: <span className="text-emerald-400 font-bold">{moveSpeed === 3.6 ? 'Normal' : 'Sprint'}</span>
                </button>

                <button
                  onClick={resetToCenter}
                  className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-medium rounded-xl border border-gray-700 flex items-center gap-1.5 transition-colors active:scale-95"
                  title="Charakter auf Mittelkachel [1,1] zurücksetzen"
                >
                  <RotateCcw size={13} className="text-amber-400" />
                  <span>Mitte [1,1]</span>
                </button>

                <button
                  onClick={() => setAudioEnabled(!audioEnabled)}
                  className={`px-2.5 py-1.5 text-xs rounded-xl border transition-colors ${
                    audioEnabled
                      ? 'bg-gray-800 text-gray-300 border-gray-700'
                      : 'bg-gray-900 text-gray-500 border-gray-800'
                  }`}
                  title="Audio SFX Ein/Aus"
                >
                  {audioEnabled ? 'SFX An' : 'SFX Aus'}
                </button>
              </div>

              <div className="text-[11px] text-gray-400 flex items-center gap-2">
                <span className="text-gray-500">Navigation:</span>
                <span>Klick auf eine Kachel bewegt den Charakter schrittweise</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DungeonTestView;
