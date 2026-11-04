
import React, { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Editor, EditorTab } from './components/Editor';
import { Player } from './components/Player';
import { RPGWorld } from './components/RPGWorld';
import { StoryJournal } from './components/StoryJournal';
import { SettingsOverlay } from './components/SettingsOverlay';
import { DungeonTestView } from './components/DungeonTestView';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { audioManager } from './utils/audioManager';
import { Character, Scene, GameSaveData, RPGState, WorldMap, ChatMessage, WorldInfo, Chapter, StoryLogEntry, AssetItem, DungeonProject } from './types';
import { getItem, setItem } from './utils/db';
import { loadImage, saveImage, listImageIds } from './utils/imageStorage';
import {
  LEGACY_PROJECT_ID, ProjectData, ProjectRegistry, saveGameKey, loadRegistry, saveRegistry, createEntry,
  loadProjectFields, saveProjectFields, deleteProjectFields, hasProjectData, collectMediaRefs, mediaRefsOf, pruneUnusedMedia
} from './utils/projects';
import { Dialog } from './components/ui/Dialog';
import { useI18n, translate } from './utils/i18n';
import JSZip from 'jszip';
import { generateSceneSummary } from './services/geminiService';
import { Loader2 } from 'lucide-react';
import { extractImagesFromProject } from './utils/migrateImages';

// Default Data for quick start
const DEFAULT_CHAPTERS: Chapter[] = [
  {
    id: 'ch1',
    order: 1,
    name: 'Chapter 1',
    description: ''
  }
];

const DEFAULT_SCENES: Scene[] = [];

const DEFAULT_CHARS: Character[] = [];

const DEFAULT_MAPS: WorldMap[] = [
  { id: 'map1', name: 'World Map', backgroundSrc: null, spots: [] }
];

const DEFAULT_WORLD: WorldInfo = { 
    description: "",
    factions: [],
    loreLocations: [],
    systemInstruction: '',
    llmProvider: 'gemini',
    llmModel: 'gemini-3.5-flash',
    ollamaUrl: 'http://localhost:11434',
    ollamaNumCtx: 8192,
    ollamaTemperature: 0.8,
    ollamaRepeatPenalty: 1.1,
    openaiApiKey: '',
    openaiBaseUrl: 'https://openrouter.ai/api/v1',
    openaiModel: 'nous-hermes/llama-3.1-70b',
    comfyUrl: 'http://127.0.0.1:8188',
    comfyEnabled: false,
    comfyWorkflow: ''
};

const PROJECT_STORAGE_KEY = 'vn_creator_project';

