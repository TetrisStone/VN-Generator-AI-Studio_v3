import React, { useState, useRef, useEffect } from 'react';
import { EditorTab, ProjectMeta, Character, CharacterImportance, CharacterAlignment, Scene, WorldMap, WorldInfo, BattleStats, Chapter, SceneEffect, MapSpot, WorldLocation, Faction, RelationshipTrigger, RelationshipThreshold, StoryLogEntry, AssetItem, DungeonProject, DungeonSection, DungeonBaseGLB, DungeonChunkLibraryEntry, DungeonChunkPlacement, DungeonNpcLibraryEntry, DungeonNpcPlacement, DungeonChunkType, DungeonNpcKind } from '../types';
import { Button } from './ui/Button';
import { Sidebar } from './layout/Sidebar';
import { HomeView, ProjectSummary } from './HomeView';
import { SettingsView } from './SettingsView';
import { PageHeader, EmptyState, OrnateFrame } from './ui/Ornate';
import { useI18n } from '../utils/i18n';
import { ABILITIES } from '../battle/abilities';
import { DEFAULT_ENEMY_STATS, DEFAULT_HERO_STATS, DEFAULT_SPARK_STATS } from '../battle/config';
import { Trash, Sword, Scaling, Plus, Save, Play, Download, Upload, Monitor, Map as MapIcon, Users, Target, Book, Layout, MessageSquare, Unlock, Lock, Waypoints, Image as ImageIcon, XCircle, Terminal, MapPin, Heart, EyeOff, Video, Music, Sparkles, Loader2, ArrowLeft, Cpu, Check, FolderOpen, ChevronUp, ChevronDown, ExternalLink, X, Move, ChevronLeft, ChevronRight, Search, Compass, Boxes, Castle } from 'lucide-react';
import { CHARACTER_GROUPS, getCharacterGroupKey, getCharacterGroup, CharacterGroupKey } from '../utils/characterUtils';
import { generateAutoScene, generateLoreTeaser } from '../services/geminiService';
import { AsyncImage } from './ui/AsyncImage';
import { AsyncVideo } from './ui/AsyncVideo';
import { AssetManager } from './AssetManager';
import { AssetSelectorModal } from './AssetSelectorModal';

import { saveImage, loadImage, deleteImage } from '../utils/imageStorage';
import { getItem } from '../utils/db';

// Keys of the raw 3D dungeon sandbox (DungeonTestView) in the keyval store
const DUNGEON_SANDBOX_KEYS = {
  chunkLibrary: 'dungeon_chunk_library',
  placedChunks: 'dungeon_chunk_placements',
  sections: 'dungeon_sections',
  npcLibrary: 'dungeon_npc_library',
  placedNpcs: 'dungeon_npc_placements',
  baseFloor: 'dungeon_custom_floor_glb',
  baseWall: 'dungeon_custom_wall_glb',
  baseDoor: 'dungeon_custom_door_glb',
  baseCharacter: 'dungeon_custom_glb_config'
} as const;
import { generateComfyImage, prepareComfyWorkflow, getDefaultWorkflow, getAvailableLoras, getAvailableCheckpoints } from '../services/comfyService';

export const WorldInfoContext = React.createContext<WorldInfo | null>(null);

interface ImageFieldProps {
  label: string;
  value: string | null;
  onChange: (val: string | null) => void;
  defaultPrompt?: string;
  assets?: AssetItem[];
}

