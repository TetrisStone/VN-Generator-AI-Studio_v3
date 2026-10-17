
import React, { useState, useEffect, useRef } from 'react';
import { Scene, Character, ChatMessage, GameState, GameSaveData, Chapter, WorldInfo, CharacterEmotion, RelationshipKeyMoment } from '../types';
import { generateGameTurn, generateImagePromptContext, selectRelevantLore } from '../services/geminiService';
import { Button } from './ui/Button';
import { ArrowLeft, RefreshCw, Send, Save, Map, CheckCircle, Play, MapPin, Heart, SkipForward, Target, Cpu, Sparkles, XCircle, Loader2, User, Image as ImageIcon } from 'lucide-react';
import { AsyncImage } from './ui/AsyncImage';
import { AsyncVideo } from './ui/AsyncVideo';
import { generateComfyImage, prepareComfyWorkflow, getAvailableLoras, getAvailableCheckpoints } from '../services/comfyService';
import { saveImage } from '../utils/imageStorage';

const KEY_MOMENT_THRESHOLD = 5;
const COMFY_STANDARD_PROMPT = "masterpiece, best quality, score_9, anime, simple_background";

interface PlayerProps {
  scenes: Scene[];
  characters: Character[];
  chapters: Chapter[];
  worldInfo: WorldInfo;
  initialState: any; // Using any loosely here because we are mixing save data types
  onExit: (success: boolean, history: ChatMessage[]) => void; 
  onSave: (vnState: any) => Promise<boolean>;
  onCharacterUpdate?: (updatedChar: Character) => void; // New prop to persist changes
  onSceneUpdate?: (updatedScene: Scene) => void; // New prop to persist scene edits
}

