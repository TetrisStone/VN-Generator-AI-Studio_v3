import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { 
  ArrowLeft, RotateCcw, Upload, Compass, Shield, User, 
  ChevronDown, ChevronUp, Footprints, Sparkles, Check, 
  Trash2, Sliders, Film, HelpCircle, Layers 
} from 'lucide-react';
import { Character } from '../types';
import { getItem, setItem } from '../utils/db';
import { loadImage } from '../utils/imageStorage';
import { 
  createAnimeDungeonFloorTextures, 
  createAnimeDungeonWallTextures, 
  createAnimeDungeonDoorTextures 
} from './dungeonTextures';

interface DungeonTestViewProps {
  onExit: () => void;
  characters?: Character[];
}

interface TileCoord {
  col: number; // 0, 1, 2 (West to East)
  row: number; // 0, 1, 2 (North to South)
}

type Direction = 'NORTH' | 'EAST' | 'SOUTH' | 'WEST';

const TILE_SIZE = 2.4; // World units per tile
const PLATFORM_HALF = (3 * TILE_SIZE) / 2; // 3.6 units from center to edge
const WALL_HEIGHT = 3.8;
const WALL_THICKNESS = 0.55;

const STORAGE_KEY_GLB = 'dungeon_custom_glb_config';

interface StoredGLBConfig {
  fileName: string;
  fileSize: number;
  dataBase64: string;
  scale?: number;
  offsetY?: number;
  rotationY?: number;
  idleClipName?: string;
  runClipName?: string;
}

