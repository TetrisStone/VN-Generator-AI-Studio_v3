import React, { useState } from 'react';
import { AssetItem, AssetCategory } from '../types';
import { AsyncImage } from './ui/AsyncImage';
import { Search, X, Check, Filter, Tag, Image as ImageIcon } from 'lucide-react';
import { PRESET_ARCHETYPES, getArchetypeLabel } from '../utils/assetUtils';

interface AssetSelectorModalProps {
  assets: AssetItem[];
  categoryFilter?: AssetCategory; // e.g. 'scene_bg' or 'characters' or 'maps'
  onSelect: (asset: AssetItem) => void;
  onClose: () => void;
  title?: string;
}

export const AssetSelectorModal: React.FC<AssetSelectorModalProps> = ({
  assets,
  categoryFilter,
  onSelect,
  onClose,
  title = "Asset aus der Bibliothek wählen"
}) => {
  const [activeCategory, setActiveCategory] = useState<AssetCategory | 'all'>(categoryFilter || 'all');
  const [searchTerm, setSearchTerm] = useState('');
  const [envFilter, setEnvFilter] = useState<string>('all');
  const [alignmentFilter, setAlignmentFilter] = useState<string>('all');
  const [archetypeFilter, setArchetypeFilter] = useState<string>('all');
  const [selectedTag, setSelectedTag] = useState<string>('all');

  // Collect all unique tags for location assets
  const allTags = Array.from(new Set(
    assets
      .flatMap(a => a.locationMeta?.tags || [])
      .filter(Boolean)
  ));

  // Collect unique archetypes
  const allArchetypes = Array.from(new Set([
    ...PRESET_ARCHETYPES.map(p => p.id),
    ...assets
      .map(a => a.characterMeta?.archetype)
      .filter((arch): arch is string => Boolean(arch && arch.trim()))
  ]));

  const filteredAssets = assets.filter(a => {
    // Category check
    if (activeCategory !== 'all' && a.category !== activeCategory) return false;

    // Search term check
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      const matchName = a.name.toLowerCase().includes(term);
      const matchTags = a.locationMeta?.tags?.some(t => t.toLowerCase().includes(term));
      const matchArch = a.characterMeta?.archetype?.toLowerCase().includes(term);
      const matchSpecies = a.characterMeta?.species?.toLowerCase().includes(term);
      if (!matchName && !matchTags && !matchArch && !matchSpecies) return false;
    }

    // Environment filter
    if (envFilter !== 'all' && a.locationMeta?.environment !== envFilter) return false;

    // Alignment filter
    if (alignmentFilter !== 'all' && a.characterMeta?.alignment !== alignmentFilter) return false;

    // Archetype filter
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

    // Tag filter
    if (selectedTag !== 'all' && !a.locationMeta?.tags?.includes(selectedTag)) return false;

    return true;
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="p-4 border-b border-gray-800 flex items-center justify-between bg-gray-950">
          <div className="flex items-center gap-2 text-emerald-400 font-bold text-lg">
            <ImageIcon size={20} />
            <span>{title}</span>
          </div>
          <button 
            onClick={onClose} 
            className="p-1 text-gray-400 hover:text-white rounded-lg hover:bg-gray-800"
          >
            <X size={20} />
          </button>
        </div>

        {/* Filter Controls */}
        <div className="p-4 border-b border-gray-800 bg-gray-900/80 space-y-3">
          
          {/* Sub-Category Tabs & Search */}
          <div className="flex flex-col sm:flex-row items-center gap-3 justify-between">
            <div className="flex items-center gap-1 bg-gray-950 p-1 rounded-lg border border-gray-800 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => setActiveCategory('all')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${activeCategory === 'all' ? 'bg-emerald-600 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                Alle
              </button>
              <button
                type="button"
                onClick={() => setActiveCategory('scene_bg')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${activeCategory === 'scene_bg' ? 'bg-emerald-600 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                Szenen (BGs)
              </button>
              <button
                type="button"
                onClick={() => setActiveCategory('characters')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${activeCategory === 'characters' ? 'bg-emerald-600 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                Charaktere
              </button>
              <button
                type="button"
                onClick={() => setActiveCategory('maps')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${activeCategory === 'maps' ? 'bg-emerald-600 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                Karten
              </button>
            </div>

            <div className="relative w-full sm:w-64">
              <Search size={16} className="absolute left-3 top-2.5 text-gray-500" />
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Suchbegriff oder Tag..."
                className="w-full bg-gray-950 border border-gray-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Quick Filters */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-gray-400 font-semibold flex items-center gap-1"><Filter size={12}/> Filter:</span>
            
            {/* Environment Filter */}
            <select
              value={envFilter}
              onChange={e => setEnvFilter(e.target.value)}
              className="bg-gray-950 border border-gray-800 rounded px-2 py-1 text-gray-300 text-xs focus:border-emerald-500 outline-none"
            >
              <option value="all">Umgebung: Alle</option>
              <option value="indoor">Indoor</option>
              <option value="outdoor">Outdoor</option>
              <option value="dungeon">Dungeon</option>
            </select>

            {/* Alignment Filter */}
            <select
              value={alignmentFilter}
              onChange={e => setAlignmentFilter(e.target.value)}
              className="bg-gray-950 border border-gray-800 rounded px-2 py-1 text-gray-300 text-xs focus:border-emerald-500 outline-none"
            >
              <option value="all">Gesinnung: Alle</option>
              <option value="gut">Gut</option>
              <option value="neutral">Neutral</option>
              <option value="boese">Böse</option>
            </select>

            {/* Class/Archetype Filter */}
            <select
              value={archetypeFilter}
              onChange={e => setArchetypeFilter(e.target.value)}
              className="bg-gray-950 border border-gray-800 rounded px-2 py-1 text-gray-300 text-xs focus:border-emerald-500 outline-none"
            >
              <option value="all">Klasse: Alle</option>
              {allArchetypes.map(archKey => (
                <option key={archKey} value={archKey}>
                  {getArchetypeLabel(archKey)}
                </option>
              ))}
            </select>

            {/* Tag Filter */}
            {allTags.length > 0 && (
              <select
                value={selectedTag}
                onChange={e => setSelectedTag(e.target.value)}
                className="bg-gray-950 border border-gray-800 rounded px-2 py-1 text-gray-300 text-xs focus:border-emerald-500 outline-none"
              >
                <option value="all">Tag: Alle ({allTags.length})</option>
                {allTags.map(t => (
                  <option key={t} value={t}>#{t}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Assets Grid Area */}
        <div className="flex-1 p-4 overflow-y-auto min-h-[300px]">
          {filteredAssets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 space-y-2 py-12">
              <ImageIcon size={40} className="opacity-30" />
              <p className="text-sm">Keine passenden Assets in der Bibliothek gefunden.</p>
              <p className="text-xs text-gray-600">Lade ein neues Asset hoch oder passe die Filter an.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {filteredAssets.map(asset => (
                <div
                  key={asset.id}
                  onClick={() => {
                    onSelect(asset);
                    onClose();
                  }}
                  className="group relative bg-gray-950 border border-gray-800 hover:border-emerald-500 rounded-lg overflow-hidden cursor-pointer transition-all hover:shadow-lg flex flex-col"
                >
                  <div className="aspect-video w-full bg-gray-900 relative overflow-hidden flex items-center justify-center">
                    {asset.fileUrl ? (
                      <AsyncImage src={asset.fileUrl} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                    ) : (
                      <div className="text-xs text-gray-600 font-mono">No Image</div>
                    )}

                    {/* Hover Overlay */}
                    <div className="absolute inset-0 bg-emerald-950/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-emerald-300 font-bold text-xs gap-1">
                      <Check size={16} /> Wählen
                    </div>

                    {/* Category Badge */}
                    <span className="absolute top-1 left-1 px-1.5 py-0.5 bg-black/70 rounded text-[9px] font-semibold text-gray-300 uppercase">
                      {asset.category === 'scene_bg' ? 'Szene' : asset.category === 'characters' ? 'Charakter' : 'Karte'}
                    </span>
                  </div>

                  <div className="p-2 flex-1 flex flex-col justify-between">
                    <div>
                      <div className="font-semibold text-xs text-white group-hover:text-emerald-400 truncate">
                        {asset.name}
                      </div>

                      {/* Character Metadata badges */}
                      {asset.category === 'characters' && asset.characterMeta && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {asset.characterMeta.alignment && (
                            <span className="text-[9px] px-1 bg-purple-900/60 text-purple-200 rounded">
                              {asset.characterMeta.alignment}
                            </span>
                          )}
                          {asset.characterMeta.archetype && (
                            <span className="text-[9px] px-1 bg-blue-900/60 text-blue-200 rounded">
                              {getArchetypeLabel(asset.characterMeta.archetype)}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Location Metadata badges */}
                      {asset.locationMeta && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {asset.locationMeta.environment && (
                            <span className="text-[9px] px-1 bg-amber-900/60 text-amber-200 rounded">
                              {asset.locationMeta.environment}
                            </span>
                          )}
                          {asset.locationMeta.tags?.slice(0, 2).map(t => (
                            <span key={t} className="text-[9px] px-1 bg-gray-800 text-gray-300 rounded flex items-center gap-0.5">
                              <Tag size={8} /> {t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Assignment status */}
                    <div className="mt-2 pt-1 border-t border-gray-900 text-[9px] text-gray-500 truncate">
                      {asset.assignedTo ? (
                        <span className="text-emerald-400 font-medium">✓ Zugewiesen</span>
                      ) : (
                        <span className="text-gray-500">Unbenutzt</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-gray-800 bg-gray-950 flex justify-between items-center text-xs text-gray-400">
          <span>{filteredAssets.length} von {assets.length} Assets</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors"
          >
            Abbrechen
          </button>
        </div>

      </div>
    </div>
  );
};
