import React, { useState, useRef, useEffect } from 'react';
import { AssetItem, AssetCategory, Character, Scene, WorldMap, WorldInfo } from '../types';
import { Button } from './ui/Button';
import { AsyncImage } from './ui/AsyncImage';
import { saveImage, deleteImage } from '../utils/imageStorage';
import { generateComfyImage, prepareComfyWorkflow } from '../services/comfyService';
import { TagSelector } from './TagSelector';
import { getEffectiveAssignment, PRESET_ARCHETYPES, getArchetypeLabel } from '../utils/assetUtils';
import {
  ImageIcon,
  Plus,
  Upload,
  Sparkles,
  Search,
  Filter,
  Tag,
  Trash2,
  Edit3,
  Check,
  UserPlus,
  Monitor,
  Map as MapIcon,
  X,
  Loader2,
  Users,
  Eye,
  Sliders,
  FolderPlus,
  Shield,
  Heart,
  BookOpen
} from 'lucide-react';

interface AssetManagerProps {
  assets: AssetItem[];
  characters: Character[];
  scenes: Scene[];
  maps: WorldMap[];
  worldInfo: WorldInfo;
  onUpdateAssets: (assets: AssetItem[]) => void;
  onUpdateCharacters: (chars: Character[]) => void;
  onUpdateScenes: (scenes: Scene[]) => void;
  onUpdateMaps: (maps: WorldMap[]) => void;
}

const DEFAULT_TAG_SUGGESTIONS = [
  "Garten",
  "Schlossgarten",
  "Garden",
  "Gasthaus",
  "Inn",
  "Gästezimmer",
  "Schäbiges_Gasthaus_Zimmer",
  "rustikaler Schankraum",
  "Gasthaus-Zimmer",
  "Schloss/Palast Schlafgemach",
  "Bücherei",
  "Hof",
  "Wald",
  "Dunkle Gasse",
  "Marktplatz",
  "Thronsaal",
  "Verlies",
  "Küste / Strand",
  "Höhle",
  "Magie-Akademie",
  "Labor",
  "Tempel",
  "Taverne",
  "Dorf",
  "Stadt",
  "Kaufmannshaus",
  "Ruinen",
  "Berg / Gebirge"
];

interface ArchetypeSelectorProps {
  value: string;
  onChange: (val: string) => void;
  allAvailableArchetypes: string[];
  label?: string;
  className?: string;
}

const ArchetypeSelector: React.FC<ArchetypeSelectorProps> = ({
  value,
  onChange,
  allAvailableArchetypes,
  label = "Klasse / Archetyp",
  className = ""
}) => {
  const [isCustom, setIsCustom] = useState(false);
  const [customVal, setCustomVal] = useState('');

  const knownKeys = Array.from(new Set([
    ...PRESET_ARCHETYPES.map(p => p.id),
    ...allAvailableArchetypes
  ])).filter(Boolean);

  const matchedKey = knownKeys.find(
    k => k.toLowerCase() === (value || '').toLowerCase() || getArchetypeLabel(k).toLowerCase() === (value || '').toLowerCase()
  );

  useEffect(() => {
    if (!matchedKey && value && value.trim()) {
      setIsCustom(true);
      setCustomVal(value);
    } else if (matchedKey) {
      setIsCustom(false);
    }
  }, [value, matchedKey]);

  return (
    <div className={className}>
      <label className="text-gray-400 uppercase font-bold text-[10px] block mb-1">{label}</label>
      {!isCustom ? (
        <select
          value={matchedKey || (value ? '__custom__' : 'buerger')}
          onChange={e => {
            const sel = e.target.value;
            if (sel === '__custom__') {
              setIsCustom(true);
              setCustomVal(value || '');
            } else {
              setIsCustom(false);
              onChange(sel);
            }
          }}
          className="w-full bg-gray-900 border border-gray-700 rounded p-1.5 text-white text-xs outline-none focus:border-emerald-500"
        >
          {knownKeys.map(key => (
            <option key={key} value={key}>
              {getArchetypeLabel(key)}
            </option>
          ))}
          <option value="__custom__">+ Neue Klasse / Archetyp eintragen...</option>
        </select>
      ) : (
        <div className="space-y-1">
          <div className="flex gap-1">
            <input
              type="text"
              autoFocus
              placeholder="z.B. Kleriker, Handwerker..."
              value={customVal}
              onChange={e => {
                setCustomVal(e.target.value);
                onChange(e.target.value);
              }}
              className="flex-1 bg-gray-900 border border-emerald-500 rounded p-1.5 text-white text-xs outline-none"
            />
            <button
              type="button"
              onClick={() => {
                setIsCustom(false);
                if (!value || !matchedKey) onChange('buerger');
              }}
              className="px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-xs"
              title="Zurück zur Auswahlliste"
            >
              Liste
            </button>
          </div>
          <p className="text-[9px] text-gray-500">Eigenen Wert eingeben (wird auch im Filter verfügbar sein)</p>
        </div>
      )}
    </div>
  );
};