// Convert tile coordinate to world coordinates
function tileToWorld(col: number, row: number): THREE.Vector3 {
  const x = (col - 1) * TILE_SIZE;
  const z = (row - 1) * TILE_SIZE;
  return new THREE.Vector3(x, 0.05, z);
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

// Procedural anime dungeon textures are generated via ./dungeonTextures

// Wall textures now loaded from ./dungeonTextures

// Door textures now loaded from ./dungeonTextures


export const DungeonTestView: React.FC<DungeonTestViewProps> = ({ onExit, characters = [] }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  const [isLoadingModel, setIsLoadingModel] = useState<boolean>(false);

  // Model Fine-Tuning state
  const [modelScale, setModelScale] = useState<number>(1.0);
  const [modelOffsetY, setModelOffsetY] = useState<number>(0.0);
  const [modelRotationY, setModelRotationY] = useState<number>(0); // in degrees: 0, 90, 180, 270

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

  // Three.js mutable references
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const characterRootRef = useRef<THREE.Group | null>(null);
  const customModelInnerRef = useRef<THREE.Group | null>(null);
  const tileMeshesRef = useRef<THREE.Mesh[]>([]);
  const hoverIndicatorRef = useRef<THREE.Group | null>(null);

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

    // Standard character height ~1.85m
    const naturalHeight = size.y || 1;
    const baseScale = 1.85 / naturalHeight;

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
  }, [modelScale, modelOffsetY, modelRotationY, playTactileSfx]);

  // Load a GLB File (from File input or Drag & Drop)
  const processGLBFile = useCallback(async (file: File) => {
    setIsLoadingModel(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const base64DataUrl = await arrayBufferToDataUrl(arrayBuffer);

      // Parse with Three.js GLTFLoader
      const loader = new GLTFLoader();
      loader.parse(arrayBuffer, '', async (gltf) => {
        mountGLBModel(gltf, {
          fileName: file.name,
          fileSize: file.size,
          scale: 1.0,
          offsetY: 0.0,
          rotationY: 0.0
        });

        setCustomModelName(file.name);
        setCustomModelSize(file.size);
        setModelScale(1.0);
        setModelOffsetY(0.0);
        setModelRotationY(0);

        // Persist to IndexedDB so it stays active across reloads
        try {
          await setItem(STORAGE_KEY_GLB, {
            fileName: file.name,
            fileSize: file.size,
            dataBase64: base64DataUrl,
            scale: 1.0,
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
  }, [mountGLBModel]);

  // Load a character's 3D model from the project
  const loadCharacterFromProject = useCallback(async (char: Character) => {
    if (!char.model3dSrc) {
      alert(`Für "${char.name}" ist noch kein 3D-Modell im Charakter-Editor hinterlegt. Du kannst direkt eine .glb Datei hochladen.`);
      return;
    }
    setIsLoadingModel(true);
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
  }, [mountGLBModel]);

  // Revert to built-in Anime Knight Dummy
  const handleResetToDummy = useCallback(async () => {
    try {
      await setItem(STORAGE_KEY_GLB, null);
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

  // Apply real-time Model Adjustments (Scale, Offset Y, Rotation Y)
  useEffect(() => {
    if (!customModelInnerRef.current) return;
    const baseHeight = 1.85; // normalized height
    customModelInnerRef.current.scale.setScalar(modelScale);
    customModelInnerRef.current.position.y = modelOffsetY;
    customModelInnerRef.current.rotation.y = (modelRotationY * Math.PI) / 180;
  }, [modelScale, modelOffsetY, modelRotationY]);

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

    playTactileSfx('click');

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

    targetWorldPosRef.current = tileToWorld(firstStep.col, firstStep.row);
  }, [playTactileSfx, updateMovementAnimation]);

  // Reset character to (1,1) Center Tile
  const resetToCenter = useCallback(() => {
    moveQueueRef.current = [];
    currentTileRef.current = { col: 1, row: 1 };
    targetWorldPosRef.current = null;
    characterPosRef.current.set(0, 0.05, 0);
    targetFacingAngleRef.current = 0;
    currentFacingAngleRef.current = 0;

    if (characterRootRef.current) {
      characterRootRef.current.position.set(0, 0.05, 0);
      characterRootRef.current.rotation.y = 0;
    }

    setCharacterCoord({ col: 1, row: 1 });
    setFacingDir('SOUTH');
    setAnimState('IDLE');
    updateMovementAnimation(false);
    playTactileSfx('click');
  }, [playTactileSfx, updateMovementAnimation]);

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
    scene.add(plinthMesh);

    const curbGeo = new THREE.BoxGeometry(PLATFORM_HALF * 2 + 0.16, 0.22, PLATFORM_HALF * 2 + 0.16);
    const curbMat = new THREE.MeshLambertMaterial({ color: 0x4a4744 });
    const curbMesh = new THREE.Mesh(curbGeo, curbMat);
    curbMesh.position.y = -0.11;
    scene.add(curbMesh);

    const floorCanvas = createStylizedFloorCanvas();
    const floorTexture = new THREE.CanvasTexture(floorCanvas);
    floorTexture.colorSpace = THREE.SRGBColorSpace;

    const floorGeo = new THREE.PlaneGeometry(PLATFORM_HALF * 2, PLATFORM_HALF * 2);
    const floorMat = new THREE.MeshLambertMaterial({ map: floorTexture });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = 0.005;
    scene.add(floorMesh);

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

    // 7. Dynamic Hover Indicator: Magical Fantasy Runic Ring
    const hoverGroup = new THREE.Group();
    hoverGroup.visible = false;
    hoverIndicatorRef.current = hoverGroup;

    const runeRingGeo = new THREE.RingGeometry(0.85, 0.95, 48);
    const runeRingMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const runeRing = new THREE.Mesh(runeRingGeo, runeRingMat);
    runeRing.rotation.x = -Math.PI / 2;
    hoverGroup.add(runeRing);

    const innerRingGeo = new THREE.RingGeometry(0.68, 0.72, 36);
    const innerRingMat = new THREE.MeshBasicMaterial({
      color: 0xfacc15,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const innerRing = new THREE.Mesh(innerRingGeo, innerRingMat);
    innerRing.rotation.x = -Math.PI / 2;
    hoverGroup.add(innerRing);

    const tileWashGeo = new THREE.PlaneGeometry(TILE_SIZE - 0.1, TILE_SIZE - 0.1);
    const tileWashMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.12,
      depthWrite: false
    });
    const tileWash = new THREE.Mesh(tileWashGeo, tileWashMat);
    tileWash.rotation.x = -Math.PI / 2;
    hoverGroup.add(tileWash);

    hoverGroup.position.y = 0.035;
    scene.add(hoverGroup);

    // 8. Architectural Walls & Arched Doorway (North & East Walls)
    const wallCanvas = createStylizedWallCanvas();
    const wallTexture = new THREE.CanvasTexture(wallCanvas);
    wallTexture.colorSpace = THREE.SRGBColorSpace;
    const wallMat = new THREE.MeshLambertMaterial({ map: wallTexture });
    const trimStoneMat = new THREE.MeshLambertMaterial({ color: 0x5a5752 });

    const northWallGeo = new THREE.BoxGeometry(PLATFORM_HALF * 2, WALL_HEIGHT, WALL_THICKNESS);
    const northWall = new THREE.Mesh(northWallGeo, wallMat);
    northWall.position.set(0, WALL_HEIGHT / 2, -PLATFORM_HALF - WALL_THICKNESS / 2);
    scene.add(northWall);

    const baseboardGeo = new THREE.BoxGeometry(PLATFORM_HALF * 2 + 0.1, 0.28, 0.18);
    const northBaseboard = new THREE.Mesh(baseboardGeo, trimStoneMat);
    northBaseboard.position.set(0, 0.14, -PLATFORM_HALF + 0.09);
    scene.add(northBaseboard);

    const northCorniceGeo = new THREE.BoxGeometry(PLATFORM_HALF * 2 + 0.35, 0.35, WALL_THICKNESS + 0.35);
    const northCornice = new THREE.Mesh(northCorniceGeo, trimStoneMat);
    northCornice.position.set(0, WALL_HEIGHT + 0.175, -PLATFORM_HALF - WALL_THICKNESS / 2);
    scene.add(northCornice);

    const jambColGeo = new THREE.CylinderGeometry(0.18, 0.22, 2.7, 24);
    const jambL = new THREE.Mesh(jambColGeo, trimStoneMat);
    jambL.position.set(-0.95, 1.35, -PLATFORM_HALF + 0.08);
    const jambR = new THREE.Mesh(jambColGeo, trimStoneMat);
    jambR.position.set(0.95, 1.35, -PLATFORM_HALF + 0.08);
    scene.add(jambL);
    scene.add(jambR);

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
    scene.add(archMesh);

    const keystoneGeo = new THREE.BoxGeometry(0.32, 0.42, 0.28);
    const keystone = new THREE.Mesh(keystoneGeo, trimStoneMat);
    keystone.position.set(0, 3.82, -PLATFORM_HALF + 0.12);
    scene.add(keystone);

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
    scene.add(doorMesh);

    const ringGeo = new THREE.TorusGeometry(0.12, 0.025, 16, 24);
    const ringMat = new THREE.MeshLambertMaterial({ color: 0x475569 });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.position.set(-0.35, 1.35, -PLATFORM_HALF + 0.08);
    scene.add(ringMesh);

    // East Wall
    const eastWallGeo = new THREE.BoxGeometry(WALL_THICKNESS, WALL_HEIGHT, PLATFORM_HALF * 2 + WALL_THICKNESS);
    const eastWall = new THREE.Mesh(eastWallGeo, wallMat);
    eastWall.position.set(PLATFORM_HALF + WALL_THICKNESS / 2, WALL_HEIGHT / 2, -WALL_THICKNESS / 2);
    scene.add(eastWall);

    const eastBaseboardGeo = new THREE.BoxGeometry(0.18, 0.28, PLATFORM_HALF * 2 + 0.1);
    const eastBaseboard = new THREE.Mesh(eastBaseboardGeo, trimStoneMat);
    eastBaseboard.position.set(PLATFORM_HALF - 0.09, 0.14, 0);
    scene.add(eastBaseboard);

    const eastCorniceGeo = new THREE.BoxGeometry(WALL_THICKNESS + 0.35, 0.35, PLATFORM_HALF * 2 + WALL_THICKNESS + 0.35);
    const eastCornice = new THREE.Mesh(eastCorniceGeo, trimStoneMat);
    eastCornice.position.set(PLATFORM_HALF + WALL_THICKNESS / 2, WALL_HEIGHT + 0.175, -WALL_THICKNESS / 2);
    scene.add(eastCornice);

    const pilasterGeo = new THREE.CylinderGeometry(0.24, 0.28, WALL_HEIGHT, 24);
    const pilaster = new THREE.Mesh(pilasterGeo, trimStoneMat);
    pilaster.position.set(PLATFORM_HALF - 0.14, WALL_HEIGHT / 2, 0);
    scene.add(pilaster);

    const capGeo = new THREE.CylinderGeometry(0.34, 0.26, 0.32, 24);
    const pilasterCap = new THREE.Mesh(capGeo, trimStoneMat);
    pilasterCap.position.set(PLATFORM_HALF - 0.14, WALL_HEIGHT - 0.16, 0);
    scene.add(pilasterCap);

    const sconceArmCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(PLATFORM_HALF - 0.02, 2.1, 0),
      new THREE.Vector3(PLATFORM_HALF - 0.28, 2.15, 0),
      new THREE.Vector3(PLATFORM_HALF - 0.38, 2.35, 0)
    ]);
    const sconceTubeGeo = new THREE.TubeGeometry(sconceArmCurve, 16, 0.035, 12, false);
    const sconceMat = new THREE.MeshLambertMaterial({ color: 0x334155 });
    const sconceArm = new THREE.Mesh(sconceTubeGeo, sconceMat);
    scene.add(sconceArm);

    const brazierGeo = new THREE.ConeGeometry(0.14, 0.18, 16, 1, true);
    const brazier = new THREE.Mesh(brazierGeo, sconceMat);
    brazier.position.set(PLATFORM_HALF - 0.38, 2.44, 0);
    scene.add(brazier);

    const flameGeo = new THREE.OctahedronGeometry(0.14, 2);
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
    const flameMesh = new THREE.Mesh(flameGeo, flameMat);
    flameMesh.position.set(PLATFORM_HALF - 0.38, 2.58, 0);
    scene.add(flameMesh);

    const torchLight = new THREE.PointLight(0xf59e0b, 1.2, 7.5);
    torchLight.position.set(PLATFORM_HALF - 0.45, 2.65, 0);
    scene.add(torchLight);

    const cornerColGeo = new THREE.CylinderGeometry(0.42, 0.46, WALL_HEIGHT + 0.35, 24);
    const cornerCol = new THREE.Mesh(cornerColGeo, trimStoneMat);
    cornerCol.position.set(PLATFORM_HALF + WALL_THICKNESS / 2, (WALL_HEIGHT + 0.35) / 2, -PLATFORM_HALF - WALL_THICKNESS / 2);
    scene.add(cornerCol);

    // Check IndexedDB for previously stored custom GLB
    const initCharacter = async () => {
      try {
        const storedGLB = await getItem<StoredGLBConfig>(STORAGE_KEY_GLB);
        if (storedGLB?.dataBase64) {
          const buffer = dataUrlToArrayBuffer(storedGLB.dataBase64);
          const loader = new GLTFLoader();
          loader.parse(buffer, '', (gltf) => {
            setCustomModelName(storedGLB.fileName || 'custom_model.glb');
            setCustomModelSize(storedGLB.fileSize || 0);
            if (storedGLB.scale !== undefined) setModelScale(storedGLB.scale);
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

    initCharacter();

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

        setHoveredCoord((prev) => {
          if (!prev || prev.col !== col || prev.row !== row) {
            playTactileSfx('hover');
          }
          return { col, row };
        });

        if (hoverIndicatorRef.current) {
          const wPos = tileToWorld(col, row);
          hoverIndicatorRef.current.position.set(wPos.x, 0.035, wPos.z);
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
            playTactileSfx('step');

            if (queue.length > 0) {
              const upcoming = queue[0];
              const { angle, dir } = getCardinalAngle(nextStep, upcoming);
              targetFacingAngleRef.current = angle;
              setFacingDir(dir);
              targetWorldPosRef.current = tileToWorld(upcoming.col, upcoming.row);
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

      if (hoverIndicatorRef.current && hoverIndicatorRef.current.visible) {
        runeRing.rotation.z += delta * 0.8;
        innerRing.rotation.z -= delta * 1.2;
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
      processGLBFile(file);
    } else {
      alert("Bitte ziehe eine 3D-Modelldatei im .glb- oder .gltf-Format auf die Bühne.");
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processGLBFile(file);
    }
  };

  return (
    <div 
      className="relative w-full h-screen bg-gray-950 select-none overflow-hidden font-sans"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 3D WebGL Canvas */}
      <div ref={mountRef} className="absolute inset-0 w-full h-full" />

      {/* DRAG & DROP OVERLAY */}
      {isDraggingFile && (
        <div className="absolute inset-0 z-50 bg-black/75 backdrop-blur-sm flex flex-col items-center justify-center pointer-events-none border-4 border-dashed border-cyan-400">
          <Upload size={64} className="text-cyan-400 mb-4 animate-bounce" />
          <h2 className="text-2xl font-bold text-white tracking-wide">GLB-Charakter hier ablegen</h2>
          <p className="text-gray-300 mt-2">Lade deine 3D-Datei (.glb) direkt auf die Dungeon-Bühne</p>
        </div>
      )}

      {/* LOADING OVERLAY */}
      {isLoadingModel && (
        <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center pointer-events-none">
          <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mb-4" />
          <h3 className="text-lg font-bold text-white">3D-Modell wird geladen & aufbereitet...</h3>
        </div>
      )}

      {/* TOP BAR */}
      <div className="absolute top-0 left-0 right-0 p-4 md:p-6 flex items-center justify-between pointer-events-none z-20">
        <button
          onClick={onExit}
          className="pointer-events-auto flex items-center gap-2 px-4 py-2.5 bg-gray-900/90 hover:bg-gray-800 text-gray-200 hover:text-white border border-gray-700/80 rounded-xl shadow-xl transition-all duration-200 font-semibold text-sm group active:scale-95"
          title="Zurück zum Editor Hauptmenü"
        >
          <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform text-emerald-400" />
          <span>Zurück zum Editor</span>
        </button>

        {/* Central Character & Stage Badge */}
        <div className="hidden sm:flex items-center gap-3 px-4 py-1.5 bg-gray-900/90 border border-gray-800 rounded-full text-xs text-gray-300 font-mono shadow-lg">
          <Compass size={14} className="text-cyan-400" />
          <span className="font-bold text-white">3D Dungeon</span>
          <span className="text-gray-500">|</span>
          <span className="text-emerald-400 font-semibold">
            {customModelLoaded ? `Charakter: ${customModelName}` : 'Standard Anime-Dummy'}
          </span>
        </div>

        {/* Right Action: Quick GLB Upload / Status Pill */}
        <div className="pointer-events-auto flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".glb,.gltf"
            onChange={handleFileInputChange}
            className="hidden"
          />

          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-3.5 py-2 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs rounded-xl shadow-lg border border-cyan-400/40 transition-all active:scale-95"
            title="Eigene .glb Datei vom Computer laden"
          >
            <Upload size={14} />
            <span>{customModelLoaded ? 'Anderen GLB laden' : 'Eigenen GLB laden'}</span>
          </button>

          <div className="hidden md:flex items-center gap-3 px-3.5 py-1.5 bg-gray-900/90 border border-gray-800 rounded-xl text-xs shadow-xl">
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

      {/* DRAG AND DROP HINT BADGE (Top Center) */}
      {!customModelLoaded && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 pointer-events-none z-10 text-center hidden md:block">
          <div className="bg-cyan-950/60 border border-cyan-500/30 px-3 py-1 rounded-full text-[11px] text-cyan-200">
            💡 Tipp: Du kannst deine <strong>.glb</strong>-Datei auch per Drag & Drop direkt auf den Bildschirm ziehen!
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
          className="mb-1 px-3.5 py-1 bg-gray-900 text-gray-300 hover:text-white rounded-t-lg border-t border-x border-gray-700/80 text-xs font-semibold flex items-center gap-1 shadow-lg transition-colors"
        >
          {isDockCollapsed ? (
            <>
              <ChevronUp size={14} /> 3D-Charakter & Steuerung anzeigen
            </>
          ) : (
            <>
              <ChevronDown size={14} /> Steuerung minimieren
            </>
          )}
        </button>

        {!isDockCollapsed && (
          <div className="w-full bg-gray-900/95 border border-gray-800 rounded-2xl p-4 shadow-2xl space-y-3.5">
            {/* Top row: Model status & GLB controls */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-gray-800">
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                  <User size={15} className="text-cyan-400" /> Aktives Modell:
                </span>

                {customModelLoaded ? (
                  <div className="flex items-center gap-2 bg-cyan-950/50 border border-cyan-600/50 px-3 py-1 rounded-xl text-xs text-cyan-200">
                    <Check size={14} className="text-cyan-400" />
                    <span className="font-semibold truncate max-w-[200px]" title={customModelName}>
                      {customModelName}
                    </span>
                    {customModelSize > 0 && (
                      <span className="text-[10px] text-gray-400">
                        ({(customModelSize / (1024 * 1024)).toFixed(2)} MB)
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-gray-300 bg-gray-800 px-2.5 py-1 rounded-lg border border-gray-700">
                    Standard Anime-Kriegerin (Dummy)
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-cyan-300 hover:text-white border border-gray-700 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors"
                >
                  <Upload size={13} />
                  <span>{customModelLoaded ? 'Neue GLB Datei wählen' : 'Eigene GLB hochladen'}</span>
                </button>

                {customModelLoaded && (
                  <button
                    onClick={handleResetToDummy}
                    className="px-3 py-1.5 bg-red-950/40 hover:bg-red-900/60 text-red-300 hover:text-white border border-red-800/50 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors"
                    title="GLB entfernen und Dummy wiederherstellen"
                  >
                    <Trash2 size={13} />
                    <span>Dummy wiederherstellen</span>
                  </button>
                )}
              </div>
            </div>

            {/* Project Characters Bar */}
            {characters && characters.length > 0 && (
              <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
                <span className="text-[11px] text-gray-500 font-semibold uppercase tracking-wider flex-shrink-0 flex items-center gap-1">
                  <Layers size={13} /> Charaktere:
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
                        fileInputRef.current?.click();
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

            {/* Custom Model Adjustments (Scale, Offset Y, Rotation, Animations) */}
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
                      className="text-[10px] text-gray-500 hover:text-gray-300 underline"
                    >
                      Reset (1.0x)
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
                    <RotateCcw size={13} className="text-blue-400" /> Modell-Ausrichtung (Blender-Offset):
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
                    Falls das Modell in Blender rückwärts exportiert wurde, wähle hier 180°.
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
                        <span className="text-[10px] text-gray-500 w-10">Idle:</span>
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
                          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-white outline-none focus:border-cyan-500"
                        >
                          {availableClips.map(clip => (
                            <option key={clip} value={clip}>{clip}</option>
                          ))}
                        </select>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-gray-500 w-10">Lauf:</span>
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
                          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-white outline-none focus:border-cyan-500"
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

            {/* Bottom Row Actions */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
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

              <div className="text-[11px] text-gray-400 flex items-center gap-1">
                <span>Steuerung: <strong>Klick auf Kachel</strong> zum Laufen</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DungeonTestView;
