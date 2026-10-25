
export interface SceneCharacterConfig {
  characterId: string;
  roleInScene?: string;
}

export interface SceneEffect {
  type: 'scene' | 'transition' | 'battle';
  targetId: string;
  action: 'unlock' | 'lock';
}

export interface RelationshipTrigger {
    id: string;
    description: string;
    valueChange: number;
}

export interface RelationshipThreshold {
    id: string;
    label: string;
    valueStart: number;
    description: string;
    roadmapNotes?: string;  // NEU: erzählerischer Leitfaden NUR für diese Stufe
}

export interface RelationshipKeyMoment {
    id: string;
    timestamp: number;
    description: string;   // reason aus relationshipUpdates
    impact: number;        // der change-Wert
    emotionalTone: 'positive' | 'negative' | 'neutral';
    sceneName?: string;
}

export interface RelationshipConfig {
    enabled: boolean;
    currentValue: number;
    startValue: number;
    triggers: RelationshipTrigger[];
    thresholds: RelationshipThreshold[];
    keyMoments?: RelationshipKeyMoment[];
}

export interface WeaponConfig {
    name: string;
    at: number;
    mod: number;
    dmg: number;
    cap: number | null;
}

export interface CombatStats {
    pra: number;
    str: number;
    wid: number;
    ges: number;
    wil: number;
    hp: number;
    maxHp: number;
    limit: number;
    recoveryRate: number;
    weapon: WeaponConfig;
}

export interface CharacterImagePrompts {
    trigger?: string;      // z.B. "lstsprk_elr_bs" (LoRA-Triggerwort)
    face?: string;         // z.B. "red_hair, long_hair, blue_eyes"
    hair?: string;         // z.B. "hair_down" oder "ponytail"
    clothes?: string;      // z.B. "silver_blue_armor, gauntlets"
    bodyType?: string;     // z.B. "athletic, tall" (optional)
    loraFileName?: string;       // Auswahl aus Dropdown (z.B. Dateiname des LoRA-Modells)
    checkpointFileName?: string; // Auswahl aus Dropdown (optional, z.B. Dateiname des Checkpoints)
}

export type CharacterImportance = 'main' | 'side';
export type CharacterAlignment = 'gut' | 'boese' | 'neutral';

export interface Character {
  id: string;
  name: string;
  defaultDescription: string;
  lore?: string;
  aiImagePrompt?: string; // Fallback field for ComfyUI generation
  imagePrompts?: CharacterImagePrompts; // Structured prompt parts
  
  // Categorization & Structure
  importance?: CharacterImportance;
  alignment?: CharacterAlignment;
  
  // Visuals
  rpgColor: string;
  imageSrc: string | null; // Idle / Standard
  emotions?: {
    happy?: string | null;
    angry?: string | null;
    thoughtful?: string | null;
    shy?: string | null;
    sad?: string | null;
    shocked?: string | null;
    worried?: string | null;
    lustful?: string | null;
  };
  mapSpriteSrc: string | null;
  bubbleColor?: string;
  isItalic?: boolean;
  
  // Relationships
  playerRelation?: string;
  relationship?: RelationshipConfig;

  // Combat / RPG Stats
  stats?: CombatStats;
  
  // Battle Visuals
  battleIdleSrc?: string | null;
  battlePrepSrc?: string | null;
  battleHitSrc?: string | null;
  battleIdleScale?: number;
  battleIdleOffsetX?: number;
  battleIdleOffsetY?: number;
  
  battlePrepScale?: number;
  battlePrepOffsetX?: number;
  battlePrepOffsetY?: number;
  
  battleHitScale?: number;
  battleHitOffsetX?: number;
  battleHitOffsetY?: number;
  
  battleScale?: number; // fallback

  // Battle Audio SFX
  sfxWeaponHit?: string | null;
  sfxWeaponMiss?: string | null;
  sfxVoiceHit?: string | null;
  sfxVoiceCrit?: string | null;
  sfxVoiceDeath?: string | null;

  woozySprites?: string[];
  finishSprite?: string | null;
  finishAnimation?: string[];

  // 3D Model Visuals (GLB)
  model3dSrc?: string | null;
  model3dScale?: number;
  model3dOffsetY?: number;
  model3dRotationY?: number;
}

