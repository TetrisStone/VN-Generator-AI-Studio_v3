import React, { useState } from 'react';
import { Save, Download, Upload, Check, Cpu, Sparkles, Globe, Volume2, ArrowLeft } from 'lucide-react';
import { WorldInfo } from '../types';
import { getDefaultWorkflow } from '../services/comfyService';
import { audioManager } from '../utils/audioManager';
import { useI18n, Lang } from '../utils/i18n';
import { OrnateFrame, FantasyButton, GoldRule } from './ui/Ornate';

interface SettingsViewProps {
  worldInfo: WorldInfo;
  onUpdateWorldInfo: (w: WorldInfo) => void;
  onQuickSave: () => Promise<boolean>;
  onExportProject: (includeMedia?: boolean) => void;
  onImportProject: (file: File) => void;
  onExportSave?: () => void;
  onImportSave?: (file: File) => void;
  onBack: () => void;
}

const Section: React.FC<{ title: string; icon: React.ReactNode; hint?: string; className?: string; children: React.ReactNode }> = ({ title, icon, hint, className = '', children }) => (
  <OrnateFrame className={`bg-gray-900/80 p-6 space-y-4 ${className}`}>
    <div>
      <h3 className="text-base font-semibold text-emerald-300 flex items-center gap-2 uppercase">{icon}{title}</h3>
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
    {children}
  </OrnateFrame>
);

export const SettingsView: React.FC<SettingsViewProps> = (viewProps) => {
  // The LLM / ComfyUI block below was moved 1:1 from the old Home tab and still reads `props.*`
  const props = viewProps;
  const { t, lang, setLang } = useI18n();
  const [quickSaveSuccess, setQuickSaveSuccess] = useState(false);
  const [bgmVol, setBgmVol] = useState(audioManager.bgmVolume);
  const [sfxVol, setSfxVol] = useState(audioManager.sfxVolume);

  const handleQuickSaveClick = async () => {
    await props.onQuickSave();
    setQuickSaveSuccess(true);
    setTimeout(() => setQuickSaveSuccess(false), 2500);
  };
  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) props.onImportProject(e.target.files[0]);
    e.target.value = '';
  };
  const handleImportSave = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0] && props.onImportSave) props.onImportSave(e.target.files[0]);
    e.target.value = '';
  };

  return (
    <div className="max-w-5xl mx-auto w-full space-y-6 overflow-y-auto h-full pb-12 pt-2 pr-2">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl text-emerald-300 vn-font-display">{t('settings.title')}</h2>
          <p className="text-gray-400 text-sm mt-1 vn-font-serif text-base">{t('settings.subtitle')}</p>
        </div>
        <FantasyButton inline icon={<ArrowLeft size={14} />} onClick={props.onBack}>{t('settings.back')}</FantasyButton>
      </div>
      <GoldRule />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Section title={t('settings.language')} icon={<Globe size={16} />} hint={t('settings.language.hint')}>
          <div className="flex gap-2">
            {([['en', 'English'], ['de', 'Deutsch']] as [Lang, string][]).map(([code, label]) => (
              <button
                key={code}
                type="button"
                onClick={() => setLang(code)}
                className={`flex-1 py-2 rounded border text-sm font-semibold transition-colors ${
                  lang === code
                    ? 'bg-emerald-600/25 text-emerald-200 border-emerald-500'
                    : 'bg-gray-800 text-gray-300 border-gray-700 hover:border-gray-500'
                }`}
              >{label}</button>
            ))}
          </div>
        </Section>

        <Section title={t('settings.audio')} icon={<Volume2 size={16} />}>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-gray-400 font-bold mb-1 block uppercase">{t('settings.music')}</label>
              <input type="range" min="0" max="1" step="0.01" value={bgmVol} className="w-full accent-[#c9a45c]"
                onChange={e => { const v = parseFloat(e.target.value); setBgmVol(v); audioManager.setBgmVolume(v); }} />
            </div>
            <div>
              <label className="text-xs text-gray-400 font-bold mb-1 block uppercase">{t('settings.sfx')}</label>
              <input type="range" min="0" max="1" step="0.01" value={sfxVol} className="w-full accent-[#c9a45c]"
                onChange={e => { const v = parseFloat(e.target.value); setSfxVol(v); audioManager.setSfxVolume(v); }} />
            </div>
          </div>
        </Section>

        <Section title={t('settings.savegame')} icon={<Save size={16} />} hint={t('settings.savegame.hint')}>
          <div className="grid grid-cols-1 gap-3">
            <FantasyButton
              inline
              icon={quickSaveSuccess ? <Check size={14} /> : <Save size={14} />}
              onClick={handleQuickSaveClick}
              title="Quick Save Project to Local Browser Storage"
            >{quickSaveSuccess ? t('settings.quicksaved') : t('settings.quicksave')}</FantasyButton>
            <div className="grid grid-cols-2 gap-3">
              <FantasyButton inline icon={<Download size={14} />} onClick={props.onExportSave} title="Export Save Game to File">{t('settings.exportsave')}</FantasyButton>
              <div className="relative">
                <FantasyButton inline icon={<Upload size={14} />} className="w-full" title="Import Save Game from File">{t('settings.importsave')}</FantasyButton>
                <input type="file" onChange={handleImportSave} className="absolute inset-0 opacity-0 cursor-pointer" accept=".json" />
              </div>
            </div>
          </div>
        </Section>

        <Section title={t('settings.project')} icon={<Download size={16} />} hint={t('settings.project.hint')}>
          <div className="grid grid-cols-1 gap-3">
            <FantasyButton inline icon={<Download size={14} />} onClick={() => props.onExportProject(true)} title="Export Full Project with all Media">{t('settings.exportfull')}</FantasyButton>
            <FantasyButton inline icon={<Download size={14} />} onClick={() => props.onExportProject(false)} title="Export Light Project (Data only)">{t('settings.exportlight')}</FantasyButton>
            <div className="relative">
              <FantasyButton inline icon={<Upload size={14} />} className="w-full" title="Import Editor Project">{t('settings.import')}</FantasyButton>
              <input type="file" onChange={handleImport} className="absolute inset-0 opacity-0 cursor-pointer" accept=".json,.zip" />
            </div>
          </div>
        </Section>

            {/* LLM Settings */}
            <OrnateFrame className="bg-gray-900/80 p-6 space-y-4 md:col-span-2">
                <h3 className="text-base font-semibold text-emerald-300 flex items-center gap-2 uppercase"><Cpu size={16}/> Model Settings</h3>
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
            </OrnateFrame>
      </div>
    </div>
  );
};