function uint8ArrayToBase64DataURLAsync(arr: Uint8Array, mimeType: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([arr], { type: mimeType });
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function dataURLToUint8Array(dataUrl: string): { array: Uint8Array; mimeType: string } | null {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const arr = dataUrl.split(',');
  if (arr.length < 2) return null;
  const mimeMatch = arr[0].match(/:(.*?);/);
  if (!mimeMatch) return null;
  const mimeType = mimeMatch[1];
  try {
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return { array: u8arr, mimeType };
  } catch (err) {
    console.error("Failed to decode base64 in dataURLToUint8Array:", err);
    return null;
  }
}

// Fields of the removed 2D dice battle system. Old projects still load; these
// values are dropped (no conversion into the new BattleStats, section 6).
const LEGACY_COMBAT_FIELDS = [
  'stats', 'battleIdleSrc', 'battlePrepSrc', 'battleHitSrc', 'battleIdleScale', 'battleIdleOffsetX', 'battleIdleOffsetY',
  'battlePrepScale', 'battlePrepOffsetX', 'battlePrepOffsetY', 'battleHitScale', 'battleHitOffsetX', 'battleHitOffsetY',
  'battleScale', 'sfxWeaponHit', 'sfxWeaponMiss', 'sfxVoiceHit', 'sfxVoiceCrit', 'sfxVoiceDeath',
  'woozySprites', 'finishSprite', 'finishAnimation',
];
const stripLegacyCombatFields = (c: any): Character => {
  if (!c || typeof c !== 'object') return c;
  const out = { ...c };
  for (const k of LEGACY_COMBAT_FIELDS) delete out[k];
  return out as Character;
};

const App: React.FC = () => {
  const [mode, setMode] = useState<'edit' | 'rpg' | 'vn' | 'dungeon_test' | 'dungeon_play'>('edit');
  
  // Data State
  const [worldInfo, setWorldInfo] = useState<WorldInfo>(DEFAULT_WORLD);
  const [chapters, setChapters] = useState<Chapter[]>(DEFAULT_CHAPTERS);
  const [characters, setCharacters] = useState<Character[]>(DEFAULT_CHARS);
  const [scenes, setScenes] = useState<Scene[]>(DEFAULT_SCENES);
  const [maps, setMaps] = useState<WorldMap[]>(DEFAULT_MAPS);
  const [dungeonProjects, setDungeonProjects] = useState<DungeonProject[]>([]);
  const [activeDungeonBuildId, setActiveDungeonBuildId] = useState<string | null>(null);
  const [playingDungeonId, setPlayingDungeonId] = useState<string | null>(null);
  const [editorInitialTab, setEditorInitialTab] = useState<EditorTab>('home');
  const [assets, setAssets] = useState<AssetItem[]>([]);
  
  // Game Play State
  const [rpgState, setRpgState] = useState<RPGState>({ 
    currentMapId: 'map1', 
    completedSceneIds: [],
    unlockedIds: [],
    hiddenIds: [],
    ongoingScenes: {},
    storyLog: [], // Init empty log
    dungeonEnemyState: {}
  });
  
  const [activeSceneIndex, setActiveSceneIndex] = useState<number>(-1);
  const [vnHistory, setVnHistory] = useState<ChatMessage[]>([]); 

  const [hasSaveGame, setHasSaveGame] = useState(false);

  // Multi-project state
  const { t } = useI18n();
  const [registry, setRegistry] = useState<ProjectRegistry | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string>(LEGACY_PROJECT_ID);
  const [isReady, setIsReady] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const registryRef = useRef<ProjectRegistry | null>(null);
  const activeIdRef = useRef<string>(LEGACY_PROJECT_ID);
  const readyRef = useRef(false);
  const busyRef = useRef(false);
  const initStartedRef = useRef(false);
  const touchRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPruneRef = useRef<Set<string>>(new Set());
  const prevCoverRef = useRef<{ id: string; cover: string | null } | null>(null);
  const appliedRef = useRef<any>(null);
  const stateRef = useRef<any>({});
  const modeRef = useRef<string>('edit');
  
  // New States for Journal and Loading
  const [showJournal, setShowJournal] = useState(false);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // Background Music State
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentBgmUrl, setCurrentBgmUrl] = useState<string | undefined>(undefined);

  // Always-current snapshot for async persistence code
  stateRef.current = { worldInfo, chapters, characters, scenes, maps, assets, dungeonProjects };
  modeRef.current = mode;

  // Background Music Volume Sync
  useEffect(() => {
    if (audioRef.current) {
        audioRef.current.volume = audioManager.bgmVolume;
    }
    const handleVolumeChange = (e: any) => {
        if (audioRef.current && e.detail !== undefined) {
            audioRef.current.volume = e.detail;
        }
    };
    window.addEventListener('bgmVolumeChanged', handleVolumeChange);
    return () => window.removeEventListener('bgmVolumeChanged', handleVolumeChange);
  }, []);

  // ---------------------------------------------------------------------------
  // Multi-project persistence
  // ---------------------------------------------------------------------------
  const normalizeData = (data: ProjectData): Required<Pick<ProjectData, 'chapters' | 'characters' | 'scenes' | 'maps' | 'assets' | 'dungeonProjects'>> & { worldInfo: WorldInfo } => {
    const w = data.worldInfo || {};
    // Legacy fields of the old dice battle system are dropped (diceConfig)
    const { diceConfig: _legacyDice, ...wRest } = w as any;
    const worldInfo: WorldInfo = {
      ...DEFAULT_WORLD,
      ...wRest,
      description: w.description || '',
      factions: w.factions || [],
      loreLocations: w.loreLocations || [],
      systemInstruction: w.systemInstruction || '',
      llmProvider: w.llmProvider || 'gemini',
      llmModel: w.llmModel || 'gemini-3.5-flash',
      ollamaUrl: w.ollamaUrl || 'http://localhost:11434',
      ollamaNumCtx: w.ollamaNumCtx ?? 8192,
      ollamaTemperature: w.ollamaTemperature ?? 0.8,
      ollamaRepeatPenalty: w.ollamaRepeatPenalty ?? 1.1,
      openaiApiKey: w.openaiApiKey ?? '',
      openaiBaseUrl: w.openaiBaseUrl ?? 'https://openrouter.ai/api/v1',
      openaiModel: w.openaiModel ?? '',
      comfyUrl: w.comfyUrl || 'http://127.0.0.1:8188',
      comfyEnabled: !!w.comfyEnabled,
      comfyWorkflow: w.comfyWorkflow || ''
    };

    const chapters: Chapter[] = data.chapters && data.chapters.length > 0
      ? data.chapters.map((c: any, index: number) => ({ ...c, order: c.order ?? index + 1 }))
      : structuredClone(DEFAULT_CHAPTERS);
    const firstChapterId = chapters[0].id;

    const scenes: Scene[] = (data.scenes || []).map((s: any, index: number) => ({
      ...s,
      chapterId: s.chapterId || firstChapterId,
      order: s.order ?? index + 1,
      isMainScene: s.isMainScene ?? true,
      effects: s.effects || s.unlocks || [],
      isRepeatable: s.isRepeatable || false,
      locationName: s.locationName || s.name || 'Unknown Location',
      aiInstructions: s.aiInstructions || '',
      sensoryDetails: s.sensoryDetails || '',
      environmentDetails: s.environmentDetails || '',
      relevantFactionIds: s.relevantFactionIds ?? undefined,
      relevantLocationIds: s.relevantLocationIds ?? undefined,
    }));


    let maps: WorldMap[];
    if (data.maps && data.maps.length > 0) maps = data.maps;
    else if (data.mapConfig) maps = [{ ...data.mapConfig, id: 'map1', name: 'Default Map' }];
    else maps = structuredClone(DEFAULT_MAPS);
    // Old 2D battle spots are removed (the battle system now lives in the dungeons)
    maps = maps.map(m => ({
      ...m,
      spots: (m.spots || []).filter((sp: any) => sp.type !== 'battle').map(({ battleId: _b, ...sp }: any) => sp),
    }));
    // Old battle unlock effects are dropped
    for (const sc of scenes) sc.effects = (sc.effects || []).filter((e: any) => e.type !== 'battle');
    // Old combat fields on characters are ignored (no conversion, section 6)
    const characters = (data.characters || []).map(stripLegacyCombatFields);

    return {
      worldInfo,
      chapters,
      characters,
      scenes,
      maps,
      assets: data.assets || [],
      dungeonProjects: data.dungeonProjects || [],
    };
  };

  /** Puts a normalized project into React state (and remembers it as the "unchanged" snapshot for autosave) */
  const applyData = (norm: ReturnType<typeof normalizeData>, savedGame: GameSaveData | null) => {
    const characters = savedGame?.characterState
      ? norm.characters.map(c => {
          const st = savedGame.characterState?.[c.id];
          return st ? { ...c, ...st } : c;
        })
      : norm.characters;
    const snapshot = { ...norm, characters };
    appliedRef.current = snapshot;
    stateRef.current = snapshot;
    prevCoverRef.current = { id: activeIdRef.current, cover: norm.worldInfo.projectMeta?.coverImageId ?? null };
    setWorldInfo(snapshot.worldInfo);
    setChapters(snapshot.chapters);
    setCharacters(snapshot.characters);
    setScenes(snapshot.scenes);
    setMaps(snapshot.maps);
    setAssets(snapshot.assets);
    setDungeonProjects(snapshot.dungeonProjects);
    // leave any running game session behind
    setRpgState({
      currentMapId: snapshot.maps[0]?.id || 'map1',
      completedSceneIds: [], unlockedIds: [], hiddenIds: [], ongoingScenes: {}, storyLog: [], dungeonEnemyState: {}
    });
    setVnHistory([]);
    setActiveSceneIndex(-1);
    setMode('edit');
  };

  const updateRegistry = async (fn: (reg: ProjectRegistry) => ProjectRegistry) => {
    const next = fn(registryRef.current!);
    registryRef.current = next;
    setRegistry(next);
    await saveRegistry(next);
  };

  /** Persists the open project right now (debounced autosave and all project switches go through here) */
  const flushSave = async () => {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    if (!readyRef.current || !registryRef.current) return;
    const id = activeIdRef.current;
    const d = stateRef.current;
    const touch = touchRef.current;
    touchRef.current = false;
    await saveProjectFields(id, d);
    const meta = d.worldInfo?.projectMeta;
    await updateRegistry(reg => ({
      ...reg,
      projects: reg.projects.map(p => p.id === id
        ? { ...p, title: meta?.title ?? '', coverImageId: meta?.coverImageId ?? null, updatedAt: touch ? Date.now() : p.updatedAt }
        : p),
    }));
    if (pendingPruneRef.current.size > 0) {
      const candidates = pendingPruneRef.current;
      pendingPruneRef.current = new Set();
      await pruneUnusedMedia(candidates);
    }
  };

  const loadIntoState = async (id: string) => {
    const data = await loadProjectFields(id);
    const savedGame = await getItem<GameSaveData>(saveGameKey(id));
    activeIdRef.current = id;
    setActiveProjectId(id);
    applyData(normalizeData(data), savedGame || null);
    setHasSaveGame(!!savedGame);
    setEditorInitialTab('home');
  };

  /** Runs a project switch/create/delete with autosave paused so nothing is written into the wrong project */
  const transition = async (fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      await flushSave();
      readyRef.current = false;
      await fn();
    } catch (e) {
      console.error('Project operation failed', e);
    } finally {
      readyRef.current = true;
      busyRef.current = false;
    }
  };

  const handleSelectProject = (id: string) => {
    if (id === activeIdRef.current) return;
    transition(async () => {
      await loadIntoState(id);
      await updateRegistry(reg => ({ ...reg, activeId: id }));
    });
  };

  const handleCreateProject = () => {
    transition(async () => {
      const id = crypto.randomUUID();
      const norm = normalizeData({});
      await saveProjectFields(id, norm);
      await updateRegistry(reg => ({ activeId: id, projects: [...reg.projects, createEntry(id)] }));
      activeIdRef.current = id;
      setActiveProjectId(id);
      applyData(norm, null);
      setHasSaveGame(false);
      setEditorInitialTab('home');
    });
  };

  const handleDeleteProject = () => {
    setShowDeleteDialog(false);
    transition(async () => {
      const id = activeIdRef.current;
      const reg = registryRef.current!;
      const known = new Set(await listImageIds());
      const refs = collectMediaRefs(stateRef.current, known);
      const idx = reg.projects.findIndex(p => p.id === id);
      await deleteProjectFields(id);
      const remaining = reg.projects.filter(p => p.id !== id);
      if (remaining.length > 0) {
        const next = remaining[Math.min(idx, remaining.length - 1)];
        await updateRegistry(() => ({ activeId: next.id, projects: remaining }));
        await loadIntoState(next.id);
      } else {
        // last project deleted: start over with an empty one
        const newId = crypto.randomUUID();
        const norm = normalizeData({});
        await saveProjectFields(newId, norm);
        await updateRegistry(() => ({ activeId: newId, projects: [createEntry(newId)] }));
        activeIdRef.current = newId;
        setActiveProjectId(newId);
        applyData(norm, null);
        setHasSaveGame(false);
        setEditorInitialTab('home');
      }
      await pruneUnusedMedia(refs);
    });
  };

  // Load registry + active project on mount (legacy single-project data becomes project "main")
  useEffect(() => {
    if (initStartedRef.current) return;
    initStartedRef.current = true;
    const initLoad = async () => {
        let reg = await loadRegistry();
        let id: string;
        let data: ProjectData = {};

        if (reg) {
            id = reg.projects.some(p => p.id === reg!.activeId) ? reg.activeId : reg.projects[0].id;
            data = await loadProjectFields(id);
        } else {
            // First start with multi-project support: adopt whatever the single-project version stored
            id = LEGACY_PROJECT_ID;
            try {
                data = await loadProjectFields(id);
            } catch (e) {
                console.error("IDB load project error", e);
            }
            if (!hasProjectData(data)) {
                const lsProject = localStorage.getItem(PROJECT_STORAGE_KEY);
                const legacyData = await getItem<ProjectData>(PROJECT_STORAGE_KEY); // old keyval store
                if (lsProject || legacyData) {
                    try { data = legacyData || JSON.parse(lsProject!); } catch (e) {}
                }
            }
        }

        // Media extraction migration (old projects embedded base64 data)
        const migrated = await getItem('mediaExtracted');
        if (!migrated) {
            if (hasProjectData(data)) {
                setIsProcessing(true);
                try {
                    await setItem(`project_backup_${Date.now()}`, data);
                    data = await extractImagesFromProject(data);
                    await saveProjectFields(id, data);
                } catch (e) {
                    console.error("Migration failed", e);
                } finally {
                    setIsProcessing(false);
                }
            }
            await setItem('mediaExtracted', true);
        }

        const norm = normalizeData(data);
        if (!reg) {
            const entry = createEntry(id, norm.worldInfo.projectMeta?.title ?? '');
            entry.coverImageId = norm.worldInfo.projectMeta?.coverImageId ?? null;
            if (norm.worldInfo.projectMeta?.lastEdited) entry.updatedAt = norm.worldInfo.projectMeta.lastEdited;
            reg = { activeId: id, projects: [entry] };
            await saveRegistry(reg);
        }
        registryRef.current = reg;
        setRegistry(reg);

        const savedGame = await getItem<GameSaveData>(saveGameKey(id));
        activeIdRef.current = id;
        setActiveProjectId(id);
        applyData(norm, savedGame || null);
        setHasSaveGame(!!savedGame);
        readyRef.current = true;
        setIsReady(true);
    };
    initLoad().catch(e => console.error('Init failed', e));
  }, []);

  // Autosave (debounced) whenever project data changes
  useEffect(() => {
    if (!readyRef.current) return;
    const s = stateRef.current;
    const a = appliedRef.current;
    if (a && a.worldInfo === s.worldInfo && a.chapters === s.chapters && a.characters === s.characters && a.scenes === s.scenes
        && a.maps === s.maps && a.assets === s.assets && a.dungeonProjects === s.dungeonProjects) return;
    const cover = s.worldInfo?.projectMeta?.coverImageId ?? null;
    const prev = prevCoverRef.current;
    if (prev && prev.id === activeIdRef.current && prev.cover && prev.cover !== cover) pendingPruneRef.current.add(prev.cover);
    prevCoverRef.current = { id: activeIdRef.current, cover };
    if (modeRef.current === 'edit') touchRef.current = true;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { flushSave().catch(console.error); }, 500);
  }, [worldInfo, chapters, characters, scenes, maps, assets, dungeonProjects]);

  // Don't lose the last edits when the tab is hidden or closed
  useEffect(() => {
    const flush = () => { flushSave().catch(() => {}); };
    const onVis = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVis);
    return () => { window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  const handleQuickSave = async () => {
    touchRef.current = true;
    await flushSave();
    return true;
  };

  const handleExportProject = async (includeMedia: boolean = true) => {
    setIsProcessing(true);
    try {
      const data = { worldInfo, chapters, characters, scenes, maps, dungeonProjects, assets };
      // Only media that this project actually references (the shared store may hold other projects' files)
      const ownMedia = await mediaRefsOf(data);
      
      const zip = new JSZip();
      zip.file("project.json", JSON.stringify(data, null, 2));

      if (includeMedia) {
        // Include all media in binary form to save memory and avoid RangeError
        const imagesFolder = zip.folder("images");
        const videosFolder = zip.folder("videos");
        const audioFolder = zip.folder("audio");

        if (imagesFolder && videosFolder && audioFolder) {
          const imageIds = Array.from(ownMedia);
          
          for (const id of imageIds) {
            const base64 = await loadImage(id);
            if (base64) {
              const binaryData = dataURLToUint8Array(base64);
              if (binaryData) {
                const { array, mimeType } = binaryData;
                // Encode MIME type in filename to decode on import
                const safeMime = mimeType.replace('/', '_');
                const filename = `${id}___${safeMime}.bin`;

                if (base64.startsWith('data:video/')) {
                   videosFolder.file(filename, array);
                } else if (base64.startsWith('data:audio/')) {
                   audioFolder.file(filename, array);
                } else {
                   imagesFolder.file(filename, array);
                }
              } else {
                // If it's not a data URL, fallback to saving it as a text file
                if (base64.startsWith('data:video/')) {
                   videosFolder.file(`${id}.txt`, base64);
                } else if (base64.startsWith('data:audio/')) {
                   audioFolder.file(`${id}.txt`, base64);
                } else {
                   imagesFolder.file(`${id}.txt`, base64);
                }
              }
            }
          }
        }
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      const href = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = href;
      const mediaSuffix = includeMedia ? "" : "-light";
      const slug = (worldInfo.projectMeta?.title || '').trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';
      link.download = `vn-${slug}-${new Date().toISOString().slice(0,10)}${mediaSuffix}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(href);
    } catch (e) {
      console.error("Failed to export project: ", e);
      alert("Failed to export project due to memory limits. Try exporting 'Light (nur Daten)' instead.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExportSave = async () => {
      const savedGame = await getItem<GameSaveData>(saveGameKey(activeIdRef.current));
      if (!savedGame) {
          alert("No save game found!");
          return;
      }
      const jsonString = JSON.stringify(savedGame, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const href = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = href;
      link.download = `vn-savegame-${new Date().toISOString().slice(0,10)}.save.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(href);
  };

  const handleImportSave = (file: File) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
            const content = e.target?.result as string;
            const data = JSON.parse(content) as GameSaveData;
            if (data.rpgState) {
                await setItem(saveGameKey(activeIdRef.current), data);
                setHasSaveGame(true);
                alert("Save Game imported successfully! Click 'Continue' to play.");
            } else {
                throw new Error("Invalid Save Data format.");
            }
        } catch(error) {
            console.error("Save Import failed", error);
            alert("Failed to load save file. Invalid or corrupt save game.");
        }
      }
      reader.readAsText(file);
  };

  const parseProjectFile = async (file: File): Promise<any> => {
      let data: any = null;

      if (file.name.endsWith('.zip')) {
        const zip = new JSZip();
        const unzipped = await zip.loadAsync(file);
        
        // Extract project.json
        const projectFile = unzipped.file("project.json");
        if (!projectFile) throw new Error("project.json not found in ZIP.");
        const content = await projectFile.async("text");
        data = JSON.parse(content);

        // Extract media files reliably from any path in zip
        const mediaPromises: Promise<void>[] = [];
        let mediaCount = 0;

        for (const zipPath of Object.keys(unzipped.files)) {
          const zipObj = unzipped.files[zipPath];
          if (zipObj.dir) continue;
          
          // Strip any parent directory paths to get pure filename
          const filename = zipPath.split('/').pop();
          if (!filename || filename === 'project.json') continue;

          if (filename.endsWith('.txt')) {
            // Legacy base64 text file
            const id = filename.replace('.txt', '');
            mediaPromises.push(
              zipObj.async("text").then(async base64 => {
                if (base64 && base64.trim().length > 0) {
                  await saveImage(id, base64.trim());
                  mediaCount++;
                }
              }).catch(err => console.error("Error importing text file:", filename, err))
            );
          } else if (filename.includes('___') && filename.endsWith('.bin')) {
            // New binary file: id___safeMime.bin
            const baseName = filename.substring(0, filename.length - 4); // strip .bin
            const parts = baseName.split('___');
            if (parts.length >= 2) {
              const id = parts[0];
              const mimeType = parts[1].replace('_', '/');
              mediaPromises.push(
                zipObj.async("uint8array").then(async arr => {
                  if (arr && arr.length > 0) {
                    const base64 = await uint8ArrayToBase64DataURLAsync(arr, mimeType);
                    await saveImage(id, base64);
                    mediaCount++;
                  }
                }).catch(err => console.error("Error importing binary media file:", filename, err))
              );
            }
          } else {
            // Standard media extensions (e.g. uuid.png, uuid.jpg, etc.)
            const extMatch = filename.match(/\.(png|jpg|jpeg|webp|gif|mp4|webm|mp3|wav|ogg)$/i);
            if (extMatch) {
              const ext = extMatch[1].toLowerCase();
              const id = filename.substring(0, filename.lastIndexOf('.'));
              let mimeType = 'image/png';
              if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
              else if (ext === 'webp') mimeType = 'image/webp';
              else if (ext === 'gif') mimeType = 'image/gif';
              else if (ext === 'mp4') mimeType = 'video/mp4';
              else if (ext === 'webm') mimeType = 'video/webm';
              else if (ext === 'mp3') mimeType = 'audio/mp3';
              else if (ext === 'wav') mimeType = 'audio/wav';
              else if (ext === 'ogg') mimeType = 'audio/ogg';

              mediaPromises.push(
                zipObj.async("uint8array").then(async arr => {
                  if (arr && arr.length > 0) {
                    const base64 = await uint8ArrayToBase64DataURLAsync(arr, mimeType);
                    await saveImage(id, base64);
                    mediaCount++;
                  }
                }).catch(err => console.error("Error importing standard media file:", filename, err))
              );
            }
          }
        }

        await Promise.all(mediaPromises);
        console.log(`Successfully imported ${mediaCount} media files into IndexedDB.`);
      } else {
        // Fallback for legacy JSON imports
        const content = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.onerror = reject;
          reader.readAsText(file);
        });
        data = JSON.parse(content);
      }
    return data;
  };

  /** Writes a normalized project into the active project (replace) or into a brand-new one */
  const runImport = async (file: File, mode: 'replace' | 'new') => {
    setIsProcessing(true);
    try {
      await flushSave();
    } catch (e) { console.error(e); }
    readyRef.current = false;
    try {
      let raw = await parseProjectFile(file);
      raw = await extractImagesFromProject(raw);
      await setItem('mediaExtracted', true);
      const norm = normalizeData(raw);
      const fileTitle = file.name.replace(/\.(zip|json)$/i, '');

      if (mode === 'replace') {
        const id = activeIdRef.current;
        const known = new Set(await listImageIds());
        const oldRefs = collectMediaRefs(stateRef.current, known);
        // A file without project details keeps the details of the open project
        if (!norm.worldInfo.projectMeta) norm.worldInfo.projectMeta = stateRef.current.worldInfo.projectMeta;
        await saveProjectFields(id, norm);
        applyData(norm, null);
        const meta = norm.worldInfo.projectMeta;
        await updateRegistry(reg => ({
          ...reg,
          projects: reg.projects.map(p => p.id === id ? { ...p, title: meta?.title ?? '', coverImageId: meta?.coverImageId ?? null, updatedAt: Date.now() } : p),
        }));
        await pruneUnusedMedia(oldRefs);
      } else {
        const id = crypto.randomUUID();
        const meta = norm.worldInfo.projectMeta ?? { title: '' };
        if (!meta.title?.trim()) meta.title = fileTitle;
        norm.worldInfo.projectMeta = meta;
        await saveProjectFields(id, norm);
        const entry = { ...createEntry(id, meta.title), coverImageId: meta.coverImageId ?? null };
        await updateRegistry(reg => ({ activeId: id, projects: [...reg.projects, entry] }));
        activeIdRef.current = id;
        setActiveProjectId(id);
        applyData(norm, null);
        setHasSaveGame(false);
        setEditorInitialTab('home');
      }
      alert(translate('project.import.done'));
    } catch (error) {
      console.error("Import failed", error);
      alert(translate('project.import.failed'));
    } finally {
      readyRef.current = true;
      setIsProcessing(false);
    }
  };

  // Import always asks first: overwrite the open project or create a new one
  const handleImportProject = (file: File) => setImportFile(file);

  const handleStartNewGame = () => {
    // Reset Relationship Values to startValue and reset keyMoments for a new game
    const resetChars = characters.map(c => {
        if (c.relationship) {
            return { 
                ...c, 
                relationship: { 
                    ...c.relationship, 
                    currentValue: c.relationship.startValue,
                    keyMoments: []  // NEU: Auch keyMoments zurücksetzen
                } 
            };
        }
        return c;
    });
    setCharacters(resetChars);

    // Default start at first chapter (sorted chronologically)
    const sortedChaps = [...chapters].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const firstChapter = sortedChaps[0];
    const firstChapterId = firstChapter?.id || chapters[0]?.id || 'ch1';

    // Find the first scene in the first chapter
    const firstChapterScenes = scenes
        .filter(s => s.chapterId === firstChapterId)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const firstScene = firstChapterScenes[0];

    // Determine initial map mapped to the first scene in the first chapter
    let initialMapId = maps[0]?.id || 'map1';
    if (firstScene) {
        if (firstScene.mapId && maps.some(m => m.id === firstScene.mapId)) {
            initialMapId = firstScene.mapId;
        } else {
            const mapWithSceneSpot = maps.find(m => m.spots?.some(spot => spot.type === 'scene' && spot.sceneId === firstScene.id));
            if (mapWithSceneSpot) {
                initialMapId = mapWithSceneSpot.id;
            }
        }
    }

    setRpgState({ 
        currentChapterId: firstChapterId,
        currentMapId: initialMapId, 
        completedSceneIds: [], 
        unlockedIds: [],
        hiddenIds: [],
        ongoingScenes: {},
        storyLog: [],
        dungeonEnemyState: {}
    });
    setVnHistory([]);
    setActiveSceneIndex(-1);
    setMode('rpg');
  };

  const handleContinueGame = async () => {
    let savedGame = await getItem<GameSaveData>(saveGameKey(activeIdRef.current));
    if (savedGame) {
      try {
        const safeMapId = maps.find(m => m.id === savedGame!.rpgState.currentMapId) ? savedGame!.rpgState.currentMapId : maps[0].id;
        
        setRpgState({ 
            ...savedGame.rpgState, 
            currentMapId: safeMapId,
            dungeonEnemyState: savedGame.rpgState.dungeonEnemyState || {},
            unlockedIds: savedGame.rpgState.unlockedIds || [], 
            hiddenIds: savedGame.rpgState.hiddenIds || [], 
            ongoingScenes: savedGame.rpgState.ongoingScenes || {},
            storyLog: savedGame.rpgState.storyLog || []
        });

        // Apply saved character state (relationships)
        if (savedGame.characterState) {
            setCharacters(prevChars => prevChars.map(c => {
                const savedState = savedGame.characterState?.[c.id];
                // Deep merge relationship status
                if (savedState) return { ...c, ...savedState };
                return c;
            }));
        }
        
        if (savedGame.vnState) {
          setActiveSceneIndex(savedGame.vnState.currentSceneIndex);
          setVnHistory(savedGame.vnState.history);
          setMode('vn');
        } else {
          setMode('rpg');
        }
      } catch (e) {
        console.error("Corrupt save file");
        handleStartNewGame();
      }
    }
  };

  const handleSaveGameInternal = async (updatedRpgState: RPGState, vnState: any | null) => {
      // Create a map of character updates (mainly for relationships) to save
      const charStateMap: Record<string, Partial<Character>> = {};
      characters.forEach(c => {
          if (c.relationship) {
              charStateMap[c.id] = { relationship: c.relationship };
          }
      });

      const saveData: GameSaveData = {
        rpgState: updatedRpgState,
        vnState: vnState,
        characterState: charStateMap,
        timestamp: Date.now()
      };
      await setItem(saveGameKey(activeIdRef.current), saveData);
      setHasSaveGame(true);
      return true;
  };

  const handleInteraction = (type: 'scene'|'transition'|'character'|'dungeon', id: string) => {
      // Check if locked/hidden first
      if (rpgState.hiddenIds.includes(id)) return;

      if (type === 'transition') {
          if (maps.find(m => m.id === id)) {
              setRpgState(prev => ({ ...prev, currentMapId: id }));
          }
      } else if (type === 'character') {
          const charId = id;
          const char = characters.find(c => c.id === charId);
          if (!char) return;

          const availableScenes = scenes.filter(s => s.characters.some(c => c.characterId === charId));
          
          const playableScene = availableScenes.find(s => {
              // Check visibility/lock logic strictly
              const isCompleted = rpgState.completedSceneIds.includes(s.id);
              if (isCompleted && !s.isRepeatable) return false;
              if (rpgState.hiddenIds.includes(s.id)) return false;
              
              const isLockedByOthers = scenes.some(other => other.effects?.some(u => u.type === 'scene' && u.targetId === s.id && u.action === 'unlock'));
              const isUnlocked = rpgState.unlockedIds.includes(s.id);

              return !isLockedByOthers || isUnlocked;
          });

          if (playableScene) {
             startScene(playableScene);
          } else {
             alert(`${char.name} has nothing new to say right now.`);
          }

      } else if (type === 'dungeon') {
         // Phase 3: dungeon entrance on the world map
         const dungeon = dungeonProjects.find(d => d.id === id);
         if (dungeon) {
             setPlayingDungeonId(dungeon.id);
             setMode('dungeon_play');
         }
      } else {
          const scene = scenes.find(s => s.id === id);
          if (scene) startScene(scene);
      }
  };

  const startScene = (scene: Scene) => {
      const realIndex = scenes.findIndex(s => s.id === scene.id);
      setActiveSceneIndex(realIndex);
      
      const existingHistory = rpgState.ongoingScenes?.[scene.id] || [];
      setVnHistory(existingHistory);
      
      setMode('vn');
  };

  const handleSceneExit = async (completed: boolean, history: ChatMessage[]) => {
      const activeScene = scenes[activeSceneIndex];
      const sceneId = activeScene.id;
      
      let newState = { ...rpgState };

      if (completed) {
          // --- SUMMARY GENERATION ---
          setGeneratingSummary(true);
          // Only generate summary if it's the first completion OR repeatable?
          // Let's generate every time for now to keep a log of repeat visits.
          const summaryRes = await generateSceneSummary(activeScene, characters, history, worldInfo);
          
          const newEntry: StoryLogEntry = {
              id: crypto.randomUUID(),
              sceneName: activeScene.name,
              locationName: activeScene.locationName || 'Unknown',
              charactersInvolved: activeScene.characters.map(sc => characters.find(c => c.id === sc.characterId)?.name || '?'),
              summary: summaryRes.summary || "Summary generation failed.",
              importance: summaryRes.importance || 'major',
              tags: summaryRes.tags || [],
              referencedCharacterIds: summaryRes.referencedCharacterIds || [],
              timestamp: Date.now()
          };
          
          setGeneratingSummary(false);

          const newCompletedIds = [...rpgState.completedSceneIds];
          if (!newCompletedIds.includes(sceneId)) newCompletedIds.push(sceneId);
          
          const { [sceneId]: _, ...remainingScenes } = newState.ongoingScenes || {};
          
          const newUnlockedIds = [...rpgState.unlockedIds];
          const newHiddenIds = [...rpgState.hiddenIds];

          if (activeScene.effects) {
              activeScene.effects.forEach(effect => {
                  const targetId = effect.targetId;
                  const action = effect.action || 'unlock'; 

                  if (action === 'unlock') {
                      if (!newUnlockedIds.includes(targetId)) newUnlockedIds.push(targetId);
                      const hideIdx = newHiddenIds.indexOf(targetId);
                      if (hideIdx > -1) newHiddenIds.splice(hideIdx, 1);
                  } else if (action === 'lock') {
                      if (!newHiddenIds.includes(targetId)) newHiddenIds.push(targetId);
                  }
              });
          }

          // Append to log without overwriting
          const newStoryLog = [...(rpgState.storyLog || []), newEntry];

          newState = { 
              ...newState, 
              completedSceneIds: newCompletedIds,
              unlockedIds: newUnlockedIds,
              hiddenIds: newHiddenIds,
              ongoingScenes: remainingScenes,
              storyLog: newStoryLog
          };

      } else {
          newState = {
              ...newState,
              ongoingScenes: { ...newState.ongoingScenes, [sceneId]: history }
          };
      }
      
      setRpgState(newState);
      await handleSaveGameInternal(newState, null);
      setMode('rpg');
  };

  const handleUpdateJournal = (entryId: string, newSummary: string) => {
      const updatedLog = rpgState.storyLog.map(entry => 
          entry.id === entryId ? { ...entry, summary: newSummary } : entry
      );
      setRpgState(prev => ({ ...prev, storyLog: updatedLog }));
      // Auto-save changes
      handleSaveGameInternal({ ...rpgState, storyLog: updatedLog }, null);
  };

  const activeMap = maps.find(m => m.id === rpgState.currentMapId) || maps[0];

  // Background Music Logic
  useEffect(() => {
    let targetBgm: string | undefined = undefined;

    if (mode === 'rpg') {
        targetBgm = activeMap?.bgmUrl;
    } else if (mode === 'vn' && activeSceneIndex >= 0) {
        targetBgm = scenes[activeSceneIndex]?.bgmUrl || activeMap?.bgmUrl;
    }

    console.log(`BGM Logic - mode: ${mode}, currentBgmUrl: ${currentBgmUrl}, targetBgm: ${targetBgm}`);

    if (targetBgm && targetBgm !== currentBgmUrl && mode !== 'edit') {
        setCurrentBgmUrl(targetBgm);
    } else if (!targetBgm && currentBgmUrl && mode !== 'edit') {
        setCurrentBgmUrl(undefined);
    } else if (mode === 'edit' && currentBgmUrl) {
        setCurrentBgmUrl(undefined);
    }
  }, [mode, activeMap, activeSceneIndex, scenes, currentBgmUrl]);

  const currentResolvedBgm = useRef<string | null>(null);

  useEffect(() => {
      let isMounted = true;
      if (!audioRef.current) return;
      console.log('Audio useEffect triggered, currentBgmUrl:', currentBgmUrl);
      if (currentBgmUrl) {
          loadImage(currentBgmUrl).then(resolvedUrl => {
              if (isMounted && audioRef.current) {
                  if (currentResolvedBgm.current !== resolvedUrl) {
                      console.log('Setting audio src to resolved URL and playing');
                      currentResolvedBgm.current = resolvedUrl;
                      audioRef.current.src = resolvedUrl || '';
                      audioRef.current.play().catch(e => console.log('Audio autoplay blocked', e));
                  } else {
                      console.log('Audio URL resolved to identical source, skipping restart.');
                  }
              }
          });
      } else {
          console.log('Pausing audio and clearing src');
          currentResolvedBgm.current = null;
          audioRef.current.pause();
          audioRef.current.src = '';
      }
      return () => { isMounted = false; };
  }, [currentBgmUrl]);

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 font-sans selection:bg-emerald-500 selection:text-white">
      {/* BACKGROUND AUDIO PLAYER */}
      <audio ref={audioRef} loop className="hidden" />

      {/* PROCESSING OVERLAY */}
      {isProcessing && (
          <div className="fixed inset-0 z-[200] bg-black/90 flex flex-col items-center justify-center pointer-events-none">
              <Loader2 size={48} className="animate-spin text-emerald-500 mb-4" />
              <h2 className="text-xl font-bold text-white tracking-widest animate-pulse">PROCESSING DATA...</h2>
              <p className="text-sm text-gray-400 mt-2">Compressing or unpacking project files, please wait.</p>
          </div>
      )}

      {/* LOADING OVERLAY FOR SUMMARY GENERATION */}
      {generatingSummary && (
          <div className="fixed inset-0 z-[200] bg-black/90 flex flex-col items-center justify-center pointer-events-none">
              <Loader2 size={48} className="animate-spin text-emerald-500 mb-4" />
              <h2 className="text-xl font-bold text-white tracking-widest animate-pulse">WRITING STORY LOG...</h2>
              <p className="text-sm text-gray-400 mt-2">The Chronicler is recording your deeds.</p>
          </div>
      )}

      {/* STORY JOURNAL OVERLAY */}
      {showJournal && (
          <StoryJournal 
              entries={rpgState.storyLog || []}
              onClose={() => setShowJournal(false)}
              onUpdateEntry={handleUpdateJournal}
          />
      )}

      {/* Audio settings live in Editor > Settings; the floating gear stays only in game modes */}
      {mode !== 'edit' && mode !== 'dungeon_test' && <SettingsOverlay />}

      <AnimatePresence mode="wait">
        {mode === 'edit' && (
          <motion.div 
            className="w-full min-h-screen"
            key="edit"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
          >
            <Editor 
              worldInfo={worldInfo}
              chapters={chapters}
              characters={characters}
              scenes={scenes}
              maps={maps}
              assets={assets}
              storyLog={rpgState.storyLog} // PASS STORY LOG TO EDITOR
              onUpdateWorldInfo={setWorldInfo}
              onUpdateChapters={setChapters}
              onUpdateCharacters={setCharacters}
              onUpdateScenes={setScenes}
              onUpdateMaps={setMaps}
              dungeonProjects={dungeonProjects}
              onUpdateDungeonProjects={setDungeonProjects}
              onUpdateAssets={setAssets}
              onPlay={handleStartNewGame}
              onQuickSave={handleQuickSave}
              onExportProject={handleExportProject}
              onImportProject={handleImportProject}
              onExportSave={handleExportSave}
              onImportSave={handleImportSave}
              hasSaveGame={hasSaveGame}
              onContinueGame={handleContinueGame}
              onBuildDungeon={(id) => { setActiveDungeonBuildId(id); setEditorInitialTab('dungeons'); setMode('dungeon_test'); }}
              initialTab={editorInitialTab}
              projects={(registry?.projects ?? []).map(p => ({ id: p.id, title: p.title, coverImageId: p.coverImageId }))}
              activeProjectId={activeProjectId}
              lastEdited={registry?.projects.find(p => p.id === activeProjectId)?.updatedAt}
              onSelectProject={handleSelectProject}
              onCreateProject={handleCreateProject}
              onDeleteProject={() => setShowDeleteDialog(true)}
            />
          </motion.div>
        )}

        {mode === 'rpg' && (
          <motion.div 
            className="w-full h-screen"
            key={`rpg-${activeMap?.id}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
          >
            <RPGWorld 
              characters={characters}
              mapConfig={activeMap}
              maps={maps}
              scenes={scenes}
              dungeons={dungeonProjects}
              initialState={rpgState}
              onInteraction={handleInteraction}
              onSave={async (updatedRpgState) => {
                 setRpgState(updatedRpgState);
                 await handleSaveGameInternal(updatedRpgState, null);
                 alert("Game Saved!");
              }}
              onExit={() => setMode('edit')}
              onOpenJournal={() => setShowJournal(true)}
            />
          </motion.div>
        )}

        {mode === 'vn' && activeSceneIndex >= 0 && (
          <motion.div 
             className="w-full h-screen"
             key={`vn-${activeSceneIndex}`}
             initial={{ opacity: 0 }}
             animate={{ opacity: 1 }}
             exit={{ opacity: 0 }}
             transition={{ duration: 0.6 }}
          >
            <Player 
              scenes={scenes}
              characters={characters}
              chapters={chapters}
              worldInfo={worldInfo}
              initialState={{
                currentSceneIndex: activeSceneIndex,
                history: vnHistory, 
                timestamp: 0,
                rpgState: rpgState, 
                vnState: null
              }}
              onExit={handleSceneExit}
              onSave={async (vnState) => {
                 await handleSaveGameInternal(rpgState, vnState);
                 return true;
              }}
              onCharacterUpdate={(updatedChar) => {
                  setCharacters(prev => prev.map(c => c.id === updatedChar.id ? updatedChar : c));
              }}
              onSceneUpdate={(updatedScene) => {
                  setScenes(prev => prev.map(s => s.id === updatedScene.id ? updatedScene : s));
              }}
            />
          </motion.div>
        )}

        {mode === 'dungeon_test' && (
          <motion.div 
            className="w-full h-screen"
            key="dungeon-test-stage"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
          >
            <ErrorBoundary fallbackTitle="Fehler in der 3D-Bühne" onReset={() => setMode('edit')}>
              <DungeonTestView 
                onExit={() => setMode('edit')}
                characters={characters}
                scenes={scenes}
                dungeonProject={dungeonProjects.find(d => d.id === activeDungeonBuildId) || undefined}
                onSaveProject={(patch) => {
                  setDungeonProjects(prev => prev.map(d => d.id === activeDungeonBuildId ? { ...d, ...patch } : d));
                }}
              />
            </ErrorBoundary>
          </motion.div>
        )}

        {mode === 'dungeon_play' && (
          <motion.div 
            className="w-full h-screen"
            key={`dungeon-play-${playingDungeonId}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
          >
            <ErrorBoundary fallbackTitle="Fehler in der 3D-Bühne" onReset={() => setMode('rpg')}>
              <DungeonTestView
                onExit={() => setMode('rpg')}
                characters={characters}
                scenes={scenes}
                dungeonProject={dungeonProjects.find(d => d.id === playingDungeonId) || undefined}
                playMode
                enemyState={rpgState.dungeonEnemyState || {}}
                onEnemyStateChange={(patch) => {
                  // Persist kraft / defeated per `${dungeonId}:${placementId}` (section 12)
                  setRpgState(prev => {
                    const next = { ...prev, dungeonEnemyState: { ...(prev.dungeonEnemyState || {}), ...patch } };
                    handleSaveGameInternal(next, null).catch(err => console.warn('battle state save failed:', err));
                    return next;
                  });
                }}
                onSceneStart={(sceneId) => {
                  const sc = scenes.find(s => s.id === sceneId);
                  if (sc) startScene(sc);
                }}
              />
            </ErrorBoundary>
          </motion.div>
        )}
      </AnimatePresence>

      {importFile && (
        <Dialog
          title={t('project.import.title')}
          onClose={() => setImportFile(null)}
          actions={[
            { label: t('common.cancel'), onClick: () => setImportFile(null) },
            { label: t('project.import.replace'), onClick: () => { const f = importFile; setImportFile(null); runImport(f, 'replace'); } },
            { label: t('project.import.new'), primary: true, onClick: () => { const f = importFile; setImportFile(null); runImport(f, 'new'); } },
          ]}
        >
          {t('project.import.text').replace('{name}', worldInfo.projectMeta?.title?.trim() || t('home.untitled'))}
        </Dialog>
      )}

      {showDeleteDialog && (
        <Dialog
          title={t('project.delete.title')}
          onClose={() => setShowDeleteDialog(false)}
          actions={[
            { label: t('common.cancel'), onClick: () => setShowDeleteDialog(false) },
            { label: t('project.delete.confirm'), primary: true, onClick: handleDeleteProject },
          ]}
        >
          {t('project.delete.text').replace('{name}', worldInfo.projectMeta?.title?.trim() || t('home.untitled'))}
        </Dialog>
      )}
    </div>
  );
};

export default App;
