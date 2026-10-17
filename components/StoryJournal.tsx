
import React, { useState } from 'react';
import { StoryLogEntry } from '../types';
import { Button } from './ui/Button';
import { Book, X, Edit2, Check, MapPin, Users, Tag } from 'lucide-react';

interface StoryJournalProps {
    entries: StoryLogEntry[];
    onClose: () => void;
    onUpdateEntry: (id: string, newSummary: string) => void;
}

export const StoryJournal: React.FC<StoryJournalProps> = ({ entries, onClose, onUpdateEntry }) => {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editText, setEditText] = useState('');

    const startEditing = (entry: StoryLogEntry) => {
        setEditingId(entry.id);
        setEditText(entry.summary);
    };

    const saveEdit = (id: string) => {
        onUpdateEntry(id, editText);
        setEditingId(null);
    };

    const renderImportanceBadge = (importance?: 'critical' | 'major' | 'minor') => {
        const imp = importance || 'major';
        if (imp === 'critical') {
            return (
                <span className="bg-amber-950/80 text-amber-300 border border-amber-600/70 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full shadow-sm">
                    Critical
                </span>
            );
        }
        if (imp === 'minor') {
            return (
                <span className="bg-gray-800 text-gray-400 border border-gray-700 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full">
                    Minor
                </span>
            );
        }
        return (
            <span className="bg-emerald-950/80 text-emerald-300 border border-emerald-600/70 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full shadow-sm">
                Major
            </span>
        );
    };

    const getDotStyle = (importance?: 'critical' | 'major' | 'minor') => {
        const imp = importance || 'major';
        if (imp === 'critical') return "border-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]";
        if (imp === 'minor') return "border-gray-500 shadow-none";
        return "border-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]";
    };

    return (
        <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-gray-900 border border-gray-700 w-full max-w-3xl h-[80vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                
                {/* Header */}
                <div className="bg-gray-800 p-4 flex justify-between items-center border-b border-gray-700">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-emerald-600 rounded-lg text-white">
                            <Book size={20} />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-white">Story Journal</h2>
                            <p className="text-xs text-gray-400">Chronicles of your journey</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-white p-2 rounded-full hover:bg-gray-700 transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar bg-gray-900/50">
                    {entries.length === 0 ? (
                        <div className="text-center text-gray-500 italic mt-20">
                            No entries yet. Complete a scene to add to your story.
                        </div>
                    ) : (
                        entries.map((entry) => {
                            const tags = entry.tags || [];
                            return (
                                <div key={entry.id} className="relative pl-8 border-l-2 border-emerald-500/30 last:border-0 pb-8 last:pb-0">
                                    {/* Timeline Dot */}
                                    <div className={`absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-gray-900 border-2 ${getDotStyle(entry.importance)}`}></div>
                                    
                                    <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 hover:border-gray-600 transition-colors">
                                        <div className="flex justify-between items-start mb-2 gap-2">
                                            <div>
                                                <div className="flex items-center gap-2 flex-wrap mb-1">
                                                    <h3 className="font-bold text-lg text-emerald-300">{entry.sceneName}</h3>
                                                    {renderImportanceBadge(entry.importance)}
                                                </div>
                                                <div className="flex items-center gap-4 text-xs text-gray-400 mt-1">
                                                    <span className="flex items-center gap-1"><MapPin size={12}/> {entry.locationName}</span>
                                                    <span className="flex items-center gap-1"><Users size={12}/> {entry.charactersInvolved.join(', ')}</span>
                                                </div>
                                            </div>
                                            {editingId !== entry.id && (
                                                <button onClick={() => startEditing(entry)} className="text-gray-500 hover:text-emerald-400 p-1 transition-colors" title="Edit Summary">
                                                    <Edit2 size={14} />
                                                </button>
                                            )}
                                        </div>

                                        {editingId === entry.id ? (
                                            <div className="mt-3">
                                                <textarea 
                                                    className="w-full bg-black/30 border border-gray-600 rounded-lg p-3 text-sm text-gray-200 focus:border-emerald-500 outline-none min-h-[100px]"
                                                    value={editText}
                                                    onChange={(e) => setEditText(e.target.value)}
                                                />
                                                <div className="flex justify-end gap-2 mt-2">
                                                    <Button variant="secondary" onClick={() => setEditingId(null)} className="text-xs py-1">Cancel</Button>
                                                    <Button onClick={() => saveEdit(entry.id)} className="text-xs py-1"><Check size={14}/> Save</Button>
                                                </div>
                                            </div>
                                        ) : (
                                            <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap font-serif text-gray-200/90 mt-2">
                                                {entry.summary}
                                            </p>
                                        )}

                                        {/* Tags display */}
                                        {tags.length > 0 && (
                                            <div className="flex flex-wrap gap-1.5 mt-3 pt-2.5 border-t border-gray-700/50">
                                                {tags.map((tag, tIdx) => (
                                                    <span key={tIdx} className="text-[10px] bg-gray-900/80 text-gray-300 px-2 py-0.5 rounded border border-gray-700/80 flex items-center gap-1">
                                                        <Tag size={10} className="text-gray-400" />
                                                        {tag}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

            </div>
        </div>
    );
};