export interface Scene {
  id: string;
  chapterId?: string;
  mapId?: string; // Mapped WorldMap ID
  name: string;
  order?: number; // Order within the chapter
  isMainScene?: boolean; // true = Hauptszene (Story), false = Nebenszene (Optional)
  
  locationName?: string; 
  backgroundSrc: string | null; 
  introVideoSrc?: string | null;
  description: string; 
  aiInstructions?: string; 
  sensoryDetails?: string; 
  environmentDetails?: string;
  
  goal: string; 
  characters: SceneCharacterConfig[];
  effects?: SceneEffect[]; 
  
  mapIconSrc?: string | null; 
  isRepeatable?: boolean;
  bgmUrl?: string;
  
  // NEU: Szenen-spezifisches Lore-Scoping
  relevantFactionIds?: string[];      // IDs aus WorldInfo.factions
  relevantLocationIds?: string[];     // IDs aus WorldInfo.loreLocations
}

export type CharacterEmotion = 'idle' | 'happy' | 'angry' | 'thoughtful' | 'shy' | 'sad' | 'shocked' | 'worried' | 'lustful';

export interface ChatMessage {
  sender: 'user' | 'model' | 'system';
  characterId?: string;
  emotion?: CharacterEmotion;
  text: string;
  timestamp: number;
}

export interface TokenStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AIResponse {
  characterResponses: {
    characterId: string;
    emotion?: CharacterEmotion;
    text: string;
  }[];
  relationshipUpdates?: {
    characterId: string;
    change: number;
    reason: string;
  }[];
  sceneGoalReached: boolean;
  sceneTransitionReason?: string;
  tokenStats?: TokenStats;
}

export interface Faction {
    id: string;
    name: string;
    description: string;
    teaser?: string;
}

export interface WorldLocation {
    id: string;
    name: string;
    description: string;
    teaser?: string;
}

export interface WorldInfo {
  description: string;
  factions: Faction[];
  loreLocations: WorldLocation[];
  systemInstruction?: string;
  diceConfig?: { skins: Record<number, string[]> };
  llmProvider?: 'gemini' | 'ollama' | 'openai';
  llmModel?: string;
  ollamaUrl?: string;
  ollamaNumCtx?: number;
  ollamaTemperature?: number;
  ollamaRepeatPenalty?: number;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  openaiModel?: string;
  comfyUrl?: string;
  comfyEnabled?: boolean;
  comfyWorkflow?: string;
}

export interface Chapter {
  id: string;
  name: string;
  description: string;
  order?: number; // Chronological chapter number / position
}

export interface MapSpot {
  id: string;
  x: number;
  y: number;
  type: 'scene' | 'character' | 'battle' | 'transition';
  sceneId?: string;
  characterId?: string;
  battleId?: string;
  targetMapId?: string;
  visualCharacterId?: string;
}

export interface WorldMap {
  id: string;
  name: string;
  backgroundSrc: string | null;
  bgmUrl?: string;
  spots: MapSpot[];
}

export interface Battle {
  id: string;
  name: string;
  chapterId?: string;
  backgroundSrc: string | null;
  playerCharacterIds: string[];
  enemyCharacterIds: string[];
  isRepeatable: boolean;
  bgmUrl?: string;
  onWinEffect?: SceneEffect[];
}

export interface StoryLogEntry {
    id: string;
    sceneName: string;
    locationName: string;
    charactersInvolved: string[]; // Names
    summary: string;
    timestamp: number;
    importance?: 'critical' | 'major' | 'minor';
    tags?: string[];
    referencedCharacterIds?: string[];
}

export interface RPGState {
    currentMapId: string;
    currentChapterId?: string;
    completedSceneIds: string[];
    completedBattleIds: string[];
    unlockedIds: string[];
    hiddenIds: string[];
    ongoingScenes: Record<string, ChatMessage[]>;
    storyLog: StoryLogEntry[]; // New history field
}

export interface GameState {
  currentSceneIndex: number;
  history: ChatMessage[];
  isProcessing: boolean;
  gameOver: boolean;
  timestamp?: number;
  rpgState?: RPGState;
  vnState?: any;
}

export interface GameSaveData {
    rpgState: RPGState;
    vnState: any | null;
    characterState?: Record<string, Partial<Character>>;
    timestamp: number;
}

