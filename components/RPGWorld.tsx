
import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Character, RPGState, WorldMap, Scene, Battle } from '../types';
import { Save, LogOut, MapPin, Book } from 'lucide-react';
import { loadImage } from '../utils/imageStorage';

// Default Icon (Speech Bubble)
const DEFAULT_SCENE_ICON = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjgiIGhlaWdodD0iMTI4IiB2aWV3Qm94PSIwIDAgMjQgMjQiIGZpbGw9IiMwNTk2NjkiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik0yMSAxNWEyIDIgMCAwIDEtMiAySDdsLTQgNFY1YTIgMiAwIDAgMSAyLTJoMTRhMiAyIDAgMCAxIDIgMnoiLz48L3N2Zz4=";

interface RPGWorldProps {
  characters: Character[];
  mapConfig: WorldMap; // The CURRENT map
  maps: WorldMap[]; // For referencing target map names
  scenes: Scene[]; // Needed to check dependencies
  battles?: Battle[]; // Needed for battle data
  onInteraction: (type: 'scene'|'transition'|'character'|'battle', id: string) => void;
  initialState?: RPGState;
  onSave: (state: RPGState) => void;
  onExit: () => void;
  onOpenJournal: () => void; // New Prop
}

export const RPGWorld: React.FC<RPGWorldProps> = ({ 
  characters, 
  mapConfig,
  maps,
  scenes,
  battles = [],
  onInteraction, 
  initialState, 
  onSave,
  onExit,
  onOpenJournal
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const [hoveredSpotId, setHoveredSpotId] = useState<string | null>(null);
  const [bgDataUrl, setBgDataUrl] = useState<string | null>(null);
  
  // Fixed internal resolution for 16:9 aspect ratio
  const CANVAS_WIDTH = 1920;
  const CANVAS_HEIGHT = 1080;

  // Cache for loaded sprite images
  const spritesRef = useRef<Record<string, HTMLImageElement>>({});
  const [spritesLoaded, setSpritesLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    const loadSprites = async () => {
        const promises: Promise<void>[] = [];
        
        // Load Background for active map
        if (mapConfig.backgroundSrc) {
            promises.push(
               loadImage(mapConfig.backgroundSrc).then(data => {
                   if (active) setBgDataUrl(data);
               })
            );
        } else {
            setBgDataUrl(null);
        }

        // 1. Load Default Icon
        promises.push(new Promise((resolve) => {
             const img = new Image();
             img.src = DEFAULT_SCENE_ICON;
             img.onload = () => { if(active) spritesRef.current['default_scene'] = img; resolve(); };
             img.onerror = () => resolve();
        }));

        // 2. Load Character Sprites (Map Sprites)
        characters.forEach(c => {
            if (!c.mapSpriteSrc) return;
            promises.push(
                loadImage(c.mapSpriteSrc)
                .then(data => {
                    if (!data) return;
                    return new Promise<void>((resolve) => {
                        const img = new Image();
                        img.src = data;
                        img.onload = () => { if(active) spritesRef.current[c.id] = img; resolve(); };
                        img.onerror = () => resolve();
                    });
                })
            );
        });

        // 3. Load Scene Icons
        scenes.forEach(s => {
            if (!s.mapIconSrc) return;
            promises.push(
               loadImage(s.mapIconSrc)
               .then(data => {
                   if (!data) return;
                   return new Promise<void>((resolve) => {
                       const img = new Image();
                       img.src = data;
                       img.onload = () => { if(active) spritesRef.current[s.id] = img; resolve(); };
                       img.onerror = () => resolve();
                   });
               })
            );
        });
        await Promise.all(promises);
        if (active) setSpritesLoaded(true);
    };
    loadSprites();
    return () => { active = false; };
  }, [characters, scenes, mapConfig.backgroundSrc]);

  // --- Visibility Logic ---
  const visibleSpots = useMemo(() => mapConfig.spots.filter(spot => {
      // 1. Check if explicitly hidden (Locked via game logic)
      if (initialState?.hiddenIds.includes(spot.id)) return false; 
      
      if (spot.sceneId && initialState?.hiddenIds.includes(spot.sceneId)) return false;
      if (spot.targetMapId && initialState?.hiddenIds.includes(spot.targetMapId)) return false;
      if (spot.characterId && initialState?.hiddenIds.includes(spot.characterId)) return false;
      if (spot.battleId && initialState?.hiddenIds.includes(spot.battleId)) return false;

      if (spot.type === 'transition') {
          const targetMapId = spot.targetMapId;
          if (!targetMapId) return false;
          // Check dependency (Unlock logic)
          const isLockedByDependency = scenes.some(s => s.effects?.some(u => u.type === 'transition' && u.targetId === targetMapId && (u.action === 'unlock' || !u.action)));
          const isUnlocked = initialState?.unlockedIds.includes(targetMapId);
          return !isLockedByDependency || isUnlocked;

      } else if (spot.type === 'scene') {
          const sceneId = spot.sceneId;
          if (!sceneId) return false;
          const scene = scenes.find(s => s.id === sceneId);
          if (!scene) return false; 
          const isCompleted = initialState?.completedSceneIds.includes(scene.id);
          // If completed, only hide if it is NOT repeatable
          if (isCompleted && !scene.isRepeatable) return false; 
          // Check dependency (Unlock logic)
          const isLockedByDependency = scenes.some(other => other.effects?.some(u => u.type === 'scene' && u.targetId === scene.id && (u.action === 'unlock' || !u.action)));
          const isUnlocked = initialState?.unlockedIds.includes(scene.id);
          return !isLockedByDependency || isUnlocked;

      } else if (spot.type === 'battle') {
          const battleId = spot.battleId;
          if (!battleId) return false;
          const battle = battles.find(b => b.id === battleId);
          if (!battle) return false;
          const isCompleted = initialState?.completedBattleIds.includes(battle.id);
          if (isCompleted && !battle.isRepeatable) return false;

          // Check dependency
          const isLockedByDependency = scenes.some(other => other.effects?.some(u => u.type === 'battle' && u.targetId === battle.id && (u.action === 'unlock' || !u.action)));
          const isUnlocked = initialState?.unlockedIds.includes(battle.id);
          return !isLockedByDependency || isUnlocked;

      } else if (spot.type === 'character') {
          return !!spot.characterId;
      }
      return true;
  }), [mapConfig.spots, initialState?.hiddenIds, initialState?.unlockedIds, initialState?.completedSceneIds, initialState?.completedBattleIds, scenes, battles]);

  // --- Interaction / Render ---

  const getMousePosInWorldPercent = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    return {
        x: (x / rect.width) * 100,
        y: (y / rect.height) * 100
    };
  };

  const checkHit = (xPct: number, yPct: number) => {
    const THRESHOLD = 3; // Hitbox size roughly in percentage
    return visibleSpots.find(spot => {
       const dx = spot.x - xPct;
       const dy = spot.y - yPct;
       return Math.sqrt(dx*dx + dy*dy) < THRESHOLD;
    });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const worldPct = getMousePosInWorldPercent(e);
    const hit = checkHit(worldPct.x, worldPct.y);
    
    if (hit) {
      if (hoveredSpotId !== hit.id) setHoveredSpotId(hit.id);
    } else {
      if (hoveredSpotId !== null) setHoveredSpotId(null);
    }
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const worldPct = getMousePosInWorldPercent(e);
    const hit = checkHit(worldPct.x, worldPct.y);
    if (hit) {
      if (hit.type === 'scene' && hit.sceneId) onInteraction('scene', hit.sceneId);
      else if (hit.type === 'character' && hit.characterId) onInteraction('character', hit.characterId);
      else if (hit.type === 'transition' && hit.targetMapId) onInteraction('transition', hit.targetMapId);
      else if (hit.type === 'battle' && hit.battleId) onInteraction('battle', hit.battleId);
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.save();

    const bgImage = new Image();
    if (bgDataUrl) bgImage.src = bgDataUrl;

    const drawScene = () => {
        if (bgDataUrl && bgImage.complete) {
            ctx.drawImage(bgImage, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        } else {
            ctx.fillStyle = '#1e293b';
            ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
            ctx.strokeStyle = '#334155';
            ctx.lineWidth = 2;
            ctx.strokeRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        }

        const toPx = (pct: number, dim: number) => (pct / 100) * dim;

        visibleSpots.forEach(spot => {
          const cx = toPx(spot.x, CANVAS_WIDTH);
          const cy = toPx(spot.y, CANVAS_HEIGHT);
          const isHovered = hoveredSpotId === spot.id;

          const baseScale = CANVAS_WIDTH / 1200; // Scaling factor for sprites based on resolution
          
          let spriteImg: HTMLImageElement | undefined = undefined;

          // 1. Check for Visual Override First
          if (spot.visualCharacterId) {
              spriteImg = spritesRef.current[spot.visualCharacterId];
          }

          // 2. Fallback Logic per Type if no override
          if (!spriteImg) {
              if (spot.type === 'scene' && spot.sceneId) {
                  const scene = scenes.find(s => s.id === spot.sceneId);
                  if (scene) {
                      if (scene.mapIconSrc) {
                          spriteImg = spritesRef.current[scene.id];
                      } else if (scene.characters.length > 0) {
                          // Try finding first character sprite
                          const firstChar = characters.find(c => c.id === scene.characters[0].characterId);
                          if (firstChar) spriteImg = spritesRef.current[firstChar.id];
                      }
                  }
              } else if (spot.type === 'character' && spot.characterId) {
                  spriteImg = spritesRef.current[spot.characterId];
              }
              // Battles and Transitions default to icons if no visual override
          }

          // --- DRAWING ---
          
          if (spriteImg) {
              // Draw Character Sprite
              const targetHeight = (isHovered ? 70 : 50) * baseScale; // Reduced size
              const ratio = spriteImg.naturalWidth / spriteImg.naturalHeight || 1;
              const drawHeight = targetHeight;
              const drawWidth = targetHeight * ratio;
              ctx.save();
              ctx.shadowColor = isHovered ? 'white' : 'black';
              ctx.shadowBlur = isHovered ? 20 : 10;
              ctx.drawImage(spriteImg, cx - drawWidth/2, cy - drawHeight/2, drawWidth, drawHeight);
              ctx.restore();
          } else {
              // Draw Default Icons (Smaller)
              if (spot.type === 'scene') {
                  const size = (isHovered ? 12 : 8) * baseScale; // Drastically reduced
                  ctx.save();
                  ctx.translate(cx, cy);
                  ctx.fillStyle = '#059669'; // Emerald-600
                  ctx.strokeStyle = 'white';
                  ctx.lineWidth = 2;
                  
                  ctx.beginPath();
                  ctx.arc(0, 0, size, 0, Math.PI * 2);
                  ctx.shadowColor = 'black';
                  ctx.shadowBlur = 5;
                  ctx.fill();
                  ctx.stroke();

                  // Simple dot or small symbol
                  ctx.fillStyle = 'white';
                  ctx.textAlign = 'center';
                  ctx.textBaseline = 'middle';
                  ctx.font = `bold ${size}px sans-serif`;
                  ctx.fillText('!', 0, 0); // Exclamation mark
                  
                  ctx.restore();

              } else if (spot.type === 'battle') {
                  const size = (isHovered ? 14 : 10) * baseScale; // Drastically reduced
                  ctx.save();
                  ctx.translate(cx, cy);
                  ctx.fillStyle = '#991b1b'; // Red-800
                  ctx.strokeStyle = '#f87171'; // Red-400
                  ctx.lineWidth = 2;
                  
                  ctx.beginPath();
                  ctx.roundRect(-size, -size, size*2, size*2, 4);
                  ctx.fill();
                  ctx.stroke();

                  // Swords X
                  ctx.strokeStyle = 'white';
                  ctx.lineWidth = 2;
                  ctx.beginPath();
                  ctx.moveTo(-size/2, -size/2);
                  ctx.lineTo(size/2, size/2);
                  ctx.moveTo(size/2, -size/2);
                  ctx.lineTo(-size/2, size/2);
                  ctx.stroke();
                  
                  ctx.restore();
              } else if (spot.type === 'transition') {
                  const radius = 10 * baseScale; // Smaller
                  const pulseColor = 'rgba(52, 211, 153, 0.6)';
                  if (isHovered) {
                      const time = Date.now() / 300;
                      const pulse = Math.sin(time) * 4 + radius + 4;
                      ctx.beginPath();
                      ctx.arc(cx, cy, pulse, 0, Math.PI * 2);
                      ctx.strokeStyle = pulseColor;
                      ctx.lineWidth = 2;
                      ctx.stroke();
                  }
                  ctx.beginPath();
                  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
                  ctx.fillStyle = 'rgba(16, 185, 129, 0.9)'; 
                  ctx.fill();
                  ctx.strokeStyle = '#6ee7b7'; 
                  ctx.lineWidth = 2;
                  ctx.stroke();
                  
                  // Arrow
                  ctx.beginPath();
                  ctx.moveTo(cx - 3, cy);
                  ctx.lineTo(cx + 3, cy);
                  ctx.lineTo(cx + 1, cy - 3);
                  ctx.moveTo(cx + 3, cy);
                  ctx.lineTo(cx + 1, cy + 3);
                  ctx.strokeStyle = 'white';
                  ctx.stroke();
              }
          }

          // Name Label on Hover
          if (isHovered) {
            let labelName = "Unknown";
            if (spot.type === 'scene' && spot.sceneId) labelName = scenes.find(s => s.id === spot.sceneId)?.name || "Unknown Scene";
            else if (spot.type === 'battle' && spot.battleId) labelName = battles.find(b => b.id === spot.battleId)?.name || "Battle";
            else if (spot.type === 'character' && spot.characterId) labelName = characters.find(c => c.id === spot.characterId)?.name || "Character";
            else if (spot.type === 'transition' && spot.targetMapId) labelName = `To ${maps.find(m => m.id === spot.targetMapId)?.name || 'Area'}`;

            ctx.save();
            ctx.translate(cx, cy - 40); // Lift label higher
            ctx.fillStyle = 'rgba(0,0,0,0.8)';
            ctx.font = 'bold 20px sans-serif';
            const textW = ctx.measureText(labelName).width;
            ctx.fillRect(-textW/2 - 10, -24, textW + 20, 32);
            ctx.fillStyle = 'white';
            ctx.textAlign = 'center';
            ctx.fillText(labelName, 0, 0);
            ctx.restore();
          }
        });
    }

    if (bgImage.complete || !bgDataUrl) {
        drawScene();
    } else {
        bgImage.onload = drawScene;
    }
    ctx.restore();
  }, [mapConfig, characters, scenes, battles, hoveredSpotId, spritesLoaded, visibleSpots, bgDataUrl]);

  const handleManualSave = () => {
    onSave({ 
        currentMapId: mapConfig.id,
        completedSceneIds: initialState?.completedSceneIds || [],
        completedBattleIds: initialState?.completedBattleIds || [],
        unlockedIds: initialState?.unlockedIds || [],
        hiddenIds: initialState?.hiddenIds || [],
        ongoingScenes: initialState?.ongoingScenes || {},
        storyLog: initialState?.storyLog || []
    });
  };

  return (
    <div className="relative w-full h-full bg-black flex items-center justify-center overflow-hidden">
      {/* 16:9 Container */}
      <div className="relative w-full max-w-[177.78vh] aspect-video bg-gray-900 shadow-2xl border border-gray-800">
          
          {/* Header Overlay */}
          <div className="absolute top-4 left-4 md:top-6 md:left-6 z-10 pointer-events-none">
              <div className="bg-gray-900/60 px-3 py-1.5 md:px-4 md:py-2 rounded-lg border border-gray-700/50 backdrop-blur-sm shadow-xl pointer-events-auto inline-block">
                <h1 className="text-sm md:text-base font-semibold text-emerald-300/90 flex items-center gap-1.5 md:gap-2 tracking-wide">
                    <MapPin size={16} className="text-emerald-400/80"/>
                    {mapConfig.name.toUpperCase()}
                </h1>
              </div>
          </div>

          <canvas 
            ref={canvasRef}
            width={CANVAS_WIDTH} 
            height={CANVAS_HEIGHT}
            className="w-full h-full object-contain cursor-crosshair"
            onMouseMove={handleMouseMove}
            onClick={handleClick}
            style={{ cursor: hoveredSpotId ? 'pointer' : 'default' }}
          />

          {/* Controls */}
          <div className="absolute bottom-8 right-8 flex gap-3 z-10">
             <button onClick={onOpenJournal} className="bg-emerald-700 p-3 rounded-full hover:bg-emerald-600 text-white shadow-lg transition transform hover:scale-105 border border-emerald-500/30" title="Open Journal"><Book size={24} /></button>
             <button onClick={handleManualSave} className="bg-emerald-600 p-3 rounded-full hover:bg-emerald-500 text-white shadow-lg transition transform hover:scale-105" title="Save Game"><Save size={24} /></button>
             <button onClick={onExit} className="bg-gray-800 p-3 rounded-full hover:bg-red-900/80 text-white border border-gray-600 shadow-lg transition transform hover:scale-105" title="Exit to Editor"><LogOut size={24} /></button>
          </div>
      </div>
    </div>
  );
};