export const Player: React.FC<PlayerProps> = ({ scenes, characters, chapters, worldInfo, initialState, onExit, onSave, onCharacterUpdate, onSceneUpdate }) => {
  const [state, setState] = useState<GameState>({
    currentSceneIndex: initialState?.currentSceneIndex || 0,
    history: initialState?.history || [],
    isProcessing: false,
    gameOver: false,
  });
  const [userInput, setUserInput] = useState('');
  
  // Track goal reached state locally to show UI elements
  const [goalReached, setGoalReached] = useState(false);
  const [goalReason, setGoalReason] = useState<string | null>(null);

  // Dev Tools State
  const [showDevTools, setShowDevTools] = useState(false);
  const [showGoalPopover, setShowGoalPopover] = useState(false);
  const [lastTokenStats, setLastTokenStats] = useState<{promptTokens?: number, completionTokens?: number, totalTokens?: number} | null>(null);
  
  // AI Lore Router State
  const [prefetchedLoreIds, setPrefetchedLoreIds] = useState<string[]>([]);
  const [isLoreLoading, setIsLoreLoading] = useState(false);

  // Notifications for Relationship Updates
  const [notifications, setNotifications] = useState<{ id: string, text: string, type: 'good' | 'bad' }[]>([]);

  // VIDEO STATE
  const [playingVideo, setPlayingVideo] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [isSaving, setIsSaving] = useState(false);

  const currentScene = scenes[state.currentSceneIndex];
  
  // ComfyUI States
  const [showComfyModal, setShowComfyModal] = useState(false);
  const [activeEventCG, setActiveEventCG] = useState<string | null>(null);
  const [comfyStatus, setComfyStatus] = useState('');
  const [isComfyGenerating, setIsComfyGenerating] = useState(false);
  const [comfyError, setComfyError] = useState<string | null>(null);

  // ComfyUI Structured Prompt Building Blocks & Model Selection
  const [comfySelectedCharId, setComfySelectedCharId] = useState<string>('');
  const [comfyLoraFileName, setComfyLoraFileName] = useState<string>('');
  const [comfyCheckpointFileName, setComfyCheckpointFileName] = useState<string>('');
  const [availableLoras, setAvailableLoras] = useState<string[]>([]);
  const [availableCheckpoints, setAvailableCheckpoints] = useState<string[]>([]);
  const [isLoadingComfyModels, setIsLoadingComfyModels] = useState<boolean>(false);
  const [comfyTrigger, setComfyTrigger] = useState<string>('');
  const [comfyHead, setComfyHead] = useState<string>('');
  const [comfyBody, setComfyBody] = useState<string>('');
  const [comfyModifiers, setComfyModifiers] = useState<string>('');
  const [comfyAction, setComfyAction] = useState<string>('');
  const [comfyParticipants, setComfyParticipants] = useState<string>('');

  // Find current chapter
  const currentChapter = currentScene?.chapterId ? chapters.find(c => c.id === currentScene.chapterId) : undefined;
  
  // Logic: Active characters are those present in the scene logic (for AI context)
  const activeCharacters = currentScene?.characters
    .map(sc => characters.find(c => c.id === sc.characterId))
    .filter((c): c is Character => !!c) || [];

  const populateComfyFieldsForCharacter = (char: Character | undefined) => {
    if (!char) {
      setComfySelectedCharId('');
      setComfyLoraFileName('');
      setComfyCheckpointFileName('');
      setComfyTrigger('');
      setComfyHead('');
      setComfyBody('');
      return;
    }
    setComfySelectedCharId(char.id);
    setComfyLoraFileName(char.imagePrompts?.loraFileName || '');
    setComfyCheckpointFileName(char.imagePrompts?.checkpointFileName || '');
    setComfyTrigger(char.imagePrompts?.trigger?.trim() || char.aiImagePrompt?.trim() || '');

    const headParts = [char.imagePrompts?.face, char.imagePrompts?.hair]
      .filter(Boolean)
      .map(s => s!.trim())
      .filter(s => s.length > 0);
    setComfyHead(headParts.join(', '));

    const bodyParts = [char.imagePrompts?.clothes, char.imagePrompts?.bodyType]
      .filter(Boolean)
      .map(s => s!.trim())
      .filter(s => s.length > 0);
    setComfyBody(bodyParts.join(', '));
  };

  const loadComfyModels = async () => {
    setIsLoadingComfyModels(true);
    try {
      const comfyUrl = worldInfo?.comfyUrl || 'http://127.0.0.1:8188';
      const [fetchedLoras, fetchedCkpts] = await Promise.all([
        getAvailableLoras(comfyUrl),
        getAvailableCheckpoints(comfyUrl)
      ]);
      setAvailableLoras(fetchedLoras);
      setAvailableCheckpoints(fetchedCkpts);
    } catch (e) {
      console.warn("ComfyUI-Modelle konnten nicht geladen werden:", e);
    } finally {
      setIsLoadingComfyModels(false);
    }
  };

  const finalComfyPrompt = React.useMemo(() => {
    const parts = [
      COMFY_STANDARD_PROMPT,
      comfyTrigger,
      comfyHead,
      comfyBody,
      comfyModifiers,
      comfyAction,
      comfyParticipants
    ];
    return parts
      .map(p => (p || '').trim())
      .filter(p => p.length > 0)
      .join(', ');
  }, [comfyTrigger, comfyHead, comfyBody, comfyModifiers, comfyAction, comfyParticipants]);

  const handleOpenComfyModal = () => {
    setShowComfyModal(true);
    setComfyError(null);
    setComfyStatus('');

    loadComfyModels();

    // Pre-select first character with trigger, LoRA or prompts
    const charWithTrigger = activeCharacters.find(c => !!c.imagePrompts?.trigger?.trim() || !!c.imagePrompts?.loraFileName);
    const charWithAnyPrompt = activeCharacters.find(c => !!c.imagePrompts?.face || !!c.imagePrompts?.clothes || !!c.aiImagePrompt);
    const initialChar = charWithTrigger || charWithAnyPrompt || (activeCharacters.length > 0 ? activeCharacters[0] : undefined);

    populateComfyFieldsForCharacter(initialChar);
    setComfyModifiers('');
    setComfyAction('');
    setComfyParticipants('');
  };

  // Logic: Visible characters are strictly those with an imageSrc or any emotion image.
  const visibleCharacters = activeCharacters.filter(c => !!c.imageSrc || (c.emotions && Object.values(c.emotions).some(v => !!v)));

  // Derive latest emotion for each character from chat history
  const latestEmotions = React.useMemo(() => {
    const emotions: Record<string, CharacterEmotion> = {};
    for (const msg of state.history) {
      if (msg.characterId) {
        emotions[msg.characterId] = msg.emotion || 'idle';
      }
    }
    return emotions;
  }, [state.history]);

  // Auto-scroll chat
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [state.history]);

  // Initial greeting from System/Narrator and AI Lore Router when scene starts
  useEffect(() => {
    if (!currentScene) return;

    setGoalReached(false);
    setGoalReason(null);
    setPrefetchedLoreIds([]);

    // Check for Intro Video
    if (state.history.length === 0 && currentScene.introVideoSrc) {
        setPlayingVideo(true);
    } else {
        setPlayingVideo(false);
    }

    if (state.history.length === 0) {
      setState(prev => ({
        ...prev,
        history: [{
          sender: 'system',
          text: currentScene.description,
          timestamp: Date.now(),
        }]
      }));
    }

    // Trigger AI Lore Relevance Router in Background
    const allFactions = worldInfo?.factions || [];
    const allLocations = worldInfo?.loreLocations || [];

    if (allFactions.length > 0 || allLocations.length > 0) {
      setIsLoreLoading(true);
      const activeChars = currentScene.characters.map(sc => {
        const baseChar = characters.find(c => c.id === sc.characterId);
        return {
          name: baseChar?.name || 'Unbekannt',
          defaultDescription: baseChar?.defaultDescription || '',
        };
      });

      selectRelevantLore({
        sceneName: currentScene.name,
        sceneDescription: currentScene.description,
        sceneGoal: currentScene.goal,
        sceneAiInstructions: currentScene.aiInstructions,
        activeCharacters: activeChars,
        allFactions,
        allLocations,
        worldInfo,
      })
        .then(selectedIds => {
          console.log("[Lore Router] Scoped Lore IDs for scene:", selectedIds);
          setPrefetchedLoreIds(selectedIds);
        })
        .catch(err => {
          console.warn("[Lore Router] Prefetch failed, fallback to keyword scoring:", err);
          setPrefetchedLoreIds([]);
        })
        .finally(() => {
          setIsLoreLoading(false);
        });
    } else {
      setPrefetchedLoreIds([]);
      setIsLoreLoading(false);
    }
  }, [state.currentSceneIndex, currentScene]); // Trigger when index changes

  const addNotification = (text: string, type: 'good' | 'bad') => {
      const id = crypto.randomUUID();
      setNotifications(prev => [...prev, { id, text, type }]);
      setTimeout(() => {
          setNotifications(prev => prev.filter(n => n.id !== id));
      }, 4000);
  };

  const handleSendMessage = async () => {
    if (!userInput.trim() || state.isProcessing || isLoreLoading || !currentScene || playingVideo) return;

    const newMessage: ChatMessage = {
      sender: 'user',
      text: userInput,
      timestamp: Date.now(),
    };

    // Optimistic update
    setState(prev => ({
      ...prev,
      history: [...prev.history, newMessage],
      isProcessing: true,
    }));
    setUserInput('');

    try {
      const aiResponse = await generateGameTurn(
        newMessage.text,
        state.history, // send previous history
        currentScene,
        characters,
        worldInfo,
        currentChapter,
        initialState?.rpgState?.storyLog || [], // PASS STORY HISTORY HERE
        prefetchedLoreIds
      );

      const validEmotions: CharacterEmotion[] = ['idle','happy','angry','thoughtful','shy','sad','shocked','worried','lustful'];
      const safeEmotion = (e: string | undefined): CharacterEmotion | undefined =>
        e && validEmotions.includes(e as CharacterEmotion) ? (e as CharacterEmotion) : 'idle';

      const characterResponses = aiResponse?.characterResponses || [];
      const newMessages: ChatMessage[] = characterResponses.map((resp: any) => ({
        sender: 'model',
        characterId: resp.characterId,
        emotion: safeEmotion(resp.emotion),
        text: resp.text,
        timestamp: Date.now(),
      }));

      setState(prev => ({
        ...prev,
        history: [...prev.history, ...newMessages],
        isProcessing: false,
      }));

      // Handle Relationship Updates
      if (aiResponse?.relationshipUpdates && aiResponse.relationshipUpdates.length > 0 && onCharacterUpdate) {
          aiResponse.relationshipUpdates.forEach((update: any) => {
              const char = characters.find(c => c.id === update.characterId);
              if (char && char.relationship) {
                  // Calculate new value
                  const newVal = (char.relationship.currentValue || 0) + update.change;
                  
                  let newKeyMoments = char.relationship.keyMoments ? [...char.relationship.keyMoments] : [];
                  if (Math.abs(update.change) >= KEY_MOMENT_THRESHOLD) {
                      const emotionalTone: 'positive' | 'negative' | 'neutral' = 
                          update.change > 0 ? 'positive' : update.change < 0 ? 'negative' : 'neutral';
                      
                      const newMoment: RelationshipKeyMoment = {
                          id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'km_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
                          timestamp: Date.now(),
                          description: update.reason || '',
                          impact: update.change,
                          emotionalTone,
                          sceneName: currentScene.name
                      };
                      
                      newKeyMoments = [...newKeyMoments, newMoment].slice(-10);
                  }

                  // Persist change
                  onCharacterUpdate({
                      ...char,
                      relationship: { 
                          ...char.relationship, 
                          currentValue: newVal,
                          keyMoments: newKeyMoments
                      }
                  });
                  // Show Notification
                  const sign = update.change > 0 ? '+' : '';
                  addNotification(`${char.name}: Relationship ${sign}${update.change} (${update.reason})`, update.change > 0 ? 'good' : 'bad');
              }
          });
      }

      if (aiResponse?.sceneGoalReached) {
        setGoalReached(true);
        setGoalReason(aiResponse.sceneTransitionReason || "Objective Completed.");
      }
      
      if (aiResponse?.tokenStats) {
          setLastTokenStats(aiResponse.tokenStats);
      }

    } catch (error: any) {
      console.error("Turn error", error);
      addNotification(`Error: ${error.message}`, 'bad');
      setState(prev => ({ ...prev, isProcessing: false }));
    }
  };

  const handleManualExit = (complete: boolean) => {
      onExit(complete, state.history);
  };

  const handleComfyGenerate = async () => {
    setIsComfyGenerating(true);
    setComfyError(null);
    setComfyStatus('Konstruiere Workflow...');

    try {
        const comfyUrl = worldInfo?.comfyUrl || 'http://127.0.0.1:8188';
        const workflowStr = worldInfo?.comfyWorkflow || '';

        const width = 1024;
        const height = 576;

        const preparedWorkflow = prepareComfyWorkflow(
            workflowStr, 
            finalComfyPrompt, 
            width, 
            height, 
            comfyTrigger,
            comfyLoraFileName,
            comfyCheckpointFileName
        );
        
        const base64Data = await generateComfyImage(comfyUrl, preparedWorkflow, (statusMsg) => {
            setComfyStatus(statusMsg);
        });

        const newId = crypto.randomUUID();
        await saveImage(newId, base64Data);

        setActiveEventCG(newId);
        addNotification('Event CG generiert!', 'good');

        setShowComfyModal(false);
    } catch (err: any) {
        console.error(err);
        setComfyError(err.message || 'Ein unbekannter Fehler ist aufgetreten.');
    } finally {
        setIsComfyGenerating(false);
    }
  };

  const handleSaveGame = async () => {
    if (isSaving) return;
    setIsSaving(true);
    
    const vnState = {
       currentSceneIndex: state.currentSceneIndex,
       history: state.history,
       isProcessing: false,
       gameOver: false
    };

    const btn = document.getElementById('save-btn');
    if (btn) btn.innerHTML = '...';

    await onSave(vnState);
    
    if (btn) {
      btn.innerHTML = 'Saved!';
      setTimeout(() => btn.innerHTML = '', 2000); 
      setTimeout(() => setIsSaving(false), 1500);
    } else {
        setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  if (!currentScene) {
    return <div className="flex items-center justify-center h-full">Scene Data Error. <button onClick={() => handleManualExit(false)}>Back</button></div>;
  }

  return (
    // Fixed container filling the screen
    <div className="fixed inset-0 z-[100] bg-black overflow-hidden flex flex-col">
      
      {/* VIDEO OVERLAY */}
      {playingVideo && currentScene.introVideoSrc && (
          <div className="absolute inset-0 z-[200] bg-black flex items-center justify-center">
              <AsyncVideo 
                  src={currentScene.introVideoSrc} 
                  autoPlay 
                  onEnded={() => setPlayingVideo(false)}
                  className="w-full h-full object-contain"
              />
              <button 
                  onClick={() => setPlayingVideo(false)}
                  className="absolute bottom-10 right-10 bg-white/20 hover:bg-white/40 text-white px-4 py-2 rounded-full backdrop-blur-md flex items-center gap-2 border border-white/30 transition-all hover:scale-105"
              >
                  <SkipForward size={20} fill="currentColor"/> SKIP VIDEO
              </button>
          </div>
      )}

      {/* Background Layer - Original Full Screen Cover Mode */}
      <div className="absolute inset-0 z-0 bg-gray-950">
        {currentScene.backgroundSrc ? (
             <AsyncImage 
                src={currentScene.backgroundSrc} 
                alt="bg" 
                className="w-full h-full object-cover"
             />
        ) : (
          <div className="w-full h-full bg-gradient-to-b from-gray-800 to-gray-900" />
        )}
        {/* Dark Overlay for UI readability */}
        <div className="absolute inset-0 bg-black/20 z-10 pointer-events-none" />
      </div>

      {/* Top Bar Navigation */}
      <div className="absolute top-2 left-2 right-2 md:top-4 md:left-4 md:right-4 z-50 flex justify-between items-start pointer-events-none gap-2">
        
        {/* Left Side Controls & Headers */}
        <div className="flex flex-col gap-2 pointer-events-auto items-start">
          
          {/* Location & Chapter Header (Ganz nach links über Resume) */}
          <div className="flex flex-col items-start gap-0.5 mb-1 max-w-[280px] sm:max-w-md">
             <div className="flex items-center gap-1.5 text-xs md:text-sm text-emerald-300 font-bold bg-black/75 px-3 py-1.5 rounded-xl md:rounded-full backdrop-blur-md border border-white/10 shadow-lg">
                <MapPin size={14} className="text-emerald-400 flex-shrink-0" />
                <span className="truncate">{currentScene.locationName || currentScene.name || 'Unknown Location'}</span>
             </div>
             {currentChapter && (
                <span className="text-[9px] md:text-[10px] text-gray-400 font-medium uppercase tracking-widest pl-2 truncate max-w-full">
                   {currentChapter.name}
                </span>
             )}
          </div>

          {/* Back / Pause Button */}
          <button 
             onClick={() => handleManualExit(false)}
             className="flex items-center gap-1 md:gap-2 bg-black/60 hover:bg-black/80 text-gray-200 px-3 py-1.5 md:px-4 md:py-2 rounded-full backdrop-blur-md border border-white/10 transition-all hover:scale-105 shadow-lg group flex-shrink-0"
          >
             <ArrowLeft size={14} className="group-hover:-translate-x-1 transition-transform" />
             <span className="font-semibold text-xs md:text-sm">Resume</span>
          </button>
          
          {/* Dev Tools Toggle */}
          <button 
             onClick={() => setShowDevTools(!showDevTools)}
             className={`flex items-center gap-1 md:gap-2 px-3 py-1.5 md:px-4 md:py-2 rounded-full backdrop-blur-md border transition-all shadow-lg flex-shrink-0 ${showDevTools ? 'bg-emerald-600/80 border-emerald-400 text-white' : 'bg-black/60 hover:bg-black/80 border-white/10 text-gray-300'}`}
          >
             <Cpu size={14} />
             <span className="font-semibold text-xs md:text-sm">Dev Tools</span>
          </button>

          {/* Dev Tools Panel */}
          {showDevTools && (
             <div className="bg-black/90 backdrop-blur-md border border-emerald-500/30 p-3 rounded-xl min-w-[240px] max-w-[320px] text-xs font-mono text-gray-300 shadow-xl animate-in fade-in slide-in-from-left-4 flex flex-col gap-3">
                <div>
                   <div className="font-bold text-emerald-400 mb-1.5 border-b border-emerald-500/30 pb-1 flex justify-between items-center">
                      <span>Token Usage (Last Turn)</span>
                      <span className="text-[10px] text-emerald-300/80 font-normal">
                         {worldInfo?.llmProvider === 'openai' ? 'OpenAI Router' : worldInfo?.llmProvider === 'ollama' ? 'Ollama' : 'Gemini'}
                      </span>
                   </div>
                   {lastTokenStats ? (
                     <div className="flex flex-col gap-1">
                        <div className="flex justify-between"><span>Prompt:</span> <span>{lastTokenStats.promptTokens || 0}</span></div>
                        <div className="flex justify-between"><span>Completion:</span> <span>{lastTokenStats.completionTokens || 0}</span></div>
                        <div className="flex justify-between border-t border-gray-700/50 pt-1 mt-1 font-bold text-emerald-300"><span>Total:</span> <span>{lastTokenStats.totalTokens || 0}</span></div>
                     </div>
                   ) : (
                     <div className="text-gray-500 italic">No data yet. Send a message!</div>
                   )}
                </div>

                <div>
                   <div className="font-bold text-emerald-400 mb-1.5 border-b border-emerald-500/30 pb-1 flex justify-between items-center">
                      <span>Lore Sources</span>
                      {isLoreLoading && <span className="text-[10px] text-yellow-400 animate-pulse">Routing...</span>}
                   </div>
                   
                   {/* Manual & AI Scoped Lore */}
                   {(() => {
                      const manualFactions = (worldInfo?.factions || []).filter(f => (currentScene.relevantFactionIds || []).includes(f.id));
                      const manualLocations = (worldInfo?.loreLocations || []).filter(l => (currentScene.relevantLocationIds || []).includes(l.id));
                      const aiFactions = (worldInfo?.factions || []).filter(f => prefetchedLoreIds.includes(f.id) && !(currentScene.relevantFactionIds || []).includes(f.id));
                      const aiLocations = (worldInfo?.loreLocations || []).filter(l => prefetchedLoreIds.includes(l.id) && !(currentScene.relevantLocationIds || []).includes(l.id));

                      const hasManual = manualFactions.length > 0 || manualLocations.length > 0;
                      const hasAI = aiFactions.length > 0 || aiLocations.length > 0;

                      if (!hasManual && !hasAI && !isLoreLoading) {
                         return <div className="text-gray-500 italic text-[11px]">Fallback: Dynamisches Keyword-Scoring aktiv</div>;
                      }

                      return (
                         <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                            {hasManual && (
                               <div>
                                  <div className="text-[10px] text-blue-400 font-bold uppercase tracking-wider mb-0.5">Manuell gescopt:</div>
                                  <div className="flex flex-wrap gap-1">
                                     {manualFactions.map(f => (
                                        <span key={f.id} className="bg-blue-950/80 border border-blue-600/50 text-blue-200 text-[10px] px-1.5 py-0.5 rounded">
                                           {f.name} (Fraktion)
                                        </span>
                                     ))}
                                     {manualLocations.map(l => (
                                        <span key={l.id} className="bg-blue-950/80 border border-blue-600/50 text-blue-200 text-[10px] px-1.5 py-0.5 rounded">
                                           {l.name} (Ort)
                                        </span>
                                     ))}
                                  </div>
                               </div>
                            )}

                            {hasAI && (
                               <div>
                                  <div className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider mb-0.5">KI-Router gewählt:</div>
                                  <div className="flex flex-wrap gap-1">
                                     {aiFactions.map(f => (
                                        <span key={f.id} className="bg-emerald-950/80 border border-emerald-600/50 text-emerald-200 text-[10px] px-1.5 py-0.5 rounded">
                                           {f.name}
                                        </span>
                                     ))}
                                     {aiLocations.map(l => (
                                        <span key={l.id} className="bg-emerald-950/80 border border-emerald-600/50 text-emerald-200 text-[10px] px-1.5 py-0.5 rounded">
                                           {l.name}
                                        </span>
                                     ))}
                                  </div>
                               </div>
                            )}
                         </div>
                      );
                   })()}
                </div>
             </div>
          )}

          {/* ComfyUI Image Generator Toggle */}
          {worldInfo?.comfyEnabled && (
             <button 
                onClick={handleOpenComfyModal}
                className="flex items-center gap-1 md:gap-2 bg-purple-900/70 border border-purple-500/50 hover:bg-purple-800 text-purple-100 px-3 py-1.5 md:px-4 md:py-2 rounded-full backdrop-blur-md transition-all hover:scale-105 shadow-lg flex-shrink-0"
             >
                <Sparkles size={14} className="animate-pulse text-purple-400" />
                <span className="font-semibold text-xs md:text-sm">KI Generieren</span>
             </button>
          )}

          {/* Goal Button & Popover (Ganz nach links unter KI Generieren) */}
          <div className="relative pointer-events-auto">
             <button 
                onClick={() => setShowGoalPopover(!showGoalPopover)}
                className={`flex items-center gap-1.5 px-3 py-1.5 md:px-4 md:py-2 rounded-full backdrop-blur-md border transition-all shadow-lg text-xs md:text-sm font-semibold ${
                   showGoalPopover 
                      ? 'bg-emerald-700/90 border-emerald-400 text-white' 
                      : goalReached 
                        ? 'bg-emerald-900/80 border-emerald-500 text-emerald-200' 
                        : 'bg-black/60 hover:bg-black/80 border-emerald-500/40 text-emerald-300'
                }`}
             >
                <Target size={14} className="text-emerald-400" />
                <span>Goal</span>
                {goalReached && <span className="ml-1 px-1.5 py-0.2 bg-emerald-500 text-black text-[10px] rounded-full font-bold">✓</span>}
             </button>

             {showGoalPopover && (
                <div className="absolute top-full left-0 mt-2 bg-black/90 backdrop-blur-md border border-emerald-500/40 p-3.5 rounded-xl min-w-[220px] max-w-[300px] text-xs text-emerald-100 shadow-2xl z-50 animate-in fade-in slide-in-from-top-2">
                   <div className="flex justify-between items-center mb-1.5 pb-1 border-b border-emerald-500/30">
                      <span className="font-bold text-emerald-400 flex items-center gap-1">
                         <Target size={12}/> Szenen-Ziel
                      </span>
                      <button onClick={() => setShowGoalPopover(false)} className="text-gray-400 hover:text-white text-xs px-1">✕</button>
                   </div>
                   <p className="text-xs text-gray-200 leading-relaxed">
                      {currentScene.goal || 'Kein bestimmtes Ziel angegeben.'}
                   </p>
                   {goalReached ? (
                      goalReason && (
                         <div className="mt-2 pt-2 border-t border-emerald-500/20 text-[11px] text-emerald-300 italic">
                            ✓ Erreicht: {goalReason}
                         </div>
                      )
                   ) : (
                      currentScene.goal && (
                         <button 
                            onClick={() => {
                               setGoalReached(true);
                               setGoalReason("Manuell als erreicht markiert.");
                            }}
                            className="mt-2.5 w-full py-1 px-2.5 bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 border border-emerald-600/50 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1.5 transition-all shadow-sm active:scale-95"
                         >
                            <CheckCircle size={13} /> Als erreicht markieren
                         </button>
                      )
                   )}
                </div>
             )}
          </div>

        </div>

        {/* Goal Reached Action Button */}
        <div className={`pointer-events-auto flex flex-col items-end gap-1 md:gap-2 transition-all duration-500 flex-shrink-0 ${goalReached ? 'translate-y-0 opacity-100' : '-translate-y-4 opacity-0'}`}>
           {goalReached && (
             <>
               <div className="bg-emerald-900/90 text-emerald-100 px-3 py-1.5 md:px-4 md:py-2 rounded-lg border border-emerald-500/50 shadow-2xl backdrop-blur-md animate-in slide-in-from-top-4 hidden sm:block">
                  <div className="flex items-center gap-1 md:gap-2 font-bold mb-0.5 md:mb-1 text-xs md:text-sm">
                      <CheckCircle size={14} className="text-emerald-400" /> Goal Reached!
                  </div>
                  <p className="text-[10px] md:text-xs opacity-90 max-w-[150px] md:max-w-[200px]">{goalReason}</p>
               </div>
               
               <button 
                  onClick={() => handleManualExit(true)}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 md:px-5 md:py-3 rounded-full font-bold shadow-lg shadow-emerald-900/50 flex items-center gap-1 md:gap-2 animate-pulse hover:animate-none transition-all transform hover:scale-105 text-xs md:text-md"
               >
                  Finish <span className="hidden sm:inline">Scenario</span> <Play size={14} fill="currentColor" />
               </button>
             </>
           )}
        </div>
      </div>
      
      {/* NOTIFICATION LAYER (Center-Top) */}
      <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[60] flex flex-col gap-2 pointer-events-none w-full max-w-md items-center">
          {notifications.map(n => (
              <div 
                  key={n.id}
                  className={`px-6 py-2 rounded-full shadow-xl backdrop-blur-md animate-in slide-in-from-top-4 fade-in duration-500 border flex items-center gap-2 font-bold
                    ${n.type === 'good' ? 'bg-pink-500/80 border-pink-400 text-white' : 'bg-gray-800/90 border-gray-600 text-gray-300'}
                  `}
              >
                  {n.type === 'good' ? <Heart size={16} fill="currentColor"/> : <Heart size={16} className="text-gray-500"/>}
                  {n.text}
              </div>
          ))}
      </div>

      {/* Opaque Solid Shadow Layer at bottom (verhindert Sichtbarkeit halber Charaktere) */}
      <div className="absolute bottom-0 left-0 right-0 z-[15] h-[26vh] bg-black pointer-events-none" />

      {/* Character Layer - Positioned above the background, below UI */}
      {/* We use visibleCharacters map to ensure characters without portraits don't take up layout space */}
      <div className="absolute bottom-[25vh] left-0 right-0 z-20 flex justify-center items-end px-10 h-[65vh] pointer-events-none">
        {visibleCharacters.map((char, idx) => {
           const currentEmotion = latestEmotions[char.id] || 'idle';
           let currentSrc = char.imageSrc;
           if (currentEmotion !== 'idle' && char.emotions && char.emotions[currentEmotion as keyof typeof char.emotions]) {
               currentSrc = char.emotions[currentEmotion as keyof typeof char.emotions] || char.imageSrc;
           }

           return (
             <div 
                key={char.id} 
                className="relative transition-transform duration-500 transform"
                style={{ 
                   zIndex: 20 + idx, 
                   marginLeft: idx > 0 ? '-50px' : '0',
                   filter: state.isProcessing ? 'brightness(0.7)' : 'brightness(1)' 
                }}
             >
                {currentSrc && (
                  <AsyncImage 
                    src={currentSrc} 
                    alt={char.name} 
                    className="max-h-[65vh] w-auto object-contain drop-shadow-2xl"
                  />
                )}
               <div className="absolute bottom-2 left-0 right-0 text-center">
                  <span className="bg-black/60 text-white px-2 py-0.5 rounded text-xs md:text-sm backdrop-blur-sm">{char.name}</span>
               </div>
             </div>
           );
        })}
      </div>

      {/* Event CG Layer */}
      {activeEventCG && (
        <div 
           className="absolute inset-0 z-20 bg-black cursor-pointer animate-in fade-in duration-500"
           onClick={() => setActiveEventCG(null)}
        >
           <AsyncImage 
              src={activeEventCG} 
              alt="Event CG" 
              className="w-full h-full object-cover"
           />
           <div className="absolute top-4 right-4 bg-black/60 text-white text-xs px-2 py-1 rounded backdrop-blur">
               Klicken, um zurückzukehren
           </div>
        </div>
      )}

      {/* UI Layer - Chat Box (Höhe reduziert auf 26vh) */}
      <div className="absolute bottom-0 left-0 right-0 z-30 p-2 md:p-4 pt-10 md:pt-14 bg-gradient-to-t from-black via-black via-80% to-transparent">
        <div className="max-w-4xl mx-auto bg-black/85 border border-gray-700/80 rounded-xl backdrop-blur-md shadow-2xl overflow-hidden flex flex-col h-[26vh] md:h-[26vh]">
          
          {/* Chat History */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-2 md:p-4 space-y-3 md:space-y-4">
            {state.history.map((msg, i) => {
              const char = characters.find(c => c.id === msg.characterId);
              const isUser = msg.sender === 'user';
              const isSystem = msg.sender === 'system';
              
              if (isSystem) return (
                <div key={i} className="text-center text-yellow-500 italic text-xs md:text-sm my-2 md:my-4 px-4 md:px-8">
                  {msg.text}
                </div>
              );

              // Apply custom visual styles
              const bubbleStyle: React.CSSProperties = {};
              
              if (!isUser && char) {
                  const bgColor = char.bubbleColor || char.rpgColor;
                  if (bgColor) bubbleStyle.backgroundColor = bgColor;
                  bubbleStyle.color = 'white'; 
                  if (char.isItalic) bubbleStyle.fontStyle = 'italic';
              }

              return (
                <div key={i} className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
                   <div className="text-[10px] md:text-xs text-gray-400 mb-0.5 md:mb-1 px-1">
                     {isUser ? 'You' : (char?.name || 'Unknown')}
                   </div>
                   <div 
                      className={`px-3 py-1.5 md:px-4 md:py-2 rounded-lg max-w-[90%] md:max-w-[85%] text-xs md:text-sm leading-relaxed ${
                        isUser 
                          ? 'bg-emerald-600 text-white rounded-br-none' 
                          : 'bg-gray-800 text-white rounded-bl-none border border-gray-700'
                      }`}
                      style={!isUser ? bubbleStyle : undefined}
                   >
                     {msg.text}
                   </div>
                </div>
              );
            })}
            {state.isProcessing && (
              <div className="flex items-center gap-1.5 text-gray-500 text-xs md:text-sm px-2 md:px-4">
                <RefreshCw className="animate-spin" size={12} /> AI is thinking...
              </div>
            )}
            
            {/* System Message inside chat when goal reached */}
            {goalReached && (
                <div className="text-center my-2 md:my-4 animate-in fade-in zoom-in duration-300">
                    <span className="bg-emerald-900/50 text-emerald-300 border border-emerald-600/50 px-2 py-1 md:px-3 rounded-full text-[10px] md:text-xs font-bold">
                        ★ Objective Complete
                    </span>
                </div>
            )}
          </div>

          {/* Input Area */}
          <div className="p-2 md:p-4 border-t border-gray-700 bg-gray-900/50 flex flex-col gap-1.5">
             {isLoreLoading && (
                <div className="flex items-center gap-1.5 text-yellow-400 text-[11px] px-1 animate-pulse">
                   <Loader2 size={12} className="animate-spin" /> Lore wird geladen...
                </div>
             )}
             <div className="flex gap-2">
                <button 
                  id="save-btn"
                  onClick={handleSaveGame} 
                  disabled={isSaving}
                  className="bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-300 p-2 md:p-3 rounded-lg transition-colors flex items-center justify-center min-w-[40px] md:min-w-[50px]"
                  title="Save Current Progress"
                >
                  {!isSaving && <Save size={16} />}
                </button>
                
                <input
                  type="text"
                  className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 md:px-4 md:py-3 text-xs md:text-sm text-white focus:border-emerald-500 outline-none transition-colors"
                  placeholder={goalReached ? "Keep chatting or leave..." : isLoreLoading ? "Lore wird geladen..." : "What do you say/do?"}
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  autoFocus
                  disabled={state.isProcessing || isLoreLoading}
                />
                <button 
                   onClick={handleSendMessage}
                   disabled={!userInput.trim() || state.isProcessing || isLoreLoading}
                   className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white p-2 md:p-3 rounded-lg transition-colors flex items-center justify-center min-w-[40px] md:min-w-[44px]"
                   title={isLoreLoading ? "Lore wird geladen..." : "Senden"}
                >
                   {isLoreLoading ? <Loader2 size={16} className="animate-spin text-gray-400" /> : <Send size={16} />}
                </button>
             </div>
          </div>

        </div>
      </div>

      {/* COMFYUI GENERATION MODAL - Located at top-level to prevent chat box container height clipping */}
      {showComfyModal && (
          <div className="fixed inset-0 z-[300] bg-black/85 flex items-center justify-center p-4 backdrop-blur-md pointer-events-auto overflow-y-auto">
              <div className="bg-gray-900 border border-purple-500/30 rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col gap-4 text-gray-200 shadow-2xl">
                  <div className="flex justify-between items-center border-b border-gray-800 pb-3">
                      <h3 className="font-bold text-lg text-purple-400 flex items-center gap-2">
                          <Sparkles size={20} className="animate-pulse" /> KI-Bildgenerierung (ComfyUI)
                      </h3>
                      <button 
                          onClick={() => setShowComfyModal(false)} 
                          className="text-gray-400 hover:text-white transition"
                          disabled={isComfyGenerating}
                      >
                          <XCircle size={24} />
                      </button>
                  </div>

                  <div className="space-y-4">
                      {/* 1. Character Dropdown */}
                      <div className="bg-gray-800/80 p-3.5 rounded-xl border border-gray-700/80">
                          <label className="text-xs font-bold text-purple-300 uppercase tracking-wider block mb-1.5 flex items-center gap-1.5">
                              <User size={14} className="text-purple-400" /> Charakter auswählen
                          </label>
                          <select
                              value={comfySelectedCharId}
                              onChange={(e) => {
                                  const selected = activeCharacters.find(c => c.id === e.target.value);
                                  populateComfyFieldsForCharacter(selected);
                              }}
                              disabled={isComfyGenerating}
                              className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2.5 text-white text-xs md:text-sm focus:border-purple-500 outline-none"
                          >
                              <option value="">-- Kein Charakter (Standard / Freitext) --</option>
                              {activeCharacters.map(char => {
                                  const hasTrigger = !!char.imagePrompts?.trigger?.trim();
                                  const triggerText = hasTrigger ? ` [LoRA: ${char.imagePrompts?.trigger}]` : '';
                                  return (
                                      <option key={char.id} value={char.id}>
                                          {char.name}{triggerText}
                                      </option>
                                  );
                              })}
                          </select>
                          <p className="text-[11px] text-gray-400 mt-1.5">
                              Die Auswahl lädt automatisch die hinterlegten Charakter-Prompt-Bausteine in die Eingabefelder.
                          </p>
                      </div>

                      {/* 2. Model Selection (LoRA & Checkpoint) */}
                      <div className="bg-gray-800/80 p-3.5 rounded-xl border border-purple-900/40 space-y-3">
                          <div className="flex justify-between items-center border-b border-gray-700/50 pb-1">
                              <label className="text-xs font-bold text-purple-300 uppercase tracking-wider flex items-center gap-1.5">
                                  <Cpu size={14} className="text-purple-400" /> Modell-Auswahl (ComfyUI)
                              </label>
                              {isLoadingComfyModels && (
                                  <span className="text-[11px] text-purple-400 flex items-center gap-1">
                                      <Loader2 size={12} className="animate-spin" /> Lade Modelle...
                                  </span>
                              )}
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div>
                                  <label className="text-[11px] font-semibold text-gray-300 block mb-1">
                                      LoRA-Modell:
                                  </label>
                                  <select
                                      value={comfyLoraFileName}
                                      onChange={(e) => setComfyLoraFileName(e.target.value)}
                                      disabled={isComfyGenerating}
                                      className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-xs text-white focus:border-purple-500 outline-none"
                                  >
                                      <option value="">-- Keine LoRA ausgewählt --</option>
                                      {availableLoras.map(lora => (
                                          <option key={lora} value={lora}>{lora}</option>
                                      ))}
                                      {availableLoras.length === 0 && !isLoadingComfyModels && (
                                          <option disabled value="__empty__">Keine Modelle gefunden – ComfyUI läuft?</option>
                                      )}
                                      {comfyLoraFileName && !availableLoras.includes(comfyLoraFileName) && (
                                          <option value={comfyLoraFileName}>{comfyLoraFileName} (gespeichert)</option>
                                      )}
                                  </select>
                                  {availableLoras.length === 0 && !isLoadingComfyModels && (
                                      <p className="text-[10px] text-amber-500/80 mt-1">Keine Modelle gefunden – ComfyUI läuft?</p>
                                  )}
                              </div>

                              <div>
                                  <label className="text-[11px] font-semibold text-gray-300 block mb-1">
                                      Checkpoint / Diffusion-Modell:
                                  </label>
                                  <select
                                      value={comfyCheckpointFileName}
                                      onChange={(e) => setComfyCheckpointFileName(e.target.value)}
                                      disabled={isComfyGenerating}
                                      className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-xs text-white focus:border-purple-500 outline-none"
                                  >
                                      <option value="">-- Standard (aus Workflow) --</option>
                                      {availableCheckpoints.map(ckpt => (
                                          <option key={ckpt} value={ckpt}>{ckpt}</option>
                                      ))}
                                      {availableCheckpoints.length === 0 && !isLoadingComfyModels && (
                                          <option disabled value="__empty__">Keine Modelle gefunden (checkpoints/diffusion_models) – ComfyUI läuft?</option>
                                      )}
                                      {comfyCheckpointFileName && !availableCheckpoints.includes(comfyCheckpointFileName) && (
                                          <option value={comfyCheckpointFileName}>{comfyCheckpointFileName} (gespeichert)</option>
                                      )}
                                  </select>
                                  {availableCheckpoints.length === 0 && !isLoadingComfyModels && (
                                      <p className="text-[10px] text-amber-500/80 mt-1">Keine Modelle gefunden (checkpoints/diffusion_models) – ComfyUI läuft?</p>
                                  )}
                              </div>
                          </div>
                      </div>

                      {/* 3. Editable Building Blocks */}
                      <div className="bg-gray-800/60 p-4 rounded-xl border border-gray-700/70 space-y-3">
                          <div className="font-bold text-xs uppercase tracking-wider text-gray-300 border-b border-gray-700/50 pb-1">
                              Editierbare Prompt-Bausteine
                          </div>

                          {/* LoRA Trigger Tag */}
                          <div>
                              <label className="text-[11px] font-semibold text-gray-400 block mb-1">
                                  LoRA Trigger:
                              </label>
                              <input 
                                  type="text"
                                  className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-xs text-purple-200 placeholder-gray-600 focus:border-purple-500 outline-none font-mono"
                                  value={comfyTrigger}
                                  onChange={(e) => setComfyTrigger(e.target.value)}
                                  placeholder="z.B. lstsprk_elr_bs (wird für LoraLoader injiziert)"
                                  disabled={isComfyGenerating}
                              />
                          </div>

                          {/* Kopf (Face + Hair) */}
                          <div>
                              <label className="text-[11px] font-semibold text-gray-300 block mb-1">
                                  Kopf (Gesicht &amp; Frisur):
                              </label>
                              <input 
                                  type="text"
                                  className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-xs text-white placeholder-gray-500 focus:border-purple-500 outline-none"
                                  value={comfyHead}
                                  onChange={(e) => setComfyHead(e.target.value)}
                                  placeholder="z.B. red_hair, long_hair, blue_eyes, hair_down"
                                  disabled={isComfyGenerating}
                              />
                          </div>

                          {/* Körper (Clothes + BodyType) */}
                          <div>
                              <label className="text-[11px] font-semibold text-gray-300 block mb-1">
                                  Körper (Kleidung &amp; Körperbau):
                              </label>
                              <input 
                                  type="text"
                                  className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-xs text-white placeholder-gray-500 focus:border-purple-500 outline-none"
                                  value={comfyBody}
                                  onChange={(e) => setComfyBody(e.target.value)}
                                  placeholder="z.B. silver_blue_armor, gauntlets, athletic"
                                  disabled={isComfyGenerating}
                              />
                          </div>

                          {/* Modifikatoren */}
                          <div>
                              <label className="text-[11px] font-semibold text-gray-300 block mb-1">
                                  Modifikatoren:
                              </label>
                              <input 
                                  type="text"
                                  className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-xs text-white placeholder-gray-500 focus:border-purple-500 outline-none"
                                  value={comfyModifiers}
                                  onChange={(e) => setComfyModifiers(e.target.value)}
                                  placeholder="z.B. blush, closed_eyes, blood_on_face"
                                  disabled={isComfyGenerating}
                              />
                          </div>

                          {/* Aktion */}
                          <div>
                              <label className="text-[11px] font-semibold text-gray-300 block mb-1">
                                  Aktion:
                              </label>
                              <input 
                                  type="text"
                                  className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-xs text-white placeholder-gray-500 focus:border-purple-500 outline-none"
                                  value={comfyAction}
                                  onChange={(e) => setComfyAction(e.target.value)}
                                  placeholder="z.B. kissing, fighting, sitting"
                                  disabled={isComfyGenerating}
                              />
                          </div>

                          {/* Beteiligte */}
                          <div>
                              <label className="text-[11px] font-semibold text-gray-300 block mb-1">
                                  Beteiligte:
                              </label>
                              <input 
                                  type="text"
                                  className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-xs text-white placeholder-gray-500 focus:border-purple-500 outline-none"
                                  value={comfyParticipants}
                                  onChange={(e) => setComfyParticipants(e.target.value)}
                                  placeholder="z.B. 1girl, 1boy, solo"
                                  disabled={isComfyGenerating}
                              />
                          </div>
                      </div>

                      {/* 3. Live Prompt Preview */}
                      <div className="bg-purple-950/30 p-3.5 rounded-xl border border-purple-600/40">
                          <label className="text-[11px] font-bold text-purple-300 uppercase tracking-wider block mb-1 flex items-center justify-between">
                              <span>Vorschau des finalen Prompts (Live)</span>
                              <span className="text-[10px] text-purple-400 font-normal">Wird an ComfyUI gesendet</span>
                          </label>
                          <div className="p-2.5 bg-black/60 rounded-lg border border-purple-900/50 text-xs text-purple-100 font-mono leading-relaxed break-words max-h-24 overflow-y-auto select-all">
                              {finalComfyPrompt}
                          </div>
                      </div>

                      {/* Generate / Error Display */}
                      {comfyError && (
                          <div className="p-3 bg-red-950/40 border border-red-500/50 rounded text-red-300 text-xs whitespace-pre-wrap leading-relaxed">
                              {comfyError}
                          </div>
                      )}

                      {isComfyGenerating ? (
                          <div className="p-4 bg-purple-950/20 border border-purple-500/30 rounded flex flex-col items-center justify-center gap-3">
                              <Loader2 size={32} className="animate-spin text-purple-500" />
                              <div className="text-sm font-semibold text-purple-300">{comfyStatus}</div>
                              <p className="text-[11px] text-gray-500 text-center">Dieser Vorgang kann je nach Systemleistung ein paar Sekunden dauern.</p>
                          </div>
                      ) : (
                          <button 
                              onClick={handleComfyGenerate}
                              className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2 shadow-lg hover:shadow-purple-950/50"
                          >
                              <Sparkles size={18} /> Jetzt Generieren (ComfyUI)
                          </button>
                      )}
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};
