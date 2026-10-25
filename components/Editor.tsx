import React, { useState, useRef, useEffect } from 'react';
import { Character, CharacterImportance, CharacterAlignment, Scene, WorldMap, Battle, WorldInfo, Chapter, SceneEffect, MapSpot, WorldLocation, Faction, RelationshipTrigger, RelationshipThreshold, StoryLogEntry, AssetItem, DungeonProject, DungeonSection, DungeonBaseGLB, DungeonChunkLibraryEntry, DungeonChunkPlacement, DungeonNpcLibraryEntry, DungeonNpcPlacement, DungeonChunkType, DungeonNpcKind } from '../types';
import { Button } from './ui/Button';
import { Trash, Sword, Scaling, Plus, Save, Play, Download, Upload, Monitor, Map as MapIcon, Users, Target, Book, Layout, MessageSquare, Unlock, Lock, Waypoints, Image as ImageIcon, XCircle, Terminal, MapPin, Heart, EyeOff, Video, Music, Sparkles, Loader2, ArrowLeft, Cpu, Check, FolderOpen, ChevronUp, ChevronDown, ExternalLink, X, Move, ChevronLeft, ChevronRight, Search, Compass, Boxes } from 'lucide-react';
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
        <div className="space-y-6 max-w-3xl bg-gray-900/50 p-6 rounded-xl border border-gray-800">
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

    // Helper for arrays (sprites)
    const updateSpriteArray = (arrName: 'woozySprites' | 'finishAnimation', index: number, val: string | null) => {
        const arr = character[arrName] ? [...character[arrName]!] : [];
        if (val) arr[index] = val;
        else arr.splice(index, 1);
        onChange({ [arrName]: arr });
    };

    // Helper for Relationship
    const updateRelationship = (u: any) => {
        const rel = character.relationship || { enabled: false, currentValue: 0, startValue: 0, triggers: [], thresholds: [] };
        onChange({ relationship: { ...rel, ...u } });
    };

    return (
        <div className="space-y-6 max-w-2xl bg-gray-900/50 p-6 rounded-xl border border-gray-800">
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
            
            {/* Stats Editor for Combat */}
            <div className="bg-gray-800 p-4 rounded border border-gray-700">
                <h4 className="font-bold text-emerald-400 mb-4 flex items-center gap-2"><Sword size={16}/> Combat Stats</h4>
                {!character.stats ? (
                    <Button onClick={() => onChange({ stats: { pra: 3, str: 3, wid: 3, ges: 3, wil: 3, hp: 20, maxHp: 20, limit: 10, recoveryRate: 5, weapon: { name: 'Fists', at: 3, mod: 0, dmg: 1, cap: null } } })}>Enable Combat Stats</Button>
                ) : (
                    <div className="space-y-4">
                        <div className="grid grid-cols-5 gap-2 text-center">
                           {['pra', 'str', 'wid', 'ges', 'wil'].map(stat => (
                               <div key={stat}>
                                   <div className="text-[10px] uppercase font-bold text-gray-500">{stat}</div>
                                   <input type="number" className="w-full bg-gray-900 border border-gray-600 rounded text-center text-white" value={(character.stats as any)[stat]} onChange={e => onChange({ stats: { ...character.stats!, [stat]: parseInt(e.target.value) } })} />
                               </div>
                           ))}
                        </div>
                        <div className="grid grid-cols-3 gap-4">
                             <div>
                                 <label className="text-xs font-bold text-gray-500">Max HP</label>
                                 <input type="number" className="w-full bg-gray-900 border border-gray-600 rounded p-1 text-white" value={character.stats.maxHp} onChange={e => onChange({ stats: { ...character.stats!, maxHp: parseInt(e.target.value), hp: parseInt(e.target.value) } })} />
                             </div>
                             <div>
                                 <label className="text-xs font-bold text-gray-500">Limit</label>
                                 <input type="number" className="w-full bg-gray-900 border border-gray-600 rounded p-1 text-white" value={character.stats.limit} onChange={e => onChange({ stats: { ...character.stats!, limit: parseInt(e.target.value) } })} />
                             </div>
                             <div>
                                 <label className="text-xs font-bold text-gray-500 text-emerald-400">Recovery</label>
                                 <input type="number" className="w-full bg-gray-900 border border-emerald-500/50 rounded p-1 text-white" value={character.stats.recoveryRate || 5} onChange={e => onChange({ stats: { ...character.stats!, recoveryRate: parseInt(e.target.value) } })} />
                             </div>
                        </div>

                        {/* Battle Sprites */}
                        <div className="border-t border-gray-700 pt-4 mt-2">
                            <label className="text-xs font-bold text-gray-500 uppercase mb-2 block">Battle Visuals (Active)</label>
                            <div className="grid grid-cols-3 gap-2">
                                <div className="space-y-1">
                                    <ImageField label="Idle State" value={character.battleIdleSrc} onChange={val => onChange({ battleIdleSrc: val })} />
                                    <div className="flex items-center gap-1">
                                        <Scaling size={12} className="text-gray-500"/>
                                        <input type="number" step="0.1" className="w-full bg-gray-900 border border-gray-600 rounded text-center text-xs p-1 text-white" placeholder="Scale" value={character.battleIdleScale || character.battleScale || 1} onChange={e => onChange({ battleIdleScale: parseFloat(e.target.value) })} />
                                    </div>
                                    <div className="grid grid-cols-2 gap-1 mt-1">
                                        <input type="number" step="1" className="w-full bg-gray-900 border border-gray-600 rounded text-center text-[10px] p-1 text-white" placeholder="Off X" value={character.battleIdleOffsetX || 0} onChange={e => onChange({ battleIdleOffsetX: parseInt(e.target.value) || 0 })} title="Offset X" />
                                        <input type="number" step="1" className="w-full bg-gray-900 border border-gray-600 rounded text-center text-[10px] p-1 text-white" placeholder="Off Y" value={character.battleIdleOffsetY || 0} onChange={e => onChange({ battleIdleOffsetY: parseInt(e.target.value) || 0 })} title="Offset Y" />
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <ImageField label="Prep State" value={character.battlePrepSrc} onChange={val => onChange({ battlePrepSrc: val })} />
                                    <div className="flex items-center gap-1">
                                        <Scaling size={12} className="text-gray-500"/>
                                        <input type="number" step="0.1" className="w-full bg-gray-900 border border-gray-600 rounded text-center text-xs p-1 text-white" placeholder="Scale" value={character.battlePrepScale || character.battleScale || 1} onChange={e => onChange({ battlePrepScale: parseFloat(e.target.value) })} />
                                    </div>
                                    <div className="grid grid-cols-2 gap-1 mt-1">
                                        <input type="number" step="1" className="w-full bg-gray-900 border border-gray-600 rounded text-center text-[10px] p-1 text-white" placeholder="Off X" value={character.battlePrepOffsetX || 0} onChange={e => onChange({ battlePrepOffsetX: parseInt(e.target.value) || 0 })} title="Offset X" />
                                        <input type="number" step="1" className="w-full bg-gray-900 border border-gray-600 rounded text-center text-[10px] p-1 text-white" placeholder="Off Y" value={character.battlePrepOffsetY || 0} onChange={e => onChange({ battlePrepOffsetY: parseInt(e.target.value) || 0 })} title="Offset Y" />
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <ImageField label="Hit Impact" value={character.battleHitSrc} onChange={val => onChange({ battleHitSrc: val })} />
                                    <div className="flex items-center gap-1">
                                        <Scaling size={12} className="text-gray-500"/>
                                        <input type="number" step="0.1" className="w-full bg-gray-900 border border-gray-600 rounded text-center text-xs p-1 text-white" placeholder="Scale" value={character.battleHitScale || character.battleScale || 1} onChange={e => onChange({ battleHitScale: parseFloat(e.target.value) })} />
                                    </div>
                                    <div className="grid grid-cols-2 gap-1 mt-1">
                                        <input type="number" step="1" className="w-full bg-gray-900 border border-gray-600 rounded text-center text-[10px] p-1 text-white" placeholder="Off X" value={character.battleHitOffsetX || 0} onChange={e => onChange({ battleHitOffsetX: parseInt(e.target.value) || 0 })} title="Offset X" />
                                        <input type="number" step="1" className="w-full bg-gray-900 border border-gray-600 rounded text-center text-[10px] p-1 text-white" placeholder="Off Y" value={character.battleHitOffsetY || 0} onChange={e => onChange({ battleHitOffsetY: parseInt(e.target.value) || 0 })} title="Offset Y" />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Woozy & Death Visuals */}
                         <div className="border-t border-gray-700 pt-4 mt-2">
                            <label className="text-xs font-bold text-emerald-400 uppercase mb-2 block">Woozy / Death Visuals</label>
                            <div className="grid grid-cols-2 gap-4 mb-4">
                                <div className="p-2 border border-emerald-500/20 rounded bg-emerald-900/10">
                                    <div className="text-[10px] font-bold text-gray-500 uppercase mb-2">Woozy Loop (2-4 Frames)</div>
                                    <div className="grid grid-cols-2 gap-2">
                                        {[0,1,2,3].map(i => (
                                            <ImageField key={i} label={`Frame ${i+1}`} value={character.woozySprites?.[i] || null} onChange={val => updateSpriteArray('woozySprites', i, val)} />
                                        ))}
                                    </div>
                                </div>
                                <div className="p-2 border border-red-500/20 rounded bg-red-900/10">
                                    <div className="text-[10px] font-bold text-gray-500 uppercase mb-2">Finish Sequence</div>
                                    <div className="space-y-2">
                                        <ImageField label="Corpse (Static)" value={character.finishSprite || null} onChange={val => onChange({ finishSprite: val })} />
                                        <div className="grid grid-cols-2 gap-2">
                                            {[0,1,2,3].map(i => (
                                                <ImageField key={i} label={`Anim ${i+1}`} value={character.finishAnimation?.[i] || null} onChange={val => updateSpriteArray('finishAnimation', i, val)} />
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="border-t border-gray-700 pt-4">
                             <div className="text-xs font-bold text-gray-500 uppercase mb-2">Weapon</div>
                             <div className="grid grid-cols-3 gap-2">
                                <input className="col-span-3 bg-gray-900 border border-gray-600 rounded p-1 text-sm text-white" placeholder="Weapon Name" value={character.stats.weapon.name} onChange={e => onChange({ stats: { ...character.stats!, weapon: { ...character.stats!.weapon, name: e.target.value } } })} />
                                <input type="number" placeholder="AT" title="Attack Dice" className="bg-gray-900 border border-gray-600 rounded p-1 text-white" value={character.stats.weapon.at} onChange={e => onChange({ stats: { ...character.stats!, weapon: { ...character.stats!.weapon, at: parseInt(e.target.value) } } })} />
                                <input type="number" placeholder="DMG" title="Damage" className="bg-gray-900 border border-gray-600 rounded p-1 text-white" value={character.stats.weapon.dmg} onChange={e => onChange({ stats: { ...character.stats!, weapon: { ...character.stats!.weapon, dmg: parseInt(e.target.value) } } })} />
                             </div>
                        </div>

                        <div className="border-t border-gray-700 pt-4 mt-2">
                            <label className="text-xs font-bold text-yellow-500 uppercase mb-2 block">Battle Audio (SFX)</label>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <AudioField label="Weapon Hit" value={character.sfxWeaponHit || null} onChange={val => onChange({ sfxWeaponHit: val || null })} />
                                    <AudioField label="Weapon Miss" value={character.sfxWeaponMiss || null} onChange={val => onChange({ sfxWeaponMiss: val || null })} />
                                </div>
                                <div className="space-y-2">
                                    <AudioField label="Voice Hit" value={character.sfxVoiceHit || null} onChange={val => onChange({ sfxVoiceHit: val || null })} />
                                    <AudioField label="Voice Crit" value={character.sfxVoiceCrit || null} onChange={val => onChange({ sfxVoiceCrit: val || null })} />
                                    <AudioField label="Voice Death" value={character.sfxVoiceDeath || null} onChange={val => onChange({ sfxVoiceDeath: val || null })} />
                                </div>
                            </div>
                        </div>

                        <Button variant="danger" className="w-full mt-4 text-xs" onClick={() => onChange({ stats: undefined })}>Disable Combat</Button>
                    </div>
                )}
            </div>
        </div>
    );
};

interface SceneEditorProps {
    scene: Scene;
    allScenes: Scene[];
    allBattles: Battle[];
    allMaps: WorldMap[];
    characters: Character[];
    chapters: Chapter[];
    worldInfo: WorldInfo;
    assets?: AssetItem[];
    onChange: (u: Partial<Scene>) => void;
    onDelete: () => void;
}

const SceneEditor: React.FC<SceneEditorProps> = ({ scene, allScenes, allBattles, allMaps, characters, chapters, worldInfo, assets, onChange, onDelete }) => {
    const toggleEffect = (type: 'scene' | 'transition' | 'battle', targetId: string, action: 'unlock' | 'lock') => {
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
        <div className="space-y-6 max-w-3xl bg-gray-900/50 p-6 rounded-xl border border-gray-800">
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
                        <div className="text-xs font-bold text-gray-500 uppercase sticky top-0 bg-gray-800 py-1 z-10">Battles</div>
                        {allBattles.map((b) => {
                            const effect = scene.effects?.find(u => u.type === 'battle' && u.targetId === b.id);
                            const status = effect?.action || 'neutral';
                            return (
                                <div key={b.id} className="flex items-center justify-between bg-gray-900 p-2 rounded border border-gray-700">
                                    <div className="flex items-center gap-2 truncate flex-1">
                                        <Sword size={14} className="text-red-500"/>
                                        <span className="text-xs text-gray-300 truncate" title={b.name}>{b.name}</span>
                                    </div>
                                    <div className="flex gap-1 ml-2">
                                        <button onClick={() => toggleEffect('battle', b.id, 'unlock')} className={`p-1 rounded ${status === 'unlock' ? 'bg-emerald-600 text-white' : 'bg-gray-800 text-gray-500 hover:bg-gray-700'}`} title="Unlock"><Unlock size={12}/></button>
                                        <button onClick={() => toggleEffect('battle', b.id, 'lock')} className={`p-1 rounded ${status === 'lock' ? 'bg-red-600 text-white' : 'bg-gray-800 text-gray-500 hover:bg-gray-700'}`} title="Lock"><Lock size={12}/></button>
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
    battles: Battle[];
    allMaps: WorldMap[];
    assets?: AssetItem[];
    onChange: (u: Partial<WorldMap>) => void;
    onDelete: () => void;
}

const MapEditor: React.FC<MapEditorProps> = ({ map, scenes, characters, battles, allMaps, assets, onChange, onDelete }) => {
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
        <div className="space-y-6 max-w-3xl bg-gray-900/50 p-6 rounded-xl border border-gray-800">
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
                                        <option value="battle">Battle</option>
                                        <option value="transition">Transition</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-gray-400 uppercase">Ziel (Target)</label>
                                    <select 
                                        className="w-full bg-gray-800 border border-gray-700 rounded p-1.5 text-xs text-white focus:border-amber-500 focus:outline-none"
                                        value={selectedSpot.sceneId || selectedSpot.characterId || selectedSpot.battleId || selectedSpot.targetMapId || ''}
                                        onChange={e => {
                                            const val = e.target.value;
                                            if (selectedSpot.type === 'scene') updateSpot(selectedSpot.id, { sceneId: val });
                                            if (selectedSpot.type === 'character') updateSpot(selectedSpot.id, { characterId: val });
                                            if (selectedSpot.type === 'battle') updateSpot(selectedSpot.id, { battleId: val });
                                            if (selectedSpot.type === 'transition') updateSpot(selectedSpot.id, { targetMapId: val });
                                        }}
                                    >
                                        <option value="">-- Auswählen --</option>
                                        {selectedSpot.type === 'scene' && scenes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                        {selectedSpot.type === 'character' && characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                        {selectedSpot.type === 'battle' && battles.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                                        {selectedSpot.type === 'transition' && allMaps.filter(m => m.id !== map.id).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
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
                                         <option value="battle">Battle</option>
                                         <option value="transition">Transition</option>
                                     </select>
                                 </div>
                                 <div>
                                     <label className="text-[10px] font-bold text-gray-500 uppercase">Target</label>
                                     <select 
                                        className="w-full bg-gray-900 border border-gray-600 rounded p-1 text-xs text-white"
                                        value={spot.sceneId || spot.characterId || spot.battleId || spot.targetMapId || ''}
                                        onChange={e => {
                                            const val = e.target.value;
                                            if (spot.type === 'scene') updateSpot(spot.id, { sceneId: val });
                                            if (spot.type === 'character') updateSpot(spot.id, { characterId: val });
                                            if (spot.type === 'battle') updateSpot(spot.id, { battleId: val });
                                            if (spot.type === 'transition') updateSpot(spot.id, { targetMapId: val });
                                        }}
                                     >
                                         <option value="">-- Select --</option>
                                         {spot.type === 'scene' && scenes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                         {spot.type === 'character' && characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                         {spot.type === 'battle' && battles.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                                         {spot.type === 'transition' && allMaps.filter(m => m.id !== map.id).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
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

interface BattleEditorProps {
    battle: Battle;
    characters: Character[];
    chapters: Chapter[];
    allScenes: Scene[];
    allBattles: Battle[];
    allMaps: WorldMap[];
    assets?: AssetItem[];
    onChange: (u: Partial<Battle>) => void;
    onDelete: () => void;
}

const BattleEditor: React.FC<BattleEditorProps> = ({ battle, characters, chapters, allScenes, allBattles, allMaps, assets, onChange, onDelete }) => {
    
    const toggleEffect = (type: 'scene' | 'transition' | 'battle', targetId: string, action: 'unlock' | 'lock') => {
        const effects = battle.onWinEffect ? [...battle.onWinEffect] : [];
        const index = effects.findIndex(e => e.type === type && e.targetId === targetId);

        if (index >= 0) {
            if (effects[index].action === action) effects.splice(index, 1);
            else effects[index] = { ...effects[index], action };
        } else {
            effects.push({ type, targetId, action });
        }
        onChange({ onWinEffect: effects });
    };

    return (
        <div className="space-y-6 max-w-3xl bg-gray-900/50 p-6 rounded-xl border border-gray-800">
            <div className="flex justify-between items-center">
                <h3 className="text-xl font-bold text-red-400">Editing: {battle.name}</h3>
                <div className="flex gap-2">
                    <label className="flex items-center gap-2 text-xs bg-gray-800 px-3 py-1 rounded border border-gray-700">
                        <input type="checkbox" checked={battle.isRepeatable} onChange={e => onChange({ isRepeatable: e.target.checked })} />
                        Repeatable
                    </label>
                    <button onClick={onDelete} className="text-red-500 hover:bg-red-900/20 p-2 rounded"><Trash size={18}/></button>
                </div>
            </div>

             <div className="grid grid-cols-2 gap-4">
                 <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">Battle Name</label>
                    <input className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" value={battle.name} onChange={e => onChange({ name: e.target.value })} />
                 </div>
                 <div>
                    <label className="text-xs font-bold text-gray-500 uppercase">Chapter</label>
                    <select className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" value={battle.chapterId || ''} onChange={e => onChange({ chapterId: e.target.value })}>
                        {chapters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                 </div>
            </div>

            <ImageField 
                label="Battle Background" 
                value={battle.backgroundSrc} 
                onChange={val => onChange({ backgroundSrc: val })} 
                assets={assets}
                defaultPrompt={`${battle.name} battle background backdrop, epic anime combat arena, visual novel action backdrop, digital painting, dramatic cinematic lighting, masterpiece`}
            />

            <AudioField label="Background Music (Loop)" value={battle.bgmUrl || null} onChange={val => onChange({ bgmUrl: val || undefined })} />

            <div className="grid grid-cols-2 gap-8">
                {/* Player Team */}
                <div className="bg-gray-800 p-4 rounded border border-gray-700">
                    <h4 className="font-bold text-emerald-400 mb-2 flex items-center gap-2"><Users size={16}/> Player Team</h4>
                    <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                        {characters.map(c => {
                            const group = getCharacterGroup(c);
                            return (
                                <label key={c.id} className="flex items-center justify-between gap-2 bg-gray-900 p-2 rounded border border-gray-700 cursor-pointer hover:bg-gray-800">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <input 
                                            type="checkbox"
                                            checked={battle.playerCharacterIds.includes(c.id)}
                                            onChange={e => {
                                                if (e.target.checked) onChange({ playerCharacterIds: [...battle.playerCharacterIds, c.id] });
                                                else onChange({ playerCharacterIds: battle.playerCharacterIds.filter(id => id !== c.id) });
                                            }}
                                        />
                                        <span className="text-xs text-white font-medium truncate">{c.name}</span>
                                    </div>
                                    <span className={`text-[9px] px-1.5 py-0.2 rounded border ${group.badgeBg} ${group.badgeBorder} ${group.textColor} font-semibold flex-shrink-0`}>
                                        {group.shortLabel}
                                    </span>
                                </label>
                            );
                        })}
                    </div>
                </div>

                {/* Enemy Team */}
                <div className="bg-gray-800 p-4 rounded border border-gray-700">
                    <h4 className="font-bold text-red-400 mb-2 flex items-center gap-2"><Target size={16}/> Enemy Team</h4>
                    <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                         {characters.map(c => {
                            const group = getCharacterGroup(c);
                            return (
                                <label key={c.id} className="flex items-center justify-between gap-2 bg-gray-900 p-2 rounded border border-gray-700 cursor-pointer hover:bg-gray-800">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <input 
                                            type="checkbox"
                                            checked={battle.enemyCharacterIds.includes(c.id)}
                                            onChange={e => {
                                                if (e.target.checked) onChange({ enemyCharacterIds: [...battle.enemyCharacterIds, c.id] });
                                                else onChange({ enemyCharacterIds: battle.enemyCharacterIds.filter(id => id !== c.id) });
                                            }}
                                        />
                                        <span className="text-xs text-white font-medium truncate">{c.name}</span>
                                    </div>
                                    <span className={`text-[9px] px-1.5 py-0.2 rounded border ${group.badgeBg} ${group.badgeBorder} ${group.textColor} font-semibold flex-shrink-0`}>
                                        {group.shortLabel}
                                    </span>
                                </label>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Win Effects */}
             <div className="bg-gray-800 p-4 rounded-xl border border-gray-700">
                <label className="flex items-center gap-2 text-sm font-bold text-yellow-500 mb-4"><Unlock size={18} /> ON WIN: UNLOCKS / LOCKS</label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-h-60 overflow-y-auto custom-scrollbar p-1">
                    {/* Reuse similar logic from SceneEditor for unlocks */}
                    <div className="space-y-2">
                        <div className="text-xs font-bold text-gray-500 uppercase sticky top-0 bg-gray-800 py-1 z-10">Scenes</div>
                        {allScenes.map((s) => {
                            const effect = battle.onWinEffect?.find(u => u.type === 'scene' && u.targetId === s.id);
                            const status = effect?.action || 'neutral';
                            return (
                                <div key={s.id} className="flex items-center justify-between bg-gray-900 p-2 rounded border border-gray-700">
                                    <span className="text-xs text-gray-300 truncate flex-1" title={s.name}>{s.name}</span>
                                    <div className="flex gap-1 ml-2">
                                        <button onClick={() => toggleEffect('scene', s.id, 'unlock')} className={`p-1 rounded ${status === 'unlock' ? 'bg-emerald-600 text-white' : 'bg-gray-800 text-gray-500'}`}><Unlock size={12}/></button>
                                        <button onClick={() => toggleEffect('scene', s.id, 'lock')} className={`p-1 rounded ${status === 'lock' ? 'bg-red-600 text-white' : 'bg-gray-800 text-gray-500'}`}><Lock size={12}/></button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    {/* Add Maps and Battles lists similarly if needed, for now focusing on Scenes which is most common */}
                     <div className="space-y-2">
                        <div className="text-xs font-bold text-gray-500 uppercase sticky top-0 bg-gray-800 py-1 z-10">Map Transitions</div>
                        {allMaps.map((m) => {
                            const effect = battle.onWinEffect?.find(u => u.type === 'transition' && u.targetId === m.id);
                            const status = effect?.action || 'neutral';
                            return (
                                <div key={m.id} className="flex items-center justify-between bg-gray-900 p-2 rounded border border-gray-700">
                                    <span className="text-xs text-gray-300 truncate flex-1" title={m.name}>To: {m.name}</span>
                                    <div className="flex gap-1 ml-2">
                                        <button onClick={() => toggleEffect('transition', m.id, 'unlock')} className={`p-1 rounded ${status === 'unlock' ? 'bg-emerald-600 text-white' : 'bg-gray-800 text-gray-500'}`}><Unlock size={12}/></button>
                                        <button onClick={() => toggleEffect('transition', m.id, 'lock')} className={`p-1 rounded ${status === 'lock' ? 'bg-red-600 text-white' : 'bg-gray-800 text-gray-500'}`}><Lock size={12}/></button>
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

interface EditorProps {
  worldInfo: WorldInfo;
  chapters: Chapter[];
  characters: Character[];
  scenes: Scene[];
  maps: WorldMap[];
  battles: Battle[];
  dungeonProjects?: DungeonProject[];
  assets?: AssetItem[];
  storyLog?: StoryLogEntry[]; // New prop for context awareness
  onUpdateWorldInfo: (w: WorldInfo) => void;
  onUpdateChapters: (c: Chapter[]) => void;
  onUpdateCharacters: (c: Character[]) => void;
  onUpdateScenes: (s: Scene[]) => void;
  onUpdateMaps: (m: WorldMap[]) => void;
  onUpdateBattles: (b: Battle[]) => void;
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
}

export type EditorTab = 'home' | 'world' | 'chapters' | 'chars' | 'scenes' | 'maps' | 'dungeons' | 'battles' | 'assets';

export const Editor: React.FC<EditorProps> = (props) => {
    const [tab, setTab] = useState<EditorTab>(props.initialTab ?? 'home');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [scenePrompt, setScenePrompt] = useState("");
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [isSubSidebarOpen, setIsSubSidebarOpen] = useState(true);
    const [quickSaveSuccess, setQuickSaveSuccess] = useState(false);

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

    const navItems: { id: typeof tab; label: string; icon: React.ReactNode }[] = [
        { id: 'home', label: 'Home Settings', icon: <Play size={16}/> },
        { id: 'world', label: 'World & Lore', icon: <Book size={16}/> },
        { id: 'chapters', label: 'Chapters', icon: <Book size={16}/> },
        { id: 'chars', label: 'Characters', icon: <Users size={16}/> },
        { id: 'scenes', label: 'Scenes', icon: <Monitor size={16}/> },
        { id: 'maps', label: 'Maps', icon: <MapIcon size={16}/> },
        { id: 'dungeons', label: 'Dungeons', icon: <Boxes size={16}/> },
        { id: 'battles', label: 'Battles', icon: <Target size={16}/> },
        { id: 'assets', label: 'Assets', icon: <FolderOpen size={16}/> },
    ];

    const handleQuickSaveClick = async () => {
        if (props.onQuickSave) {
            await props.onQuickSave();
            setQuickSaveSuccess(true);
            setTimeout(() => setQuickSaveSuccess(false), 2500);
        }
    };

    const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.[0]) props.onImportProject(e.target.files[0]);
    };

    const handleImportSave = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.[0] && props.onImportSave) props.onImportSave(e.target.files[0]);
    };

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
                alert('Die Sandbox ist leer. Baue zuerst im "Dungeon Test" etwas — oder lege einen neuen Dungeon an.');
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
            <div className="flex h-screen overflow-hidden text-sm">
            {/* Mobile Sidebar Toggle Button */}
            <button
                className="md:hidden absolute top-4 right-4 z-50 p-2 bg-gray-800 rounded-md text-white border border-gray-700"
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            >
                <Layout size={20} />
            </button>

            {/* Sidebar */}
            <div className={`${isSidebarOpen ? 'w-64 md:w-64' : 'w-0 md:w-16'} transition-all duration-300 ease-in-out bg-gray-900 border-r border-gray-800 flex flex-col flex-shrink-0 z-40 relative md:static absolute inset-y-0 left-0 overflow-hidden`}>
                <div className={`p-3 md:p-4 border-b border-gray-800 flex items-center whitespace-nowrap ${isSidebarOpen ? 'justify-between min-w-[16rem]' : 'justify-center min-w-0'}`}>
                    {isSidebarOpen ? (
                        <>
                            <h1 className="text-lg md:text-xl font-bold text-emerald-500 flex items-center gap-2"><Layout size={18}/> VN Creator</h1>
                            <div className="flex items-center gap-1">
                                <button className="hidden md:flex text-gray-400 hover:text-white p-1 rounded hover:bg-gray-800 transition-colors" onClick={() => setIsSidebarOpen(false)} title="Menü einklappen">
                                    <ChevronLeft size={18}/>
                                </button>
                                <button className="md:hidden text-gray-500" onClick={() => setIsSidebarOpen(false)}><XCircle size={20}/></button>
                            </div>
                        </>
                    ) : (
                        <button className="hidden md:flex text-gray-400 hover:text-white p-1 rounded hover:bg-gray-800 transition-colors" onClick={() => setIsSidebarOpen(true)} title="Menü ausklappen">
                            <ChevronRight size={18}/>
                        </button>
                    )}
                </div>
                <div className={`flex-1 overflow-y-auto py-2 md:py-4 space-y-1 ${isSidebarOpen ? 'min-w-[16rem]' : 'min-w-0'}`}>
                    {navItems.map(item => (
                        <button 
                            key={item.id} 
                            onClick={() => { setTab(item.id); setSelectedId(null); if (window.innerWidth < 768) setIsSidebarOpen(false); }} 
                            title={item.label}
                            className={`w-full text-left py-2.5 md:py-3 flex items-center gap-3 transition-colors ${
                                isSidebarOpen ? 'px-4 md:px-6' : 'px-0 justify-center'
                            } ${
                                tab === item.id 
                                    ? 'bg-emerald-900/30 text-emerald-400 border-r-2 border-emerald-500 font-semibold' 
                                    : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                            }`}
                        >
                            <span className="flex-shrink-0">{item.icon}</span>
                            {isSidebarOpen && <span className="truncate">{item.label}</span>}
                        </button>
                    ))}
                    {props.onDungeonTest && (
                        <div className="pt-3 px-2 border-t border-gray-800/80">
                            <button
                                onClick={props.onDungeonTest}
                                title="3D Dungeon Testbühne betreten"
                                className={`w-full py-2.5 flex items-center gap-2.5 rounded-xl bg-purple-900/30 hover:bg-purple-900/50 text-purple-300 hover:text-white border border-purple-700/50 transition-all font-semibold text-xs shadow-md ${
                                    isSidebarOpen ? 'px-3' : 'px-0 justify-center'
                                }`}
                            >
                                <Compass size={17} className="text-purple-400 flex-shrink-0" />
                                {isSidebarOpen && <span className="truncate">Dungeon Test</span>}
                            </button>
                        </div>
                    )}
                </div>
            </div>
            
            {/* Backdrop for mobile sidebar */}
            {isSidebarOpen && <div className="md:hidden fixed inset-0 bg-black/60 z-30" onClick={() => setIsSidebarOpen(false)} />}

            {/* Main Content */}
            <div className="flex-1 bg-gray-950 flex flex-col w-full min-w-0 h-full">
                <div className="flex-1 p-4 md:p-8 overflow-hidden flex flex-col">
                {/* ... (Existing World and Chars Tabs) ... */}
                {tab === 'home' && (
                    <div className="max-w-3xl mx-auto w-full space-y-8 overflow-y-auto h-full pb-12 pt-4">
                        <div className="text-center mb-8">
                            <h2 className="text-3xl font-bold text-white mb-2 flex items-center justify-center gap-3">
                                <Layout size={32} className="text-emerald-500" /> VN Creator UI
                            </h2>
                            <p className="text-gray-400">Manage your project and launch the game.</p>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="bg-gray-900 p-6 rounded-xl border border-gray-800 space-y-4">
                                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><Play className="text-green-500" size={20}/> Play Game</h3>
                                <Button onClick={props.onPlay} className="w-full justify-center bg-green-600 hover:bg-green-500 py-3 text-base font-semibold"><Play size={18} className="mr-2"/> Start New Game</Button>
                                {props.hasSaveGame && <Button onClick={props.onContinueGame} variant="secondary" className="w-full justify-center py-3 text-base font-semibold"><Play size={18} className="mr-2"/> Continue Save Game</Button>}
                                {props.onDungeonTest && (
                                    <Button onClick={props.onDungeonTest} className="w-full justify-center bg-purple-600 hover:bg-purple-500 text-white py-3 text-base font-semibold shadow-lg shadow-purple-950/40 border border-purple-400/30">
                                        <Compass size={18} className="mr-2 text-purple-200"/> Dungeon Test
                                    </Button>
                                )}
                            </div>

                            <div className="bg-gray-900 p-6 rounded-xl border border-gray-800 space-y-4">
                                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><Save className="text-blue-500" size={20}/> Save Data Management</h3>
                                <p className="text-xs text-gray-400 mb-2">Save progress locally or export/import save files.</p>
                                <div className="grid grid-cols-1 gap-3">
                                    <Button 
                                        variant="secondary" 
                                        onClick={handleQuickSaveClick} 
                                        title="Quick Save Project to Local Browser Storage" 
                                        className={`py-2 justify-center transition-colors ${quickSaveSuccess ? 'border-emerald-500 text-emerald-400 bg-emerald-950/40' : ''}`}
                                    >
                                        {quickSaveSuccess ? (
                                            <>
                                                <Check size={16} className="mr-2 text-emerald-400"/>
                                                Projekt lokal gespeichert!
                                            </>
                                        ) : (
                                            <>
                                                <Save size={16} className="mr-2"/>
                                                Quick Save locally
                                            </>
                                        )}
                                    </Button>
                                    <div className="grid grid-cols-2 gap-3">
                                        <Button variant="secondary" onClick={props.onExportSave} title="Export Save Game to File" className="py-2 justify-center"><Download size={16} className="mr-2"/> Export Save</Button>
                                        <div className="relative">
                                            <Button variant="secondary" className="w-full py-2 justify-center" title="Import Save Game from File"><Upload size={16} className="mr-2"/> Import Save</Button>
                                            <input type="file" onChange={handleImportSave} className="absolute inset-0 opacity-0 cursor-pointer" accept=".json"/>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-gray-900 p-6 rounded-xl border border-gray-800 space-y-4 md:col-span-2">
                                <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2"><Download className="text-emerald-500" size={20}/> Project Data (Editor)</h3>
                                <p className="text-xs text-gray-400 mb-4">Exportieren oder Importieren des VN Creator Projekts. Bei "Full Project" werden alle generierten KI-Bilder, Sprach- und BGM-Dateien mit in die ZIP gepackt.</p>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                    <Button variant="secondary" onClick={() => props.onExportProject(true)} title="Export Full Project with all Media" className="py-3 justify-center font-semibold text-emerald-400 border-emerald-500/30 hover:bg-emerald-900/20"><Download size={18} className="mr-2"/> Export Full (inkl. Medien)</Button>
                                    <Button variant="secondary" onClick={() => props.onExportProject(false)} title="Export Light Project (Data only)" className="py-3 justify-center font-semibold text-cyan-400 border-cyan-500/30 hover:bg-cyan-900/20"><Download size={18} className="mr-2"/> Export Light (nur Daten)</Button>
                                    <div className="relative">
                                        <Button variant="secondary" className="w-full py-3 justify-center font-semibold text-emerald-400 border-emerald-500/30 hover:bg-emerald-900/20" title="Import Editor Project"><Upload size={18} className="mr-2"/> Import Project (ZIP/JSON)</Button>
                                        <input type="file" onChange={handleImport} className="absolute inset-0 opacity-0 cursor-pointer" accept=".json,.zip"/>
                                    </div>
                                </div>
                            </div>

                            {/* LLM Settings */}
                            <div className="bg-gray-900 p-6 rounded-xl border border-gray-800 space-y-4 md:col-span-2">
                                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><Cpu className="text-orange-500" size={20}/> Model Settings</h3>
                                <p className="text-xs text-gray-400 mb-4">Select the AI Model used for generation.</p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-xs font-bold text-gray-500 uppercase">Provider</label>
                                        <select 
                                            className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white h-[42px] focus:border-emerald-500 outline-none"
                                            value={props.worldInfo.llmProvider || 'gemini'}
                                            onChange={e => props.onUpdateWorldInfo({ ...props.worldInfo, llmProvider: e.target.value as 'gemini' | 'ollama' | 'openai' })}
                                        >
                                            <option value="gemini">Gemini</option>
                                            <option value="ollama">Local (Ollama)</option>
                                            <option value="openai">OpenAI Compatible (Router)</option>
                                        </select>
                                    </div>
                                    {(!props.worldInfo.llmProvider || props.worldInfo.llmProvider === 'gemini') && (
                                        <div>
                                            <label className="text-xs font-bold text-gray-500 uppercase">Model</label>
                                            <select 
                                                className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white h-[42px] focus:border-emerald-500 outline-none"
                                                value={props.worldInfo.llmModel || 'gemini-3.5-flash'}
                                                onChange={e => props.onUpdateWorldInfo({ ...props.worldInfo, llmModel: e.target.value })}
                                            >
                                                <option value="gemini-3.5-flash">Gemini 3.5 Flash</option>
                                                <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (Preview)</option>
                                            </select>
                                        </div>
                                    )}
                                    {props.worldInfo.llmProvider === 'openai' && (
                                        <div>
                                            <label className="text-xs font-bold text-gray-500 uppercase">Model Name</label>
                                            <input 
                                                type="text"
                                                className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white h-[42px] focus:border-emerald-500 outline-none placeholder:text-gray-600 font-mono text-xs"
                                                value={props.worldInfo.openaiModel || ''}
                                                placeholder="e.g. nous-hermes/llama-3.1-70b"
                                                onChange={e => props.onUpdateWorldInfo({ ...props.worldInfo, openaiModel: e.target.value })}
                                            />
                                        </div>
                                    )}
                                    {props.worldInfo.llmProvider === 'openai' && (
                                        <>
                                            <div>
                                                <label className="text-xs font-bold text-gray-500 uppercase">API Key</label>
                                                <input 
                                                    type="password"
                                                    className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white h-[42px] focus:border-emerald-500 outline-none placeholder:text-gray-600 font-mono text-xs"
                                                    value={props.worldInfo.openaiApiKey || ''}
                                                    placeholder="sk-or-v1-..."
                                                    onChange={e => props.onUpdateWorldInfo({ ...props.worldInfo, openaiApiKey: e.target.value })}
                                                />
                                            </div>
                                            <div>
                                                <label className="text-xs font-bold text-gray-500 uppercase">Base URL</label>
                                                <input 
                                                    type="text"
                                                    className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white h-[42px] focus:border-emerald-500 outline-none placeholder:text-gray-600 font-mono text-xs"
                                                    value={props.worldInfo.openaiBaseUrl !== undefined ? props.worldInfo.openaiBaseUrl : 'https://openrouter.ai/api/v1'}
                                                    placeholder="https://openrouter.ai/api/v1"
                                                    onChange={e => props.onUpdateWorldInfo({ ...props.worldInfo, openaiBaseUrl: e.target.value })}
                                                />
                                            </div>
                                            <div className="sm:col-span-2 space-y-2">
                                                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-gray-400">
                                                    <span>Schnellwahl Base URL:</span>
                                                    {[
                                                        { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1', defaultModel: 'nous-hermes/llama-3.1-70b' },
                                                        { name: 'Requesty', url: 'https://router.requesty.ai/v1', defaultModel: '' },
                                                        { name: 'Groq', url: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile' },
                                                        { name: 'Local (LM Studio / Ollama)', url: 'http://localhost:1234/v1', defaultModel: '' }
                                                    ].map(p => (
                                                        <button
                                                            key={p.name}
                                                            type="button"
                                                            onClick={() => {
                                                                props.onUpdateWorldInfo({
                                                                    ...props.worldInfo,
                                                                    openaiBaseUrl: p.url,
                                                                    openaiModel: props.worldInfo.openaiModel || p.defaultModel
                                                                });
                                                            }}
                                                            className={`px-2 py-0.5 rounded border transition-colors ${
                                                                (props.worldInfo.openaiBaseUrl || 'https://openrouter.ai/api/v1') === p.url
                                                                    ? 'bg-emerald-600 text-white border-emerald-500 font-medium'
                                                                    : 'bg-gray-800/90 hover:bg-gray-700 text-gray-300 border-gray-700'
                                                            }`}
                                                        >
                                                            {p.name}
                                                        </button>
                                                    ))}
                                                </div>
                                                <p className="text-[11px] text-gray-400 bg-gray-950 p-2.5 rounded border border-gray-800">
                                                    Kompatibel mit OpenRouter, Requesty, NVIDIA NIM, Groq, LM Studio oder jedem OpenAI-kompatiblen API-Endpunkt.
                                                </p>
                                            </div>
                                            {!props.worldInfo.openaiApiKey?.trim() && (
                                                <div className="sm:col-span-2 text-[11px] text-amber-400 bg-amber-950/40 border border-amber-800/50 p-2.5 rounded flex items-center gap-2">
                                                    <span>⚠️</span>
                                                    <span>Hinweis: Bitte trage einen gültigen API-Key ein, um diesen Provider für LLM-Aufrufe zu nutzen.</span>
                                                </div>
                                            )}
                                        </>
                                    )}
                                    {props.worldInfo.llmProvider === 'ollama' && (
                                        <div className="sm:col-span-2">
                                            <label className="text-xs font-bold text-gray-500 uppercase">Model</label>
                                            <input
                                                type="text"
                                                className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white h-[42px] focus:border-emerald-500 outline-none placeholder:text-gray-600"
                                                value={props.worldInfo.llmModel || 'llama3'}
                                                placeholder="e.g. llama3, mistral, qwen2.5:14b"
                                                onChange={e => props.onUpdateWorldInfo({ ...props.worldInfo, llmModel: e.target.value })}
                                            />
                                        </div>
                                    )}
                                    {props.worldInfo.llmProvider === 'ollama' && (
                                        <>
                                            <div className="sm:col-span-2 bg-gray-950/60 p-4 rounded-lg border border-gray-800 space-y-3">
                                                <div className="flex justify-between items-center">
                                                    <label className="text-xs font-bold text-gray-400 uppercase flex items-center gap-1.5">
                                                        Context Size (num_ctx)
                                                    </label>
                                                    <span className="text-xs font-mono px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800/50 font-semibold">
                                                        {props.worldInfo.ollamaNumCtx 
                                                            ? `${props.worldInfo.ollamaNumCtx >= 1024 ? `${(props.worldInfo.ollamaNumCtx / 1024).toFixed(props.worldInfo.ollamaNumCtx % 1024 === 0 ? 0 : 1)}K` : props.worldInfo.ollamaNumCtx} Tokens (${props.worldInfo.ollamaNumCtx})` 
                                                            : '8K Tokens (8192)'}
                                                    </span>
                                                </div>
                                                <input 
                                                    type="number"
                                                    className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white h-[42px] focus:border-emerald-500 outline-none font-mono text-sm"
                                                    value={props.worldInfo.ollamaNumCtx ?? 8192}
                                                    placeholder="8192"
                                                    onChange={e => props.onUpdateWorldInfo({ ...props.worldInfo, ollamaNumCtx: parseInt(e.target.value, 10) || 8192 })}
                                                />
                                                <div>
                                                    <div className="text-[11px] text-gray-400 mb-1.5 font-medium">Standardgrößen (Schnellwahl per Klick):</div>
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {[
                                                            { label: '2K (2048)', val: 2048 },
                                                            { label: '4K (4096)', val: 4096 },
                                                            { label: '8K (8192)', val: 8192, badge: 'Standard' },
                                                            { label: '16K (16384)', val: 16384 },
                                                            { label: '32K (32768)', val: 32768 },
                                                            { label: '64K (65536)', val: 65536, badge: 'Groß' },
                                                            { label: '128K (131072)', val: 131072 }
                                                        ].map(preset => {
                                                            const isSelected = (props.worldInfo.ollamaNumCtx ?? 8192) === preset.val;
                                                            return (
                                                                <button
                                                                    key={preset.val}
                                                                    type="button"
                                                                    onClick={() => props.onUpdateWorldInfo({ ...props.worldInfo, ollamaNumCtx: preset.val })}
                                                                    className={`text-xs px-2.5 py-1 rounded border transition-all flex items-center gap-1 cursor-pointer ${
                                                                        isSelected
                                                                            ? 'bg-emerald-600 text-white border-emerald-400 font-semibold shadow-sm'
                                                                            : 'bg-gray-800/90 hover:bg-gray-700 text-gray-300 border-gray-700 hover:border-gray-600'
                                                                    }`}
                                                                >
                                                                    <span>{preset.label}</span>
                                                                    {preset.badge && (
                                                                        <span className={`text-[9px] px-1 py-0.2 rounded uppercase font-bold ${
                                                                            isSelected ? 'bg-emerald-800 text-white' : 'bg-gray-900 text-gray-400'
                                                                        }`}>
                                                                            {preset.badge}
                                                                        </span>
                                                                    )}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                    <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
                                                        Hinweis: Kontextgrößen bei Sprachmodellen sind Potenzen von 2 (z. B. 8192 = 8K, 65536 = 64K). Höhere Werte erlauben längere Dialoge, benötigen aber mehr VRAM.
                                                    </p>
                                                </div>
                                            </div>
                                            <div>
                                                <div className="flex justify-between items-center mb-1">
                                                    <label className="text-xs font-bold text-gray-500 uppercase">Temperature</label>
                                                    <span className="text-[11px] text-gray-400 font-mono">{props.worldInfo.ollamaTemperature ?? 0.8}</span>
                                                </div>
                                                <input 
                                                    type="number"
                                                    step="0.05"
                                                    min="0"
                                                    max="2"
                                                    className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white h-[42px] focus:border-emerald-500 outline-none font-mono text-sm"
                                                    value={props.worldInfo.ollamaTemperature ?? 0.8}
                                                    placeholder="0.8"
                                                    onChange={e => props.onUpdateWorldInfo({ ...props.worldInfo, ollamaTemperature: parseFloat(e.target.value) || 0.8 })}
                                                />
                                                <p className="text-[10px] text-gray-500 mt-1">0.7 – 0.8 empfohlen für kreative Antworten.</p>
                                            </div>
                                            <div>
                                                <div className="flex justify-between items-center mb-1">
                                                    <label className="text-xs font-bold text-gray-500 uppercase">Repeat Penalty</label>
                                                    <span className="text-[11px] text-gray-400 font-mono">{props.worldInfo.ollamaRepeatPenalty ?? 1.1}</span>
                                                </div>
                                                <input 
                                                    type="number"
                                                    step="0.05"
                                                    min="1"
                                                    max="2"
                                                    className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white h-[42px] focus:border-emerald-500 outline-none font-mono text-sm"
                                                    value={props.worldInfo.ollamaRepeatPenalty ?? 1.1}
                                                    placeholder="1.1"
                                                    onChange={e => props.onUpdateWorldInfo({ ...props.worldInfo, ollamaRepeatPenalty: parseFloat(e.target.value) || 1.1 })}
                                                />
                                                <p className="text-[10px] text-gray-500 mt-1">1.1 empfohlen zur Vermeidung von Wiederholungen.</p>
                                            </div>
                                        </>
                                    )}
                                    {props.worldInfo.llmProvider === 'ollama' && (
                                        <div className="sm:col-span-2">
                                            <label className="text-xs font-bold text-gray-500 uppercase">Ollama URL</label>
                                            <input 
                                                type="text"
                                                className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white h-[42px] focus:border-emerald-500 outline-none font-mono text-xs"
                                                value={props.worldInfo.ollamaUrl || 'http://localhost:11434'}
                                                placeholder="http://localhost:11434"
                                                onChange={e => props.onUpdateWorldInfo({ ...props.worldInfo, ollamaUrl: e.target.value })}
                                            />
                                        </div>
                                    )}

                                    {/* ComfyUI Settings */}
                                    <div className="sm:col-span-2 border-t border-gray-800 pt-6 mt-4">
                                        <div className="flex justify-between items-center mb-4">
                                            <div>
                                                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                                                    <Sparkles size={16} className="text-emerald-500" /> Local ComfyUI Image Generation
                                                </h4>
                                                <p className="text-[11px] text-gray-500">Enable local AI image generation using a running ComfyUI server.</p>
                                            </div>
                                            <label className="flex items-center gap-2 text-xs bg-gray-800 px-3 py-1.5 rounded-lg border border-gray-700 cursor-pointer select-none">
                                                <input 
                                                    type="checkbox" 
                                                    checked={props.worldInfo.comfyEnabled || false} 
                                                    onChange={e => props.onUpdateWorldInfo({ ...props.worldInfo, comfyEnabled: e.target.checked })} 
                                                    className="rounded text-emerald-600 focus:ring-emerald-500 bg-gray-900 border-gray-700"
                                                />
                                                <span className="font-semibold text-gray-300">Aktiviert</span>
                                            </label>
                                        </div>

                                        {props.worldInfo.comfyEnabled && (
                                            <div className="space-y-4 bg-gray-950 p-4 rounded-lg border border-gray-800">
                                                <div>
                                                    <label className="text-xs font-bold text-gray-400 uppercase">ComfyUI URL</label>
                                                    <input 
                                                        type="text"
                                                        className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white text-xs mt-1 focus:border-emerald-500 outline-none font-mono"
                                                        value={props.worldInfo.comfyUrl || 'http://127.0.0.1:8188'}
                                                        placeholder="e.g. http://127.0.0.1:8188"
                                                        onChange={e => props.onUpdateWorldInfo({ ...props.worldInfo, comfyUrl: e.target.value })}
                                                    />
                                                    <p className="text-[10px] text-gray-500 mt-1">
                                                        Stelle sicher, dass du ComfyUI mit dem Argument <code className="bg-gray-800 px-1 py-0.5 rounded text-gray-300">--enable-cors-header</code> startest, um CORS-Fehler im Browser zu vermeiden.
                                                    </p>
                                                </div>

                                                <div>
                                                    <div className="flex justify-between items-center mb-1">
                                                        <label className="text-xs font-bold text-gray-400 uppercase">ComfyUI API Workflow (JSON)</label>
                                                        <button 
                                                            type="button"
                                                            onClick={() => {
                                                                if (window.confirm('Möchtest du das standardmäßige KSampler-Workflow-Template laden?')) {
                                                                    props.onUpdateWorldInfo({ ...props.worldInfo, comfyWorkflow: getDefaultWorkflow() });
                                                                }
                                                            }}
                                                            className="text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800 hover:bg-emerald-900 px-2 py-0.5 rounded transition-colors"
                                                        >
                                                            Reset auf Standard-Template
                                                        </button>
                                                    </div>
                                                    <textarea 
                                                        className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white text-[10px] focus:border-emerald-500 outline-none font-mono h-40 custom-scrollbar"
                                                        value={props.worldInfo.comfyWorkflow || ''}
                                                        placeholder="Füge hier deinen exportierten ComfyUI API JSON Workflow ein..."
                                                        onChange={e => props.onUpdateWorldInfo({ ...props.worldInfo, comfyWorkflow: e.target.value })}
                                                    />
                                                    <p className="text-[10px] text-gray-500 mt-1 leading-relaxed">
                                                        Füge das im <strong>API-Format</strong> (Export API in ComfyUI aktivieren) gespeicherte JSON ein. Verwende <code className="bg-gray-800 px-1 py-0.5 rounded text-gray-300">PROMPT_PLACEHOLDER</code> im Text-Node sowie <code className="bg-gray-800 px-1 py-0.5 rounded text-gray-300">WIDTH_PLACEHOLDER</code> / <code className="bg-gray-800 px-1 py-0.5 rounded text-gray-300">HEIGHT_PLACEHOLDER</code> in den EmptyLatentImage-Dimensionen.
                                                    </p>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
                {tab === 'world' && (
                    <div className="max-w-4xl space-y-8 overflow-y-auto h-full pr-4 pb-12">
                        <div>
                            <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2"><Book size={24}/> World Settings</h2>
                            <p className="text-gray-400 text-sm mb-6">Define the global context, lore, and rules for the AI Game Master.</p>
                            
                            <div className="space-y-4">
                                <div>
                                    <label className="text-xs font-bold text-gray-500 uppercase flex items-center gap-2 mb-1"><Book size={14}/> World Description</label>
                                    <textarea 
                                        className="w-full bg-gray-900 border border-gray-700 rounded p-3 h-32 text-white focus:border-emerald-500 outline-none" 
                                        placeholder="General setting, atmosphere, time period, and major themes..."
                                        value={props.worldInfo.description} 
                                        onChange={e => props.onUpdateWorldInfo({ ...props.worldInfo, description: e.target.value })} 
                                    />
                                </div>

                                <div>
                                    <label className="text-xs font-bold text-emerald-400 uppercase flex items-center gap-2 mb-1"><Terminal size={14}/> System Prompt (AI Instructions)</label>
                                    <textarea 
                                        className="w-full bg-gray-900 border border-emerald-900/50 rounded p-3 h-32 text-emerald-100 font-mono text-sm focus:border-emerald-500 outline-none" 
                                        placeholder="Technical instructions for the AI (e.g. 'Speak in Shakespearean English', 'Always be sarcastic', 'Focus on horror elements')..."
                                        value={props.worldInfo.systemInstruction || ''} 
                                        onChange={e => props.onUpdateWorldInfo({ ...props.worldInfo, systemInstruction: e.target.value })} 
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 border-t border-gray-800 pt-8">
                             {/* LOCATIONS */}
                             <div className="space-y-4">
                                 <div className="flex justify-between items-center">
                                     <h3 className="text-lg font-bold text-emerald-400 flex items-center gap-2"><MapPin size={18}/> Key Locations</h3>
                                     <Button onClick={() => props.onUpdateWorldInfo({ ...props.worldInfo, loreLocations: [...props.worldInfo.loreLocations, { id: crypto.randomUUID(), name: 'New Location', description: '' }] })} className="text-xs px-2 py-1"><Plus size={14}/></Button>
                                 </div>
                                 <div className="space-y-3">
                                     {props.worldInfo.loreLocations.length === 0 && <div className="text-gray-600 text-sm italic">No specific lore locations defined.</div>}
                                     {props.worldInfo.loreLocations.map((loc, i) => (
                                         <div key={loc.id} className="bg-gray-900 border border-gray-700 rounded p-3 space-y-2.5 group">
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
                             </div>

                             {/* FACTIONS */}
                             <div className="space-y-4">
                                 <div className="flex justify-between items-center">
                                     <h3 className="text-lg font-bold text-amber-400 flex items-center gap-2"><Users size={18}/> Groups / Factions</h3>
                                     <Button onClick={() => props.onUpdateWorldInfo({ ...props.worldInfo, factions: [...props.worldInfo.factions, { id: crypto.randomUUID(), name: 'New Group', description: '' }] })} className="text-xs px-2 py-1"><Plus size={14}/></Button>
                                 </div>
                                 <div className="space-y-3">
                                     {props.worldInfo.factions.length === 0 && <div className="text-gray-600 text-sm italic">No groups defined.</div>}
                                     {props.worldInfo.factions.map((fac, i) => (
                                         <div key={fac.id} className="bg-gray-900 border border-gray-700 rounded p-3 space-y-2.5 group">
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
                             </div>
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
                        <div className="flex flex-col md:flex-row h-full gap-4 md:gap-6">
                            <div className={`w-full ${isSubSidebarOpen ? 'md:w-1/3' : 'md:w-0 md:hidden'} border-none md:border-r border-gray-800 pb-4 md:pb-0 md:pr-4 overflow-y-auto ${selectedId ? 'hidden md:block' : 'block'}`}>
                                <div className="flex justify-between items-center mb-4">
                                    <h2 className="text-xl font-bold text-white flex items-center gap-2"><Book size={20}/> Chapters</h2>
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
                                }}><Plus size={14}/> Add Chapter</Button>
                                <div className="space-y-2">
                                    {sortedChapters.map((c) => {
                                        const sceneCount = props.scenes.filter(s => s.chapterId === c.id).length;
                                        return (
                                            <div key={c.id} onClick={() => setSelectedId(c.id)} className={`p-2.5 md:p-3 rounded-lg cursor-pointer border text-sm transition-colors ${selectedId === c.id ? 'bg-emerald-900/50 border-emerald-500' : 'bg-gray-900 border-gray-800 hover:bg-gray-800'}`}>
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
                                    <div className="h-full flex items-center justify-center text-gray-600 italic text-sm">Select a chapter from the list to edit its details and manage mapped scenes.</div>
                                )}
                            </div>
                        </div>
                    );
                })()}

                {tab === 'chars' && (
                    <div className="flex flex-col md:flex-row h-full gap-4 md:gap-6">
                        <div className={`w-full ${isSubSidebarOpen ? 'md:w-1/3' : 'md:w-0 md:hidden'} border-none md:border-r border-gray-800 pb-4 md:pb-0 md:pr-4 overflow-y-auto ${selectedId ? 'hidden md:block' : 'block'}`}>
                            <div className="flex justify-between items-center mb-3">
                                <h2 className="text-lg font-bold text-white flex items-center gap-2"><Users size={18}/> Characters ({props.characters.length})</h2>
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
                            }}><Plus size={14}/> Add Character</Button>

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
                                        <div className="p-4 bg-gray-900/50 border border-gray-800 rounded-lg text-center text-xs text-gray-500">
                                            Keine Charaktere gefunden.
                                        </div>
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
                                                                            className={`p-2 rounded-lg cursor-pointer border text-xs flex items-center gap-2.5 transition-all ${isSelected ? 'bg-emerald-900/50 border-emerald-500 shadow-md' : 'bg-gray-900/80 border-gray-800/80 hover:bg-gray-800/90'}`}
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
                        <div className="flex flex-col md:flex-row h-full gap-4 md:gap-6">
                            <div className={`w-full ${isSubSidebarOpen ? 'md:w-1/3' : 'md:w-0 md:hidden'} border-none md:border-r border-gray-800 pb-4 md:pb-0 md:pr-4 overflow-y-auto ${selectedId ? 'hidden md:block' : 'block'}`}>
                                <div className="flex justify-between items-center mb-3">
                                    <h2 className="text-lg font-bold text-white flex items-center gap-2"><Monitor size={18}/> Scenes</h2>
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
                                    }}><Plus size={14}/> Add Scene</Button>
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
                                                className={`p-2.5 md:p-3 rounded-lg cursor-pointer border text-sm transition-colors ${selectedId === s.id ? 'bg-emerald-900/50 border-emerald-500' : 'bg-gray-900 border-gray-800 hover:bg-gray-800'}`}
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
                                         <SceneEditor key={selectedId} scene={props.scenes.find(s => s.id === selectedId)!} allScenes={props.scenes} allBattles={props.battles} allMaps={props.maps} characters={props.characters} chapters={props.chapters} worldInfo={props.worldInfo} assets={props.assets} onChange={(u) => props.onUpdateScenes(props.scenes.map(x => x.id === selectedId ? { ...x, ...u } : x))} onDelete={() => { props.onUpdateScenes(props.scenes.filter(x => x.id !== selectedId)); setSelectedId(null); }} />
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })()}
                
                {tab === 'maps' && (
                     <div className="flex flex-col md:flex-row h-full gap-4 md:gap-6">
                        <div className={`w-full ${isSubSidebarOpen ? 'md:w-1/3' : 'md:w-0 md:hidden'} border-none md:border-r border-gray-800 pb-4 md:pb-0 md:pr-4 overflow-y-auto ${selectedId ? 'hidden md:block' : 'block'}`}>
                            <div className="flex justify-between items-center mb-3">
                                <h2 className="text-lg font-bold text-white flex items-center gap-2"><MapIcon size={18}/> Maps</h2>
                                <button onClick={() => setIsSubSidebarOpen(false)} className="hidden md:flex text-gray-400 hover:text-white p-1 rounded hover:bg-gray-800 transition-colors" title="Karten-Liste einklappen">
                                    <ChevronLeft size={18}/>
                                </button>
                            </div>
                             <Button className="w-full mb-4 py-1.5 text-sm" onClick={() => { const id = crypto.randomUUID(); props.onUpdateMaps([...props.maps, { id, name: 'New Map', backgroundSrc: null, spots: [] }]); setSelectedId(id); }}><Plus size={14}/> Add Map</Button>
                             <div className="space-y-2">{props.maps.map(m => (<div key={m.id} onClick={() => setSelectedId(m.id)} className={`p-2 md:p-3 rounded cursor-pointer border text-sm ${selectedId === m.id ? 'bg-emerald-900/50 border-emerald-500' : 'bg-gray-900 border-gray-800 hover:bg-gray-800'}`}><div className="font-bold text-white">{m.name}</div></div>))}</div>
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
                                    <MapEditor key={selectedId} map={props.maps.find(m => m.id === selectedId)!} scenes={props.scenes} characters={props.characters} battles={props.battles} allMaps={props.maps} assets={props.assets} onChange={(u) => props.onUpdateMaps(props.maps.map(x => x.id === selectedId ? { ...x, ...u } : x))} onDelete={() => { props.onUpdateMaps(props.maps.filter(x => x.id !== selectedId)); setSelectedId(null); }} />
                                </div>
                            )}
                        </div>
                    </div>
                )}
                {tab === 'dungeons' && (
                    <div className="h-full overflow-y-auto pb-8">
                        <div className="flex flex-wrap gap-2 mb-4">
                            <Button className="py-1.5 text-sm" onClick={createDungeonProject}><Plus size={14}/> Neuer Dungeon</Button>
                            <Button
                                variant="secondary"
                                className="py-1.5 text-sm"
                                onClick={importSandboxToDungeon}
                                disabled={isImportingSandbox}
                                title="Kopiert den aktuellen Stand der 'Dungeon Test'-Sandbox als eigenständiges Dungeon-Projekt"
                            >
                                <Upload size={14}/> {isImportingSandbox ? 'Importiere…' : 'Sandbox importieren'}
                            </Button>
                        </div>

                        <div className="mb-5 p-3 bg-sky-950/40 border border-sky-800/60 rounded-xl text-xs text-sky-200 leading-relaxed">
                            <strong className="font-bold">Hinweis:</strong> „Bauen" öffnet die 3D-Bühne direkt mit diesem
                            Dungeon-Projekt geladen — Chunks/Figuren hochladen &amp; platzieren, Änderungen werden automatisch
                            zurück ins Projekt gespeichert. Der „Dungeon Test"-Button in Home/Seitenleiste öffnet weiterhin
            die separate Sandbox. „Spielen" folgt in Phase 3 (Einstieg über Karten-Spots).
                        </div>

                        {(props.dungeonProjects || []).length === 0 && (
                            <div className="p-8 border border-dashed border-gray-700 rounded-xl text-center text-gray-500">
                                <Boxes size={28} className="mx-auto mb-3 opacity-50"/>
                                <p className="text-sm font-semibold text-gray-400 mb-1">Noch keine Dungeons angelegt</p>
                                <p className="text-xs">Lege einen neuen Dungeon an — oder importiere deinen gebauten Sandbox-Dungeon.</p>
                            </div>
                        )}

                        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
                            {(props.dungeonProjects || []).map(d => {
                                const chunkCount = d.placedChunks.length + (d.baseFloor ? 1 : 0);
                                const figCount = d.placedNpcs.length;
                                return (
                                    <div key={d.id} className="p-4 bg-gray-900 border border-gray-800 rounded-xl hover:border-gray-600 transition-colors">
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
                                                    className="flex-1 bg-gray-950 border border-gray-700 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-emerald-500"
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
                                            <span className="px-1.5 py-0.5 bg-gray-800 text-gray-300 rounded border border-gray-700">{d.sections.length} Abschnitte</span>
                                            <span className="px-1.5 py-0.5 bg-gray-800 text-gray-300 rounded border border-gray-700">{chunkCount} Chunks</span>
                                            <span className="px-1.5 py-0.5 bg-gray-800 text-gray-300 rounded border border-gray-700">{figCount} Figuren</span>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            <Button
                                                className="flex-1 py-1 text-xs"
                                                onClick={() => (props.onBuildDungeon ? props.onBuildDungeon(d.id) : props.onDungeonTest?.())}
                                                title={props.onBuildDungeon ? 'Öffnet die Dungeon-Bühne geladen mit diesem Projekt' : 'Öffnet die Sandbox zum Bauen (Projekt-Anbindung folgt in Phase 2)'}
                                            ><Play size={12}/> Bauen</Button>
                                            <Button
                                                variant="secondary"
                                                className="flex-1 py-1 text-xs"
                                                disabled
                                                title="Spielen kommt mit Phase 3 (Einstieg über Karten-Spot)"
                                            ><Compass size={12}/> Spielen</Button>
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
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
                {tab === 'battles' && (
                     <div className="flex flex-col md:flex-row h-full gap-4 md:gap-6">
                        <div className={`w-full ${isSubSidebarOpen ? 'md:w-1/3' : 'md:w-0 md:hidden'} border-none md:border-r border-gray-800 pb-4 md:pb-0 md:pr-4 overflow-y-auto ${selectedId ? 'hidden md:block' : 'block'}`}>
                            <div className="flex justify-between items-center mb-3">
                                <h2 className="text-lg font-bold text-white flex items-center gap-2"><Target size={18}/> Battles</h2>
                                <button onClick={() => setIsSubSidebarOpen(false)} className="hidden md:flex text-gray-400 hover:text-white p-1 rounded hover:bg-gray-800 transition-colors" title="Kampf-Liste einklappen">
                                    <ChevronLeft size={18}/>
                                </button>
                            </div>
                             <Button className="w-full mb-4 py-1.5 text-sm" onClick={() => { const id = crypto.randomUUID(); props.onUpdateBattles([...props.battles, { id, name: 'New Battle', backgroundSrc: null, playerCharacterIds: [], enemyCharacterIds: [], isRepeatable: false }]); setSelectedId(id); }}><Plus size={14}/> Add Battle</Button>
                             <div className="space-y-2">{props.battles.map(b => (<div key={b.id} onClick={() => setSelectedId(b.id)} className={`p-2 md:p-3 rounded cursor-pointer border text-sm ${selectedId === b.id ? 'bg-emerald-900/50 border-emerald-500' : 'bg-gray-900 border-gray-800 hover:bg-gray-800'}`}><div className="font-bold text-white">{b.name}</div></div>))}</div>
                        </div>
                        <div className={`flex-1 overflow-y-auto ${!selectedId ? 'hidden md:block' : 'block'}`}>
                            {!isSubSidebarOpen && (
                                <button onClick={() => setIsSubSidebarOpen(true)} className="hidden md:inline-flex mb-3 text-xs text-emerald-400 bg-gray-900 border border-gray-800 hover:bg-gray-800 px-2.5 py-1.5 rounded-lg items-center gap-1.5 font-medium transition-colors shadow-sm" title="Kampf-Liste ausklappen">
                                    <ChevronRight size={16}/> Kampf-Liste anzeigen
                                </button>
                            )}
                            {selectedId && props.battles.find(b => b.id === selectedId) && (
                                <div className="flex flex-col h-full">
                                    <button className="md:hidden mb-4 text-emerald-400 font-bold flex items-center gap-1.5" onClick={() => setSelectedId(null)}>
                                        <ArrowLeft size={16}/> Back to Battles
                                    </button>
                                    <BattleEditor key={selectedId} battle={props.battles.find(b => b.id === selectedId)!} characters={props.characters} chapters={props.chapters} allScenes={props.scenes} allBattles={props.battles} allMaps={props.maps} assets={props.assets} onChange={(u) => props.onUpdateBattles(props.battles.map(x => x.id === selectedId ? { ...x, ...u } : x))} onDelete={() => { props.onUpdateBattles(props.battles.filter(x => x.id !== selectedId)); setSelectedId(null); }} />
                                </div>
                            )}
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