import React, { useState, useEffect } from 'react';
import { Volume2, VolumeX, Settings, X } from 'lucide-react';
import { audioManager } from '../utils/audioManager';

export const SettingsOverlay: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [bgmVol, setBgmVol] = useState(audioManager.bgmVolume);
    const [sfxVol, setSfxVol] = useState(audioManager.sfxVolume);

    const handleBgmChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseFloat(e.target.value);
        setBgmVol(val);
        audioManager.setBgmVolume(val);
    };

    const handleSfxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseFloat(e.target.value);
        setSfxVol(val);
        audioManager.setSfxVolume(val);
    };

    return (
        <div className="fixed bottom-4 right-4 z-[300]">
            {isOpen ? (
                <div className="bg-gray-900 border border-gray-700 shadow-2xl rounded-lg p-4 w-64">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="font-bold text-gray-200">Audio Settings</h3>
                        <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-white">
                            <X size={18} />
                        </button>
                    </div>
                    <div className="space-y-4">
                        <div>
                            <label className="text-xs text-gray-400 font-bold mb-1 block uppercase">Music Volume</label>
                            <input 
                                type="range" 
                                min="0" max="1" step="0.01" 
                                value={bgmVol} 
                                onChange={handleBgmChange} 
                                className="w-full"
                            />
                        </div>
                        <div>
                            <label className="text-xs text-gray-400 font-bold mb-1 block uppercase">SFX Volume</label>
                            <input 
                                type="range" 
                                min="0" max="1" step="0.01" 
                                value={sfxVol} 
                                onChange={handleSfxChange} 
                                className="w-full"
                            />
                        </div>
                    </div>
                </div>
            ) : (
                <button 
                    onClick={() => setIsOpen(true)}
                    className="p-3 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white rounded-full shadow-lg border border-gray-700 transition"
                >
                    <Settings size={20} />
                </button>
            )}
        </div>
    );
};
