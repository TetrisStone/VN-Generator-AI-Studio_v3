import React, { useState, useMemo } from 'react';
import { Tag, Plus, X, Check } from 'lucide-react';

interface TagSelectorProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  allAvailableTags: string[];
  label?: string;
  placeholder?: string;
}

const normalize = (str: string) =>
  str
    .toLowerCase()
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ß/g, 'ss');

export const TagSelector: React.FC<TagSelectorProps> = ({
  tags = [],
  onChange,
  allAvailableTags = [],
  label = "Tags",
  placeholder = "Tag suchen oder tippen..."
}) => {
  const [inputValue, setInputValue] = useState('');

  // Collect unique available tags sorted alphabetically
  const sortedUniqueAvailable = useMemo(() => {
    const combined = Array.from(new Set([...allAvailableTags, ...tags])).filter(Boolean);
    return combined.sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' }));
  }, [allAvailableTags, tags]);

  // Filter suggestions based on typed search query (with German umlaut normalization)
  const filteredSuggestions = useMemo(() => {
    const query = inputValue.trim();
    if (!query) return sortedUniqueAvailable;
    const normQuery = normalize(query);
    return sortedUniqueAvailable.filter(tag =>
      normalize(tag).includes(normQuery) || tag.toLowerCase().includes(query.toLowerCase())
    );
  }, [sortedUniqueAvailable, inputValue]);

  const handleAddTag = (tagToAdd: string) => {
    const clean = tagToAdd.trim();
    if (!clean) return;
    if (!tags.includes(clean)) {
      onChange([...tags, clean]);
    }
    setInputValue('');
  };

  const handleRemoveTag = (tagToRemove: string) => {
    onChange(tags.filter(t => t !== tagToRemove));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      handleAddTag(inputValue);
    }
  };

  return (
    <div className="space-y-2">
      {label && (
        <label className="text-gray-400 uppercase font-bold text-[10px] block mb-1">
          {label}
        </label>
      )}

      {/* Selected Tags Pills */}
      <div className="flex flex-wrap gap-1.5 p-2 bg-gray-900 border border-gray-800 rounded-lg min-h-[38px] items-center">
        {tags.length === 0 ? (
          <span className="text-gray-500 text-xs italic">Keine Tags ausgewählt</span>
        ) : (
          tags.map(tag => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-emerald-950 border border-emerald-600/70 text-emerald-300 rounded-full text-xs font-medium"
            >
              <Tag size={11} className="text-emerald-400" />
              <span>{tag}</span>
              <button
                type="button"
                onClick={() => handleRemoveTag(tag)}
                className="hover:text-red-400 text-emerald-400/80 hover:bg-emerald-900/60 rounded-full p-0.5 transition-colors ml-0.5"
                title="Tag entfernen"
              >
                <X size={12} />
              </button>
            </span>
          ))
        )}
      </div>

      {/* Input Field & Add Button */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg py-1.5 px-3 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500"
          />
          {inputValue && (
            <button
              type="button"
              onClick={() => setInputValue('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white p-0.5"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {inputValue.trim() && !tags.includes(inputValue.trim()) && (
          <button
            type="button"
            onClick={() => handleAddTag(inputValue)}
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors whitespace-nowrap shadow"
          >
            <Plus size={13} /> Hinzufügen
          </button>
        )}
      </div>

      {/* Available Tags list */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10px] text-gray-400 font-medium">
          <span>
            {inputValue.trim()
              ? `Gefilterte Tags für "${inputValue.trim()}":`
              : 'Verfügbare Tags (Klicken zum Hinzufügen / Entfernen):'}
          </span>
          <span className="text-gray-500">{filteredSuggestions.length} Tags</span>
        </div>

        <div className="max-h-36 overflow-y-auto p-2 bg-gray-950 border border-gray-800 rounded-lg flex flex-wrap gap-1.5 scrollbar-thin">
          {filteredSuggestions.length === 0 ? (
            <div className="text-gray-500 text-xs italic py-1 px-1">
              Kein bekannter Tag passt zu "{inputValue}". Drücke <kbd className="px-1 py-0.5 bg-gray-800 border border-gray-700 rounded text-[10px]">Enter</kbd>, um diesen Tag neu anzulegen.
            </div>
          ) : (
            filteredSuggestions.map(tag => {
              const isSelected = tags.includes(tag);
              return (
                <button
                  type="button"
                  key={tag}
                  onClick={() => {
                    if (isSelected) {
                      handleRemoveTag(tag);
                    } else {
                      handleAddTag(tag);
                    }
                  }}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1 border ${
                    isSelected
                      ? 'bg-emerald-600 border-emerald-500 text-white shadow-sm'
                      : 'bg-gray-900 border-gray-700/80 text-gray-300 hover:bg-gray-800 hover:border-gray-600 hover:text-white'
                  }`}
                >
                  {isSelected ? <Check size={12} /> : <Plus size={12} className="text-gray-400" />}
                  <span>{tag}</span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default TagSelector;