export const AssetManager: React.FC<AssetManagerProps> = ({
  assets,
  characters,
  scenes,
  maps,
  worldInfo,
  onUpdateAssets,
  onUpdateCharacters,
  onUpdateScenes,
  onUpdateMaps,
}) => {
  const [subTab, setSubTab] = useState<'all' | 'scene_bg' | 'characters' | 'maps'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'unassigned' | 'assigned'>('all');

  // Character filters
  const [alignmentFilter, setAlignmentFilter] = useState<string>('all');
  const [speciesFilter, setSpeciesFilter] = useState<string>('all');
  const [genderFilter, setGenderFilter] = useState<string>('all');
  const [archetypeFilter, setArchetypeFilter] = useState<string>('all');

  // Location / Environment filters
  const [envFilter, setEnvFilter] = useState<string>('all');
  const [tagFilter, setTagFilter] = useState<string>('all');

  // Modal States
  const [editingAsset, setEditingAsset] = useState<AssetItem | null>(null);
  const [assigningAsset, setAssigningAsset] = useState<AssetItem | null>(null);
  const [assetToDelete, setAssetToDelete] = useState<AssetItem | null>(null);
  const [showAiModal, setShowAiModal] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // AI Generation Form
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiName, setAiName] = useState('');
  const [aiCategory, setAiCategory] = useState<AssetCategory>('scene_bg');
  const [aiEnv, setAiEnv] = useState<'indoor' | 'outdoor' | 'dungeon'>('indoor');
  const [aiAlignment, setAiAlignment] = useState<'gut' | 'neutral' | 'boese'>('neutral');
  const [aiSpecies, setAiSpecies] = useState<'mensch' | 'furry' | 'anthro' | 'modifiziert'>('mensch');
  const [aiGender, setAiGender] = useState<'maennlich' | 'weiblich' | 'diverse'>('weiblich');
  const [aiArchetype, setAiArchetype] = useState<string>('buerger');
  const [aiTags, setAiTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState('');
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [aiStatus, setAiStatus] = useState('');
  const [aiError, setAiError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Synchronize asset assignment status whenever scenes/maps/characters change
  useEffect(() => {
    let hasChanges = false;
    const syncedAssets = assets.map(asset => {
      const effective = getEffectiveAssignment(asset, scenes, maps, [], characters);
      if (JSON.stringify(asset.assignedTo) !== JSON.stringify(effective)) {
        hasChanges = true;
        return { ...asset, assignedTo: effective };
      }
      return asset;
    });

    if (hasChanges) {
      onUpdateAssets(syncedAssets);
    }
  }, [scenes, maps, characters]);

  // Collect unique tags sorted alphabetically
  const existingTags = Array.from(
    new Set([
      ...DEFAULT_TAG_SUGGESTIONS,
      ...assets.flatMap(a => a.locationMeta?.tags || [])
    ])
  )
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' }));

  // Collect unique archetype keys from presets + existing character assets
  const allArchetypes = Array.from(
    new Set([
      ...PRESET_ARCHETYPES.map(p => p.id),
      ...assets
        .map(a => a.characterMeta?.archetype)
        .filter((arch): arch is string => Boolean(arch && arch.trim()))
    ])
  );

  // Handle Manual Upload
  const handleUploadFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const base64 = ev.target?.result as string;
        const newId = crypto.randomUUID();
        await saveImage(newId, base64);

        const category: AssetCategory = subTab === 'all' ? 'scene_bg' : subTab;
        const nameClean = file.name.replace(/\.[^/.]+$/, "");

        const newAsset: AssetItem = {
          id: newId,
          name: nameClean || "Neues Asset",
          category,
          fileUrl: newId,
          assetType: file.type.startsWith('audio/') ? 'audio' : 'image',
          locationMeta: category !== 'characters' ? {
            environment: 'indoor',
            tags: []
          } : undefined,
          characterMeta: category === 'characters' ? {
            alignment: 'neutral',
            species: 'mensch',
            gender: 'weiblich',
            archetype: 'buerger'
          } : undefined,
          createdAt: Date.now()
        };

        onUpdateAssets([newAsset, ...assets]);
      } catch (err) {
        console.error("Upload asset failed:", err);
        alert("Upload fehlgeschlagen.");
      } finally {
        setIsUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };
    reader.readAsDataURL(file);
  };

  // Handle AI Asset Generation
  const handleGenerateAiAsset = async () => {
    if (!aiPrompt.trim()) return;
    setIsAiGenerating(true);
    setAiError(null);
    setAiStatus("Starte KI Bildgenerierung...");

    try {
      const comfyUrl = worldInfo?.comfyUrl || 'http://127.0.0.1:8188';
      const workflowStr = worldInfo?.comfyWorkflow || '';

      const isBG = aiCategory === 'scene_bg' || aiCategory === 'maps';
      const width = isBG ? 1024 : 512;
      const height = isBG ? 576 : 512;

      const preparedWorkflow = prepareComfyWorkflow(workflowStr, aiPrompt, width, height);

      const base64Data = await generateComfyImage(comfyUrl, preparedWorkflow, (statusMsg) => {
        setAiStatus(statusMsg);
      });

      const imageId = crypto.randomUUID();
      await saveImage(imageId, base64Data);

      const newAsset: AssetItem = {
        id: imageId,
        name: aiName.trim() || `KI ${aiCategory === 'characters' ? 'Charakter' : aiCategory === 'maps' ? 'Karte' : 'Szene'}`,
        category: aiCategory,
        fileUrl: imageId,
        assetType: 'image',
        locationMeta: aiCategory !== 'characters' ? {
          environment: aiEnv,
          tags: aiTags
        } : undefined,
        characterMeta: aiCategory === 'characters' ? {
          alignment: aiAlignment,
          species: aiSpecies,
          gender: aiGender,
          archetype: aiArchetype
        } : undefined,
        createdAt: Date.now()
      };

      onUpdateAssets([newAsset, ...assets]);
      setShowAiModal(false);
      // Reset form
      setAiPrompt('');
      setAiName('');
      setAiTags([]);
    } catch (err: any) {
      console.error("AI Asset generation error:", err);
      setAiError(err.message || "Fehler bei der KI-Bildgenerierung. Überprüfe ComfyUI / Settings.");
    } finally {
      setIsAiGenerating(false);
    }
  };

  // Delete Asset
  const confirmDeleteAsset = async () => {
    if (!assetToDelete) return;
    const asset = assetToDelete;
    if (asset.fileUrl) {
      try {
        await deleteImage(asset.fileUrl);
      } catch (e) {
        console.error("Fehler beim Löschen aus dem Bildspeicher:", e);
      }
    }
    const nextAssets = assets.filter(a => a.id !== asset.id);
    onUpdateAssets(nextAssets);
    setAssetToDelete(null);
  };

  // Save Asset Details Editing
  const handleSaveEditAsset = () => {
    if (!editingAsset) return;
    onUpdateAssets(assets.map(a => a.id === editingAsset.id ? editingAsset : a));
    setEditingAsset(null);
  };

  // Quick Entity Creation from Asset
  const handleCreateEntityFromAsset = (asset: AssetItem, type: 'character' | 'scene' | 'map') => {
    if (type === 'character') {
      const newChar: Character = {
        id: crypto.randomUUID(),
        name: asset.name,
        defaultDescription: `${asset.characterMeta?.archetype || 'Charakter'} (${asset.characterMeta?.species || 'Mensch'})`,
        rpgColor: '#10b981',
        imageSrc: asset.fileUrl,
        mapSpriteSrc: null
      };
      onUpdateCharacters([...characters, newChar]);

      // Mark asset assigned
      const updatedAsset: AssetItem = {
        ...asset,
        assignedTo: {
          type: 'character_idle',
          targetId: newChar.id,
          targetName: newChar.name
        }
      };
      onUpdateAssets(assets.map(a => a.id === asset.id ? updatedAsset : a));
      alert(`Neuer Charakter "${newChar.name}" mit diesem Asset wurde erfolgreich erstellt!`);
    } else if (type === 'scene') {
      const newScene: Scene = {
        id: crypto.randomUUID(),
        name: asset.name,
        locationName: asset.name,
        backgroundSrc: asset.fileUrl,
        description: `Szene in ${asset.name}`,
        goal: "Erkunde die Umgebung",
        characters: [],
        effects: []
      };
      onUpdateScenes([...scenes, newScene]);

      const updatedAsset: AssetItem = {
        ...asset,
        assignedTo: {
          type: 'scene_bg',
          targetId: newScene.id,
          targetName: newScene.name
        }
      };
      onUpdateAssets(assets.map(a => a.id === asset.id ? updatedAsset : a));
      alert(`Neue Szene "${newScene.name}" mit diesem Asset wurde erfolgreich erstellt!`);
    } else if (type === 'map') {
      const newMap: WorldMap = {
        id: crypto.randomUUID(),
        name: asset.name,
        backgroundSrc: asset.fileUrl,
        spots: []
      };
      onUpdateMaps([...maps, newMap]);

      const updatedAsset: AssetItem = {
        ...asset,
        assignedTo: {
          type: 'map_bg',
          targetId: newMap.id,
          targetName: newMap.name
        }
      };
      onUpdateAssets(assets.map(a => a.id === asset.id ? updatedAsset : a));
      alert(`Neue Weltkarte "${newMap.name}" mit diesem Asset wurde erfolgreich erstellt!`);
    }
  };

  // Filter Assets
  const filteredAssets = assets.filter(a => {
    // SubTab Filter
    if (subTab !== 'all' && a.category !== subTab) return false;

    // Status Filter
    const assignment = getEffectiveAssignment(a, scenes, maps, [], characters);
    if (statusFilter === 'assigned' && !assignment) return false;
    if (statusFilter === 'unassigned' && assignment) return false;

    // Search query
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      const matchName = a.name.toLowerCase().includes(term);
      const matchTags = a.locationMeta?.tags?.some(t => t.toLowerCase().includes(term));
      const matchArch = a.characterMeta?.archetype?.toLowerCase().includes(term);
      const matchSpecies = a.characterMeta?.species?.toLowerCase().includes(term);
      const matchAlign = a.characterMeta?.alignment?.toLowerCase().includes(term);
      if (!matchName && !matchTags && !matchArch && !matchSpecies && !matchAlign) return false;
    }

    // Character filters
    if (a.category === 'characters') {
      if (alignmentFilter !== 'all' && a.characterMeta?.alignment !== alignmentFilter) return false;
      if (speciesFilter !== 'all' && a.characterMeta?.species !== speciesFilter) return false;
      if (genderFilter !== 'all' && a.characterMeta?.gender !== genderFilter) return false;
      if (archetypeFilter !== 'all') {
        const assetArch = a.characterMeta?.archetype || '';
        const filterVal = archetypeFilter.toLowerCase();
        const assetVal = assetArch.toLowerCase();
        const filterLabel = getArchetypeLabel(archetypeFilter).toLowerCase();
        const assetLabel = getArchetypeLabel(assetArch).toLowerCase();
        if (assetVal !== filterVal && assetLabel !== filterVal && assetLabel !== filterLabel) {
          return false;
        }
      }
    }

    // Scene / Map filters
    if (a.category === 'scene_bg' || a.category === 'maps') {
      if (envFilter !== 'all' && a.locationMeta?.environment !== envFilter) return false;
      if (tagFilter !== 'all' && !a.locationMeta?.tags?.includes(tagFilter)) return false;
    }

    return true;
  });

  return (
    <div className="flex flex-col h-full overflow-hidden bg-gray-950 text-gray-200">
      
      {/* Top Bar Header */}
      <div className="p-4 md:p-6 border-b border-gray-800 bg-gray-900/60 flex flex-col md:flex-row justify-between md:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <ImageIcon className="text-emerald-500" size={24} /> Asset Library
          </h2>
          <p className="text-xs text-gray-400 mt-1">
            Zentrales Medienlager für Szenen-Hintergründe, Charakter-Portraits und Weltkarten.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Upload Button */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleUploadFile}
            accept="image/*,audio/*"
            className="hidden"
          />
          <Button
            variant="secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="text-xs py-2 px-3 flex items-center gap-2 border-gray-700 hover:border-emerald-500"
          >
            {isUploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            <span>Asset hochladen</span>
          </Button>

          {/* AI Generator Button */}
          <Button
            onClick={() => setShowAiModal(true)}
            className="text-xs py-2 px-3 flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium"
          >
            <Sparkles size={14} />
            <span>KI-Asset generieren</span>
          </Button>
        </div>
      </div>

      {/* Sub-Navigation & Filters Section */}
      <div className="p-4 border-b border-gray-800 bg-gray-900/30 space-y-3">
        
        {/* Category Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 bg-gray-950 p-1 rounded-lg border border-gray-800">
            <button
              onClick={() => setSubTab('all')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${subTab === 'all' ? 'bg-emerald-600 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              Alle Assets ({assets.length})
            </button>
            <button
              onClick={() => setSubTab('scene_bg')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 ${subTab === 'scene_bg' ? 'bg-emerald-600 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              <Monitor size={14} /> Scene-Backgrounds ({assets.filter(a => a.category === 'scene_bg').length})
            </button>
            <button
              onClick={() => setSubTab('characters')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 ${subTab === 'characters' ? 'bg-emerald-600 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              <Users size={14} /> Characters ({assets.filter(a => a.category === 'characters').length})
            </button>
            <button
              onClick={() => setSubTab('maps')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 ${subTab === 'maps' ? 'bg-emerald-600 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              <MapIcon size={14} /> Maps ({assets.filter(a => a.category === 'maps').length})
            </button>
          </div>

          {/* Search bar */}
          <div className="relative w-full md:w-72">
            <Search size={16} className="absolute left-3 top-2.5 text-gray-500" />
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Suche in Name, Tags, Archetyp..."
              className="w-full bg-gray-950 border border-gray-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>

        {/* Detailed Filter Dropdowns */}
        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
          <span className="text-gray-400 font-semibold flex items-center gap-1"><Filter size={12}/> Filter:</span>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as any)}
            className="bg-gray-950 border border-gray-800 rounded px-2.5 py-1 text-gray-300 text-xs focus:border-emerald-500 outline-none"
          >
            <option value="all">Status: Alle</option>
            <option value="unassigned">Nicht zugewiesen</option>
            <option value="assigned">Zugewiesen</option>
          </select>

          {/* Character specific filters */}
          {(subTab === 'all' || subTab === 'characters') && (
            <>
              {/* Alignment */}
              <select
                value={alignmentFilter}
                onChange={e => setAlignmentFilter(e.target.value)}
                className="bg-gray-950 border border-gray-800 rounded px-2.5 py-1 text-gray-300 text-xs focus:border-emerald-500 outline-none"
              >
                <option value="all">Gesinnung: Alle</option>
                <option value="gut">Gut</option>
                <option value="neutral">Neutral</option>
                <option value="boese">Böse</option>
              </select>

              {/* Species */}
              <select
                value={speciesFilter}
                onChange={e => setSpeciesFilter(e.target.value)}
                className="bg-gray-950 border border-gray-800 rounded px-2.5 py-1 text-gray-300 text-xs focus:border-emerald-500 outline-none"
              >
                <option value="all">Spezies: Alle</option>
                <option value="mensch">Mensch</option>
                <option value="furry">Furry</option>
                <option value="anthro">Anthro</option>
                <option value="modifiziert">Modifiziert</option>
              </select>

              {/* Gender */}
              <select
                value={genderFilter}
                onChange={e => setGenderFilter(e.target.value)}
                className="bg-gray-950 border border-gray-800 rounded px-2.5 py-1 text-gray-300 text-xs focus:border-emerald-500 outline-none"
              >
                <option value="all">Geschlecht: Alle</option>
                <option value="maennlich">Männlich</option>
                <option value="weiblich">Weiblich</option>
                <option value="diverse">Diverse</option>
              </select>

              {/* Class/Archetype */}
              <select
                value={archetypeFilter}
                onChange={e => setArchetypeFilter(e.target.value)}
                className="bg-gray-950 border border-gray-800 rounded px-2.5 py-1 text-gray-300 text-xs focus:border-emerald-500 outline-none"
              >
                <option value="all">Klasse: Alle</option>
                {allArchetypes.map(archKey => (
                  <option key={archKey} value={archKey}>
                    {getArchetypeLabel(archKey)}
                  </option>
                ))}
              </select>
            </>
          )}

          {/* Location / Map filters */}
          {(subTab === 'all' || subTab === 'scene_bg' || subTab === 'maps') && (
            <>
              {/* Environment */}
              <select
                value={envFilter}
                onChange={e => setEnvFilter(e.target.value)}
                className="bg-gray-950 border border-gray-800 rounded px-2.5 py-1 text-gray-300 text-xs focus:border-emerald-500 outline-none"
              >
                <option value="all">Umgebung: Alle</option>
                <option value="indoor">Indoor</option>
                <option value="outdoor">Outdoor</option>
                <option value="dungeon">Unterirdisch / Dungeon</option>
              </select>

              {/* Tags Filter */}
              {existingTags.length > 0 && (
                <select
                  value={tagFilter}
                  onChange={e => setTagFilter(e.target.value)}
                  className="bg-gray-950 border border-gray-800 rounded px-2.5 py-1 text-gray-300 text-xs focus:border-emerald-500 outline-none"
                >
                  <option value="all">Tag Filter: Alle ({existingTags.length})</option>
                  {existingTags.map(t => (
                    <option key={t} value={t}>#{t}</option>
                  ))}
                </select>
              )}
            </>
          )}
        </div>
      </div>

      {/* Assets Main Grid Display */}
      <div className="flex-1 p-4 md:p-6 overflow-y-auto">
        {filteredAssets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-500 space-y-3">
            <ImageIcon size={48} className="opacity-20 text-emerald-400" />
            <p className="text-sm font-medium">Keine Assets in dieser Ansicht vorhanden.</p>
            <p className="text-xs text-gray-600 text-center max-w-md">
              Lade ein neues Asset hoch oder erstelle ein KI-Asset mit vordefinierten Tags, damit die KI es bei der automatischen Szenenerstellung zuordnen kann.
            </p>
            <Button
              onClick={() => setShowAiModal(true)}
              className="mt-2 text-xs py-2 px-4 bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              <Sparkles size={14} className="mr-1.5" /> Erstes KI-Asset generieren
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filteredAssets.map(asset => (
              <div
                key={asset.id}
                className="bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl overflow-hidden flex flex-col justify-between shadow-lg transition-all group"
              >
                {/* Image Container */}
                <div className="aspect-video w-full bg-gray-950 relative overflow-hidden flex items-center justify-center">
                  {asset.fileUrl ? (
                    <AsyncImage src={asset.fileUrl} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                  ) : (
                    <div className="text-xs text-gray-600 font-mono">Kein Bild</div>
                  )}

                  {/* Category Pill */}
                  <span className="absolute top-2 left-2 px-2 py-0.5 bg-black/80 rounded text-[10px] font-bold text-gray-300 uppercase tracking-wide border border-gray-800">
                    {asset.category === 'scene_bg' ? 'Scene BG' : asset.category === 'characters' ? 'Charakter' : 'Karte'}
                  </span>

                  {/* Assignment Status Pill */}
                  <div className="absolute top-2 right-2">
                    {(() => {
                      const assignment = getEffectiveAssignment(asset, scenes, maps, [], characters);
                      return assignment ? (
                        <span
                          className="px-2 py-0.5 bg-emerald-950/90 text-emerald-400 border border-emerald-500/40 rounded text-[10px] font-bold"
                          title={`Zugewiesen an: ${assignment.targetName}`}
                        >
                          Zugewiesen
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-gray-900/90 text-gray-400 border border-gray-700 rounded text-[10px] font-medium">
                          Unbenutzt
                        </span>
                      );
                    })()}
                  </div>
                </div>

                {/* Body Content */}
                <div className="p-3 flex-1 flex flex-col justify-between space-y-2">
                  <div>
                    <h4 className="font-bold text-sm text-white truncate" title={asset.name}>
                      {asset.name}
                    </h4>

                    {/* Metadata Badges */}
                    {asset.category === 'characters' && asset.characterMeta && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {asset.characterMeta.alignment && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-purple-950/80 border border-purple-800/50 text-purple-300 rounded font-medium">
                            {asset.characterMeta.alignment}
                          </span>
                        )}
                        {asset.characterMeta.species && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-indigo-950/80 border border-indigo-800/50 text-indigo-300 rounded font-medium">
                            {asset.characterMeta.species}
                          </span>
                        )}
                        {asset.characterMeta.archetype && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-blue-950/80 border border-blue-800/50 text-blue-300 rounded font-medium">
                            {getArchetypeLabel(asset.characterMeta.archetype)}
                          </span>
                        )}
                      </div>
                    )}

                    {asset.locationMeta && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {asset.locationMeta.environment && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-amber-950/80 border border-amber-800/50 text-amber-300 rounded font-medium">
                            {asset.locationMeta.environment}
                          </span>
                        )}
                        {asset.locationMeta.tags?.map(t => (
                          <span key={t} className="text-[10px] px-1.5 py-0.5 bg-gray-800 border border-gray-700 text-gray-300 rounded flex items-center gap-1">
                            <Tag size={9} /> {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Quick Action buttons */}
                  <div className="pt-2 border-t border-gray-800/60 space-y-2">
                    
                    {/* Create Entity 1-Click Action */}
                    <div className="flex items-center gap-1 text-[11px]">
                      {asset.category === 'characters' && (
                        <button
                          onClick={() => handleCreateEntityFromAsset(asset, 'character')}
                          className="w-full py-1 px-2 bg-emerald-900/30 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-500/30 rounded flex items-center justify-center gap-1 transition-colors"
                        >
                          <UserPlus size={12} /> Als Charakter anlegen
                        </button>
                      )}
                      {asset.category === 'scene_bg' && (
                        <button
                          onClick={() => handleCreateEntityFromAsset(asset, 'scene')}
                          className="w-full py-1 px-2 bg-emerald-900/30 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-500/30 rounded flex items-center justify-center gap-1 transition-colors"
                        >
                          <Monitor size={12} /> Als Szene anlegen
                        </button>
                      )}
                      {asset.category === 'maps' && (
                        <button
                          onClick={() => handleCreateEntityFromAsset(asset, 'map')}
                          className="w-full py-1 px-2 bg-emerald-900/30 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-500/30 rounded flex items-center justify-center gap-1 transition-colors"
                        >
                          <MapIcon size={12} /> Als Weltkarte anlegen
                        </button>
                      )}
                    </div>

                    {/* Edit / Delete actions */}
                    <div className="flex items-center justify-between text-xs pt-1">
                      <button
                        onClick={() => setEditingAsset({ ...asset })}
                        className="text-gray-400 hover:text-white flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-800 transition-colors"
                      >
                        <Edit3 size={13} /> Bearbeiten
                      </button>

                      <button
                        onClick={() => setAssetToDelete(asset)}
                        className="text-red-400 hover:text-red-300 flex items-center gap-1 px-2 py-1 rounded hover:bg-red-950/40 transition-colors"
                        title="Asset löschen"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>

                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* EDIT ASSET MODAL */}
      {editingAsset && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-800 pb-3">
              <h3 className="font-bold text-white text-lg flex items-center gap-2">
                <Edit3 className="text-emerald-500" size={18} /> Asset bearbeiten
              </h3>
              <button onClick={() => setEditingAsset(null)} className="text-gray-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-gray-400 uppercase font-bold text-[10px] block mb-1">Asset Name</label>
                <input
                  type="text"
                  value={editingAsset.name}
                  onChange={e => setEditingAsset({ ...editingAsset, name: e.target.value })}
                  className="w-full bg-gray-950 border border-gray-700 rounded p-2 text-white outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="text-gray-400 uppercase font-bold text-[10px] block mb-1">Kategorie</label>
                <select
                  value={editingAsset.category}
                  onChange={e => setEditingAsset({ ...editingAsset, category: e.target.value as AssetCategory })}
                  className="w-full bg-gray-950 border border-gray-700 rounded p-2 text-white outline-none focus:border-emerald-500"
                >
                  <option value="scene_bg">Scene-Background</option>
                  <option value="characters">Charakter</option>
                  <option value="maps">Weltkarte</option>
                </select>
              </div>

              {/* Character Details */}
              {editingAsset.category === 'characters' && (
                <div className="grid grid-cols-2 gap-3 p-3 bg-gray-950 border border-gray-800 rounded-lg">
                  <div>
                    <label className="text-gray-400 uppercase font-bold text-[10px] block mb-1">Gesinnung</label>
                    <select
                      value={editingAsset.characterMeta?.alignment || 'neutral'}
                      onChange={e => setEditingAsset({
                        ...editingAsset,
                        characterMeta: { ...editingAsset.characterMeta, alignment: e.target.value }
                      })}
                      className="w-full bg-gray-900 border border-gray-700 rounded p-1.5 text-white"
                    >
                      <option value="gut">Gut</option>
                      <option value="neutral">Neutral</option>
                      <option value="boese">Böse</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-gray-400 uppercase font-bold text-[10px] block mb-1">Spezies</label>
                    <select
                      value={editingAsset.characterMeta?.species || 'mensch'}
                      onChange={e => setEditingAsset({
                        ...editingAsset,
                        characterMeta: { ...editingAsset.characterMeta, species: e.target.value }
                      })}
                      className="w-full bg-gray-900 border border-gray-700 rounded p-1.5 text-white"
                    >
                      <option value="mensch">Mensch</option>
                      <option value="furry">Furry</option>
                      <option value="anthro">Anthro</option>
                      <option value="modifiziert">Modifiziert</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-gray-400 uppercase font-bold text-[10px] block mb-1">Geschlecht</label>
                    <select
                      value={editingAsset.characterMeta?.gender || 'weiblich'}
                      onChange={e => setEditingAsset({
                        ...editingAsset,
                        characterMeta: { ...editingAsset.characterMeta, gender: e.target.value }
                      })}
                      className="w-full bg-gray-900 border border-gray-700 rounded p-1.5 text-white"
                    >
                      <option value="maennlich">Männlich</option>
                      <option value="weiblich">Weiblich</option>
                      <option value="diverse">Diverse</option>
                    </select>
                  </div>

                  <ArchetypeSelector
                    value={editingAsset.characterMeta?.archetype || 'buerger'}
                    onChange={newArch => setEditingAsset({
                      ...editingAsset,
                      characterMeta: { ...editingAsset.characterMeta, archetype: newArch }
                    })}
                    allAvailableArchetypes={allArchetypes}
                    label="Klasse / Archetyp"
                  />
                </div>
              )}

              {/* Location Details */}
              {editingAsset.category !== 'characters' && (
                <div className="space-y-3 p-3 bg-gray-950 border border-gray-800 rounded-lg">
                  <div>
                    <label className="text-gray-400 uppercase font-bold text-[10px] block mb-1">Umgebung</label>
                    <select
                      value={editingAsset.locationMeta?.environment || 'indoor'}
                      onChange={e => setEditingAsset({
                        ...editingAsset,
                        locationMeta: { ...editingAsset.locationMeta, environment: e.target.value, tags: editingAsset.locationMeta?.tags || [] }
                      })}
                      className="w-full bg-gray-900 border border-gray-700 rounded p-1.5 text-white"
                    >
                      <option value="indoor">Indoor (Innenraum)</option>
                      <option value="outdoor">Outdoor (Aussenbereich)</option>
                      <option value="dungeon">Unterirdisch / Dungeon</option>
                    </select>
                  </div>

                  <div>
                    <TagSelector
                      tags={editingAsset.locationMeta?.tags || []}
                      onChange={newTags => setEditingAsset({
                        ...editingAsset,
                        locationMeta: {
                          ...editingAsset.locationMeta,
                          tags: newTags
                        }
                      })}
                      allAvailableTags={existingTags}
                      label="Tags bearbeiten"
                      placeholder="Tag suchen oder neu eintippen..."
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-gray-800">
              <button
                onClick={() => setEditingAsset(null)}
                className="px-4 py-2 bg-gray-800 text-gray-300 rounded text-xs hover:bg-gray-700"
              >
                Abbrechen
              </button>
              <button
                onClick={handleSaveEditAsset}
                className="px-4 py-2 bg-emerald-600 text-white rounded text-xs font-semibold hover:bg-emerald-500"
              >
                Speichern
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GENERATE AI ASSET MODAL */}
      {showAiModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-gray-900 border border-gray-700 rounded-xl max-w-xl w-full p-6 space-y-4 shadow-2xl my-8">
            <div className="flex items-center justify-between border-b border-gray-800 pb-3">
              <h3 className="font-bold text-white text-lg flex items-center gap-2">
                <Sparkles className="text-emerald-400" size={20} /> KI-Asset generieren & katalogisieren
              </h3>
              <button onClick={() => setShowAiModal(false)} className="text-gray-400 hover:text-white">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-gray-400 uppercase font-bold text-[10px] block mb-1">Name des Assets</label>
                <input
                  type="text"
                  placeholder="z.B. Rustikaler Schankraum bei Nacht"
                  value={aiName}
                  onChange={e => setAiName(e.target.value)}
                  className="w-full bg-gray-950 border border-gray-700 rounded p-2 text-white outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="text-gray-400 uppercase font-bold text-[10px] block mb-1">Kategorie</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setAiCategory('scene_bg')}
                    className={`py-2 px-3 rounded text-center border font-semibold ${aiCategory === 'scene_bg' ? 'bg-emerald-900/50 border-emerald-500 text-emerald-300' : 'bg-gray-950 border-gray-800 text-gray-400'}`}
                  >
                    Scene BG
                  </button>
                  <button
                    type="button"
                    onClick={() => setAiCategory('characters')}
                    className={`py-2 px-3 rounded text-center border font-semibold ${aiCategory === 'characters' ? 'bg-emerald-900/50 border-emerald-500 text-emerald-300' : 'bg-gray-950 border-gray-800 text-gray-400'}`}
                  >
                    Charakter
                  </button>
                  <button
                    type="button"
                    onClick={() => setAiCategory('maps')}
                    className={`py-2 px-3 rounded text-center border font-semibold ${aiCategory === 'maps' ? 'bg-emerald-900/50 border-emerald-500 text-emerald-300' : 'bg-gray-950 border-gray-800 text-gray-400'}`}
                  >
                    Weltkarte
                  </button>
                </div>
              </div>

              {/* KI Prompt */}
              <div>
                <label className="text-gray-400 uppercase font-bold text-[10px] block mb-1">KI Prompt (ComfyUI / Stable Diffusion)</label>
                <textarea
                  rows={3}
                  placeholder={aiCategory === 'characters' ? '1girl, solo, noble dress, tavern interior, looking at viewer...' : 'rustic tavern interior, wooden tables, warm lighting, anime visual novel background...'}
                  value={aiPrompt}
                  onChange={e => setAiPrompt(e.target.value)}
                  className="w-full bg-gray-950 border border-gray-700 rounded p-2 text-white outline-none focus:border-emerald-500 font-mono text-xs"
                />
              </div>

              {/* Categorization options */}
              {aiCategory === 'characters' ? (
                <div className="grid grid-cols-2 gap-3 p-3 bg-gray-950 border border-gray-800 rounded-lg">
                  <div>
                    <label className="text-gray-400 uppercase font-bold text-[10px] block mb-1">Gesinnung</label>
                    <select
                      value={aiAlignment}
                      onChange={e => setAiAlignment(e.target.value as any)}
                      className="w-full bg-gray-900 border border-gray-700 rounded p-1.5 text-white"
                    >
                      <option value="gut">Gut</option>
                      <option value="neutral">Neutral</option>
                      <option value="boese">Böse</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-gray-400 uppercase font-bold text-[10px] block mb-1">Spezies</label>
                    <select
                      value={aiSpecies}
                      onChange={e => setAiSpecies(e.target.value as any)}
                      className="w-full bg-gray-900 border border-gray-700 rounded p-1.5 text-white"
                    >
                      <option value="mensch">Mensch</option>
                      <option value="furry">Furry</option>
                      <option value="anthro">Anthro</option>
                      <option value="modifiziert">Modifiziert</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-gray-400 uppercase font-bold text-[10px] block mb-1">Geschlecht</label>
                    <select
                      value={aiGender}
                      onChange={e => setAiGender(e.target.value as any)}
                      className="w-full bg-gray-900 border border-gray-700 rounded p-1.5 text-white"
                    >
                      <option value="maennlich">Männlich</option>
                      <option value="weiblich">Weiblich</option>
                      <option value="diverse">Diverse</option>
                    </select>
                  </div>

                  <ArchetypeSelector
                    value={aiArchetype}
                    onChange={setAiArchetype}
                    allAvailableArchetypes={allArchetypes}
                    label="Klasse / Archetyp"
                  />
                </div>
              ) : (
                <div className="space-y-3 p-3 bg-gray-950 border border-gray-800 rounded-lg">
                  <div>
                    <label className="text-gray-400 uppercase font-bold text-[10px] block mb-1">Umgebung</label>
                    <select
                      value={aiEnv}
                      onChange={e => setAiEnv(e.target.value as any)}
                      className="w-full bg-gray-900 border border-gray-700 rounded p-1.5 text-white"
                    >
                      <option value="indoor">Indoor (Innenraum)</option>
                      <option value="outdoor">Outdoor (Aussenbereich)</option>
                      <option value="dungeon">Unterirdisch / Dungeon</option>
                    </select>
                  </div>

                  {/* Tags Selection */}
                  <div>
                    <TagSelector
                      tags={aiTags}
                      onChange={setAiTags}
                      allAvailableTags={existingTags}
                      label="Tags für KI-Asset"
                      placeholder="Tag suchen oder tippen..."
                    />
                  </div>
                </div>
              )}

              {/* Status and Errors */}
              {aiStatus && (
                <div className="text-emerald-400 text-xs flex items-center gap-2 p-2 bg-emerald-950/40 border border-emerald-800 rounded">
                  <Loader2 size={14} className="animate-spin" />
                  <span>{aiStatus}</span>
                </div>
              )}

              {aiError && (
                <div className="text-red-400 text-xs p-2 bg-red-950/40 border border-red-800 rounded">
                  {aiError}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-gray-800">
              <button
                type="button"
                onClick={() => setShowAiModal(false)}
                disabled={isAiGenerating}
                className="px-4 py-2 bg-gray-800 text-gray-300 rounded text-xs hover:bg-gray-700"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={handleGenerateAiAsset}
                disabled={isAiGenerating || !aiPrompt.trim()}
                className="px-4 py-2 bg-emerald-600 text-white rounded text-xs font-semibold hover:bg-emerald-500 disabled:opacity-50 flex items-center gap-1.5"
              >
                {isAiGenerating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                Generieren & Speichern
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE ASSET CONFIRMATION MODAL */}
      {assetToDelete && (
        <div className="fixed inset-0 z-[600] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3 text-red-400 font-bold text-lg border-b border-gray-800 pb-3">
              <Trash2 size={22} />
              <span>Asset löschen?</span>
            </div>

            <p className="text-sm text-gray-300">
              Möchtest du das Asset <strong className="text-white">"{assetToDelete.name}"</strong> wirklich unwiderruflich aus der Bibliothek löschen?
            </p>

            {assetToDelete.assignedTo && (
              <div className="p-3 bg-amber-950/40 border border-amber-800/60 rounded-lg text-xs text-amber-300">
                ⚠️ <strong>Hinweis:</strong> Dieses Asset ist derzeit zugewiesen an: <strong>{assetToDelete.assignedTo.targetName}</strong>.
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-800">
              <button
                type="button"
                onClick={() => setAssetToDelete(null)}
                className="px-4 py-2 bg-gray-800 text-gray-300 rounded text-xs hover:bg-gray-700 transition-colors"
              >
                Abbrechen
              </button>

              <button
                type="button"
                onClick={confirmDeleteAsset}
                className="px-4 py-2 bg-red-600 text-white rounded text-xs font-semibold hover:bg-red-500 transition-colors flex items-center gap-1.5"
              >
                <Trash2 size={14} />
                <span>Ja, Asset löschen</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