export type Zone = 'head' | 'torso' | 'arm' | 'leg';

// ==================== ASSET LIBRARY TYPES ====================
export type AssetCategory = 'maps' | 'scene_bg' | 'characters';

export interface CharacterAssetMeta {
  alignment?: 'gut' | 'neutral' | 'boese' | string;
  species?: 'mensch' | 'furry' | 'anthro' | 'modifiziert' | string;
  gender?: 'maennlich' | 'weiblich' | 'diverse' | string;
  archetype?: 'adel' | 'buerger' | 'arm' | 'ritter' | 'magier' | 'soeldner' | string;
}

export interface LocationAssetMeta {
  environment?: 'indoor' | 'outdoor' | 'dungeon' | string;
  tags: string[];
}

export interface AssetItem {
  id: string;
  name: string;
  category: AssetCategory;
  fileUrl: string | null; // Image/Audio ID or DataURL in IndexedDB
  assetType?: 'image' | 'audio';
  characterMeta?: CharacterAssetMeta;
  locationMeta?: LocationAssetMeta;
  assignedTo?: {
    type: 'character_idle' | 'character_emotion' | 'character_sprite' | 'character_map' | 'scene_bg' | 'map_bg' | 'battle_bg';
    targetId: string;
    targetName?: string;
    emotionName?: string;
  };
  createdAt: number;
}

// ==========================================================================
// 3D Dungeons — the "Build Yourself" GLB sandbox integrated as project data
// (DungeonEditor tab). Exact chunk/figure semantics live in the editor view.
// ==========================================================================

export interface DungeonSection {
  id: string;
  name: string;
}

export type DungeonChunkType = 'floor' | 'wall' | 'door';
export type DungeonNpcKind = 'npc' | 'enemy';

/** One uploaded chunk GLB file, reusable for arbitrarily many placements */
export interface DungeonChunkLibraryEntry {
  id: string;
  type: DungeonChunkType;
  fileName: string;
  fileSize: number;
  dataBase64: string; // Data URL
}

/** One placed chunk copy on the 8m chunk grid (base copies excluded) */
export interface DungeonChunkPlacement {
  id: string;
  type: DungeonChunkType;
  libraryId: string;
  cellX: number;
  cellZ: number;
  rotationY: number; // degrees, multiple of 90
  sectionId?: string; // undefined = root section
  portalId?: string; // paired door instance (section transition)
  pairColorIndex?: number;
}

/** One uploaded character GLB (neutral NPC or enemy), re-placable */
export interface DungeonNpcLibraryEntry {
  id: string;
  kind: DungeonNpcKind;
  fileName: string;
  fileSize: number;
  dataBase64: string; // Data URL
}

/** One placed character standing on a walkable sub-tile */
export interface DungeonNpcPlacement {
  id: string;
  kind: DungeonNpcKind;
  libraryId: string;
  col: number;
  row: number;
  rotationY: number;
  sectionId?: string;
  /** Phase 2: project character bound to this figure (GLB + stats) */
  characterId?: string;
  /** Phase 3: scene id opened when interacting with a neutral figure */
  sceneId?: string;
}

/** Base chunk/character GLB mounted at the grid origin (incl. user config) */
export interface DungeonBaseGLB {
  fileName: string;
  fileSize?: number;
  dataBase64: string;
  scale?: number;
  offsetX?: number;
  offsetY?: number;
  offsetZ?: number;
  rotationY?: number;
  useRawScale?: boolean; // character only
  showLeftWall?: boolean; // wall/door layout toggles
  showUpperWall?: boolean;
  showLeftDoor?: boolean;
  showUpperDoor?: boolean;
}

export interface DungeonProject {
  id: string;
  name: string;
  sections: DungeonSection[]; // first entry is always the root section
  baseFloor?: DungeonBaseGLB | null;
  baseWall?: DungeonBaseGLB | null;
  baseDoor?: DungeonBaseGLB | null;
  baseCharacter?: DungeonBaseGLB | null;
  chunkLibrary: DungeonChunkLibraryEntry[];
  placedChunks: DungeonChunkPlacement[];
  npcLibrary: DungeonNpcLibraryEntry[];
  placedNpcs: DungeonNpcPlacement[];
  createdAt: number;
  updatedAt: number;
}