const ImageField: React.FC<ImageFieldProps> = ({ label, value, onChange, defaultPrompt = '', assets }) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const [imgSrc, setImgSrc] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isDragging, setIsDragging] = useState(false);

    // AI Generation & Asset Selector Modal States
    const [showAiModal, setShowAiModal] = useState(false);
    const [showAssetSelector, setShowAssetSelector] = useState(false);
    const [aiPrompt, setAiPrompt] = useState('');
    const [aiStatus, setAiStatus] = useState('');
    const [isAiGenerating, setIsAiGenerating] = useState(false);
    const [aiError, setAiError] = useState<string | null>(null);

    const worldInfo = React.useContext(WorldInfoContext);

    React.useEffect(() => {
        let isMounted = true;
        const fetchImage = async () => {
            if (value) {
                setIsLoading(true);
                try {
                    const data = await loadImage(value);
                    if (isMounted) setImgSrc(data);
                } catch (e) {
                    console.error('Failed to load image', e);
                } finally {
                    if (isMounted) setIsLoading(false);
                }
            } else {
                setImgSrc(null);
            }
        };
        fetchImage();
        return () => { isMounted = false; };
    }, [value]);

    const processFile = (file: File) => {
        setIsLoading(true);
        const reader = new FileReader();
        reader.onload = async (ev) => {
            try {
                const base64 = ev.target?.result as string;
                let newId = value || crypto.randomUUID();
                await saveImage(newId, base64);
                setImgSrc(base64); // show immediately
                onChange(newId);
                if (inputRef.current) inputRef.current.value = "";
            } catch (e) {
                console.error('Failed to save image', e);
            } finally {
                setIsLoading(false);
            }
        };
        reader.readAsDataURL(file);
    };

    const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            processFile(file);
        }
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement | HTMLButtonElement>) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file && file.type.startsWith('image/')) {
            processFile(file);
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleRemove = async () => {
        onChange(null);
        setImgSrc(null);
    };

    const handleOpenAiModal = (e: React.MouseEvent) => {
        e.stopPropagation(); // Avoid triggering file inputs
        setAiPrompt(defaultPrompt);
        setAiStatus('');
        setAiError(null);
        setShowAiModal(true);
    };

    const handleAiGenerate = async () => {
        setIsAiGenerating(true);
        setAiError(null);
        setAiStatus('Konstruiere Workflow...');

        try {
            const comfyUrl = worldInfo?.comfyUrl || 'http://127.0.0.1:8188';
            const workflowStr = worldInfo?.comfyWorkflow || '';

            const isBackground = label.toLowerCase().includes('background') || label.toLowerCase().includes('hintergrund') || label.toLowerCase().includes('bg');
            const width = isBackground ? 1024 : 512;
            const height = isBackground ? 576 : 512;

            const preparedWorkflow = prepareComfyWorkflow(workflowStr, aiPrompt, width, height);
            
            const base64Data = await generateComfyImage(comfyUrl, preparedWorkflow, (statusMsg) => {
                setAiStatus(statusMsg);
            });

            const newId = crypto.randomUUID();
            await saveImage(newId, base64Data);
            setImgSrc(base64Data);
            onChange(newId);
            setShowAiModal(false);
        } catch (err: any) {
            console.error(err);
            setAiError(err.message || 'Ein unbekannter Fehler ist aufgetreten.');
        } finally {
            setIsAiGenerating(false);
        }
    };

    return (
        <div className="w-full">
            <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">{label}</label>
            <input 
                ref={inputRef}
                type="file" 
                onChange={handleFile} 
                className="hidden" 
                accept="image/*"
            />
            
            {value && imgSrc ? (
                <div 
                    className={`relative group w-full h-24 rounded border flex items-center justify-center overflow-hidden transition-colors ${
                        isDragging ? 'bg-emerald-900 border-emerald-500' : 'bg-gray-900 border-gray-700'
                    }`}
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                >
                    <img src={imgSrc} className="w-full h-full object-contain" alt={label} />
                    <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                         <button onClick={() => inputRef.current?.click()} className="p-2 bg-emerald-600 rounded text-white hover:bg-emerald-500 transition-colors shadow-lg" title="Bild hochladen">
                            <Upload size={16}/>
                         </button>
                         {assets && assets.length > 0 && (
                            <button onClick={() => setShowAssetSelector(true)} className="p-2 bg-blue-600 rounded text-white hover:bg-blue-500 transition-colors shadow-lg" title="Aus Asset Library wählen">
                               <FolderOpen size={16}/>
                            </button>
                         )}
                         <button onClick={handleOpenAiModal} className="p-2 bg-purple-600 rounded text-white hover:bg-purple-500 transition-colors shadow-lg" title="KI Generieren">
                            <Sparkles size={16}/>
                         </button>
                         <button onClick={handleRemove} className="p-2 bg-red-600 rounded text-white hover:bg-red-500 transition-colors shadow-lg" title="Entfernen">
                            <Trash size={16}/>
                         </button>
                    </div>
                    {isLoading && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                            <Loader2 size={24} className="animate-spin text-white" />
                        </div>
                    )}
                </div>
            ) : (
                <div 
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    className={`w-full h-24 flex items-center justify-center transition-all gap-2 group rounded border border-dashed p-1 ${
                        isDragging 
                            ? 'bg-emerald-900/50 border-emerald-400 text-emerald-300' 
                            : 'bg-gray-800/50 border-gray-600 text-gray-500'
                    }`}
                >
                    {isLoading ? (
                        <Loader2 size={24} className="animate-spin text-gray-400" />
                    ) : (
                        <>
                            <button 
                                onClick={() => inputRef.current?.click()}
                                className="flex-1 h-full flex flex-col items-center justify-center hover:bg-gray-800 rounded transition gap-1"
                                type="button"
                            >
                                <ImageIcon size={18} className="group-hover:text-gray-300 transition-colors"/>
                                <span className="text-[9px] uppercase font-bold group-hover:text-gray-300 transition-colors text-center leading-none mt-0.5">Upload</span>
                            </button>

                            {assets && assets.length > 0 && (
                              <>
                                <div className="w-[1px] h-8 bg-gray-700/60" />
                                <button 
                                    onClick={() => setShowAssetSelector(true)}
                                    className="flex-1 h-full flex flex-col items-center justify-center hover:bg-blue-950/30 text-blue-400 hover:text-blue-300 rounded transition gap-1"
                                    type="button"
                                >
                                    <FolderOpen size={18}/>
                                    <span className="text-[9px] uppercase font-bold text-center leading-none mt-0.5">Bibliothek</span>
                                </button>
                              </>
                            )}

                            <div className="w-[1px] h-8 bg-gray-700/60" />
                            <button 
                                onClick={handleOpenAiModal}
                                className="flex-1 h-full flex flex-col items-center justify-center hover:bg-purple-950/20 text-purple-400 hover:text-purple-300 rounded transition gap-1"
                                type="button"
                            >
                                <Sparkles size={18} className="animate-pulse text-purple-500"/>
                                <span className="text-[9px] uppercase font-bold text-center leading-none mt-0.5">KI Gen</span>
                            </button>
                        </>
                    )}
                </div>
            )}

            {/* Asset Selector Modal */}
            {showAssetSelector && assets && (
              <AssetSelectorModal
                assets={assets}
                onSelect={(asset) => {
                  if (asset.fileUrl) {
                    onChange(asset.fileUrl);
                  }
                }}
                onClose={() => setShowAssetSelector(false)}
              />
            )}

            {/* KI Generierungs-Modal */}
            {showAiModal && (
                <div className="fixed inset-0 z-[500] bg-black/80 flex items-center justify-center p-4">
                    <div className="bg-gray-900 border border-gray-700 shadow-2xl rounded-xl max-w-lg w-full overflow-hidden flex flex-col max-h-[90vh]">
                        <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-gray-950">
                            <div className="flex items-center gap-2 text-emerald-400 font-bold">
                                <Sparkles size={18} />
                                <span>KI-Bildgenerierung (ComfyUI)</span>
                            </div>
                            <button 
                                onClick={() => !isAiGenerating && setShowAiModal(false)} 
                                className="text-gray-400 hover:text-white transition-colors disabled:opacity-50"
                                disabled={isAiGenerating}
                            >
                                <XCircle size={20} />
                            </button>
                        </div>
                        
                        <div className="p-4 space-y-4 overflow-y-auto flex-1 text-sm text-gray-300">
                            {!worldInfo?.comfyEnabled && (
                                <div className="p-3 bg-amber-950/30 border border-amber-900/50 rounded-lg text-amber-300 text-xs leading-relaxed">
                                    <strong>Achtung:</strong> Die ComfyUI-Integration ist in den Einstellungen noch nicht aktiviert. Du kannst sie trotzdem hier testen, stelle aber sicher, dass dein lokaler Server läuft.
                                </div>
                            )}

                            <div>
                                <label className="text-xs font-bold text-gray-500 uppercase block mb-1">
                                    Prompts / Beschreibung (Englisch empfohlen)
                                </label>
                                <textarea 
                                    className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-white focus:border-emerald-500 outline-none h-24 text-sm resize-none"
                                    placeholder="e.g. Beautiful visual novel scenery of a high-tech workshop, neon accents, highly detailed anime style..."
                                    value={aiPrompt}
                                    onChange={e => setAiPrompt(e.target.value)}
                                    disabled={isAiGenerating}
                                />
                            </div>

                            <div className="bg-gray-950 p-3 rounded-lg border border-gray-800 space-y-1.5 text-xs text-gray-400">
                                <div className="flex justify-between">
                                    <span>Server-URL:</span>
                                    <span className="font-mono text-emerald-400">{worldInfo?.comfyUrl || 'http://127.0.0.1:8188'}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Zielauflösung:</span>
                                    <span>
                                        {label.toLowerCase().includes('background') || label.toLowerCase().includes('hintergrund') || label.toLowerCase().includes('bg') ? '1024x576 (16:9)' : '512x512 (1:1)'}
                                    </span>
                                </div>
                            </div>

                            {isAiGenerating && (
                                <div className="flex flex-col items-center justify-center p-4 bg-emerald-950/20 border border-emerald-900/30 rounded-lg space-y-3">
                                    <Loader2 className="animate-spin text-emerald-500" size={32} />
                                    <p className="text-emerald-300 font-medium animate-pulse text-xs text-center">{aiStatus}</p>
                                </div>
                            )}

                            {aiError && (
                                <div className="p-3 bg-red-950/40 border border-red-900/50 rounded-lg text-red-200 text-xs leading-relaxed">
                                    <strong>Fehler beim Generieren:</strong>
                                    <div className="mt-1 font-mono text-[10px] bg-black/40 p-2 rounded max-h-32 overflow-y-auto whitespace-pre-wrap">{aiError}</div>
                                </div>
                            )}
                        </div>

                        <div className="p-4 border-t border-gray-800 bg-gray-950 flex justify-end gap-3">
                            <Button 
                                variant="secondary" 
                                onClick={() => setShowAiModal(false)}
                                disabled={isAiGenerating}
                                className="px-4 text-xs"
                            >
                                Abbrechen
                            </Button>
                            <Button 
                                onClick={handleAiGenerate}
                                disabled={isAiGenerating || !aiPrompt.trim()}
                                className="px-4 text-xs flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white"
                            >
                                {isAiGenerating ? (
                                    <>
                                        <Loader2 className="animate-spin" size={14} />
                                        <span>Generiere...</span>
                                    </>
                                ) : (
                                    <>
                                        <Sparkles size={14} />
                                        <span>Jetzt Generieren</span>
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

interface VideoFieldProps {
  label: string;
  value: string | null;
  onChange: (val: string | null) => void;
}

const VideoField: React.FC<VideoFieldProps> = ({ label, value, onChange }) => {
    const inputRef = useRef<HTMLInputElement>(null);

    const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            // Limit video size roughly to prevent crashes (optional, purely UX)
            if (file.size > 50 * 1024 * 1024) {
                alert("Video file is too large (Max ~50MB recommended for browser storage)");
                return;
            }
            const reader = new FileReader();
            reader.onload = (ev) => {
                onChange(ev.target?.result as string);
                if (inputRef.current) inputRef.current.value = "";
            };
            reader.readAsDataURL(file);
        }
    };

    return (
        <div className="w-full">
            <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">{label}</label>
            <input 
                ref={inputRef}
                type="file" 
                onChange={handleFile} 
                className="hidden" 
                accept="video/*"
            />
            
            {value ? (
                <div className="relative group w-full h-24 bg-gray-900 rounded border border-gray-700 flex items-center justify-center overflow-hidden">
                    <AsyncVideo src={value} className="w-full h-full object-cover opacity-50" />
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <Video size={24} className="text-white opacity-80"/>
                    </div>
                    <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                         <button onClick={() => inputRef.current?.click()} className="p-2 bg-emerald-600 rounded text-white hover:bg-emerald-500 transition-colors shadow-lg" title="Change Video">
                            <Upload size={16}/>
                         </button>
                         <button onClick={() => onChange(null)} className="p-2 bg-red-600 rounded text-white hover:bg-red-500 transition-colors shadow-lg" title="Remove Video">
                            <Trash size={16}/>
                         </button>
                    </div>
                </div>
            ) : (
                <button 
                    onClick={() => inputRef.current?.click()}
                    className="w-full h-24 bg-gray-800/50 hover:bg-gray-800 border border-dashed border-gray-600 hover:border-gray-500 rounded flex flex-col items-center justify-center text-gray-500 transition-all gap-2 group"
                >
                    <Video size={20} className="group-hover:text-gray-300 transition-colors"/>
                    <span className="text-[10px] uppercase font-bold group-hover:text-gray-300 transition-colors">Select Video (Intro)</span>
                </button>
            )}
        </div>
    );
};

interface AudioFieldProps {
  label: string;
  value: string | null;
  onChange: (val: string | null) => void;
}

const AudioField: React.FC<AudioFieldProps> = ({ label, value, onChange }) => {
    const inputRef = useRef<HTMLInputElement>(null);

    const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            if (file.size > 20 * 1024 * 1024) {
                alert("Audio file is too large (Max ~20MB recommended for browser storage)");
                return;
            }
            const reader = new FileReader();
            reader.onload = (ev) => {
                onChange(ev.target?.result as string);
                if (inputRef.current) inputRef.current.value = "";
            };
            reader.readAsDataURL(file);
        }
    };

    return (
        <div className="w-full">
            <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">{label}</label>
            <input 
                ref={inputRef}
                type="file" 
                onChange={handleFile} 
                className="hidden" 
                accept="audio/*"
            />
            
            {value ? (
                <div className="relative group w-full h-12 bg-gray-900 rounded border border-gray-700 flex items-center justify-between px-3 overflow-hidden">
                    <div className="flex items-center gap-2 overflow-hidden">
                        <Music size={16} className="text-blue-400 flex-shrink-0" />
                        <span className="text-xs text-gray-300 truncate">Audio Selected</span>
                    </div>
                    <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 px-2 border border-blue-500/50 rounded">
                         <button onClick={() => inputRef.current?.click()} className="p-1.5 bg-emerald-600 rounded text-white hover:bg-emerald-500 transition-colors shadow-lg flex items-center gap-1" title="Change Audio">
                            <Upload size={14}/>
                         </button>
                         <button onClick={() => onChange(null)} className="p-1.5 bg-red-600 rounded text-white hover:bg-red-500 transition-colors shadow-lg flex items-center gap-1" title="Remove Audio">
                            <Trash size={14}/>
                         </button>
                    </div>
                </div>
            ) : (
                <button 
                    onClick={() => inputRef.current?.click()}
                    className="w-full h-12 bg-gray-800/50 hover:bg-gray-800 border border-dashed border-gray-600 hover:border-gray-500 rounded flex items-center justify-center text-gray-500 transition-all gap-2 group"
                >
                    <Music size={16} className="group-hover:text-gray-300 transition-colors"/>
                    <span className="text-xs font-bold group-hover:text-gray-300 transition-colors">Select Audio File</span>
                </button>
            )}
        </div>
    );
};

interface ChapterEditorProps {
    chapter: Chapter;
    allScenes: Scene[];
    allChapters: Chapter[];
    allMaps: WorldMap[];
    onChange: (u: Partial<Chapter>) => void;
    onDelete: () => void;
    onNavigateToScene: (sceneId: string) => void;
    onCreateSceneForChapter: (chapterId: string) => void;
    onUpdateScenes: (scenes: Scene[]) => void;
    onReorderChapter: (direction: 'up' | 'down') => void;
}

const ChapterEditor: React.FC<ChapterEditorProps> = ({
    chapter,
    allScenes,
    allChapters,
    allMaps,
    onChange,
    onDelete,
    onNavigateToScene,
    onCreateSceneForChapter,
    onUpdateScenes,
    onReorderChapter
}) => {
    // Mapped scenes sorted chronologically
    const mappedScenes = allScenes
        .filter(s => s.chapterId === chapter.id)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const handleMoveScene = (sceneId: string, direction: 'up' | 'down') => {
        const index = mappedScenes.findIndex(s => s.id === sceneId);
        if (index === -1) return;
        const targetIndex = direction === 'up' ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= mappedScenes.length) return;

        const updatedMapped = [...mappedScenes];
        const [moved] = updatedMapped.splice(index, 1);
        updatedMapped.splice(targetIndex, 0, moved);

        // Reassign order numbers strictly 1, 2, 3...
        const updatedScenes = allScenes.map(s => {
            if (s.chapterId !== chapter.id) return s;
            const newIndex = updatedMapped.findIndex(m => m.id === s.id);
            return { ...s, order: newIndex + 1 };
        });

        onUpdateScenes(updatedScenes);
    };

    const handleToggleSceneMain = (sceneId: string) => {
        const updatedScenes = allScenes.map(s => {
            if (s.id === sceneId) {
                return { ...s, isMainScene: s.isMainScene === false ? true : false };
            }
            return s;
        });
        onUpdateScenes(updatedScenes);
    };

    return (
        <div className="space-y-6 max-w-3xl vn-panel bg-gray-900/80 p-6">
            <div className="flex justify-between items-start">
                <div>
                    <div className="flex items-center gap-2">
                        <span className="px-2.5 py-0.5 text-xs font-bold bg-emerald-900/80 text-emerald-300 rounded border border-emerald-700">
                            Kapitel #{chapter.order ?? 1}
                        </span>
                        <h3 className="text-xl font-bold text-white">{chapter.name || 'Unnamed Chapter'}</h3>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">ID: {chapter.id}</div>
                </div>
                <div className="flex items-center gap-2">
                    <Button 
                        variant="secondary" 
                        className="text-xs py-1 px-2 flex items-center gap-1" 
                        onClick={() => onReorderChapter('up')}
                        title="Kapitel nach oben verschieben"
                    >
                        <ChevronUp size={14} /> Oben
                    </Button>
                    <Button 
                        variant="secondary" 
                        className="text-xs py-1 px-2 flex items-center gap-1" 
                        onClick={() => onReorderChapter('down')}
                        title="Kapitel nach unten verschieben"
                    >
                        <ChevronDown size={14} /> Unten
                    </Button>
                    <button onClick={onDelete} className="text-red-500 hover:text-red-400 bg-red-900/20 p-2 rounded">
                        <Trash size={18}/>
                    </button>
                </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2">
                    <label className="text-xs font-bold text-gray-500 uppercase">Chapter Name</label>
                    <input className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" value={chapter.name} onChange={e => onChange({ name: e.target.value })} />
                </div>
                <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">Reihenfolge (Order)</label>
                    <input 
                        type="number" 
                        className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" 
                        value={chapter.order ?? 1} 
                        onChange={e => onChange({ order: parseInt(e.target.value) || 1 })} 
                    />
                </div>
            </div>

            <div>
                <label className="text-xs font-bold text-gray-500 uppercase">Description / Lore</label>
                <textarea className="w-full bg-gray-800 border border-gray-700 rounded p-2 h-20 text-white" value={chapter.description} onChange={e => onChange({ description: e.target.value })} />
            </div>

            {/* MAPPED SCENES SECTION */}
            <div className="border-t border-gray-800 pt-6 space-y-4">
                <div className="flex justify-between items-center">
                    <div>
                        <h4 className="text-lg font-bold text-emerald-400 flex items-center gap-2">
                            <MapPin size={18} /> Zugeordnete Szenen ({mappedScenes.length})
                        </h4>
                        <p className="text-xs text-gray-400">
                            Chronologische Szenenabfolge in diesem Kapitel. Klicke auf eine Szene, um sie im Editor zu öffnen.
                        </p>
                    </div>
                    <Button 
                        onClick={() => onCreateSceneForChapter(chapter.id)} 
                        className="text-xs py-1.5 px-3 bg-emerald-600 hover:bg-emerald-500 flex items-center gap-1"
                    >
                        <Plus size={14} /> Szene hinzufügen
                    </Button>
                </div>

                {mappedScenes.length === 0 ? (
                    <div className="bg-gray-800/40 border border-dashed border-gray-700 rounded-xl p-6 text-center text-gray-500 text-sm">
                        Keine Szenen diesem Kapitel zugewiesen. Klicke auf "+ Szene hinzufügen", um eine neue Szene für "{chapter.name}" zu erstellen.
                    </div>
                ) : (
                    <div className="space-y-2.5">
                        {mappedScenes.map((s, idx) => {
                            const isMain = s.isMainScene !== false;
                            const assignedMap = allMaps.find(m => m.id === s.mapId) || allMaps.find(m => m.spots?.some(spot => spot.type === 'scene' && spot.sceneId === s.id));
                            return (
                                <div 
                                    key={s.id} 
                                    className="bg-gray-800/90 hover:bg-gray-800 border border-gray-700 hover:border-gray-600 rounded-lg p-3 flex flex-wrap md:flex-nowrap items-center justify-between gap-3 transition-colors"
                                >
                                    <div className="flex items-center gap-3 min-w-0 flex-1">
                                        <div className="flex flex-col items-center justify-center bg-gray-900 border border-gray-700 rounded px-2 py-1 text-center flex-shrink-0 min-w-[36px]">
                                            <span className="text-[9px] text-gray-500 font-mono uppercase">Pos</span>
                                            <span className="text-sm font-bold text-emerald-400">{s.order || idx + 1}</span>
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-bold text-white text-sm truncate">{s.name}</span>
                                                {isMain ? (
                                                    <span className="text-[10px] bg-emerald-900/80 text-emerald-300 border border-emerald-700 px-2 py-0.5 rounded font-medium flex-shrink-0">
                                                        ★ Hauptszene
                                                    </span>
                                                ) : (
                                                    <span className="text-[10px] bg-amber-900/80 text-amber-300 border border-amber-700 px-2 py-0.5 rounded font-medium flex-shrink-0">
                                                        ✦ Nebenszene
                                                    </span>
                                                )}
                                                {assignedMap ? (
                                                    <span className="text-[10px] bg-sky-900/80 text-sky-300 border border-sky-700 px-2 py-0.5 rounded font-medium flex items-center gap-1 flex-shrink-0" title={`Gezielt auf Karte '${assignedMap.name}' gemappt`}>
                                                        <MapIcon size={10} /> Karte: {assignedMap.name}
                                                    </span>
                                                ) : (
                                                    <span className="text-[10px] bg-gray-900 text-gray-500 border border-gray-700 px-2 py-0.5 rounded font-medium flex items-center gap-1 flex-shrink-0">
                                                        <MapIcon size={10} /> Keine Karte
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-xs text-gray-400 truncate mt-0.5">
                                                {s.goal ? `Ziel: ${s.goal}` : s.description || 'Keine Beschreibung'}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-1.5 flex-shrink-0 w-full md:w-auto justify-end border-t md:border-t-0 pt-2 md:pt-0 border-gray-700/50">
                                        <button 
                                            onClick={() => handleMoveScene(s.id, 'up')}
                                            disabled={idx === 0}
                                            className="p-1.5 bg-gray-900 hover:bg-gray-700 disabled:opacity-30 disabled:hover:bg-gray-900 rounded text-gray-300 border border-gray-700"
                                            title="Nach oben verschieben"
                                        >
                                            <ChevronUp size={14} />
                                        </button>
                                        <button 
                                            onClick={() => handleMoveScene(s.id, 'down')}
                                            disabled={idx === mappedScenes.length - 1}
                                            className="p-1.5 bg-gray-900 hover:bg-gray-700 disabled:opacity-30 disabled:hover:bg-gray-900 rounded text-gray-300 border border-gray-700"
                                            title="Nach unten verschieben"
                                        >
                                            <ChevronDown size={14} />
                                        </button>
                                        <button 
                                            onClick={() => handleToggleSceneMain(s.id)}
                                            className="px-2 py-1 text-xs bg-gray-900 hover:bg-gray-700 rounded text-gray-300 border border-gray-700"
                                            title="Typ wechseln (Hauptszene / Nebenszene)"
                                        >
                                            {isMain ? '✦ Als Nebenszene' : '★ Als Hauptszene'}
                                        </button>
                                        <Button 
                                            onClick={() => onNavigateToScene(s.id)}
                                            className="text-xs py-1 px-2.5 bg-emerald-600 hover:bg-emerald-500 flex items-center gap-1"
                                        >
                                            Bearbeiten <ExternalLink size={12} />
                                        </Button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

// ---------------------------------------------------------------------------
// Battle stats (new battle system, stage 1): values from section 6, ability
// dropdown from battle/abilities.ts and the Spark checkbox.
// ---------------------------------------------------------------------------
const BATTLE_PRESETS: { label: string; stats: BattleStats }[] = [
    { label: 'Held', stats: { maxHp: DEFAULT_HERO_STATS.maxHp, atk: DEFAULT_HERO_STATS.atk, def: DEFAULT_HERO_STATS.def, ini: DEFAULT_HERO_STATS.ini } },
    { label: 'Späher', stats: { maxHp: 80, atk: 22, def: 14, ini: 7 } },
    { label: 'Tank', stats: { maxHp: 140, atk: 16, def: 30, ini: 3 } },
    { label: 'Gegner', stats: { maxHp: DEFAULT_ENEMY_STATS.maxHp, atk: DEFAULT_ENEMY_STATS.atk, def: DEFAULT_ENEMY_STATS.def, ini: DEFAULT_ENEMY_STATS.ini, maxKraft: DEFAULT_ENEMY_STATS.maxKraft } },
    { label: 'Boss', stats: { maxHp: 200, atk: 22, def: 25, ini: 4, maxKraft: 150, kraftResist: 0.5 } },
];

const BattleStatsEditor: React.FC<{ character: Character; onChange: (u: Partial<Character>) => void }> = ({ character, onChange }) => {
    const bs = character.battleStats;
    const isEnemy = character.alignment === 'boese';
    const setStat = (key: keyof BattleStats, raw: string) => {
        const base: BattleStats = bs ?? { ...BATTLE_PRESETS[isEnemy ? 3 : 0].stats };
        const next: BattleStats = { ...base };
        if (key === 'abilityId') {
            next.abilityId = raw || undefined;
        } else {
            const v = parseFloat(raw);
            (next as any)[key] = Number.isFinite(v) ? v : undefined;
        }
        onChange({ battleStats: next });
    };
    const field = (key: keyof BattleStats, label: string, hint: string, step = 1, placeholder?: number) => (
        <div>
            <label className="text-[10px] font-bold uppercase text-gray-500" title={hint}>{label}</label>
            <input
                type="number"
                step={step}
                className="w-full bg-gray-900 border border-gray-600 rounded p-1 text-center text-white"
                placeholder={placeholder !== undefined ? String(placeholder) : ''}
                value={(bs as any)?.[key] ?? ''}
                onChange={e => setStat(key, e.target.value)}
            />
        </div>
    );
    const defaults = character.isSpark ? DEFAULT_SPARK_STATS : isEnemy ? DEFAULT_ENEMY_STATS : DEFAULT_HERO_STATS;
    return (
        <div className="bg-gray-800 p-4 rounded border border-gray-700 space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <h4 className="font-bold text-emerald-400 flex items-center gap-2"><Sword size={16}/> Kampfwerte</h4>
                <div className="flex gap-1 flex-wrap">
                    {BATTLE_PRESETS.map(p => (
                        <button key={p.label} className="text-[10px] px-2 py-0.5 rounded border border-gray-600 text-gray-300 hover:bg-gray-700" onClick={() => onChange({ battleStats: { ...p.stats, abilityId: bs?.abilityId } })}>{p.label}</button>
                    ))}
                </div>
            </div>
            <p className="text-[10px] text-gray-500">Leere Felder verwenden die Standardwerte (grau). Gegner erhalten ihre Werte über die Charakter-Verknüpfung der Figur im Dungeon.</p>
            <div className="grid grid-cols-4 gap-2">
                {field('maxHp', 'Max LP', 'Maximale Lebenspunkte', 1, defaults.maxHp)}
                {field('atk', 'ATK', 'Angriff', 1, defaults.atk)}
                {field('def', 'DEF', 'Verteidigung', 1, defaults.def)}
                {field('ini', 'INI', 'Initiative = Sichtweite in Sub-Tiles', 1, defaults.ini)}
            </div>
            <div className="grid grid-cols-2 gap-2">
                {field('maxKraft', 'Max Kraft (nur Gegner)', 'Fällt die Kraft auf 0, wankt der Gegner', 1, DEFAULT_ENEMY_STATS.maxKraft)}
                {field('kraftResist', 'Kraft-Resistenz 0..1 (nur Gegner)', 'Reduziert Sparks Kraftentzug, z. B. Bosse 0.5', 0.05, 0)}
            </div>
            <div>
                <label className="text-[10px] font-bold uppercase text-gray-500">Fähigkeit</label>
                <select className="w-full bg-gray-900 border border-gray-600 rounded p-1.5 text-sm text-white" value={bs?.abilityId ?? ''} onChange={e => setStat('abilityId', e.target.value)}>
                    <option value="">— keine —</option>
                    {ABILITIES.map(a => <option key={a.id} value={a.id}>{a.name} ({a.apCost} AP) – {a.description}</option>)}
                </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-200 cursor-pointer">
                <input type="checkbox" checked={!!character.isSpark} onChange={e => onChange({ isSpark: e.target.checked })} />
                <span><b className="text-amber-300">Spark</b> – kann nicht handeln, heilt wankende Helden oder entzieht den Gegnern Kraft. Fällt Spark auf 0 LP, ist der Kampf verloren.</span>
            </label>
            {bs && <Button variant="danger" className="w-full text-xs" onClick={() => onChange({ battleStats: undefined })}>Werte zurücksetzen (Standardwerte)</Button>}
        </div>
    );
};

interface CharacterEditorProps {
  character: Character;
  assets?: AssetItem[];
  onChange: (u: Partial<Character>) => void;
  onDelete: () => void;
}

const CharacterEditor: React.FC<CharacterEditorProps> = ({ character, assets, onChange, onDelete }) => {
    const charGroup = getCharacterGroup(character);
    const worldInfo = React.useContext(WorldInfoContext);

    // Dynamic ComfyUI Models
    const [loras, setLoras] = useState<string[]>([]);
    const [checkpoints, setCheckpoints] = useState<string[]>([]);
    const [isLoadingModels, setIsLoadingModels] = useState<boolean>(false);

    useEffect(() => {
        let isMounted = true;
        const fetchModels = async () => {
            setIsLoadingModels(true);
            try {
                const comfyUrl = worldInfo?.comfyUrl || 'http://127.0.0.1:8188';
                const [fetchedLoras, fetchedCkpts] = await Promise.all([
                    getAvailableLoras(comfyUrl),
                    getAvailableCheckpoints(comfyUrl)
                ]);
                if (isMounted) {
                    setLoras(fetchedLoras);
                    setCheckpoints(fetchedCkpts);
                }
            } catch (e) {
                console.warn("Konnte ComfyUI-Modelle nicht laden:", e);
            } finally {
                if (isMounted) setIsLoadingModels(false);
            }
        };
        fetchModels();
        return () => { isMounted = false; };
    }, [worldInfo?.comfyUrl]);

    // Helper for Relationship
    const updateRelationship = (u: any) => {
        const rel = character.relationship || { enabled: false, currentValue: 0, startValue: 0, triggers: [], thresholds: [] };
        onChange({ relationship: { ...rel, ...u } });
    };

    return (
        <div className="space-y-6 max-w-2xl vn-panel bg-gray-900/80 p-6">
            <div className="flex justify-between items-start">
                <div>
                     <div className="flex items-center gap-2 flex-wrap">
                       <h3 className="text-xl font-bold text-white">{character.name}</h3>
                       <span className={`text-xs px-2.5 py-0.5 rounded border ${charGroup.badgeBg} ${charGroup.badgeBorder} ${charGroup.textColor} font-semibold flex items-center gap-1.5 shadow-sm`}>
                         <span>{charGroup.icon}</span> {charGroup.label}
                       </span>
                     </div>
                     <div className="text-xs text-gray-500 mt-1">ID: {character.id}</div>
                </div>
                <button onClick={onDelete} className="text-red-500 hover:text-red-400 bg-red-900/20 p-2 rounded" title="Charakter löschen"><Trash size={18}/></button>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">Name</label>
                    <input className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" value={character.name} onChange={e => onChange({ name: e.target.value })} />
                </div>
                <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">RPG Color</label>
                    <div className="flex gap-2">
                        <input type="color" className="h-10 w-10 bg-gray-800 border border-gray-700 rounded cursor-pointer" value={character.rpgColor} onChange={e => onChange({ rpgColor: e.target.value })} />
                        <input className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" value={character.rpgColor} onChange={e => onChange({ rpgColor: e.target.value })} />
                    </div>
                </div>
            </div>

            {/* Structure & Categorization */}
            <div className="grid grid-cols-2 gap-4 bg-gray-950/80 p-3.5 rounded-xl border border-gray-800">
                <div>
                    <label className="text-xs font-bold text-gray-400 uppercase block mb-1">Rolle / Bedeutung</label>
                    <select
                        value={character.importance || 'main'}
                        onChange={e => onChange({ importance: e.target.value as CharacterImportance })}
                        className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white text-xs outline-none focus:border-emerald-500"
                    >
                        <option value="main">🌟 Hauptcharakter</option>
                        <option value="side">🛡️ Nebencharakter</option>
                    </select>
                </div>
                <div>
                    <label className="text-xs font-bold text-gray-400 uppercase block mb-1">Gesinnung</label>
                    <select
                        value={character.alignment || 'gut'}
                        onChange={e => onChange({ alignment: e.target.value as CharacterAlignment })}
                        className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white text-xs outline-none focus:border-emerald-500"
                    >
                        <option value="gut">🟢 Gut / Verbündeter</option>
                        <option value="boese">🔴 Böse / Antagonist</option>
                        <option value="neutral">⚪ Neutral / Sonstige</option>
                    </select>
                </div>
            </div>

            <div>
                <label className="text-xs font-bold text-gray-500 uppercase">Persona / Description</label>
                <textarea className="w-full bg-gray-800 border border-gray-700 rounded p-2 h-24 text-white" value={character.defaultDescription} onChange={e => onChange({ defaultDescription: e.target.value })} />
            </div>

            {/* STRUCTURED IMAGE PROMPTS (COMFYUI / LORA) */}
            <div className="bg-gray-800/90 p-4 rounded-lg border border-purple-900/40 space-y-3 shadow-inner">
                <div className="flex justify-between items-center">
                    <label className="text-xs font-bold text-purple-400 uppercase flex items-center gap-1.5">
                        <Sparkles size={14} className="text-purple-400" /> KI-Bild-Prompt &amp; LoRA-Konfiguration (ComfyUI)
                    </label>
                </div>
                <p className="text-[11px] text-gray-400 leading-relaxed">
                    Diese Felder werden bei der Bildgenerierung mit dem Standard-Prompt kombiniert. Leer lassen = Feld wird nicht verwendet.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                        <label className="text-[11px] font-semibold text-gray-300 block mb-1">
                            1. Triggerword (LoRA-Trigger)
                        </label>
                        <input 
                            type="text" 
                            className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-xs text-white placeholder-gray-500 focus:border-purple-500 outline-none"
                            placeholder="z.B. lstsprk_elr_bs"
                            value={character.imagePrompts?.trigger || ''}
                            onChange={e => onChange({
                                imagePrompts: { ...character.imagePrompts, trigger: e.target.value }
                            })}
                        />
                    </div>
                    <div>
                        <label className="text-[11px] font-semibold text-gray-300 block mb-1">
                            2. Face (Gesichtsmerkmale)
                        </label>
                        <input 
                            type="text" 
                            className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-xs text-white placeholder-gray-500 focus:border-purple-500 outline-none"
                            placeholder="z.B. red_hair, long_hair, blue_eyes"
                            value={character.imagePrompts?.face || ''}
                            onChange={e => onChange({
                                imagePrompts: { ...character.imagePrompts, face: e.target.value }
                            })}
                        />
                    </div>
                    <div>
                        <label className="text-[11px] font-semibold text-gray-300 block mb-1">
                            3. Hair (Frisur / Styling)
                        </label>
                        <input 
                            type="text" 
                            className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-xs text-white placeholder-gray-500 focus:border-purple-500 outline-none"
                            placeholder="z.B. hair_down oder ponytail"
                            value={character.imagePrompts?.hair || ''}
                            onChange={e => onChange({
                                imagePrompts: { ...character.imagePrompts, hair: e.target.value }
                            })}
                        />
                    </div>
                    <div>
                        <label className="text-[11px] font-semibold text-gray-300 block mb-1">
                            4. Clothes (Kleidung / Rüstung)
                        </label>
                        <input 
                            type="text" 
                            className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-xs text-white placeholder-gray-500 focus:border-purple-500 outline-none"
                            placeholder="z.B. silver_blue_armor, gauntlets"
                            value={character.imagePrompts?.clothes || ''}
                            onChange={e => onChange({
                                imagePrompts: { ...character.imagePrompts, clothes: e.target.value }
                            })}
                        />
                    </div>
                    <div className="md:col-span-2">
                        <label className="text-[11px] font-semibold text-gray-300 block mb-1">
                            5. Body Type (Körperbau, optional)
                        </label>
                        <input 
                            type="text" 
                            className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-xs text-white placeholder-gray-500 focus:border-purple-500 outline-none"
                            placeholder="z.B. athletic, tall"
                            value={character.imagePrompts?.bodyType || ''}
                            onChange={e => onChange({
                                imagePrompts: { ...character.imagePrompts, bodyType: e.target.value }
                            })}
                        />
                    </div>
                </div>

                {/* DYNAMIC COMFYUI MODEL SELECTION (LORA & CHECKPOINT) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-3 border-t border-purple-900/40">
                    <div>
                        <label className="text-[11px] font-semibold text-purple-300 block mb-1 flex items-center justify-between">
                            <span>LoRA-Modell (.safetensors)</span>
                            {isLoadingModels && <span className="text-[10px] text-gray-400 font-normal">Lade...</span>}
                        </label>
                        <select
                            className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-xs text-white focus:border-purple-500 outline-none"
                            value={character.imagePrompts?.loraFileName || ''}
                            onChange={e => onChange({
                                imagePrompts: { ...character.imagePrompts, loraFileName: e.target.value }
                            })}
                        >
                            <option value="">-- Keine LoRA ausgewählt --</option>
                            {loras.map(lora => (
                                <option key={lora} value={lora}>{lora}</option>
                            ))}
                            {loras.length === 0 && !isLoadingModels && (
                                <option disabled value="__empty__">Keine Modelle gefunden – ComfyUI läuft?</option>
                            )}
                            {character.imagePrompts?.loraFileName && !loras.includes(character.imagePrompts.loraFileName) && (
                                <option value={character.imagePrompts.loraFileName}>
                                    {character.imagePrompts.loraFileName} (gespeichert)
                                </option>
                            )}
                        </select>
                        {loras.length === 0 && !isLoadingModels && (
                            <p className="text-[10px] text-amber-500/80 mt-1">Keine Modelle gefunden – ComfyUI läuft?</p>
                        )}
                    </div>

                    <div>
                        <label className="text-[11px] font-semibold text-purple-300 block mb-1 flex items-center justify-between">
                            <span>Checkpoint / Diffusion-Modell (optional)</span>
                            {isLoadingModels && <span className="text-[10px] text-gray-400 font-normal">Lade...</span>}
                        </label>
                        <select
                            className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-xs text-white focus:border-purple-500 outline-none"
                            value={character.imagePrompts?.checkpointFileName || ''}
                            onChange={e => onChange({
                                imagePrompts: { ...character.imagePrompts, checkpointFileName: e.target.value }
                            })}
                        >
                            <option value="">-- Standard (aus Workflow) --</option>
                            {checkpoints.map(ckpt => (
                                <option key={ckpt} value={ckpt}>{ckpt}</option>
                            ))}
                            {checkpoints.length === 0 && !isLoadingModels && (
                                <option disabled value="__empty__">Keine Modelle gefunden (checkpoints/diffusion_models) – ComfyUI läuft?</option>
                            )}
                            {character.imagePrompts?.checkpointFileName && !checkpoints.includes(character.imagePrompts.checkpointFileName) && (
                                <option value={character.imagePrompts.checkpointFileName}>
                                    {character.imagePrompts.checkpointFileName} (gespeichert)
                                </option>
                            )}
                        </select>
                        {checkpoints.length === 0 && !isLoadingModels && (
                            <p className="text-[10px] text-amber-500/80 mt-1">Keine Modelle gefunden (checkpoints/diffusion_models) – ComfyUI läuft?</p>
                        )}
                    </div>
                </div>

                <div className="pt-2 border-t border-gray-700/60">
                    <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">
                        Legacy KI-Bild-Prompt (Freitext Fallback)
                    </label>
                    <input 
                        type="text" 
                        className="w-full bg-gray-900/60 border border-gray-700/60 rounded p-2 text-xs text-gray-400 focus:border-purple-500 outline-none" 
                        placeholder="Freitext-Prompt für Abwärtskompatibilität (z.B. 1girl, elara_lora, red hair...)"
                        value={character.aiImagePrompt || ''} 
                        onChange={e => onChange({ aiImagePrompt: e.target.value })} 
                    />
                </div>
            </div>

            <div>
                <label className="text-xs font-bold text-gray-500 uppercase">Lore / Backstory</label>
                <textarea 
                    className="w-full bg-gray-800 border border-gray-700 rounded p-2 h-20 text-sm text-gray-300" 
                    placeholder="Hidden context for the AI about this character's past..."
                    value={character.lore || ''} 
                    onChange={e => onChange({ lore: e.target.value })} 
                />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
                <ImageField 
                    label="Portrait (Idle/Standard)" 
                    value={character.imageSrc} 
                    onChange={val => onChange({ imageSrc: val })} 
                    assets={assets}
                    defaultPrompt={`${character.name}, standard portrait, ${character.defaultDescription || ''}, anime visual novel style, high quality, standalone character sprite, white background`}
                />
                <ImageField 
                    label="Map Sprite (Small)" 
                    value={character.mapSpriteSrc} 
                    onChange={val => onChange({ mapSpriteSrc: val })} 
                    assets={assets}
                    defaultPrompt={`${character.name}, mini chibi sprite, ${character.defaultDescription || ''}, transparent background, 2d game sprite, high quality`}
                />
            </div>

            {/* 3D GLB Model for Dungeon Exploration */}
            <div className="bg-gray-800/90 p-4 rounded-xl border border-gray-700/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md">
                <div className="flex items-center gap-3 min-w-0">
                    <Compass size={22} className="text-cyan-400 flex-shrink-0" />
                    <div className="min-w-0">
                        <div className="text-sm font-bold text-white flex items-center gap-2">
                            <span>3D-Modell (.glb) für Dungeon</span>
                            {character.model3dSrc && (
                                <span className="text-[10px] bg-cyan-950 text-cyan-300 border border-cyan-700/60 px-2 py-0.5 rounded font-mono font-semibold">
                                    GLB Aktiv
                                </span>
                            )}
                        </div>
                        <div className="text-xs text-gray-400 truncate mt-0.5">
                            {character.model3dSrc 
                                ? 'Eigenes GLB-Modell hinterlegt (wird in der Dungeon-Bühne genutzt)' 
                                : 'Noch kein eigenes 3D-Modell zugewiesen (nutzt den Standard-Dummy)'}
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                    <label className="px-3.5 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-semibold cursor-pointer shadow-lg flex items-center gap-2 transition-colors active:scale-95">
                        <Upload size={14} />
                        <span>{character.model3dSrc ? 'GLB ersetzen' : '.glb hochladen'}</span>
                        <input
                            type="file"
                            accept=".glb,.gltf"
                            className="hidden"
                            onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                try {
                                    const reader = new FileReader();
                                    reader.onload = async () => {
                                        const base64 = reader.result as string;
                                        const newId = `model3d_${crypto.randomUUID()}`;
                                        await saveImage(newId, base64);
                                        onChange({ model3dSrc: newId });
                                    };
                                    reader.readAsDataURL(file);
                                } catch (err) {
                                    console.error("GLB upload error in Character editor:", err);
                                }
                            }}
                        />
                    </label>
                    {character.model3dSrc && (
                        <button
                            onClick={() => onChange({ model3dSrc: null })}
                            className="p-2 bg-red-900/40 hover:bg-red-800 text-red-300 hover:text-white rounded-xl border border-red-700/50 transition-colors"
                            title="GLB-Modell entfernen"
                        >
                            <Trash size={16} />
                        </button>
                    )}
                </div>
            </div>

            <div className="bg-gray-800 p-4 rounded border border-gray-700">
                <h4 className="font-bold text-gray-400 mb-4 text-xs uppercase">Additional Emotions (Visual Novel)</h4>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <ImageField 
                        label="Happy" 
                        value={character.emotions?.happy || null} 
                        onChange={val => onChange({ emotions: { ...character.emotions, happy: val } })} 
                        assets={assets}
                        defaultPrompt={`${character.name}, happy expression, smile, ${character.defaultDescription || ''}, anime visual novel style, high quality, white background`}
                    />
                    <ImageField 
                        label="Angry" 
                        value={character.emotions?.angry || null} 
                        onChange={val => onChange({ emotions: { ...character.emotions, angry: val } })} 
                        assets={assets}
                        defaultPrompt={`${character.name}, angry expression, scowling, ${character.defaultDescription || ''}, anime visual novel style, high quality, white background`}
                    />
                    <ImageField 
                        label="Thoughtful" 
                        value={character.emotions?.thoughtful || null} 
                        onChange={val => onChange({ emotions: { ...character.emotions, thoughtful: val } })} 
                        assets={assets}
                        defaultPrompt={`${character.name}, thoughtful expression, hand on chin, ${character.defaultDescription || ''}, anime visual novel style, high quality, white background`}
                    />
                    <ImageField 
                        label="Shy" 
                        value={character.emotions?.shy || null} 
                        onChange={val => onChange({ emotions: { ...character.emotions, shy: val } })} 
                        assets={assets}
                        defaultPrompt={`${character.name}, shy expression, blushing, slight smile, ${character.defaultDescription || ''}, anime visual novel style, high quality, white background`}
                    />
                    <ImageField 
                        label="Sad" 
                        value={character.emotions?.sad || null} 
                        onChange={val => onChange({ emotions: { ...character.emotions, sad: val } })} 
                        assets={assets}
                        defaultPrompt={`${character.name}, sad expression, tearing up, looking down, ${character.defaultDescription || ''}, anime visual novel style, high quality, white background`}
                    />
                    <ImageField 
                        label="Shocked" 
                        value={character.emotions?.shocked || null} 
                        onChange={val => onChange({ emotions: { ...character.emotions, shocked: val } })} 
                        assets={assets}
                        defaultPrompt={`${character.name}, shocked expression, wide eyes, open mouth, ${character.defaultDescription || ''}, anime visual novel style, high quality, white background`}
                    />
                    <ImageField 
                        label="Worried" 
                        value={character.emotions?.worried || null} 
                        onChange={val => onChange({ emotions: { ...character.emotions, worried: val } })} 
                        assets={assets}
                        defaultPrompt={`${character.name}, worried expression, sweat drop, anxious, ${character.defaultDescription || ''}, anime visual novel style, high quality, white background`}
                    />
                    <ImageField 
                        label="Lustful" 
                        value={character.emotions?.lustful || null} 
                        onChange={val => onChange({ emotions: { ...character.emotions, lustful: val } })} 
                        assets={assets}
                        defaultPrompt={`${character.name}, starry romantic eyes, slight blush, happy smile, ${character.defaultDescription || ''}, anime visual novel style, high quality, white background`}
                    />
                </div>
            </div>

            {/* RELATIONSHIP SYSTEM EDITOR */}
            <div className="bg-gray-800 p-4 rounded border border-gray-700">
                <div className="flex justify-between items-center mb-4">
                     <h4 className="font-bold text-pink-400 flex items-center gap-2"><Heart size={16}/> Relationship System</h4>
                     <label className="flex items-center gap-2 text-xs bg-gray-900 px-2 py-1 rounded border border-gray-600">
                         <input 
                            type="checkbox" 
                            checked={character.relationship?.enabled || false} 
                            onChange={e => updateRelationship({ enabled: e.target.checked })} 
                         />
                         Enabled
                     </label>
                </div>
                
                {character.relationship?.enabled ? (
                    <div className="space-y-6">
                        {/* Basic Values */}
                        <div className="grid grid-cols-2 gap-4">
                             <div>
                                 <label className="text-xs font-bold text-gray-500 uppercase">Start Value</label>
                                 <input type="number" className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white" value={character.relationship.startValue} onChange={e => updateRelationship({ startValue: parseInt(e.target.value), currentValue: parseInt(e.target.value) })} />
                             </div>
                             <div>
                                 <label className="text-xs font-bold text-gray-500 uppercase">Current (Debug)</label>
                                 <input type="number" className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white" value={character.relationship.currentValue} onChange={e => updateRelationship({ currentValue: parseInt(e.target.value) })} />
                             </div>
                        </div>

                        {/* TRIGGERS */}
                        <div>
                            <div className="flex justify-between items-center mb-2">
                                <label className="text-xs font-bold text-gray-500 uppercase">Interaction Triggers (AI Rules)</label>
                                <Button onClick={() => updateRelationship({ triggers: [...character.relationship!.triggers, { id: crypto.randomUUID(), description: 'New Trigger', valueChange: 5 }] })} className="px-2 py-0 text-xs"><Plus size={12}/></Button>
                            </div>
                            <div className="space-y-2">
                                {character.relationship.triggers.map((t, i) => (
                                    <div key={t.id} className="flex items-center gap-2 bg-gray-900 p-2 rounded">
                                        <input 
                                            className="flex-1 bg-transparent border-b border-gray-700 text-xs text-white outline-none" 
                                            value={t.description} 
                                            onChange={e => {
                                                const newTriggers = [...character.relationship!.triggers];
                                                newTriggers[i] = { ...t, description: e.target.value };
                                                updateRelationship({ triggers: newTriggers });
                                            }}
                                            placeholder="e.g. Player is rude..."
                                        />
                                        <input 
                                            type="number"
                                            className={`w-12 bg-gray-800 text-xs text-center rounded border ${t.valueChange > 0 ? 'border-green-500 text-green-400' : 'border-red-500 text-red-400'}`}
                                            value={t.valueChange}
                                            onChange={e => {
                                                const newTriggers = [...character.relationship!.triggers];
                                                newTriggers[i] = { ...t, valueChange: parseInt(e.target.value) };
                                                updateRelationship({ triggers: newTriggers });
                                            }}
                                        />
                                        <button onClick={() => updateRelationship({ triggers: character.relationship!.triggers.filter(x => x.id !== t.id) })} className="text-gray-500 hover:text-red-500"><Trash size={12}/></button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* THRESHOLDS */}
                        <div>
                            <div className="flex justify-between items-center mb-2">
                                <label className="text-xs font-bold text-gray-500 uppercase">Stages / Thresholds</label>
                                <Button onClick={() => updateRelationship({ thresholds: [...character.relationship!.thresholds, { id: crypto.randomUUID(), label: 'Neutral', valueStart: 0, description: 'Acts politely.' }] })} className="px-2 py-0 text-xs"><Plus size={12}/></Button>
                            </div>
                            <div className="space-y-3">
                                {character.relationship.thresholds.sort((a,b) => b.valueStart - a.valueStart).map((t, i) => (
                                    <div key={t.id} className="bg-gray-900 p-3 rounded border border-gray-700">
                                        <div className="flex gap-2 mb-2">
                                             <div className="w-20">
                                                 <label className="text-[10px] text-gray-500 block">Min Value</label>
                                                 <input 
                                                    type="number"
                                                    className="w-full bg-gray-800 text-xs p-1 rounded border border-gray-600 text-white"
                                                    value={t.valueStart}
                                                    onChange={e => {
                                                        const newThresholds = [...character.relationship!.thresholds];
                                                        const idx = newThresholds.findIndex(x => x.id === t.id);
                                                        newThresholds[idx] = { ...t, valueStart: parseInt(e.target.value) };
                                                        updateRelationship({ thresholds: newThresholds });
                                                    }}
                                                 />
                                             </div>
                                             <div className="flex-1">
                                                 <label className="text-[10px] text-gray-500 block">Label</label>
                                                  <input 
                                                    className="w-full bg-gray-800 text-xs p-1 rounded border border-gray-600 text-white"
                                                    value={t.label}
                                                    onChange={e => {
                                                        const newThresholds = [...character.relationship!.thresholds];
                                                        const idx = newThresholds.findIndex(x => x.id === t.id);
                                                        newThresholds[idx] = { ...t, label: e.target.value };
                                                        updateRelationship({ thresholds: newThresholds });
                                                    }}
                                                 />
                                             </div>
                                             <button onClick={() => updateRelationship({ thresholds: character.relationship!.thresholds.filter(x => x.id !== t.id) })} className="text-gray-500 hover:text-red-500 mt-4"><Trash size={14}/></button>
                                        </div>
                                        <textarea 
                                            className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-xs text-gray-300 h-16"
                                            placeholder="Behavior description for this stage..."
                                            value={t.description}
                                            onChange={e => {
                                                const newThresholds = [...character.relationship!.thresholds];
                                                const idx = newThresholds.findIndex(x => x.id === t.id);
                                                newThresholds[idx] = { ...t, description: e.target.value };
                                                updateRelationship({ thresholds: newThresholds });
                                            }}
                                        />
                                        <div className="mt-2">
                                            <label className="text-[10px] text-indigo-300/80 block mb-0.5 font-medium">
                                                Roadmap-Notizen (erzählerischer Leitfaden für diese Stufe, optional)
                                            </label>
                                            <textarea 
                                                className="w-full bg-gray-800/90 border border-indigo-900/40 focus:border-indigo-500 rounded p-2 text-xs text-gray-300 h-16"
                                                placeholder="z.B. Nur vorsichtige Annäherung erlaubt, noch keine echten Liebesgeständnisse möglich..."
                                                value={t.roadmapNotes || ''}
                                                onChange={e => {
                                                    const newThresholds = [...character.relationship!.thresholds];
                                                    const idx = newThresholds.findIndex(x => x.id === t.id);
                                                    newThresholds[idx] = { ...t, roadmapNotes: e.target.value };
                                                    updateRelationship({ thresholds: newThresholds });
                                                }}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* KEY MOMENTS (PERSISTENT MEMORY) */}
                        <div>
                            <div className="flex justify-between items-center mb-2">
                                <label className="text-xs font-bold text-gray-500 uppercase">
                                    Schlüsselmomente / Key Moments ({character.relationship.keyMoments?.length || 0}/10)
                                </label>
                            </div>
                            {(!character.relationship.keyMoments || character.relationship.keyMoments.length === 0) ? (
                                <div className="bg-gray-900/60 border border-dashed border-gray-700/60 rounded-lg p-3 text-center text-xs text-gray-500 italic">
                                    Noch keine Schlüsselmomente aufgezeichnet. (Werden im Spiel automatisch bei Beziehungsänderungen &ge; &plusmn;5 festgehalten).
                                </div>
                            ) : (
                                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                                    {character.relationship.keyMoments.map((km) => {
                                        const isPos = km.emotionalTone === 'positive' || km.impact > 0;
                                        const isNeg = km.emotionalTone === 'negative' || km.impact < 0;
                                        const containerStyle = isPos 
                                            ? 'text-emerald-300 border-emerald-800/60 bg-emerald-950/30' 
                                            : isNeg 
                                                ? 'text-rose-300 border-rose-800/60 bg-rose-950/30' 
                                                : 'text-gray-300 border-gray-700 bg-gray-900/40';
                                        const badgeStyle = isPos 
                                            ? 'bg-emerald-900/80 text-emerald-300 border-emerald-600/50' 
                                            : isNeg 
                                                ? 'bg-rose-900/80 text-rose-300 border-rose-600/50' 
                                                : 'bg-gray-800 text-gray-400 border-gray-600';
                                        
                                        const formattedTime = km.timestamp ? new Date(km.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

                                        return (
                                            <div key={km.id} className={`flex items-center justify-between p-2 rounded border text-xs ${containerStyle}`}>
                                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border flex-shrink-0 ${badgeStyle}`}>
                                                        {km.impact > 0 ? `+${km.impact}` : km.impact}
                                                    </span>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="truncate font-medium text-gray-200" title={km.description}>
                                                            {km.description}
                                                        </div>
                                                        <div className="flex items-center gap-2 text-[10px] text-gray-400 mt-0.5">
                                                            {km.sceneName && <span>Szene: {km.sceneName}</span>}
                                                            {formattedTime && <span>• {formattedTime}</span>}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                    </div>
                ) : (
                    <div className="mb-4">
                        <label className="text-xs font-bold text-gray-500 uppercase">Legacy / Simple Relation</label>
                        <input 
                            className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm text-white" 
                            placeholder="e.g. Secretly admires them, Suspicious of them..."
                            value={character.playerRelation || ''} 
                            onChange={e => onChange({ playerRelation: e.target.value })} 
                        />
                        <p className="text-[10px] text-gray-500 mt-1">Enable the full system above for numerical tracking.</p>
                    </div>
                )}
            </div>
            
            {/* Battle stats (new battle system, stage 1) */}
            <BattleStatsEditor character={character} onChange={onChange} />
        </div>
    );
};

interface SceneEditorProps {
    scene: Scene;
    allScenes: Scene[];
    allMaps: WorldMap[];
    characters: Character[];
    chapters: Chapter[];
    worldInfo: WorldInfo;
    assets?: AssetItem[];
    onChange: (u: Partial<Scene>) => void;
    onDelete: () => void;
}

const SceneEditor: React.FC<SceneEditorProps> = ({ scene, allScenes, allMaps, characters, chapters, worldInfo, assets, onChange, onDelete }) => {
    const toggleEffect = (type: 'scene' | 'transition', targetId: string, action: 'unlock' | 'lock') => {
        const effects = scene.effects ? [...scene.effects] : [];
        const index = effects.findIndex(e => e.type === type && e.targetId === targetId);

        if (index >= 0) {
            if (effects[index].action === action) effects.splice(index, 1);
            else effects[index] = { ...effects[index], action };
        } else {
            effects.push({ type, targetId, action });
        }
        onChange({ effects });
    };

    return (
        <div className="space-y-6 max-w-3xl vn-panel bg-gray-900/80 p-6">
            <div className="flex justify-between items-center">
                <h3 className="text-xl font-bold text-emerald-400">Editing: {scene.name}</h3>
                <div className="flex gap-2">
                    <label className="flex items-center gap-2 text-xs bg-gray-800 px-3 py-1 rounded border border-gray-700">
                        <input type="checkbox" checked={scene.isRepeatable} onChange={e => onChange({ isRepeatable: e.target.checked })} />
                        Repeatable
                    </label>
                    <button onClick={onDelete} className="text-red-500 hover:bg-red-900/20 p-2 rounded"><Trash size={18}/></button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                 <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">Scene Name</label>
                    <input className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" value={scene.name} onChange={e => onChange({ name: e.target.value })} />
                 </div>
                 <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">Chapter / Kapitel</label>
                    <select className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" value={scene.chapterId || ''} onChange={e => onChange({ chapterId: e.target.value })}>
                        {chapters.map((c) => <option key={c.id} value={c.id}>{c.name || 'Unnamed Chapter'}</option>)}
                    </select>
                 </div>
                 <div>
                    <label className="text-xs font-bold text-sky-400 uppercase flex items-center gap-1">
                        <MapIcon size={12}/> World Map / Karte
                    </label>
                    <select 
                        className="w-full bg-gray-800 border border-sky-800/80 focus:border-sky-500 rounded p-2 text-white text-xs" 
                        value={scene.mapId !== undefined ? scene.mapId : (allMaps.find(m => m.spots?.some(spot => spot.type === 'scene' && spot.sceneId === scene.id))?.id || '')} 
                        onChange={e => onChange({ mapId: e.target.value || undefined })}
                    >
                        <option value="">-- Keine Karte zugewiesen --</option>
                        {allMaps.map((m) => {
                            const hasSpot = m.spots?.some(s => s.type === 'scene' && s.sceneId === scene.id);
                            return (
                                <option key={m.id} value={m.id}>
                                    {m.name || 'Unbenannte Karte'} {hasSpot ? '(auf Map platziert)' : ''}
                                </option>
                            );
                        })}
                    </select>
                 </div>
                 <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">Reihenfolge (Order)</label>
                    <input 
                        type="number" 
                        className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" 
                        value={scene.order ?? 1} 
                        onChange={e => onChange({ order: parseInt(e.target.value) || 1 })} 
                    />
                 </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 bg-gray-800/60 p-3 rounded-lg border border-gray-700">
                <span className="text-xs font-bold text-gray-300">Szenen-Typ / Relevanz:</span>
                <label className="flex items-center gap-2 text-xs text-emerald-300 cursor-pointer">
                    <input 
                        type="radio" 
                        name={`sceneType_${scene.id}`} 
                        checked={scene.isMainScene !== false} 
                        onChange={() => onChange({ isMainScene: true })} 
                    />
                    ★ Hauptszene (Story-relevant)
                </label>
                <label className="flex items-center gap-2 text-xs text-amber-300 cursor-pointer">
                    <input 
                        type="radio" 
                        name={`sceneType_${scene.id}`} 
                        checked={scene.isMainScene === false} 
                        onChange={() => onChange({ isMainScene: false })} 
                    />
                    ✦ Nebenszene (Optional / Side Quest)
                </label>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <ImageField 
                    label="Background Image" 
                    value={scene.backgroundSrc} 
                    onChange={val => onChange({ backgroundSrc: val })} 
                    assets={assets}
                    defaultPrompt={`${scene.name}, ${scene.description || ''}, ${scene.sensoryDetails || ''}, anime visual novel scenery background illustration, beautiful digital painting, colorful, high resolution`}
                />
                <VideoField label="Intro Video (Optional)" value={scene.introVideoSrc || null} onChange={val => onChange({ introVideoSrc: val })} />
            </div>

            <AudioField label="Background Music (Loop)" value={scene.bgmUrl || null} onChange={val => onChange({ bgmUrl: val || undefined })} />

            <div>
                <label className="text-xs font-bold text-gray-500 uppercase">Visible Description (Player)</label>
                <textarea className="w-full bg-gray-800 border border-gray-700 rounded p-2 h-20 text-white" value={scene.description} onChange={e => onChange({ description: e.target.value })} />
            </div>

            {/* AI CONTEXT SECTION (RESTORED) */}
            <div className="space-y-3 border-l-2 border-emerald-500/30 pl-4 my-4 bg-emerald-900/10 p-3 rounded-r-lg">
                 <h4 className="text-sm font-bold text-emerald-400 flex items-center gap-2"><EyeOff size={14}/> AI Context (Hidden from Player)</h4>
                 
                 <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase flex items-center gap-2"><Terminal size={10}/> Internal Instructions / Logic</label>
                    <textarea 
                        className="w-full bg-gray-900 border border-gray-700 rounded p-2 h-20 text-xs text-emerald-200 font-mono focus:border-emerald-500 outline-none" 
                        placeholder="e.g. The guard is secretly bribed. Speak in a whisper. Do not mention the artifact yet."
                        value={scene.aiInstructions || ''} 
                        onChange={e => onChange({ aiInstructions: e.target.value })} 
                    />
                 </div>

                 <div className="grid grid-cols-2 gap-4">
                     <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase">Sensory Details</label>
                        <textarea 
                            className="w-full bg-gray-900 border border-gray-700 rounded p-2 h-16 text-xs text-gray-300 focus:border-emerald-500 outline-none" 
                            placeholder="Smells, sounds, temperature, lighting..."
                            value={scene.sensoryDetails || ''} 
                            onChange={e => onChange({ sensoryDetails: e.target.value })} 
                        />
                     </div>
                     <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase">Environment / Layout</label>
                        <textarea 
                            className="w-full bg-gray-900 border border-gray-700 rounded p-2 h-16 text-xs text-gray-300 focus:border-emerald-500 outline-none" 
                            placeholder="Room size, exits, object placement, cover..."
                            value={scene.environmentDetails || ''} 
                            onChange={e => onChange({ environmentDetails: e.target.value })} 
                        />
                     </div>
                 </div>
            </div>
            
            <div>
                <label className="text-xs font-bold text-gray-500 uppercase">Win Condition / Goal</label>
                <input className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-emerald-400 font-medium" placeholder="e.g. Find the key, Convince the guard..." value={scene.goal} onChange={e => onChange({ goal: e.target.value })} />
            </div>

            <div className="bg-gray-800 p-4 rounded-xl border border-gray-700">
                <label className="flex items-center gap-2 text-sm font-bold text-emerald-400 mb-4"><Users size={18} /> CHARACTERS & ROLES</label>
                <div className="space-y-4">
                    {CHARACTER_GROUPS.map(group => {
                        const groupChars = characters.filter(c => getCharacterGroupKey(c) === group.id);
                        if (groupChars.length === 0) return null;
                        return (
                            <div key={group.id} className="space-y-1.5">
                                <div className="text-xs font-bold text-gray-400 flex items-center gap-1.5 pb-1 border-b border-gray-700/60">
                                    <span>{group.icon}</span> <span>{group.label}</span>
                                </div>
                                {groupChars.map(c => {
                                    const inScene = scene.characters.find((sc) => sc.characterId === c.id);
                                    return (
                                        <div key={c.id} className={`flex items-center gap-3 p-2 rounded border ${inScene ? 'bg-emerald-900/30 border-emerald-500' : 'bg-gray-900 border-gray-700 opacity-60'}`}>
                                            <input 
                                                type="checkbox" 
                                                checked={!!inScene} 
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        onChange({ characters: [...scene.characters, { characterId: c.id, roleInScene: 'Default' }] });
                                                    } else {
                                                        onChange({ characters: scene.characters.filter((sc) => sc.characterId !== c.id) });
                                                    }
                                                }}
                                            />
                                            <div className="w-28 font-bold truncate text-white text-xs">{c.name}</div>
                                            <input 
                                                className="flex-1 bg-transparent border-b border-gray-600 text-xs focus:border-emerald-500 outline-none text-white" 
                                                placeholder="Role in this scene..."
                                                disabled={!inScene}
                                                value={inScene?.roleInScene || ''}
                                                onChange={(e) => {
                                                    const newChars = scene.characters.map((sc) => sc.characterId === c.id ? { ...sc, roleInScene: e.target.value } : sc);
                                                    onChange({ characters: newChars });
                                                }}
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="bg-gray-800 p-4 rounded-xl border border-gray-700">
                <label className="flex items-center gap-2 text-sm font-bold text-emerald-400 mb-4"><Book size={18} /> LORE SCOPING</label>
                
                {/* Lore-Scoping: Factions */}
                <details className="bg-gray-900 rounded-lg p-3">
                  <summary className="cursor-pointer font-semibold text-gray-200">
                    Relevant Factions
                    <span className="text-xs text-gray-400 ml-2">
                      ({scene.relevantFactionIds?.length ?? 0} of {worldInfo.factions?.length || 0} selected)
                    </span>
                  </summary>
                  <p className="text-xs text-gray-400 mt-2 mb-3">
                    Select factions relevant to this scene. If none are selected, ALL factions are loaded (Fallback).
                  </p>
                  <div className="flex gap-2 mb-2">
                    <button 
                      className="text-xs px-2 py-1 bg-gray-700 rounded hover:bg-gray-600 text-white" 
                      onClick={() => onChange({ relevantFactionIds: worldInfo.factions?.map(f => f.id) || [] })}
                    >
                      Select All
                    </button>
                    <button 
                      className="text-xs px-2 py-1 bg-gray-700 rounded hover:bg-gray-600 text-white" 
                      onClick={() => onChange({ relevantFactionIds: [] })}
                    >
                      Select None
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto custom-scrollbar">
                    {worldInfo.factions?.map(faction => {
                      const isSelected = scene.relevantFactionIds?.includes(faction.id) ?? false;
                      return (
                        <label key={faction.id} className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer hover:bg-gray-700 p-1 rounded">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              const currentIds = scene.relevantFactionIds ?? [];
                              const newIds = e.target.checked
                                ? [...currentIds, faction.id]
                                : currentIds.filter(id => id !== faction.id);
                              onChange({ relevantFactionIds: newIds });
                            }}
                          />
                          <span className="truncate" title={faction.name}>{faction.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </details>

                {/* Lore-Scoping: Locations */}
                <details className="bg-gray-900 rounded-lg p-3 mt-2">
                  <summary className="cursor-pointer font-semibold text-gray-200">
                    Relevant Lore Locations
                    <span className="text-xs text-gray-400 ml-2">
                      ({scene.relevantLocationIds?.length ?? 0} of {worldInfo.loreLocations?.length || 0} selected)
                    </span>
                  </summary>
                  <p className="text-xs text-gray-400 mt-2 mb-3">
                    Select locations relevant to this scene. If none are selected, ALL locations are loaded.
                  </p>
                  <div className="flex gap-2 mb-2">
                    <button 
                      className="text-xs px-2 py-1 bg-gray-700 rounded hover:bg-gray-600 text-white" 
                      onClick={() => onChange({ relevantLocationIds: worldInfo.loreLocations?.map(l => l.id) || [] })}
                    >
                      Select All
                    </button>
                    <button 
                      className="text-xs px-2 py-1 bg-gray-700 rounded hover:bg-gray-600 text-white" 
                      onClick={() => onChange({ relevantLocationIds: [] })}
                    >
                      Select None
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto custom-scrollbar">
                    {worldInfo.loreLocations?.map(location => {
                      const isSelected = scene.relevantLocationIds?.includes(location.id) ?? false;
                      return (
                        <label key={location.id} className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer hover:bg-gray-700 p-1 rounded">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              const currentIds = scene.relevantLocationIds ?? [];
                              const newIds = e.target.checked
                                ? [...currentIds, location.id]
                                : currentIds.filter(id => id !== location.id);
                              onChange({ relevantLocationIds: newIds });
                            }}
                          />
                          <span className="truncate" title={location.name}>{location.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </details>
            </div>

            <div className="bg-gray-800 p-4 rounded-xl border border-gray-700">
                <label className="flex items-center gap-2 text-sm font-bold text-yellow-500 mb-4"><Unlock size={18} /> SCENE COMPLETION EFFECTS</label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-h-60 overflow-y-auto custom-scrollbar p-1">
                    <div className="space-y-2">
                        <div className="text-xs font-bold text-gray-500 uppercase sticky top-0 bg-gray-800 py-1 z-10">Other Scenes</div>
                        {allScenes.filter(s => s.id !== scene.id).map((otherScene) => {
                            const effect = scene.effects?.find(u => u.type === 'scene' && u.targetId === otherScene.id);
                            const status = effect?.action || 'neutral';
                            return (
                                <div key={otherScene.id} className="flex items-center justify-between bg-gray-900 p-2 rounded border border-gray-700">
                                    <div className="flex items-center gap-2 truncate flex-1">
                                        <MessageSquare size={14} className="text-gray-500"/>
                                        <span className="text-xs text-gray-300 truncate" title={otherScene.name}>{otherScene.name}</span>
                                    </div>
                                    <div className="flex gap-1 ml-2">
                                        <button onClick={() => toggleEffect('scene', otherScene.id, 'unlock')} className={`p-1 rounded ${status === 'unlock' ? 'bg-emerald-600 text-white' : 'bg-gray-800 text-gray-500 hover:bg-gray-700'}`} title="Unlock"><Unlock size={12}/></button>
                                        <button onClick={() => toggleEffect('scene', otherScene.id, 'lock')} className={`p-1 rounded ${status === 'lock' ? 'bg-red-600 text-white' : 'bg-gray-800 text-gray-500 hover:bg-gray-700'}`} title="Lock"><Lock size={12}/></button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    <div className="space-y-2">
                        <div className="text-xs font-bold text-gray-500 uppercase sticky top-0 bg-gray-800 py-1 z-10">Map Transitions</div>
                        {allMaps.map((m) => {
                            const effect = scene.effects?.find(u => u.type === 'transition' && u.targetId === m.id);
                            const status = effect?.action || 'neutral';
                            return (
                                <div key={m.id} className="flex items-center justify-between bg-gray-900 p-2 rounded border border-gray-700">
                                    <div className="flex items-center gap-2 truncate flex-1">
                                        <Waypoints size={14} className="text-emerald-500"/>
                                        <span className="text-xs text-gray-300 truncate" title={m.name}>To: {m.name}</span>
                                    </div>
                                    <div className="flex gap-1 ml-2">
                                        <button onClick={() => toggleEffect('transition', m.id, 'unlock')} className={`p-1 rounded ${status === 'unlock' ? 'bg-emerald-600 text-white' : 'bg-gray-800 text-gray-500 hover:bg-gray-700'}`} title="Unlock"><Unlock size={12}/></button>
                                        <button onClick={() => toggleEffect('transition', m.id, 'lock')} className={`p-1 rounded ${status === 'lock' ? 'bg-red-600 text-white' : 'bg-gray-800 text-gray-500 hover:bg-gray-700'}`} title="Lock"><Lock size={12}/></button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};

interface MapEditorProps {
    map: WorldMap;
    scenes: Scene[];
    characters: Character[];
    allMaps: WorldMap[];
    dungeons?: DungeonProject[];
    assets?: AssetItem[];
    onChange: (u: Partial<WorldMap>) => void;
    onDelete: () => void;
}

const MapEditor: React.FC<MapEditorProps> = ({ map, scenes, characters, allMaps, dungeons = [], assets, onChange, onDelete }) => {
    const [selectedSpotId, setSelectedSpotId] = useState<string | null>(null);
    const [draggingSpotId, setDraggingSpotId] = useState<string | null>(null);
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const isDraggingRef = useRef(false);
    const startMousePosRef = useRef<{ x: number; y: number } | null>(null);

    // Helper to update spots
    const updateSpot = (id: string, u: Partial<MapSpot>) => {
        onChange({ spots: map.spots.map(s => s.id === id ? { ...s, ...u } : s) });
    };

    const handleSpotMouseDown = (e: React.MouseEvent, spot: MapSpot) => {
        e.stopPropagation();
        e.preventDefault();
        setDraggingSpotId(spot.id);
        setSelectedSpotId(spot.id);
        isDraggingRef.current = false;
        startMousePosRef.current = { x: e.clientX, y: e.clientY };

        const handleMouseMove = (moveEvent: MouseEvent) => {
            if (!mapContainerRef.current || !startMousePosRef.current) return;

            const dx = moveEvent.clientX - startMousePosRef.current.x;
            const dy = moveEvent.clientY - startMousePosRef.current.y;

            if (Math.hypot(dx, dy) > 4) {
                isDraggingRef.current = true;
            }

            if (isDraggingRef.current) {
                const rect = mapContainerRef.current.getBoundingClientRect();
                const newX = Math.max(1, Math.min(99, ((moveEvent.clientX - rect.left) / rect.width) * 100));
                const newY = Math.max(1, Math.min(99, ((moveEvent.clientY - rect.top) / rect.height) * 100));
                
                updateSpot(spot.id, { 
                    x: Math.round(newX * 10) / 10, 
                    y: Math.round(newY * 10) / 10 
                });
            }
        };

        const handleMouseUp = () => {
            setDraggingSpotId(null);
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    };

    const handleCanvasContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();

        const rect = e.currentTarget.getBoundingClientRect();
        const x = Math.round((((e.clientX - rect.left) / rect.width) * 100) * 10) / 10;
        const y = Math.round((((e.clientY - rect.top) / rect.height) * 100) * 10) / 10;

        const newSpot: MapSpot = {
            id: crypto.randomUUID(),
            x, y,
            type: 'scene'
        };
        onChange({ spots: [...map.spots, newSpot] });
        setSelectedSpotId(newSpot.id);
    };

    const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (isDraggingRef.current) {
            isDraggingRef.current = false;
            return;
        }
        // Left clicking empty space deselects spot
        setSelectedSpotId(null);
    };

    const selectedSpot = map.spots.find(s => s.id === selectedSpotId);

    // Calculate smart popup placement to prevent screen boundary overflowing
    const getPopupStyle = (spot: MapSpot) => {
        const isRightHalf = spot.x > 50;
        const isBottomHalf = spot.y > 50;

        return {
            left: isRightHalf ? 'auto' : `${Math.min(spot.x, 60)}%`,
            right: isRightHalf ? `${Math.min(100 - spot.x, 60)}%` : 'auto',
            top: isBottomHalf ? 'auto' : `${Math.min(spot.y, 50)}%`,
            bottom: isBottomHalf ? `${Math.min(100 - spot.y, 50)}%` : 'auto',
        };
    };

    return (
        <div className="space-y-6 max-w-3xl vn-panel bg-gray-900/80 p-6">
             <div className="flex justify-between items-center">
                <h3 className="text-xl font-bold text-emerald-400">Editing: {map.name}</h3>
                <button onClick={onDelete} className="text-red-500 hover:bg-red-900/20 p-2 rounded"><Trash size={18}/></button>
            </div>

            <div>
                <label className="text-xs font-bold text-gray-500 uppercase">Map Name</label>
                <input className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" value={map.name} onChange={e => onChange({ name: e.target.value })} />
            </div>

            <ImageField 
                label="Map Image" 
                value={map.backgroundSrc} 
                onChange={val => onChange({ backgroundSrc: val })} 
                assets={assets}
                defaultPrompt={`${map.name}, gorgeous fantasy top-down map, regional layout map design, rpg game map, hand-drawn digital painting, clean vector shapes, highly detailed`}
            />

            <AudioField label="Background Music (Loop)" value={map.bgmUrl || null} onChange={val => onChange({ bgmUrl: val || undefined })} />

            <div>
                <div className="flex justify-between items-center mb-1.5">
                    <label className="text-xs font-bold text-emerald-400 uppercase flex items-center gap-1">
                        <MapPin size={14} /> Map Canvas & Spots
                    </label>
                    <span className="text-[11px] text-gray-400 italic">
                        Rechtsklick: Spot erstellen | Linksklick: Auswählen | Drag & Drop: Verschieben
                    </span>
                </div>

                <div 
                    ref={mapContainerRef}
                    className="relative w-full aspect-video bg-gray-800 border border-gray-600 rounded overflow-hidden cursor-crosshair group select-none"
                    onClick={handleCanvasClick}
                    onContextMenu={handleCanvasContextMenu}
                >
                    {map.backgroundSrc ? (
                        <AsyncImage src={map.backgroundSrc} className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity pointer-events-none" />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-500 pointer-events-none">Rechtsklick auf die Karte um Spots hinzuzufügen</div>
                    )}
                    
                    {/* Render Spots */}
                    {map.spots.map(spot => {
                        const isSelected = selectedSpotId === spot.id;
                        const isDragging = draggingSpotId === spot.id;
                        return (
                            <div 
                                key={spot.id} 
                                onMouseDown={(e) => handleSpotMouseDown(e, spot)}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedSpotId(spot.id);
                                }}
                                onContextMenu={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setSelectedSpotId(spot.id);
                                }}
                                className={`absolute w-7 h-7 -ml-3.5 -mt-3.5 rounded-full border-2 shadow-xl flex items-center justify-center text-xs font-bold z-20 cursor-grab active:cursor-grabbing transition-transform select-none ${
                                    isSelected 
                                        ? 'bg-amber-400 text-black border-white scale-125 ring-4 ring-amber-400/50 z-30' 
                                        : isDragging
                                            ? 'bg-sky-400 text-black border-white scale-125 shadow-2xl z-30'
                                            : 'bg-emerald-500 text-white border-white hover:scale-110 hover:bg-emerald-400'
                                }`}
                                style={{ left: `${spot.x}%`, top: `${spot.y}%` }}
                                title={`Spot: ${spot.type.toUpperCase()} (${Math.round(spot.x)}%, ${Math.round(spot.y)}%) - Klicken zum Bearbeiten, Ziehen zum Verschieben`}
                            >
                                {spot.type[0].toUpperCase()}
                            </div>
                        );
                    })}

                    {/* Pop-up Inspector for Selected Spot */}
                    {selectedSpot && (
                        <div 
                            className="absolute z-40 w-72 bg-gray-900/95 border border-amber-500/80 rounded-xl p-3.5 shadow-2xl backdrop-blur-md text-xs space-y-2.5 pointer-events-auto max-h-[90%] overflow-y-auto animate-in fade-in zoom-in-95"
                            style={getPopupStyle(selectedSpot)}
                            onClick={e => e.stopPropagation()}
                            onMouseDown={e => e.stopPropagation()}
                        >
                            <div className="flex justify-between items-center border-b border-gray-700/80 pb-1.5">
                                <div className="flex items-center gap-1.5 text-amber-400 font-bold text-xs">
                                    <MapPin size={14} />
                                    <span>Spot Bearbeiten</span>
                                    <span className="text-[10px] text-gray-400 font-normal">({Math.round(selectedSpot.x)}%, {Math.round(selectedSpot.y)}%)</span>
                                </div>
                                <button 
                                    onClick={() => setSelectedSpotId(null)}
                                    className="text-gray-400 hover:text-white p-0.5 rounded hover:bg-gray-800 transition-colors"
                                    title="Schließen"
                                >
                                    <X size={14} />
                                </button>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="text-[10px] font-bold text-gray-400 uppercase">Typ</label>
                                    <select 
                                        className="w-full bg-gray-800 border border-gray-700 rounded p-1.5 text-xs text-white focus:border-amber-500 focus:outline-none"
                                        value={selectedSpot.type}
                                        onChange={e => updateSpot(selectedSpot.id, { type: e.target.value as any })}
                                    >
                                        <option value="scene">Scene</option>
                                        <option value="character">Character</option>
                                        <option value="transition">Transition</option>
                                        <option value="dungeon">Dungeon</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-gray-400 uppercase">Ziel (Target)</label>
                                    <select 
                                        className="w-full bg-gray-800 border border-gray-700 rounded p-1.5 text-xs text-white focus:border-amber-500 focus:outline-none"
                                        value={selectedSpot.sceneId || selectedSpot.characterId || selectedSpot.targetMapId || selectedSpot.dungeonId || ''}
                                        onChange={e => {
                                            const val = e.target.value;
                                            if (selectedSpot.type === 'scene') updateSpot(selectedSpot.id, { sceneId: val });
                                            if (selectedSpot.type === 'character') updateSpot(selectedSpot.id, { characterId: val });
                                            if (selectedSpot.type === 'transition') updateSpot(selectedSpot.id, { targetMapId: val });
                                            if (selectedSpot.type === 'dungeon') updateSpot(selectedSpot.id, { dungeonId: val });
                                        }}
                                    >
                                        <option value="">-- Auswählen --</option>
                                        {selectedSpot.type === 'scene' && scenes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                        {selectedSpot.type === 'character' && characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                        {selectedSpot.type === 'transition' && allMaps.filter(m => m.id !== map.id).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                                        {selectedSpot.type === 'dungeon' && dungeons.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="text-[10px] font-bold text-gray-400 uppercase">Visual Override (Sprite)</label>
                                <select 
                                    className="w-full bg-gray-800 border border-gray-700 rounded p-1.5 text-xs text-white focus:border-amber-500 focus:outline-none"
                                    value={selectedSpot.visualCharacterId || ''}
                                    onChange={e => updateSpot(selectedSpot.id, { visualCharacterId: e.target.value || undefined })}
                                >
                                    <option value="">Standard Icon</option>
                                    {characters.map(c => <option key={c.id} value={c.id}>{c.name} (Sprite)</option>)}
                                </select>
                            </div>

                            <div className="grid grid-cols-2 gap-2 pt-1">
                                <div>
                                    <label className="text-[9px] text-gray-500 uppercase font-bold">X Position (%)</label>
                                    <input 
                                        type="number"
                                        min="0"
                                        max="100"
                                        className="w-full bg-gray-800 border border-gray-700 rounded p-1 text-xs text-white"
                                        value={selectedSpot.x}
                                        onChange={e => updateSpot(selectedSpot.id, { x: Math.max(0, Math.min(100, Number(e.target.value))) })}
                                    />
                                </div>
                                <div>
                                    <label className="text-[9px] text-gray-500 uppercase font-bold">Y Position (%)</label>
                                    <input 
                                        type="number"
                                        min="0"
                                        max="100"
                                        className="w-full bg-gray-800 border border-gray-700 rounded p-1 text-xs text-white"
                                        value={selectedSpot.y}
                                        onChange={e => updateSpot(selectedSpot.id, { y: Math.max(0, Math.min(100, Number(e.target.value))) })}
                                    />
                                </div>
                            </div>

                            <div className="flex justify-between items-center pt-2 border-t border-gray-800">
                                <span className="text-[10px] text-gray-500 flex items-center gap-1">
                                    <Move size={10} /> Ziehen zum Verschieben
                                </span>
                                <button 
                                    onClick={() => {
                                        onChange({ spots: map.spots.filter(s => s.id !== selectedSpot.id) });
                                        setSelectedSpotId(null);
                                    }}
                                    className="text-red-400 hover:text-red-300 hover:bg-red-950/50 px-2 py-1 rounded text-xs flex items-center gap-1 transition-colors"
                                >
                                    <Trash size={12} />
                                    <span>Löschen</span>
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className="space-y-4">
                <h4 className="font-bold text-gray-400 uppercase text-xs flex items-center justify-between">
                    <span>Map Spots ({map.spots.length})</span>
                    {selectedSpotId && (
                        <button 
                            onClick={() => setSelectedSpotId(null)}
                            className="text-[11px] text-amber-400 hover:underline font-normal"
                        >
                            Auswahl aufheben
                        </button>
                    )}
                </h4>
                {map.spots.map(spot => {
                    const isSelected = selectedSpotId === spot.id;
                    return (
                        <div 
                            key={spot.id} 
                            onClick={() => setSelectedSpotId(spot.id)}
                            className={`p-3 rounded border transition-all space-y-2 cursor-pointer ${
                                isSelected 
                                    ? 'bg-amber-950/30 border-amber-500 ring-1 ring-amber-500/50' 
                                    : 'bg-gray-800 border-gray-700 hover:border-gray-600'
                            }`}
                        >
                            <div className="flex justify-between items-center">
                                <span className="font-mono text-xs text-amber-300 flex items-center gap-1 font-bold">
                                    <MapPin size={12} /> POS: {Math.round(spot.x)}%, {Math.round(spot.y)}%
                                </span>
                                <button 
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onChange({ spots: map.spots.filter(s => s.id !== spot.id) });
                                        if (selectedSpotId === spot.id) setSelectedSpotId(null);
                                    }} 
                                    className="text-red-500 hover:text-white p-1 rounded hover:bg-red-950/50 transition-colors"
                                    title="Spot löschen"
                                >
                                    <Trash size={14}/>
                                </button>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                 <div>
                                     <label className="text-[10px] font-bold text-gray-500 uppercase">Type</label>
                                     <select 
                                        className="w-full bg-gray-900 border border-gray-600 rounded p-1 text-xs text-white"
                                        value={spot.type}
                                        onChange={e => updateSpot(spot.id, { type: e.target.value as any })}
                                     >
                                         <option value="scene">Scene</option>
                                         <option value="character">Character</option>
                                          <option value="transition">Transition</option>
                                         <option value="dungeon">Dungeon</option>
                                     </select>
                                 </div>
                                 <div>
                                     <label className="text-[10px] font-bold text-gray-500 uppercase">Target</label>
                                     <select 
                                        className="w-full bg-gray-900 border border-gray-600 rounded p-1 text-xs text-white"
                                        value={spot.sceneId || spot.characterId || spot.targetMapId || spot.dungeonId || ''}
                                        onChange={e => {
                                            const val = e.target.value;
                                            if (spot.type === 'scene') updateSpot(spot.id, { sceneId: val });
                                            if (spot.type === 'character') updateSpot(spot.id, { characterId: val });
                                            if (spot.type === 'transition') updateSpot(spot.id, { targetMapId: val });
                                            if (spot.type === 'dungeon') updateSpot(spot.id, { dungeonId: val });
                                        }}
                                     >
                                         <option value="">-- Select --</option>
                                         {spot.type === 'scene' && scenes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                         {spot.type === 'character' && characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                         {spot.type === 'transition' && allMaps.filter(m => m.id !== map.id).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                                         {spot.type === 'dungeon' && dungeons.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                                     </select>
                                 </div>
                            </div>
                            {/* Visual Override */}
                            <div>
                                <label className="text-[10px] font-bold text-gray-500 uppercase">Visual Override (Optional)</label>
                                <select 
                                    className="w-full bg-gray-900 border border-gray-600 rounded p-1 text-xs text-white"
                                    value={spot.visualCharacterId || ''}
                                    onChange={e => updateSpot(spot.id, { visualCharacterId: e.target.value || undefined })}
                                >
                                    <option value="">Default Icon / Sprite</option>
                                    {characters.map(c => <option key={c.id} value={c.id}>{c.name} (Sprite)</option>)}
                                </select>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

interface EditorProps {
  worldInfo: WorldInfo;
  chapters: Chapter[];
  characters: Character[];
  scenes: Scene[];
  maps: WorldMap[];
  dungeonProjects?: DungeonProject[];
  assets?: AssetItem[];
  storyLog?: StoryLogEntry[]; // New prop for context awareness
  onUpdateWorldInfo: (w: WorldInfo) => void;
  onUpdateChapters: (c: Chapter[]) => void;
  onUpdateCharacters: (c: Character[]) => void;
  onUpdateScenes: (s: Scene[]) => void;
  onUpdateMaps: (m: WorldMap[]) => void;
  onUpdateDungeonProjects?: (list: DungeonProject[]) => void;
  onUpdateAssets?: (a: AssetItem[]) => void;
  onPlay: () => void;
  onQuickSave: () => Promise<boolean>;
  onExportProject: (includeMedia?: boolean) => void;
  onImportProject: (file: File) => void;
  onExportSave?: () => void;
  onImportSave?: (file: File) => void;
  hasSaveGame: boolean;
  onContinueGame: () => void;
  onDungeonTest?: () => void;
  onBuildDungeon?: (id: string) => void;
  /** Tab the editor opens on (e.g. returning from the dungeon builder) */
  initialTab?: EditorTab;
  /** Multi-project (emblem switcher on Home) */
  projects?: ProjectSummary[];
  activeProjectId?: string;
  lastEdited?: number;
  onSelectProject?: (id: string) => void;
  onCreateProject?: () => void;
  onDeleteProject?: () => void;
}

export type { EditorTab };

export const Editor: React.FC<EditorProps> = (props) => {
    const { t } = useI18n();
    const [tab, setTab] = useState<EditorTab>(props.initialTab ?? 'home');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [scenePrompt, setScenePrompt] = useState("");
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [isSubSidebarOpen, setIsSubSidebarOpen] = useState(true);

    // Dungeons tab state
    const [renamingDungeonId, setRenamingDungeonId] = useState<string | null>(null);
    const [dungeonNameDraft, setDungeonNameDraft] = useState('');
    const [isImportingSandbox, setIsImportingSandbox] = useState(false);

    const [charSearch, setCharSearch] = useState('');
    const [charGroupFilter, setCharGroupFilter] = useState<'all' | CharacterGroupKey>('all');
    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
    const [generatingTeaserId, setGeneratingTeaserId] = useState<string | null>(null);

    const handleGenerateTeaser = async (type: 'location' | 'faction', item: WorldLocation | Faction, index: number) => {
        if (!item.name && !item.description) return;
        setGeneratingTeaserId(item.id);
        try {
            const teaser = await generateLoreTeaser(item.name, item.description, props.worldInfo);
            if (type === 'location') {
                const newLocs = [...props.worldInfo.loreLocations];
                newLocs[index] = { ...item, teaser } as WorldLocation;
                props.onUpdateWorldInfo({ ...props.worldInfo, loreLocations: newLocs });
            } else {
                const newFacs = [...props.worldInfo.factions];
                newFacs[index] = { ...item, teaser } as Faction;
                props.onUpdateWorldInfo({ ...props.worldInfo, factions: newFacs });
            }
        } catch (err) {
            console.error("Failed to generate teaser:", err);
        } finally {
            setGeneratingTeaserId(null);
        }
    };

    const projectMeta: ProjectMeta = props.worldInfo.projectMeta ?? { title: '' };
    const updateProjectMeta = (meta: ProjectMeta) => props.onUpdateWorldInfo({ ...props.worldInfo, projectMeta: meta });

    // -------------------------------------------------------------------
    // Dungeons tab: catalog of 3D dungeon projects
    // -------------------------------------------------------------------
    const updateDungeonProjects = (list: DungeonProject[]) => props.onUpdateDungeonProjects?.(list);

    const createDungeonProject = () => {
        const list = props.dungeonProjects || [];
        const project: DungeonProject = {
            id: crypto.randomUUID(),
            name: `Dungeon ${list.length + 1}`,
            sections: [{ id: 'root', name: 'Abschnitt 1' }],
            chunkLibrary: [], placedChunks: [], npcLibrary: [], placedNpcs: [],
            createdAt: Date.now(), updatedAt: Date.now()
        };
        updateDungeonProjects([...list, project]);
    };

    // Copies the wild 3D sandbox (DungeonTestView keyval data) into a proper
    // project entry. The sandbox itself stays untouched as fallback/scratch.
    const importSandboxToDungeon = async () => {
        setIsImportingSandbox(true);
        try {
            const [storedSections, chunkLibrary, placedChunks, npcLibrary, placedNpcs, baseFloor, baseWall, baseDoor, baseCharacter] = await Promise.all([
                getItem<Array<{ id: string; name: string }>>(DUNGEON_SANDBOX_KEYS.sections),
                getItem<DungeonChunkLibraryEntry[]>(DUNGEON_SANDBOX_KEYS.chunkLibrary),
                getItem<DungeonChunkPlacement[]>(DUNGEON_SANDBOX_KEYS.placedChunks),
                getItem<DungeonNpcLibraryEntry[]>(DUNGEON_SANDBOX_KEYS.npcLibrary),
                getItem<DungeonNpcPlacement[]>(DUNGEON_SANDBOX_KEYS.placedNpcs),
                getItem<DungeonBaseGLB>(DUNGEON_SANDBOX_KEYS.baseFloor),
                getItem<DungeonBaseGLB>(DUNGEON_SANDBOX_KEYS.baseWall),
                getItem<DungeonBaseGLB>(DUNGEON_SANDBOX_KEYS.baseDoor),
                getItem<DungeonBaseGLB>(DUNGEON_SANDBOX_KEYS.baseCharacter)
            ]);

            const emptySandbox = !chunkLibrary?.length && !placedChunks?.length && !npcLibrary?.length &&
                !baseFloor && !baseWall && !baseDoor && !baseCharacter;
            if (emptySandbox) {
                alert('Die Sandbox ist leer. Lege stattdessen einen neuen Dungeon an.');
                return;
            }

            const list = props.dungeonProjects || [];
            const project: DungeonProject = {
                id: crypto.randomUUID(),
                name: `Importierter Dungeon ${list.length + 1}`,
                sections: [
                    { id: 'root', name: 'Abschnitt 1' },
                    ...(storedSections || []).filter(s => s.id !== 'root')
                ],
                baseFloor: baseFloor || null,
                baseWall: baseWall || null,
                baseDoor: baseDoor || null,
                baseCharacter: baseCharacter || null,
                chunkLibrary: chunkLibrary || [],
                placedChunks: placedChunks || [],
                npcLibrary: npcLibrary || [],
                placedNpcs: placedNpcs || [],
                createdAt: Date.now(),
                updatedAt: Date.now()
            };
            updateDungeonProjects([...list, project]);
            alert('Sandbox als Dungeon-Projekt importiert (Kopie — die Sandbox bleibt unverändert bestehen).');
        } catch (err) {
            console.error('Sandbox import failed:', err);
            alert('Import fehlgeschlagen — Details in der Konsole.');
        } finally {
            setIsImportingSandbox(false);
        }
    };

    const handleGenerateScene = async () => {
        setIsGenerating(true);
        try {
            const newSceneData = await generateAutoScene(props.characters, props.storyLog || [], props.worldInfo, scenePrompt, props.assets);
            const id = crypto.randomUUID();
            
            // Build the full scene object
            const newScene: Scene = {
                id,
                chapterId: props.chapters[0]?.id, // Default to first chapter
                name: newSceneData.name || "New Generated Scene",
                locationName: newSceneData.locationName || "Unknown",
                description: newSceneData.description || "",
                goal: newSceneData.goal || "",
                aiInstructions: newSceneData.aiInstructions || "",
                sensoryDetails: newSceneData.sensoryDetails || "",
                environmentDetails: newSceneData.environmentDetails || "",
                characters: newSceneData.characters as any || [],
                backgroundSrc: newSceneData.suggestedBackgroundSrc || null,
                effects: [],
                isRepeatable: false
            };

            props.onUpdateScenes([...props.scenes, newScene]);
            setSelectedId(id);
        } catch (error) {
            alert("Failed to generate scene. Check console.");
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <WorldInfoContext.Provider value={props.worldInfo}>
            <div className="vn-theme flex h-screen overflow-hidden text-sm">
            {/* Mobile Sidebar Toggle Button */}
            <button
                className="md:hidden absolute top-4 right-4 z-50 p-2 bg-gray-800 rounded-md text-white border border-gray-700"
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            >
                <Layout size={20} />
            </button>

            {/* Sidebar */}
            <Sidebar
                tab={tab}
                isOpen={isSidebarOpen}
                onSelect={(id) => { setTab(id); setSelectedId(null); if (window.innerWidth < 768) setIsSidebarOpen(false); }}
                onToggle={setIsSidebarOpen}
            />

            {/* Backdrop for mobile sidebar */}
            {isSidebarOpen && <div className="md:hidden fixed inset-0 bg-black/60 z-30" onClick={() => setIsSidebarOpen(false)} />}

            {/* Main Content */}
            <div className="flex-1 bg-gray-950 flex flex-col w-full min-w-0 h-full">
                <div className={`flex-1 overflow-hidden flex flex-col ${tab === 'home' ? 'p-0' : 'p-4 md:p-8'}`}>
                {/* ... (Existing World and Chars Tabs) ... */}
                {tab === 'home' && (
                    <HomeView
                        meta={projectMeta}
                        onUpdateMeta={updateProjectMeta}
                        hasSaveGame={props.hasSaveGame}
                        onPlay={props.onPlay}
                        onContinue={props.onContinueGame}
                        onOpenSettings={() => { setTab('settings'); setSelectedId(null); }}
                        projects={props.projects}
                        activeProjectId={props.activeProjectId}
                        lastEdited={props.lastEdited}
                        onSelectProject={props.onSelectProject}
                        onCreateProject={props.onCreateProject}
                        onDeleteProject={props.onDeleteProject}
                    />
                )}
                {tab === 'settings' && (
                    <SettingsView
                        worldInfo={props.worldInfo}
                        onUpdateWorldInfo={props.onUpdateWorldInfo}
                        onQuickSave={props.onQuickSave}
                        onExportProject={props.onExportProject}
                        onImportProject={props.onImportProject}
                        onExportSave={props.onExportSave}
                        onImportSave={props.onImportSave}
                        onBack={() => { setTab('home'); setSelectedId(null); }}
                    />
                )}
                {tab === 'world' && (
                    <div className="max-w-5xl mx-auto w-full space-y-6 overflow-y-auto h-full pr-2 pb-12">
                        <PageHeader icon={<Book size={26}/>} title={t('nav.world')} subtitle={t('page.world.sub')} />

                        <OrnateFrame className="bg-gray-900/80 p-6 space-y-3">
                            <h3 className="text-base font-semibold text-emerald-300 flex items-center gap-2 uppercase"><Book size={16}/> {t('world.desc')}</h3>
                            <textarea
                                className="w-full bg-gray-900 border border-gray-700 rounded p-3 h-32 text-white focus:border-emerald-500 outline-none"
                                placeholder="General setting, atmosphere, time period, and major themes..."
                                value={props.worldInfo.description}
                                onChange={e => props.onUpdateWorldInfo({ ...props.worldInfo, description: e.target.value })}
                            />
                        </OrnateFrame>

                        <OrnateFrame className="bg-gray-900/80 p-6 space-y-3">
                            <h3 className="text-base font-semibold text-emerald-300 flex items-center gap-2 uppercase"><Terminal size={16}/> {t('world.prompt')}</h3>
                            <textarea
                                className="w-full bg-gray-900 border border-gray-700 rounded p-3 h-32 text-emerald-100 font-mono text-sm focus:border-emerald-500 outline-none"
                                placeholder="Technical instructions for the AI (e.g. 'Speak in Shakespearean English', 'Always be sarcastic', 'Focus on horror elements')..."
                                value={props.worldInfo.systemInstruction || ''}
                                onChange={e => props.onUpdateWorldInfo({ ...props.worldInfo, systemInstruction: e.target.value })}
                            />
                        </OrnateFrame>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                             {/* LOCATIONS */}
                             <OrnateFrame className="bg-gray-900/80 p-6 space-y-4">
                                 <div className="flex justify-between items-center">
                                     <h3 className="text-base font-semibold text-emerald-300 flex items-center gap-2 uppercase"><MapPin size={16}/> {t('world.locations')}</h3>
                                     <Button onClick={() => props.onUpdateWorldInfo({ ...props.worldInfo, loreLocations: [...props.worldInfo.loreLocations, { id: crypto.randomUUID(), name: 'New Location', description: '' }] })} className="text-xs px-2 py-1"><Plus size={14}/></Button>
                                 </div>
                                 <div className="space-y-3">
                                     {props.worldInfo.loreLocations.length === 0 && <div className="vn-empty text-gray-400 vn-font-serif text-base italic px-4 py-6 text-center">{t('world.locations.empty')}</div>}
                                     {props.worldInfo.loreLocations.map((loc, i) => (
                                         <div key={loc.id} className="vn-item p-3 space-y-2.5 group">
                                             <div className="flex justify-between items-center">
                                                 <input 
                                                    className="bg-transparent font-bold text-emerald-200 border-b border-transparent focus:border-emerald-500 outline-none text-sm w-full"
                                                    placeholder="Location Name"
                                                    value={loc.name}
                                                    onChange={(e) => {
                                                        const newLocs = [...props.worldInfo.loreLocations];
                                                        newLocs[i] = { ...loc, name: e.target.value };
                                                        props.onUpdateWorldInfo({ ...props.worldInfo, loreLocations: newLocs });
                                                    }}
                                                 />
                                                 <button 
                                                    onClick={() => props.onUpdateWorldInfo({ ...props.worldInfo, loreLocations: props.worldInfo.loreLocations.filter(l => l.id !== loc.id) })}
                                                    className="text-gray-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                                 ><Trash size={14}/></button>
                                             </div>
                                             <textarea 
                                                className="w-full bg-gray-800 text-gray-300 text-xs p-2 rounded border border-gray-700 focus:border-emerald-500 outline-none resize-none h-20"
                                                placeholder="Description for AI context..."
                                                value={loc.description}
                                                onChange={(e) => {
                                                    const newLocs = [...props.worldInfo.loreLocations];
                                                    newLocs[i] = { ...loc, description: e.target.value };
                                                    props.onUpdateWorldInfo({ ...props.worldInfo, loreLocations: newLocs });
                                                }}
                                             />

                                             {/* Teaser field for AI Lore Router */}
                                             <div className="space-y-1 pt-1 border-t border-gray-800/60">
                                                 <div className="flex justify-between items-center">
                                                     <label className="text-[10px] font-bold text-gray-400 uppercase flex items-center gap-1">
                                                         <Sparkles size={11} className="text-emerald-400" /> Teaser (1 Satz für KI-Router)
                                                     </label>
                                                     <button
                                                         type="button"
                                                         disabled={generatingTeaserId === loc.id || (!loc.name && !loc.description)}
                                                         onClick={() => handleGenerateTeaser('location', loc, i)}
                                                         className="text-[10px] text-emerald-400 hover:text-emerald-300 disabled:text-gray-600 flex items-center gap-1 bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-800/50 px-2 py-0.5 rounded transition-colors"
                                                     >
                                                         {generatingTeaserId === loc.id ? (
                                                             <>
                                                                 <Loader2 size={10} className="animate-spin" />
                                                                 <span>Generiere...</span>
                                                             </>
                                                         ) : (
                                                             <>
                                                                 <Sparkles size={10} />
                                                                 <span>Teaser generieren</span>
                                                             </>
                                                         )}
                                                     </button>
                                                 </div>
                                                 <input 
                                                     className="w-full bg-gray-800/80 text-emerald-100 text-xs p-2 rounded border border-gray-700 focus:border-emerald-500 outline-none placeholder:text-gray-600"
                                                     placeholder="Prägnanter 1-Satz Teaser für die Relevanz-Erkennung..."
                                                     value={loc.teaser || ''}
                                                     onChange={(e) => {
                                                         const newLocs = [...props.worldInfo.loreLocations];
                                                         newLocs[i] = { ...loc, teaser: e.target.value };
                                                         props.onUpdateWorldInfo({ ...props.worldInfo, loreLocations: newLocs });
                                                     }}
                                                 />
                                             </div>
                                         </div>
                                     ))}
                                 </div>
                             </OrnateFrame>

                             {/* FACTIONS */}
                             <OrnateFrame className="bg-gray-900/80 p-6 space-y-4">
                                 <div className="flex justify-between items-center">
                                     <h3 className="text-base font-semibold text-emerald-300 flex items-center gap-2 uppercase"><Users size={16}/> {t('world.factions')}</h3>
                                     <Button onClick={() => props.onUpdateWorldInfo({ ...props.worldInfo, factions: [...props.worldInfo.factions, { id: crypto.randomUUID(), name: 'New Group', description: '' }] })} className="text-xs px-2 py-1"><Plus size={14}/></Button>
                                 </div>
                                 <div className="space-y-3">
                                     {props.worldInfo.factions.length === 0 && <div className="vn-empty text-gray-400 vn-font-serif text-base italic px-4 py-6 text-center">{t('world.factions.empty')}</div>}
                                     {props.worldInfo.factions.map((fac, i) => (
                                         <div key={fac.id} className="vn-item p-3 space-y-2.5 group">
                                             <div className="flex justify-between items-center">
                                                 <input 
                                                    className="bg-transparent font-bold text-amber-200 border-b border-transparent focus:border-amber-500 outline-none text-sm w-full"
                                                    placeholder="Group Name (e.g. Nobles)"
                                                    value={fac.name}
                                                    onChange={(e) => {
                                                        const newFacs = [...props.worldInfo.factions];
                                                        newFacs[i] = { ...fac, name: e.target.value };
                                                        props.onUpdateWorldInfo({ ...props.worldInfo, factions: newFacs });
                                                    }}
                                                 />
                                                 <button 
                                                    onClick={() => props.onUpdateWorldInfo({ ...props.worldInfo, factions: props.worldInfo.factions.filter(f => f.id !== fac.id) })}
                                                    className="text-gray-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                                 ><Trash size={14}/></button>
                                             </div>
                                             <textarea 
                                                className="w-full bg-gray-800 text-gray-300 text-xs p-2 rounded border border-gray-700 focus:border-amber-500 outline-none resize-none h-20"
                                                placeholder="Description of behavior, hierarchy, etc..."
                                                value={fac.description}
                                                onChange={(e) => {
                                                    const newFacs = [...props.worldInfo.factions];
                                                    newFacs[i] = { ...fac, description: e.target.value };
                                                    props.onUpdateWorldInfo({ ...props.worldInfo, factions: newFacs });
                                                }}
                                             />

                                             {/* Teaser field for AI Lore Router */}
                                             <div className="space-y-1 pt-1 border-t border-gray-800/60">
                                                 <div className="flex justify-between items-center">
                                                     <label className="text-[10px] font-bold text-gray-400 uppercase flex items-center gap-1">
                                                         <Sparkles size={11} className="text-amber-400" /> Teaser (1 Satz für KI-Router)
                                                     </label>
                                                     <button
                                                         type="button"
                                                         disabled={generatingTeaserId === fac.id || (!fac.name && !fac.description)}
                                                         onClick={() => handleGenerateTeaser('faction', fac, i)}
                                                         className="text-[10px] text-amber-400 hover:text-amber-300 disabled:text-gray-600 flex items-center gap-1 bg-amber-950/60 hover:bg-amber-900/60 border border-amber-800/50 px-2 py-0.5 rounded transition-colors"
                                                     >
                                                         {generatingTeaserId === fac.id ? (
                                                             <>
                                                                 <Loader2 size={10} className="animate-spin" />
                                                                 <span>Generiere...</span>
                                                             </>
                                                         ) : (
                                                             <>
                                                                 <Sparkles size={10} />
                                                                 <span>Teaser generieren</span>
                                                             </>
                                                         )}
                                                     </button>
                                                 </div>
                                                 <input 
                                                     className="w-full bg-gray-800/80 text-amber-100 text-xs p-2 rounded border border-gray-700 focus:border-amber-500 outline-none placeholder:text-gray-600"
                                                     placeholder="Prägnanter 1-Satz Teaser für die Relevanz-Erkennung..."
                                                     value={fac.teaser || ''}
                                                     onChange={(e) => {
                                                         const newFacs = [...props.worldInfo.factions];
                                                         newFacs[i] = { ...fac, teaser: e.target.value };
                                                         props.onUpdateWorldInfo({ ...props.worldInfo, factions: newFacs });
                                                     }}
                                                 />
                                             </div>
                                         </div>
                                     ))}
                                 </div>
                             </OrnateFrame>
                        </div>
                    </div>
                )}

                {tab === 'chapters' && (() => {
                    const sortedChapters = [...props.chapters].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
                    
                    const handleReorderChapter = (chapterId: string, direction: 'up' | 'down') => {
                        const index = sortedChapters.findIndex(c => c.id === chapterId);
                        if (index === -1) return;
                        const targetIndex = direction === 'up' ? index - 1 : index + 1;
                        if (targetIndex < 0 || targetIndex >= sortedChapters.length) return;

                        const updated = [...sortedChapters];
                        const [moved] = updated.splice(index, 1);
                        updated.splice(targetIndex, 0, moved);

                        const reordered = updated.map((c, i) => ({ ...c, order: i + 1 }));
                        props.onUpdateChapters(reordered);
                    };

                    const handleCreateSceneForChapter = (chapterId: string) => {
                        const newId = crypto.randomUUID();
                        const chapterScenes = props.scenes.filter(s => s.chapterId === chapterId);
                        const nextOrder = chapterScenes.length + 1;
                        const newScene: Scene = {
                            id: newId,
                            chapterId: chapterId,
                            name: `Szene ${nextOrder}`,
                            description: '',
                            goal: '',
                            characters: [],
                            backgroundSrc: null,
                            order: nextOrder,
                            isMainScene: true,
                        };
                        props.onUpdateScenes([...props.scenes, newScene]);
                        setTab('scenes');
                        setSelectedId(newId);
                    };

                    return (
                        <div className="flex flex-col h-full gap-5">
<PageHeader icon={<Book size={26}/>} title={t('nav.chapters')} subtitle={t('page.chapters.sub')} />
<div className="flex flex-col md:flex-row flex-1 min-h-0 gap-4 md:gap-6">
                            <div className={`w-full ${isSubSidebarOpen ? 'md:w-1/3' : 'md:w-0 md:hidden'} border-none md:border-r border-gray-800 pb-4 md:pb-0 md:pr-4 overflow-y-auto ${selectedId ? 'hidden md:block' : 'block'}`}>
                                <div className="flex justify-between items-center mb-4">
                                    <span className="vn-list-label flex items-center gap-2"><Book size={14}/> {t('nav.chapters')}</span>
                                    <button onClick={() => setIsSubSidebarOpen(false)} className="hidden md:flex text-gray-400 hover:text-white p-1 rounded hover:bg-gray-800 transition-colors" title="Kapitel-Liste einklappen">
                                        <ChevronLeft size={18}/>
                                    </button>
                                </div>
                                <Button className="w-full mb-4 py-1.5 text-sm" onClick={() => {
                                    const id = crypto.randomUUID();
                                    const nextOrder = props.chapters.length + 1;
                                    props.onUpdateChapters([...props.chapters, {
                                        id,
                                        order: nextOrder,
                                        name: `Chapter ${nextOrder}`,
                                        description: ''
                                    }]);
                                    setSelectedId(id);
                                }}><Plus size={14}/> {t('add.chapter')}</Button>
                                <div className="space-y-2">
                                    {sortedChapters.map((c) => {
                                        const sceneCount = props.scenes.filter(s => s.chapterId === c.id).length;
                                        return (
                                            <div key={c.id} onClick={() => setSelectedId(c.id)} className={`p-2.5 md:p-3 rounded-lg cursor-pointer border text-sm transition-colors vn-item ${selectedId === c.id ? 'vn-item--on' : ''}`}>
                                                <div className="flex items-center justify-between">
                                                    <div className="font-bold text-white truncate flex items-center gap-2">
                                                        <span className="text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800/80 px-1.5 py-0.5 rounded font-mono">
                                                            #{c.order ?? 1}
                                                        </span>
                                                        {c.name || 'Unnamed Chapter'}
                                                    </div>
                                                    <span className="text-[10px] bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full border border-gray-700">
                                                        {sceneCount} Szenen
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                            <div className={`flex-1 overflow-y-auto ${!selectedId ? 'hidden md:block' : 'block'}`}>
                                {!isSubSidebarOpen && (
                                    <button onClick={() => setIsSubSidebarOpen(true)} className="hidden md:inline-flex mb-3 text-xs text-emerald-400 bg-gray-900 border border-gray-800 hover:bg-gray-800 px-2.5 py-1.5 rounded-lg items-center gap-1.5 font-medium transition-colors shadow-sm" title="Kapitel-Liste ausklappen">
                                        <ChevronRight size={16}/> Kapitel-Liste anzeigen
                                    </button>
                                )}
                                {selectedId && (
                                    <div className="md:hidden mb-4">
                                        <Button variant="secondary" className="text-xs py-1 px-2" onClick={() => setSelectedId(null)}><ArrowLeft size={14}/> Back to List</Button>
                                    </div>
                                )}
                                {selectedId && props.chapters.find(c => c.id === selectedId) ? (
                                    <ChapterEditor 
                                        key={selectedId} 
                                        chapter={props.chapters.find(c => c.id === selectedId)!} 
                                        allScenes={props.scenes}
                                        allChapters={props.chapters}
                                        allMaps={props.maps}
                                        onChange={(u) => props.onUpdateChapters(props.chapters.map(x => x.id === selectedId ? { ...x, ...u } : x))} 
                                        onDelete={() => { props.onUpdateChapters(props.chapters.filter(x => x.id !== selectedId)); setSelectedId(null); }} 
                                        onNavigateToScene={(sceneId) => {
                                            setTab('scenes');
                                            setSelectedId(sceneId);
                                        }}
                                        onCreateSceneForChapter={handleCreateSceneForChapter}
                                        onUpdateScenes={props.onUpdateScenes}
                                        onReorderChapter={(dir) => handleReorderChapter(selectedId, dir)}
                                    />
                                ) : (
                                    <EmptyState className="h-full" icon={<Book size={32}/>} title={t('empty.select.title')} text={t('empty.chapters')} />
                                )}
                            </div>
                        </div>
                        </div>
                    );
                })()}

                {tab === 'chars' && (
                    <div className="flex flex-col h-full gap-5">
<PageHeader icon={<Users size={26}/>} title={t('nav.chars')} subtitle={t('page.chars.sub')} />
<div className="flex flex-col md:flex-row flex-1 min-h-0 gap-4 md:gap-6">
                        <div className={`w-full ${isSubSidebarOpen ? 'md:w-1/3' : 'md:w-0 md:hidden'} border-none md:border-r border-gray-800 pb-4 md:pb-0 md:pr-4 overflow-y-auto ${selectedId ? 'hidden md:block' : 'block'}`}>
                            <div className="flex justify-between items-center mb-3">
                                <span className="vn-list-label flex items-center gap-2"><Users size={14}/> {t('nav.chars')} ({props.characters.length})</span>
                                <button onClick={() => setIsSubSidebarOpen(false)} className="hidden md:flex text-gray-400 hover:text-white p-1 rounded hover:bg-gray-800 transition-colors" title="Charakter-Liste einklappen">
                                    <ChevronLeft size={18}/>
                                </button>
                            </div>

                            {/* Search & Group Filter */}
                            <div className="space-y-2 mb-3">
                                <div className="relative">
                                    <Search size={14} className="absolute left-2.5 top-2.5 text-gray-500" />
                                    <input
                                        type="text"
                                        placeholder="Charakter suchen..."
                                        value={charSearch}
                                        onChange={e => setCharSearch(e.target.value)}
                                        className="w-full bg-gray-900 border border-gray-800 rounded-lg pl-8 pr-7 py-1.5 text-xs text-white placeholder-gray-500 outline-none focus:border-emerald-500"
                                    />
                                    {charSearch && (
                                        <button onClick={() => setCharSearch('')} className="absolute right-2 top-2 text-gray-500 hover:text-white">
                                            <X size={12} />
                                        </button>
                                    )}
                                </div>
                                <select
                                    value={charGroupFilter}
                                    onChange={e => setCharGroupFilter(e.target.value as any)}
                                    className="w-full bg-gray-900 border border-gray-800 rounded-lg px-2 py-1.5 text-xs text-gray-200 outline-none focus:border-emerald-500"
                                >
                                    <option value="all">Alle Kategorien ({props.characters.length})</option>
                                    {CHARACTER_GROUPS.map(g => {
                                        const count = props.characters.filter(c => getCharacterGroupKey(c) === g.id).length;
                                        return (
                                            <option key={g.id} value={g.id}>
                                                {g.icon} {g.label} ({count})
                                            </option>
                                        );
                                    })}
                                </select>
                            </div>

                            <Button className="w-full mb-4 py-1.5 text-sm" onClick={() => {
                                const id = crypto.randomUUID();
                                let initialImportance: CharacterImportance = 'main';
                                let initialAlignment: CharacterAlignment = 'gut';

                                if (charGroupFilter === 'main_boese') { initialImportance = 'main'; initialAlignment = 'boese'; }
                                else if (charGroupFilter === 'side_gut') { initialImportance = 'side'; initialAlignment = 'gut'; }
                                else if (charGroupFilter === 'side_boese') { initialImportance = 'side'; initialAlignment = 'boese'; }
                                else if (charGroupFilter === 'neutral') { initialImportance = 'side'; initialAlignment = 'neutral'; }

                                props.onUpdateCharacters([...props.characters, { 
                                    id, 
                                    name: 'Neuer Charakter', 
                                    defaultDescription: '', 
                                    rpgColor: '#ffffff',
                                    imageSrc: null,
                                    mapSpriteSrc: null,
                                    importance: initialImportance,
                                    alignment: initialAlignment
                                }]);
                                setSelectedId(id);
                            }}><Plus size={14}/> {t('add.char')}</Button>

                            {/* Grouped Characters List */}
                            {(() => {
                                const filteredCharacters = props.characters.filter(c => {
                                    if (charSearch.trim()) {
                                        const q = charSearch.toLowerCase();
                                        const matchesName = c.name?.toLowerCase().includes(q);
                                        const matchesDesc = c.defaultDescription?.toLowerCase().includes(q);
                                        if (!matchesName && !matchesDesc) return false;
                                    }
                                    return true;
                                });

                                if (filteredCharacters.length === 0) {
                                    return (
                                        <div className="vn-empty p-4 text-center text-sm text-gray-400 vn-font-serif">{t('empty.list.chars')}</div>
                                    );
                                }

                                return (
                                    <div className="space-y-3">
                                        {CHARACTER_GROUPS.map(group => {
                                            if (charGroupFilter !== 'all' && charGroupFilter !== group.id) return null;

                                            const groupChars = filteredCharacters.filter(c => getCharacterGroupKey(c) === group.id);
                                            const isCollapsed = collapsedGroups[group.id];

                                            if (groupChars.length === 0 && (charSearch.trim() || charGroupFilter !== 'all')) return null;

                                            return (
                                                <div key={group.id} className="bg-gray-950/40 border border-gray-800/80 rounded-xl overflow-hidden">
                                                    {/* Group Header */}
                                                    <button
                                                        onClick={() => setCollapsedGroups(prev => ({ ...prev, [group.id]: !prev[group.id] }))}
                                                        className="w-full flex items-center justify-between p-2.5 bg-gray-900/60 hover:bg-gray-800/60 transition-colors text-left border-b border-gray-800/60"
                                                    >
                                                        <div className="flex items-center gap-2 font-bold text-xs text-gray-200">
                                                            <span>{group.icon}</span>
                                                            <span className="truncate">{group.label}</span>
                                                        </div>
                                                        <div className="flex items-center gap-1.5">
                                                            <span className={`text-[10px] px-1.5 py-0.2 rounded-full border ${group.badgeBg} ${group.badgeBorder} ${group.textColor} font-mono font-bold`}>
                                                                {groupChars.length}
                                                            </span>
                                                            {isCollapsed ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronUp size={14} className="text-gray-400" />}
                                                        </div>
                                                    </button>

                                                    {/* Group Content */}
                                                    {!isCollapsed && (
                                                        <div className="p-1.5 space-y-1.5">
                                                            {groupChars.length === 0 ? (
                                                                <div className="text-[11px] text-gray-600 italic px-3 py-2 text-center">Keine Charaktere in dieser Kategorie</div>
                                                            ) : (
                                                                groupChars.map(c => {
                                                                    const isSelected = selectedId === c.id;
                                                                    const charGroup = getCharacterGroup(c);
                                                                    return (
                                                                        <div
                                                                            key={c.id}
                                                                            onClick={() => setSelectedId(c.id)}
                                                                            className={`p-2 rounded-lg cursor-pointer border text-xs flex items-center gap-2.5 transition-all vn-item ${isSelected ? 'vn-item--on' : ''}`}
                                                                        >
                                                                            <div className="w-9 h-9 rounded-full bg-gray-800 border border-gray-700 flex-shrink-0 overflow-hidden flex items-center justify-center text-gray-400 font-bold">
                                                                                {c.imageSrc ? (
                                                                                    <AsyncImage src={c.imageSrc} className="w-full h-full object-cover" />
                                                                                ) : (
                                                                                    c.name?.[0]?.toUpperCase() || '?'
                                                                                )}
                                                                            </div>
                                                                            <div className="min-w-0 flex-1">
                                                                                <div className="flex items-center justify-between gap-1">
                                                                                    <span className="font-bold text-white truncate">{c.name}</span>
                                                                                    <span className={`text-[9px] px-1.5 py-0.2 rounded border ${charGroup.badgeBg} ${charGroup.badgeBorder} ${charGroup.textColor} font-semibold flex-shrink-0`}>
                                                                                        {charGroup.shortLabel}
                                                                                    </span>
                                                                                </div>
                                                                                <div className="text-[10px] text-gray-400 truncate mt-0.5">{c.defaultDescription || 'Keine Beschreibung'}</div>
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            })()}
                        </div>
                        <div className={`flex-1 overflow-y-auto ${!selectedId ? 'hidden md:block' : 'block'}`}>
                             {!isSubSidebarOpen && (
                                 <button onClick={() => setIsSubSidebarOpen(true)} className="hidden md:inline-flex mb-3 text-xs text-emerald-400 bg-gray-900 border border-gray-800 hover:bg-gray-800 px-2.5 py-1.5 rounded-lg items-center gap-1.5 font-medium transition-colors shadow-sm" title="Charakter-Liste ausklappen">
                                     <ChevronRight size={16}/> Charakter-Liste anzeigen
                                 </button>
                             )}
                             {selectedId && props.characters.find(c => c.id === selectedId) && (
                                 <div className="flex flex-col h-full">
                                     <button className="md:hidden mb-4 text-emerald-400 font-bold flex items-center gap-1.5" onClick={() => setSelectedId(null)}>
                                         <ArrowLeft size={16}/> Back to Characters
                                     </button>
                                     <CharacterEditor 
                                        key={selectedId}
                                        character={props.characters.find(c => c.id === selectedId)!}
                                        assets={props.assets}
                                        onChange={(u) => props.onUpdateCharacters(props.characters.map(x => x.id === selectedId ? { ...x, ...u } : x))}
                                        onDelete={() => {
                                            props.onUpdateCharacters(props.characters.filter(x => x.id !== selectedId));
                                            setSelectedId(null);
                                        }}
                                     />
                                 </div>
                             )}
                            {!selectedId && <EmptyState className="h-full hidden md:flex" icon={<Users size={32}/>} title={t('empty.select.title')} text={t('empty.chars')} />}
                        </div>
                        </div>
                    </div>
                )}

                {tab === 'scenes' && (() => {
                    const sortedScenes = [...props.scenes].sort((a, b) => {
                        const chapA = props.chapters.find(c => c.id === a.chapterId);
                        const chapB = props.chapters.find(c => c.id === b.chapterId);
                        const chapOrderA = chapA?.order ?? 999;
                        const chapOrderB = chapB?.order ?? 999;
                        if (chapOrderA !== chapOrderB) return chapOrderA - chapOrderB;
                        return (a.order ?? 0) - (b.order ?? 0);
                    });

                    return (
                        <div className="flex flex-col h-full gap-5">
<PageHeader icon={<Monitor size={26}/>} title={t('nav.scenes')} subtitle={t('page.scenes.sub')} />
<div className="flex flex-col md:flex-row flex-1 min-h-0 gap-4 md:gap-6">
                            <div className={`w-full ${isSubSidebarOpen ? 'md:w-1/3' : 'md:w-0 md:hidden'} border-none md:border-r border-gray-800 pb-4 md:pb-0 md:pr-4 overflow-y-auto ${selectedId ? 'hidden md:block' : 'block'}`}>
                                <div className="flex justify-between items-center mb-3">
                                    <span className="vn-list-label flex items-center gap-2"><Monitor size={14}/> {t('nav.scenes')} ({props.scenes.length})</span>
                                    <button onClick={() => setIsSubSidebarOpen(false)} className="hidden md:flex text-gray-400 hover:text-white p-1 rounded hover:bg-gray-800 transition-colors" title="Szenen-Liste einklappen">
                                        <ChevronLeft size={18}/>
                                    </button>
                                </div>
                                 <div className="flex gap-2 mb-2">
                                    <Button className="flex-1 py-1.5 text-sm" onClick={() => { 
                                        const id = crypto.randomUUID(); 
                                        const firstChap = props.chapters[0];
                                        props.onUpdateScenes([...props.scenes, { 
                                            id, 
                                            chapterId: firstChap?.id,
                                            name: 'New Scene', 
                                            description: '', 
                                            goal: '', 
                                            characters: [], 
                                            backgroundSrc: null,
                                            order: props.scenes.length + 1,
                                            isMainScene: true
                                        }]); 
                                        setSelectedId(id); 
                                    }}><Plus size={14}/> {t('add.scene')}</Button>
                                    <Button 
                                        className="bg-emerald-600 hover:bg-emerald-500 shadow-emerald-500/20 py-1.5" 
                                        title="Auto-Generate Scene from Story Log"
                                        onClick={handleGenerateScene}
                                        disabled={isGenerating}
                                    >
                                        {isGenerating ? <Loader2 size={14} className="animate-spin"/> : <Sparkles size={14}/>}
                                    </Button>
                                 </div>
                                 <input 
                                    type="text"
                                    className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white text-xs mb-4 placeholder-gray-500"
                                    placeholder="Optional prompt for AI (e.g. 'Beach episode')"
                                    value={scenePrompt}
                                    onChange={e => setScenePrompt(e.target.value)}
                                 />
                                 
                                 <div className="space-y-2">
                                    {sortedScenes.map(s => {
                                        const chapter = props.chapters.find(c => c.id === s.chapterId);
                                        const isMain = s.isMainScene !== false;
                                        const assignedMap = props.maps.find(m => m.id === s.mapId) || props.maps.find(m => m.spots?.some(spot => spot.type === 'scene' && spot.sceneId === s.id));
                                        return (
                                            <div 
                                                key={s.id} 
                                                onClick={() => setSelectedId(s.id)} 
                                                className={`p-2.5 md:p-3 rounded-lg cursor-pointer border text-sm transition-colors vn-item ${selectedId === s.id ? 'vn-item--on' : ''}`}
                                            >
                                                <div className="flex items-center justify-between gap-2">
                                                    <div className="font-bold text-white truncate">{s.name}</div>
                                                    <span className="text-[10px] text-emerald-400 font-mono flex-shrink-0">
                                                        Pos #{s.order || '?'}
                                                    </span>
                                                </div>
                                                <div className="flex items-center justify-between text-xs text-gray-400 mt-1 gap-2">
                                                    <span className="truncate text-gray-400 text-[11px]">
                                                        {chapter ? chapter.name : 'Kein Kapitel'}
                                                    </span>
                                                    <div className="flex items-center gap-1.5 flex-shrink-0">
                                                        <span className={`text-[9px] px-1.5 py-0.2 rounded ${isMain ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-amber-950 text-amber-300 border border-amber-800'}`}>
                                                            {isMain ? 'Haupt' : 'Neben'}
                                                        </span>
                                                        <span className="text-[10px] text-sky-300 bg-sky-950/80 border border-sky-800/80 px-1.5 py-0.2 rounded flex items-center gap-0.5 truncate max-w-[100px]" title={assignedMap?.name || 'Keine Karte'}>
                                                            <MapIcon size={10}/> {assignedMap ? assignedMap.name : 'Keine Map'}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                 </div>
                            </div>
                            <div className={`flex-1 overflow-y-auto ${!selectedId ? 'hidden md:block' : 'block'}`}>
                                {!isSubSidebarOpen && (
                                    <button onClick={() => setIsSubSidebarOpen(true)} className="hidden md:inline-flex mb-3 text-xs text-emerald-400 bg-gray-900 border border-gray-800 hover:bg-gray-800 px-2.5 py-1.5 rounded-lg items-center gap-1.5 font-medium transition-colors shadow-sm" title="Szenen-Liste ausklappen">
                                        <ChevronRight size={16}/> Szenen-Liste anzeigen
                                    </button>
                                )}
                                {selectedId && props.scenes.find(s => s.id === selectedId) && (
                                    <div className="flex flex-col h-full">
                                         <button className="md:hidden mb-4 text-emerald-400 font-bold flex items-center gap-1.5" onClick={() => setSelectedId(null)}>
                                             <ArrowLeft size={16}/> Back to Scenes
                                         </button>
                                         <SceneEditor key={selectedId} scene={props.scenes.find(s => s.id === selectedId)!} allScenes={props.scenes} allMaps={props.maps} characters={props.characters} chapters={props.chapters} worldInfo={props.worldInfo} assets={props.assets} onChange={(u) => props.onUpdateScenes(props.scenes.map(x => x.id === selectedId ? { ...x, ...u } : x))} onDelete={() => { props.onUpdateScenes(props.scenes.filter(x => x.id !== selectedId)); setSelectedId(null); }} />
                                    </div>
                                )}
                            {!selectedId && <EmptyState className="h-full hidden md:flex" icon={<Monitor size={32}/>} title={t('empty.select.title')} text={t('empty.scenes')} />}
                            </div>
                        </div>
                        </div>
                    );
                })()}
                
                {tab === 'maps' && (
                     <div className="flex flex-col h-full gap-5">
<PageHeader icon={<MapIcon size={26}/>} title={t('nav.maps')} subtitle={t('page.maps.sub')} />
<div className="flex flex-col md:flex-row flex-1 min-h-0 gap-4 md:gap-6">
                        <div className={`w-full ${isSubSidebarOpen ? 'md:w-1/3' : 'md:w-0 md:hidden'} border-none md:border-r border-gray-800 pb-4 md:pb-0 md:pr-4 overflow-y-auto ${selectedId ? 'hidden md:block' : 'block'}`}>
                            <div className="flex justify-between items-center mb-3">
                                <span className="vn-list-label flex items-center gap-2"><MapIcon size={14}/> {t('nav.maps')} ({props.maps.length})</span>
                                <button onClick={() => setIsSubSidebarOpen(false)} className="hidden md:flex text-gray-400 hover:text-white p-1 rounded hover:bg-gray-800 transition-colors" title="Karten-Liste einklappen">
                                    <ChevronLeft size={18}/>
                                </button>
                            </div>
                             <Button className="w-full mb-4 py-1.5 text-sm" onClick={() => { const id = crypto.randomUUID(); props.onUpdateMaps([...props.maps, { id, name: 'New Map', backgroundSrc: null, spots: [] }]); setSelectedId(id); }}><Plus size={14}/> {t('add.map')}</Button>
                             <div className="space-y-2">{props.maps.map(m => (<div key={m.id} onClick={() => setSelectedId(m.id)} className={`p-2 md:p-3 rounded cursor-pointer border text-sm vn-item ${selectedId === m.id ? 'vn-item--on' : ''}`}><div className="font-bold text-white">{m.name}</div></div>))}</div>
                        </div>
                        <div className={`flex-1 overflow-y-auto ${!selectedId ? 'hidden md:block' : 'block'}`}>
                            {!isSubSidebarOpen && (
                                <button onClick={() => setIsSubSidebarOpen(true)} className="hidden md:inline-flex mb-3 text-xs text-emerald-400 bg-gray-900 border border-gray-800 hover:bg-gray-800 px-2.5 py-1.5 rounded-lg items-center gap-1.5 font-medium transition-colors shadow-sm" title="Karten-Liste ausklappen">
                                    <ChevronRight size={16}/> Karten-Liste anzeigen
                                </button>
                            )}
                            {selectedId && props.maps.find(m => m.id === selectedId) && (
                                <div className="flex flex-col h-full">
                                    <button className="md:hidden mb-4 text-emerald-400 font-bold flex items-center gap-1.5" onClick={() => setSelectedId(null)}>
                                        <ArrowLeft size={16}/> Back to Maps
                                    </button>
                                    <MapEditor key={selectedId} map={props.maps.find(m => m.id === selectedId)!} scenes={props.scenes} characters={props.characters} allMaps={props.maps} dungeons={props.dungeonProjects} assets={props.assets} onChange={(u) => props.onUpdateMaps(props.maps.map(x => x.id === selectedId ? { ...x, ...u } : x))} onDelete={() => { props.onUpdateMaps(props.maps.filter(x => x.id !== selectedId)); setSelectedId(null); }} />
                                </div>
                            )}
                            {!selectedId && <EmptyState className="h-full hidden md:flex" icon={<MapIcon size={32}/>} title={t('empty.select.title')} text={t('empty.maps')} />}
                        </div>
                        </div>
                    </div>
                )}
                {tab === 'dungeons' && (
                    <div className="h-full overflow-y-auto pb-8 pr-2 space-y-5">
                        <PageHeader
                            icon={<Castle size={26}/>}
                            title={t('nav.dungeons')}
                            subtitle={t('page.dungeons.sub')}
                            actions={<>
                                <Button className="py-1.5 text-sm" variant="primary" onClick={createDungeonProject}><Plus size={14}/> {t('dungeons.new')}</Button>
                                <Button
                                    variant="secondary"
                                    className="py-1.5 text-sm"
                                    onClick={importSandboxToDungeon}
                                    disabled={isImportingSandbox}
                                    title="Kopiert den Stand der alten 3D-Sandbox als eigenständiges Dungeon-Projekt"
                                >
                                    <Upload size={14}/> {isImportingSandbox ? t('dungeons.importing') : t('dungeons.import')}
                                </Button>
                            </>}
                        />

                        <div className="vn-notice p-3 text-sm leading-relaxed vn-font-serif text-base">{t('dungeons.hint')}</div>

                        {(props.dungeonProjects || []).length === 0 && (
                            <EmptyState icon={<Boxes size={32}/>} title={t('dungeons.empty.title')} text={t('dungeons.empty.text')} />
                        )}

                        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
                            {(props.dungeonProjects || []).map(d => {
                                const chunkCount = d.placedChunks.length + (d.baseFloor ? 1 : 0);
                                const figCount = d.placedNpcs.length;
                                return (
                                    <OrnateFrame key={d.id} className="p-5 bg-gray-900/80">
                                        {renamingDungeonId === d.id ? (
                                            <div className="flex items-center gap-2 mb-2">
                                                <input
                                                    autoFocus
                                                    value={dungeonNameDraft}
                                                    onChange={(e) => setDungeonNameDraft(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            updateDungeonProjects((props.dungeonProjects || []).map(x =>
                                                                x.id === d.id ? { ...x, name: dungeonNameDraft.trim() || x.name, updatedAt: Date.now() } : x));
                                                            setRenamingDungeonId(null);
                                                        } else if (e.key === 'Escape') {
                                                            setRenamingDungeonId(null);
                                                        }
                                                    }}
                                                    className="flex-1 bg-gray-950 border border-gray-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-emerald-500"
                                                />
                                                <button
                                                    onClick={() => {
                                                        updateDungeonProjects((props.dungeonProjects || []).map(x =>
                                                            x.id === d.id ? { ...x, name: dungeonNameDraft.trim() || x.name, updatedAt: Date.now() } : x));
                                                        setRenamingDungeonId(null);
                                                    }}
                                                    className="text-emerald-400 hover:text-emerald-300 p-1"
                                                    title="Umbenennen bestätigen"
                                                ><Check size={14}/></button>
                                            </div>
                                        ) : (
                                            <div className="flex justify-between items-start mb-3">
                                                <div className="font-bold text-white text-sm pr-2 break-words">{d.name}</div>
                                                <button
                                                    onClick={() => { setRenamingDungeonId(d.id); setDungeonNameDraft(d.name); }}
                                                    className="text-gray-500 hover:text-white p-1 flex-shrink-0"
                                                    title="Dungeon umbenennen"
                                                ><Scaling size={13}/></button>
                                            </div>
                                        )}

                                        <div className="flex flex-wrap gap-1.5 mb-3 text-[10px] font-mono">
                                            <span className="px-1.5 py-0.5 bg-gray-800 text-emerald-200 rounded-sm border border-gray-600">{d.sections.length} {t('dungeons.sections')}</span>
                                            <span className="px-1.5 py-0.5 bg-gray-800 text-emerald-200 rounded-sm border border-gray-600">{chunkCount} {t('dungeons.chunks')}</span>
                                            <span className="px-1.5 py-0.5 bg-gray-800 text-emerald-200 rounded-sm border border-gray-600">{figCount} {t('dungeons.figures')}</span>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            <Button
                                                className="flex-1 py-1 text-xs"
                                                onClick={() => (props.onBuildDungeon ? props.onBuildDungeon(d.id) : props.onDungeonTest?.())}
                                                title={props.onBuildDungeon ? 'Öffnet die Dungeon-Bühne geladen mit diesem Projekt' : 'Öffnet die Sandbox zum Bauen (Projekt-Anbindung folgt in Phase 2)'}
                                            ><Play size={12}/> {t('dungeons.build')}</Button>
                                            <Button
                                                variant="secondary"
                                                className="flex-1 py-1 text-xs"
                                                disabled
                                                title="Spielen kommt mit Phase 3 (Einstieg über Karten-Spot)"
                                            ><Compass size={12}/> {t('dungeons.play')}</Button>
                                            <button
                                                onClick={() => {
                                                    if (window.confirm(`Dungeon "${d.name}" wirklich löschen?`)) {
                                                        updateDungeonProjects((props.dungeonProjects || []).filter(x => x.id !== d.id));
                                                    }
                                                }}
                                                className="text-rose-400 hover:text-rose-200 p-1.5 rounded hover:bg-rose-950/60 transition-colors"
                                                title="Dungeon löschen"
                                            ><Trash size={14}/></button>
                                        </div>
                                    </OrnateFrame>
                                );
                            })}
                        </div>
                    </div>
                )}
                {tab === 'assets' && (
                    <div className="h-full overflow-hidden flex flex-col">
                        <AssetManager
                            assets={props.assets || []}
                            characters={props.characters}
                            scenes={props.scenes}
                            maps={props.maps}
                            worldInfo={props.worldInfo}
                            onUpdateAssets={props.onUpdateAssets || (() => {})}
                            onUpdateCharacters={props.onUpdateCharacters}
                            onUpdateScenes={props.onUpdateScenes}
                            onUpdateMaps={props.onUpdateMaps}
                        />
                    </div>
                )}
                </div>
            </div>
        </div>
        </WorldInfoContext.Provider>
    );
};