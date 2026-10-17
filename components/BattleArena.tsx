
import React, { useState, useEffect, useRef } from 'react';
import { Battle, Character, Zone, WorldInfo } from '../types';
import { ActiveCombatant, rollTeamInitiative, performShockTest, resolveAttack, CombatLog, DetailedRoll, STUN_DURATION, DISARM_DURATION, CRIPPLE_DURATION } from '../utils/combat';
import { loadImage } from '../utils/imageStorage';
import { playSynthSfx } from '../utils/audioSynth';
import { audioManager } from '../utils/audioManager';
import { Button } from './ui/Button';
import { Sword, Target, Zap, Play, Pause, Activity, List, Minimize2, BookOpen, Info, Skull, Star, Hand } from 'lucide-react';
import { AsyncImage } from './ui/AsyncImage';

const playSfx = async (url: string | null | undefined, fallback: 'hit' | 'miss' | 'crit' | 'death') => {
    if (url) {
        try {
            const resolvedUrl = await loadImage(url);
            if (resolvedUrl) {
                const a = new Audio(resolvedUrl);
                a.volume = audioManager.sfxVolume;
                a.play().catch(console.error);
                return;
            }
        } catch (e) {}
    }
    playSynthSfx(fallback, audioManager.sfxVolume);
};

interface BattleArenaProps {
  battle: Battle;
  characters: Character[]; 
  worldInfo: WorldInfo;
  onWin: () => void;
  onLose: () => void;
  onExit: () => void;
}

type BattlePhase = 'INIT' | 'COMMAND' | 'EXECUTION' | 'VICTORY' | 'DEFEAT';
type VisualState = 'idle' | 'prep' | 'hit' | 'finish' | string;

interface FloatingText {
    id: string;
    text: string;
    type: 'damage' | 'heal' | 'miss' | 'crit' | 'woozy';
    combatantId: string;
}

interface VisualRoll extends DetailedRoll {
    roll: number;
    total: number;
    isSuccess?: boolean;
    label?: string;
    skinSeed: number; // Used to pick skin deterministically
}

export const BattleArena: React.FC<BattleArenaProps> = ({ battle, characters, worldInfo, onWin, onLose, onExit }) => {
  const [phase, setPhase] = useState<BattlePhase>('INIT');
  const [combatants, setCombatants] = useState<ActiveCombatant[]>([]);
  const [turnQueue, setTurnQueue] = useState<string[]>([]); 
  const [logs, setLogs] = useState<CombatLog[]>([]);
  
  // Settings
  const [autoMode, setAutoMode] = useState(false); 
  const [isLogCollapsed, setIsLogCollapsed] = useState(false);
  const [isGuideCollapsed, setIsGuideCollapsed] = useState(true); // Default collapsed
  
  // Command State
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [selectedZone, setSelectedZone] = useState<Zone>('torso');
  const [commands, setCommands] = useState<Record<string, { targetId: string, zone: Zone }>>({});

  // --- Visual States ---
  const [floatingTexts, setFloatingTexts] = useState<FloatingText[]>([]);
  
  // New: Track sprite state per combatant
  const [combatantVisuals, setCombatantVisuals] = useState<Record<string, VisualState>>({});
  
  const [animatingAttackerId, setAnimatingAttackerId] = useState<string | null>(null); // Still used for slide logic?
  const [animatingTargetId, setAnimatingTargetId] = useState<string | null>(null);
  
  // Frame loop state for Woozy animations
  const [woozyFrame, setWoozyFrame] = useState(0);

  // DICE VISUALS
  const [activeDice, setActiveDice] = useState<VisualRoll[]>([]);
  const [showDice, setShowDice] = useState(false);
  const [diceLabel, setDiceLabel] = useState("");
  const [diceSubLabel, setDiceSubLabel] = useState(""); 

  // Control Flow State
  const [waitingForClick, setWaitingForClick] = useState(false);
  const resolveClickRef = useRef<(() => void) | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  // --- WOOZY LOOP ---
  useEffect(() => {
    const interval = setInterval(() => {
        setWoozyFrame(prev => (prev + 1) % 4); // Loop 0-3
    }, 250); // 4fps
    return () => clearInterval(interval);
  }, []);

  const setVisualState = (id: string, state: VisualState) => {
      setCombatantVisuals(prev => ({ ...prev, [id]: state }));
  };

  const addFloatingText = (combatantId: string, text: string, type: FloatingText['type']) => {
      const id = crypto.randomUUID();
      setFloatingTexts(prev => [...prev, { id, text, type, combatantId }]);
      setTimeout(() => setFloatingTexts(prev => prev.filter(ft => ft.id !== id)), 1500);
  };

  const addLog = (text: string, type: CombatLog['type']) => {
    setLogs(prev => [...prev, { text, type }]);
  };

  // --- WAIT LOGIC ---
  const autoWait = async (ms: number) => {
      return new Promise<void>(resolve => setTimeout(resolve, ms));
  };

  const waitForInput = async (autoDelayMs: number = 800) => {
      if (autoMode) {
          return new Promise<void>(resolve => setTimeout(resolve, autoDelayMs));
      } else {
          setWaitingForClick(true);
          return new Promise<void>(resolve => {
              resolveClickRef.current = resolve;
          });
      }
  };

  const handleScreenClick = () => {
      if (waitingForClick && resolveClickRef.current) {
          setWaitingForClick(false);
          const resolver = resolveClickRef.current;
          resolveClickRef.current = null;
          resolver();
      }
  };

  // --- DICE ANIMATION HELPER ---
  const visualizeRolls = async (
      label: string, 
      subLabel: string, 
      rolls: DetailedRoll[], 
      isManualTrigger: boolean 
  ) => {
      setDiceLabel(label);
      setDiceSubLabel(subLabel);
      setActiveDice([]); 
      setShowDice(true);

      if (isManualTrigger && !autoMode) {
          setDiceLabel(`Ready to ${label}`);
          await waitForInput(0); 
      }

      setDiceLabel(label); 

      const duration = 600;
      const interval = 50;
      const steps = duration / interval;
      
      for(let i=0; i<steps; i++) {
          const fakeRolls: VisualRoll[] = rolls.map(() => ({ 
              roll: Math.floor(Math.random()*20)+1, 
              total: 0,
              skinSeed: Math.random() 
          }));
          setActiveDice(fakeRolls);
          await new Promise(r => setTimeout(r, interval));
      }

      // Final Rolls with seeds
      const finalRolls: VisualRoll[] = rolls.map(r => ({ ...r, skinSeed: Math.random() }));
      setActiveDice(finalRolls);
      await waitForInput(1500);
      setShowDice(false);
  };

  // Initialize Combat
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      const parts: ActiveCombatant[] = [];
      [...battle.playerCharacterIds, ...battle.enemyCharacterIds].forEach(id => {
          const c = characters.find(char => char.id === id);
          if (c) {
              const team = battle.playerCharacterIds.includes(id) ? 'player' : 'enemy';
              parts.push({
                  ...c,
                  currentHp: c.stats?.hp || 20,
                  status: 'active',
                  recoveryValue: 0,
                  isShocked: false,
                  tempDefenseBonus: 0,
                  team,
                  stats: c.stats || { pra: 3, str: 3, wid: 3, ges: 3, wil: 3, hp: 20, maxHp: 20, limit: 10, recoveryRate: 5, weapon: { name: 'Hands', at: 3, mod: 0, dmg: 1, cap: null } }
              });
          }
      });

      if (!mounted) return;
      setCombatants(parts);

      const playerTeam = parts.filter(c => c.team === 'player');
      const enemyTeam = parts.filter(c => c.team === 'enemy');

      const pInit = rollTeamInitiative(playerTeam);
      const eInit = rollTeamInitiative(enemyTeam);

      await visualizeRolls("Player Initiative", `Best DEX: ${pInit.total - pInit.roll}`, [{ roll: pInit.roll, total: pInit.total }], true);
      await visualizeRolls("Enemy Initiative", `Best DEX: ${eInit.total - eInit.roll}`, [{ roll: eInit.roll, total: eInit.total }], false);

      addLog(`Initiative: Player ${pInit.total} vs Enemy ${eInit.total}`, 'info');

      if (pInit.total >= eInit.total) {
          startCommandPhase('player', parts);
      } else {
          startCommandPhase('enemy', parts);
      }
    };

    init();
    return () => { mounted = false; };
  }, [battle]);

  useEffect(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [logs, isLogCollapsed]);

  const startCommandPhase = (activeTeam: 'player' | 'enemy', currentCombatants: ActiveCombatant[]) => {
      setPhase('COMMAND');
      // Only include active and woozy (woozy still takes a slot to recover)
      const teamMembers = currentCombatants.filter(c => c.team === activeTeam && c.status !== 'dead');
      setTurnQueue(teamMembers.map(c => c.id));
      setCommands({}); 
      
      // Auto-skip logic is handled in executePhase or here?
      // Better to start execution if queue is purely woozy or enemies?
      
      if (activeTeam === 'enemy') {
          setTimeout(() => runEnemyAI(teamMembers, currentCombatants), 500);
      } else {
          // Check if any player members are woozy - they shouldn't block command input, but they will be auto-processed
          // Actually, we process turns one by one.
          // For simplicity in this engine: We collect commands for ALL active players at once, then execute.
          // Woozy players don't need commands.
      }
  };

  const runEnemyAI = (enemies: ActiveCombatant[], allCombatants: ActiveCombatant[]) => {
     const alivePlayers = allCombatants.filter(c => c.team === 'player' && c.status !== 'dead');
     // AI targets Woozy players too, to finish them? Yes.
     
     if (alivePlayers.length === 0) {
         executePhase(enemies, {}, allCombatants);
         return;
     }
     const aiCommands: Record<string, { targetId: string, zone: Zone }> = {};
     enemies.forEach(e => {
         if (e.status === 'active') {
             const target = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
             aiCommands[e.id] = { targetId: target.id, zone: 'torso' };
         }
     });
     setCommands(aiCommands); 
     setTimeout(() => executePhase(enemies, aiCommands, allCombatants), 1000);
  };

  const handlePlayerCommand = (attackerId: string) => {
      if (!selectedTargetId) return;
      
      // Prevent command if attacker is woozy (Safety check)
      const attacker = combatants.find(c => c.id === attackerId);
      if (attacker?.status === 'woozy') {
          // Skip input for woozy
          const nextQueue = turnQueue.filter(id => id !== attackerId);
          setTurnQueue(nextQueue);
          return;
      }

      const newCommands = { ...commands, [attackerId]: { targetId: selectedTargetId, zone: selectedZone } };
      setCommands(newCommands);
      const nextQueue = turnQueue.filter(id => id !== attackerId);
      setTurnQueue(nextQueue);
      setSelectedTargetId(null);
      setSelectedZone('torso');
      
      // All ACTIVE players have given commands?
      // Need to filter turnQueue for only active players
      const remainingActive = nextQueue.filter(id => {
          const c = combatants.find(x => x.id === id);
          return c?.status === 'active';
      });

      if (remainingActive.length === 0) {
          // If only woozy left in queue, we still execute phase to process their recovery
          executePhase(combatants.filter(c => c.team === 'player' && c.status !== 'dead'), newCommands, combatants);
      }
  };

  const executePhase = async (
      actingTeam: ActiveCombatant[], 
      activeCommands: Record<string, { targetId: string, zone: Zone }>,
      currentCombatants: ActiveCombatant[]
  ) => {
      setPhase('EXECUTION');
      let workingState = [...currentCombatants]; 

      const tickEndTurnTimers = (actorId: string) => {
          workingState = workingState.map(c => {
              if (c.id === actorId) {
                  return {
                      ...c,
                      disarmedTurns: Math.max(0, (c.disarmedTurns || 0) - 1),
                      crippledTurns: Math.max(0, (c.crippledTurns || 0) - 1)
                  };
              }
              return c;
          });
          setCombatants(workingState);
      };

      for (const actor of actingTeam) {
          const freshActor = workingState.find(c => c.id === actor.id);
          if (!freshActor || freshActor.status === 'dead') continue;
          const isPlayer = actor.team === 'player';

          // --- STUN LOGIC ---
          if (freshActor.stunnedTurns && freshActor.stunnedTurns > 0) {
              setAnimatingAttackerId(freshActor.id);
              addFloatingText(freshActor.id, "STUNNED", "crit");
              addLog(`${freshActor.name} is stunned and skips this turn!`, "crit");
              
              workingState = workingState.map(c => c.id === freshActor.id ? { ...c, stunnedTurns: Math.max(0, c.stunnedTurns! - 1) } : c);
              setCombatants(workingState);
              
              tickEndTurnTimers(actor.id);
              await waitForInput(600);
              
              setAnimatingAttackerId(null);
              continue;
          }

          // --- WOOZY LOGIC ---
          if (freshActor.status === 'woozy') {
              const recRate = freshActor.stats?.recoveryRate || 5;
              const reviveThreshold = freshActor.stats?.limit ?? 10;

              // Recover
              freshActor.recoveryValue += recRate;
              addFloatingText(freshActor.id, `+${recRate} REC`, "heal");
              
              // Check Revive
              if (freshActor.recoveryValue >= reviveThreshold) {
                  freshActor.status = 'active';
                  freshActor.currentHp = freshActor.recoveryValue;
                  freshActor.recoveryValue = 0;
                  addFloatingText(freshActor.id, "REVIVED!", "crit");
                  addLog(`${freshActor.name} stands back up!`, 'info');
              } else {
                  addFloatingText(freshActor.id, "RECOVERING...", "miss");
              }
              
              workingState = workingState.map(c => c.id === freshActor.id ? freshActor : c);
              setCombatants(workingState);
              tickEndTurnTimers(actor.id);
              await waitForInput(600);
              continue; // Skip action
          }

          // 1. Shock Test (Only active)
          const shockResult = performShockTest(freshActor);
          if (shockResult.rollData) {
             await visualizeRolls("Shock Test", `Target Number: 15`, [shockResult.rollData], isPlayer);
             if (shockResult.log) addLog(shockResult.log, 'info');
             if (freshActor.currentHp < (freshActor.stats!.maxHp * 0.25)) {
                  workingState = workingState.map(c => c.id === actor.id ? { ...c, isShocked: shockResult.shocked } : c);
             }
             if (shockResult.shocked) {
                tickEndTurnTimers(actor.id);
                addFloatingText(actor.id, "SHOCKED", "miss");
                continue; 
             }
          }

          // 2. Attack Setup
          const cmd = activeCommands[actor.id];
          if (!cmd) { tickEndTurnTimers(actor.id); continue; }
          const target = workingState.find(c => c.id === cmd.targetId);
          if (!target || target.status === 'dead') { tickEndTurnTimers(actor.id); continue; }

          // --- VISUAL: PREPARE ATTACK (Frame Change + Slide) ---
          setVisualState(actor.id, 'prep');
          setAnimatingAttackerId(actor.id);
          await waitForInput(400); // Wait for the "Charge" visual

          // Calculate
          const result = resolveAttack(freshActor, target, cmd.zone);

          // --- VISUALIZE: ROLLS ---
          const targetIsPlayer = target.team === 'player';
          if (target.status !== 'woozy') {
              await visualizeRolls(
                  `${target.name} Evades`, 
                  `Base TN (GES): ${target.stats!.ges}`, 
                  [result.defenseRoll], 
                  targetIsPlayer
              );
              await visualizeRolls(`${actor.name} Attacks`, `Target Number: ${result.defenseRoll.total}`, result.attackRolls, isPlayer);

              result.logs.forEach(l => {
                  addLog(l.text, l.type); 
              });

              if (result.woundRolls.length > 0) {
                  const threshold = 10 - (freshActor.stats!.str - target.stats!.wid);
                  await visualizeRolls("Penetration Check", `Threshold: ${threshold}`, result.woundRolls, isPlayer);
              }
          } else {
              addLog(`${actor.name} attempts execution!`, 'attack');
          }

          // --- VISUAL: EXECUTE HIT (Frame Change -> Center Screen) ---
          setVisualState(actor.id, 'hit');
          
          if (result.damage > 0 || target.status === 'woozy') {
              setAnimatingTargetId(target.id);
              
              // Audio SFX - Hit
              playSfx(actor.sfxWeaponHit, 'hit');
              if (result.isCrit) {
                  playSfx(target.sfxVoiceCrit, 'crit');
              } else {
                  playSfx(target.sfxVoiceHit, 'hit');
              }
              
              let newTargetStatus = target.status;
              let newRecoveryValue = target.recoveryValue;
              let newHp = target.currentHp;
              let finishTriggered = false;

              // Damage Application Logic
              if (target.status === 'active') {
                  newHp = Math.max(0, target.currentHp - result.damage);
                  if (newHp <= 0) {
                      newTargetStatus = 'woozy';
                      // Setting recoveryValue to 0 as requested when downed
                      newRecoveryValue = 0; 
                      addFloatingText(target.id, "DOWNED!", "woozy");
                  } else {
                      addFloatingText(target.id, `-${result.damage}`, result.isCrit ? "crit" : "damage");
                  }
              } else if (target.status === 'woozy') {
                  // Any hit on a woozy target causes instant execution
                  addFloatingText(target.id, 'FATAL', "damage");
                  finishTriggered = true;
              }

              workingState = workingState.map(c => c.id === target.id ? { 
                  ...c, 
                  currentHp: newHp,
                  status: newTargetStatus,
                  recoveryValue: newRecoveryValue
              } : c);

              setCombatants(workingState); 
              
              if (finishTriggered) {
                  await autoWait(600); // Wait for hit impact
                  setAnimatingTargetId(null);
                  
                  setVisualState(actor.id, 'idle');
                  setAnimatingAttackerId(null); // Slide back
                  await autoWait(300); // Wait for slide back

                  playSfx(target.sfxVoiceDeath, 'death');
                  addLog(`${target.name} is finished!`, 'crit');
                  
                  // Play Finish Animation Sequence
                  if (target.finishAnimation && target.finishAnimation.length > 0) {
                      for (let i = 0; i < target.finishAnimation.length; i++) {
                           setVisualState(target.id, `finish-${i}`);
                           await autoWait(250);
                      }
                  }
                  
                  // Set to DEAD
                  workingState = workingState.map(c => c.id === target.id ? { ...c, status: 'dead' } : c);
                  setCombatants(workingState);
                  addFloatingText(target.id, "EXECUTED", "crit");
                  await autoWait(1000);
              } else {
                  await waitForInput(600); // Wait for hit impact
                  setAnimatingTargetId(null);
                  
                  // Zone Effects
                  if (result.zoneEffect && newTargetStatus === 'active') {
                      let effectText = "";
                      if (result.zoneEffect === 'stun') {
                          workingState = workingState.map(c => c.id === target.id ? { ...c, stunnedTurns: STUN_DURATION } : c);
                          effectText = "STUNNED!";
                      } else if (result.zoneEffect === 'disarm') {
                          workingState = workingState.map(c => c.id === target.id ? { ...c, disarmedTurns: DISARM_DURATION } : c);
                          effectText = "DISARMED!";
                      } else if (result.zoneEffect === 'cripple') {
                          workingState = workingState.map(c => c.id === target.id ? { ...c, crippledTurns: CRIPPLE_DURATION } : c);
                          effectText = "CRIPPLED!";
                      }
                      setCombatants(workingState);
                      addFloatingText(target.id, effectText, "crit");
                      await waitForInput(600);
                  }

                  setVisualState(actor.id, 'idle');
                  setAnimatingAttackerId(null); // Slide back
                  await waitForInput(300); // Wait for slide back
              }

          } else {
              playSfx(actor.sfxWeaponMiss, 'miss');
              addFloatingText(target.id, "MISS", "miss");
              setVisualState(actor.id, 'idle');
              setAnimatingAttackerId(null); 
              await waitForInput(500);
          }
          
          tickEndTurnTimers(actor.id);
      }
      
      const justActedTeam = actingTeam.length > 0 ? actingTeam[0].team : 'player'; 
      checkWinCondition(workingState, justActedTeam);
  };

  const checkWinCondition = (currentCombs: ActiveCombatant[], lastActiveTeam: 'player' | 'enemy') => {
      // Win/Loss based on Dead status? Or Woozy too?
      // Usually, if everyone is Woozy or Dead, you lose.
      const playersAlive = currentCombs.some(c => c.team === 'player' && c.status !== 'dead');
      const enemiesAlive = currentCombs.some(c => c.team === 'enemy' && c.status !== 'dead');
      
      // Strict Check: Are all active? 
      // If all players are Woozy/Dead -> Defeat
      const playersFunctioning = currentCombs.some(c => c.team === 'player' && c.status === 'active');
      const enemiesFunctioning = currentCombs.some(c => c.team === 'enemy' && c.status === 'active');

      if (!playersAlive) { // Total wipeout
          setPhase('DEFEAT');
          return;
      }
      
      // Optional: If all players are Woozy, do we game over? 
      // Let's say yes, unless we want a crawl mechanics. For now, if no one is active, you can't act.
      if (!playersFunctioning) {
           // If everyone is woozy, the enemies will just execute them next turn.
           // So practically, it's game over unless auto-revive happens before enemy turn.
           // But enemies go next.
      }

      if (!enemiesAlive) {
          setPhase('VICTORY');
          return;
      }

      if (lastActiveTeam === 'player') startCommandPhase('enemy', currentCombs);
      else startCommandPhase('player', currentCombs);
  };

  const renderCombatant = (c: ActiveCombatant) => {
      const isDead = c.status === 'dead';
      const isWoozy = c.status === 'woozy';
      
      // Turn Highlight: Only if active
      const isTurn = turnQueue.includes(c.id) && c.status === 'active';
      const isSelected = selectedTargetId === c.id;
      
      // HP Bar Logic
      const maxHp = c.stats?.maxHp || 1;
      let hpPct = 0;
      let barColor = 'bg-green-500';

      if (isWoozy) {
          const reviveThreshold = c.stats?.limit ?? 10;
          hpPct = (c.recoveryValue / reviveThreshold) * 100;
          barColor = 'bg-emerald-500';
      } else {
          hpPct = (c.currentHp / maxHp) * 100;
          if (hpPct < 25) barColor = 'bg-red-600';
          else if (hpPct < 50) barColor = 'bg-yellow-500';
      }
      
      // Animation Logic
      const visualState = combatantVisuals[c.id] || 'idle';
      const isHitState = visualState === 'hit'; // Checking if currently in Center-Screen Mode

      // Lunge logic
      const isAttacking = animatingAttackerId === c.id && visualState !== 'hit'; 
      const isHit = animatingTargetId === c.id;
      
      const myFloatingTexts = floatingTexts.filter(ft => ft.combatantId === c.id);
      
      // Determine Image Source
      let displaySrc = c.battleIdleSrc || c.imageSrc || c.mapSpriteSrc;
      let scale = c.battleIdleScale || c.battleScale || 1;
      let offsetX = c.battleIdleOffsetX || 0;
      let offsetY = c.battleIdleOffsetY || 0;

      if (isDead) {
          displaySrc = c.finishSprite || displaySrc; // Corpse
          // If finishSprite is missing, maybe grayscale the idle?
      } else if (isWoozy) {
          if (c.woozySprites && c.woozySprites.length > 0) {
              const frameIndex = woozyFrame % c.woozySprites.length;
              displaySrc = c.woozySprites[frameIndex];
          } else {
              // Fallback for woozy if no sprite
              // Maybe rotate?
          }
      } else if (visualState === 'prep' && c.battlePrepSrc) {
          displaySrc = c.battlePrepSrc;
          scale = c.battlePrepScale || c.battleScale || 1;
          offsetX = c.battlePrepOffsetX || 0;
          offsetY = c.battlePrepOffsetY || 0;
      } else if (visualState === 'hit' && c.battleHitSrc) {
          displaySrc = c.battleHitSrc;
          scale = c.battleHitScale || c.battleScale || 1;
          offsetX = c.battleHitOffsetX || 0;
          offsetY = c.battleHitOffsetY || 0;
      }

      // Finish Animation Override
      if (visualState.startsWith('finish-') && c.finishAnimation) {
          const frameIdx = parseInt(visualState.split('-')[1]);
          if (c.finishAnimation[frameIdx]) {
              displaySrc = c.finishAnimation[frameIdx];
              scale = c.battleScale || 1; 
          }
      }

      // CSS Classes
      const lungeClass = isAttacking 
         ? (c.team === 'player' ? 'translate-x-12' : '-translate-x-12') 
         : 'translate-x-0';
      const shakeClass = isHit ? 'animate-[shake_0.5s_ease-in-out]' : '';
      
      // Woozy Visuals without sprites
      const woozyClass = isWoozy && (!c.woozySprites || c.woozySprites.length === 0) ? 'brightness-50 grayscale rotate-12 translate-y-4' : '';

      return (
          <div 
             key={c.id} 
             onClick={() => {
                 if (phase === 'COMMAND' && turnQueue.length > 0) {
                     const actorId = turnQueue[0];
                     const actor = combatants.find(a => a.id === actorId);
                     // Allow targeting Active OR Woozy enemies
                     if (actor?.team === 'player' && c.team === 'enemy' && !isDead) {
                         setSelectedTargetId(c.id);
                     }
                 }
             }}
             className={`relative w-40 md:w-56 flex flex-col items-center transition-transform duration-300 ease-out transform ${lungeClass} ${shakeClass}
                ${isDead ? 'opacity-80 grayscale contrast-125' : ''}
                ${isTurn ? 'drop-shadow-[0_0_15px_rgba(255,255,255,0.4)]' : ''}
                ${isSelected ? 'ring-2 ring-red-500 rounded-xl bg-red-900/20' : ''}
                ${!isDead && c.team === 'enemy' && phase === 'COMMAND' && turnQueue.length > 0 && combatants.find(x => x.id === turnQueue[0])?.team === 'player' ? 'cursor-pointer hover:bg-white/5 rounded-xl' : ''}
                ${isHitState ? 'opacity-0 pointer-events-none' : 'opacity-100'} 
             `}
          >
              <div className="absolute top-10 left-0 right-0 z-50 pointer-events-none flex flex-col items-center">
                  {myFloatingTexts.map(ft => (
                      <div key={ft.id} className={`text-3xl font-black animate-[floatUp_1s_ease-out_forwards] stroke-black drop-shadow-md ${ft.type === 'damage' ? 'text-red-500' : ''} ${ft.type === 'crit' ? 'text-yellow-400 text-4xl' : ''} ${ft.type === 'miss' ? 'text-gray-400' : ''} ${ft.type === 'heal' ? 'text-green-500' : ''} ${ft.type === 'woozy' ? 'text-emerald-400 text-2xl' : ''}`}>{ft.text}</div>
                  ))}
              </div>
              
              {/* Character Image Container */}
              <div className={`w-40 h-40 md:w-56 md:h-56 relative flex items-end justify-center overflow-visible transition-all ${isHit ? 'brightness-150 saturate-0 sepia' : ''} ${woozyClass}`}>
                  {displaySrc ? (
                      <AsyncImage 
                        src={displaySrc} 
                        className={`h-full w-auto max-w-none object-contain filter drop-shadow-lg ${isDead ? 'opacity-80' : ''}`} 
                        style={{ 
                          transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})`, 
                          transformOrigin: 'bottom center' 
                        }}
                      />
                  ) : (
                      <div className="w-full h-full bg-gray-700 rounded-full flex items-center justify-center text-xs text-center p-2 border-2 border-gray-500 shadow-xl">{c.name}</div>
                  )}
                  <div className="absolute top-0 right-0 flex flex-col gap-1 z-30">
                      {c.isShocked && !isWoozy && !isDead && <div className="text-yellow-400 bg-black/80 rounded-full p-2 animate-pulse"><Zap size={20}/></div>}
                      {isWoozy && <div className="text-emerald-400 bg-black/80 rounded-full p-2 animate-pulse"><Skull size={20}/></div>}
                      {c.stunnedTurns && c.stunnedTurns > 0 && !isDead ? <div className="text-yellow-400 bg-black/80 rounded-full p-2 animate-pulse" title="Stunned"><Star size={20}/></div> : null}
                      {c.disarmedTurns && c.disarmedTurns > 0 && !isDead ? <div className="text-orange-400 bg-black/80 rounded-full p-2" title={`Disarmed (${c.disarmedTurns})`}><Hand size={20}/></div> : null}
                      {c.crippledTurns && c.crippledTurns > 0 && !isDead ? <div className="text-red-500 bg-black/80 rounded-full p-2" title={`Crippled (${c.crippledTurns})`}><Activity size={20}/></div> : null}
                  </div>
              </div>
              
              <div className="bg-black/70 px-3 py-1 rounded text-xs mt-1 text-center min-w-[90px] backdrop-blur-sm border border-gray-700/50 relative z-20">
                  <div className={`font-bold truncate max-w-[120px] ${isWoozy ? 'text-emerald-300' : 'text-gray-200'} ${isDead ? 'text-red-900 line-through' : ''}`}>{c.name}</div>
              </div>

              {/* HP / Recovery Bar */}
              {!isDead && (
                  <div className="w-full max-w-[120px] h-3 bg-gray-800 rounded-full mt-2 overflow-hidden border border-gray-600 shadow-inner relative z-20">
                      <div className={`h-full transition-all duration-500 ease-out ${barColor}`} style={{ width: `${Math.min(100, hpPct)}%` }} />
                      <div className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-white drop-shadow-md">
                          {isWoozy ? Math.floor(c.recoveryValue) : c.currentHp} / {isWoozy ? (c.stats?.limit ?? 10) : maxHp}
                      </div>
                  </div>
              )}
          </div>
      );
  };

  // Helper to render die result (Sprite or CSS Box)
  const renderDie = (d: VisualRoll) => {
      const skins = worldInfo.diceConfig?.skins[d.roll] || [];
      const hasSkin = skins.length > 0;
      const skinIndex = Math.floor(d.skinSeed * skins.length);
      const skinSrc = hasSkin ? skins[skinIndex] : null;

      let dieVisual;

      if (hasSkin && skinSrc) {
          dieVisual = (
              <div className={`w-24 h-24 flex items-center justify-center ${d.roll === 20 ? 'animate-bounce' : ''}`}>
                  <AsyncImage src={skinSrc} className="w-full h-full object-contain drop-shadow-xl" />
              </div>
          );
      } else {
          dieVisual = (
            <div className={`w-20 h-20 flex items-center justify-center rounded-xl border-4 text-4xl font-bold shadow-lg transition-colors ${d.isSuccess ? 'bg-green-900 border-green-500 text-green-100' : 'bg-gray-800 border-gray-600 text-gray-400'} ${d.roll === 20 ? 'animate-bounce border-yellow-400 text-yellow-300 bg-yellow-900/50' : ''}`}>
                {d.total}
            </div>
          );
      }

      let labelStyle = "bg-black/90 border-gray-500 text-white";
      let subLabelStyle = "border-gray-600 text-gray-400";

      if (d.roll === 20) {
          labelStyle = "bg-yellow-900/90 border-yellow-400 text-yellow-300 shadow-[0_0_15px_rgba(250,204,21,0.5)]";
          subLabelStyle = "border-yellow-600 text-yellow-200/70";
      } else if (d.isSuccess) {
          labelStyle = "bg-green-900/90 border-green-500 text-green-300 shadow-[0_0_15px_rgba(34,197,94,0.5)]";
          subLabelStyle = "border-green-700 text-green-200/70";
      }

      return (
          <div className="flex flex-col items-center gap-2 animate-in slide-in-from-top-8 duration-500 fill-mode-backwards">
              {dieVisual}
              <div className={`px-4 py-1.5 rounded-full text-base font-mono font-black border flex items-center gap-2 transition-colors ${labelStyle}`}>
                  <span>{d.total}</span>
                  {d.roll !== d.total && <span className={`text-xs font-normal border-l pl-2 ${subLabelStyle}`}>raw {d.roll}</span>}
              </div>
          </div>
      );
  };

  const activePlayerCombatant = turnQueue.length > 0 ? combatants.find(c => c.id === turnQueue[0]) : null;
  // Player turn is valid if it's COMMAND phase and the active combatant is ACTIVE (not woozy/dead)
  // But wait, we filtered turnQueue to include woozy characters so they could auto-skip.
  // So we must check status here.
  const isPlayerTurn = phase === 'COMMAND' && activePlayerCombatant?.team === 'player' && activePlayerCombatant?.status === 'active';

  // If the active combatant is woozy, we shouldn't show the command interface, but `executePhase` should have picked it up?
  // No, `startCommandPhase` puts them in queue. We need to auto-trigger their turn if they are woozy.
  useEffect(() => {
      if (phase === 'COMMAND' && activePlayerCombatant?.team === 'player' && activePlayerCombatant.status === 'woozy') {
          // Auto-execute recovery for this woozy player
          // We can just trigger a "dummy" command or call executePhase directly for this single actor
          // Ideally, we pass it to executePhase immediately.
          executePhase([activePlayerCombatant], {}, combatants);
          // And remove from queue? executePhase doesn't modify turnQueue directly...
          setTurnQueue(prev => prev.slice(1));
      }
  }, [phase, activePlayerCombatant, combatants]);


  // --- SPECIAL RENDERER FOR CENTER HIT SPRITE ---
  const activeHitterId = Object.keys(combatantVisuals).find(id => combatantVisuals[id] === 'hit');
  const activeHitter = activeHitterId ? combatants.find(c => c.id === activeHitterId) : null;

  return (
    <div 
      className="fixed inset-0 z-[100] bg-black text-white flex flex-col font-sans select-none overflow-hidden"
      onClick={handleScreenClick} 
    >
       <style>{`
          @keyframes shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-5px) rotate(-5deg); } 75% { transform: translateX(5px) rotate(5deg); } }
          @keyframes floatUp { 0% { transform: translateY(0) scale(1); opacity: 1; } 100% { transform: translateY(-40px) scale(1.2); opacity: 0; } }
       `}</style>

       {/* Top Bar / Header */}
       <div className="absolute top-0 left-0 right-0 z-40 p-4 flex justify-between items-center bg-gradient-to-b from-black/90 to-transparent pointer-events-none">
           <h2 className="text-2xl font-bold flex items-center gap-2 text-red-500 drop-shadow-md"><Sword size={24}/> {battle.name}</h2>
           <div className="flex items-center gap-4 pointer-events-auto">
               <button onClick={(e) => { e.stopPropagation(); setAutoMode(!autoMode); }} className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold border transition-all ${autoMode ? 'bg-emerald-600 border-emerald-400 text-white' : 'bg-gray-800 border-gray-600 text-gray-400'}`}>
                   {autoMode ? <Play size={14} fill="currentColor"/> : <Pause size={14} fill="currentColor"/>} {autoMode ? 'AUTO' : 'MANUAL'}
               </button>
               <Button onClick={onExit} variant="secondary" className="text-xs py-1 border-red-900 text-red-200 hover:bg-red-900/20">Flee</Button>
           </div>
       </div>

       {/* FULL SCREEN BATTLE AREA - NOW WITH 16:9 RATIO ENFORCEMENT */}
       <div className="relative w-full h-full flex items-center justify-center overflow-hidden bg-black">
           
           {/* Aspect Ratio Container */}
           <div className="relative w-full max-w-[177.78vh] aspect-video bg-gray-900 shadow-2xl overflow-hidden border border-gray-800">
               
               {/* Background */}
               <div className="absolute inset-0 z-0">
                   {battle.backgroundSrc ? <AsyncImage src={battle.backgroundSrc} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-red-950/40 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-gray-800 to-black" />}
                   <div className="absolute inset-0 bg-black/20"></div>
               </div>
               
               {/* Characters Layer */}
               <div className="relative z-10 w-full h-full flex flex-col md:flex-row items-center justify-between px-[8%] md:px-[10%] gap-8 pointer-events-none">
                   <div className="flex flex-col -space-y-12 md:-space-y-20 items-center justify-center min-w-[150px] pointer-events-auto py-12">{combatants.filter(c => c.team === 'player').map(renderCombatant)}</div>
                   <div className="flex flex-col -space-y-12 md:-space-y-20 items-center justify-center min-w-[150px] pointer-events-auto py-12">{combatants.filter(c => c.team === 'enemy').map(renderCombatant)}</div>
               </div>

               {/* Center Status / Victory Messages */}
               <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
                  {phase === 'VICTORY' && <div className="text-center animate-bounce pointer-events-auto bg-black/70 p-8 rounded-2xl backdrop-blur-xl border border-yellow-500/50 shadow-2xl"><h1 className="text-6xl font-black text-yellow-400 mb-4 drop-shadow-lg">VICTORY</h1><Button onClick={onWin} className="bg-yellow-600 hover:bg-yellow-500 text-xl px-12 py-4 font-bold shadow-lg shadow-yellow-900/50">Continue Journey</Button></div>}
                  {phase === 'DEFEAT' && <div className="text-center pointer-events-auto bg-black/70 p-8 rounded-2xl backdrop-blur-xl border border-red-500/50 shadow-2xl"><h1 className="text-6xl font-black text-red-600 mb-4 drop-shadow-lg">DEFEAT</h1><Button onClick={onLose} variant="danger" className="text-xl px-12 py-4 font-bold shadow-lg shadow-red-900/50">Try Again</Button></div>}
               </div>

               {/* --- CENTER HIT SPRITE OVERLAY (NOW MATCHING SIZE) --- */}
               {activeHitter && (
                 <div className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none animate-in zoom-in-75 duration-100">
                    <div 
                      className="relative transition-transform" 
                      style={{ transform: `scale(${activeHitter.battleHitScale || activeHitter.battleScale || 1})` }}
                    >
                        {activeHitter.battleHitSrc ? (
                            <AsyncImage 
                                src={activeHitter.battleHitSrc} 
                                className="h-40 md:h-56 w-auto object-contain drop-shadow-[0_0_50px_rgba(255,255,255,0.3)] filter brightness-110" 
                            />
                        ) : (
                            // Fallback if no hit sprite is defined
                            <AsyncImage 
                                src={activeHitter.battleIdleSrc || activeHitter.imageSrc || activeHitter.mapSpriteSrc} 
                                className="h-40 md:h-56 w-auto object-contain drop-shadow-[0_0_50px_rgba(255,255,255,0.3)] filter brightness-110"
                            />
                        )}
                    </div>
                 </div>
               )}

               {/* Command Interface (Inside 16:9 Frame) */}
               {isPlayerTurn && (
                  <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-30 w-[95%] max-w-2xl pointer-events-auto">
                     <div className="bg-black/70 backdrop-blur-md border border-emerald-500/30 rounded-2xl p-4 shadow-2xl animate-in slide-in-from-bottom-10 fade-in duration-300">
                        <div className="flex items-center justify-between mb-3 border-b border-white/10 pb-2">
                           <div className="text-lg font-bold text-emerald-300 flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_10px_#10b981]"></div> 
                              Command: <span className="text-white">{activePlayerCombatant?.name}</span>
                           </div>
                           {!selectedTargetId && <div className="text-xs text-yellow-400 animate-pulse font-bold uppercase tracking-wider flex items-center gap-2"><Target size={14}/> Select Enemy Target</div>}
                        </div>

                        {selectedTargetId ? (
                            <div className="flex flex-col md:flex-row gap-4 items-center">
                                <div className="flex-1 flex gap-2 w-full overflow-x-auto pb-1 md:pb-0 custom-scrollbar justify-center">
                                    {/* Horizontal Zone Selection */}
                                    {[
                                        { id: 'torso', label: 'Torso', mod: 0 },
                                        { id: 'head', label: 'Head', mod: -6, color: 'text-red-300' },
                                        { id: 'arm', label: 'Arm', mod: -4 },
                                        { id: 'leg', label: 'Leg', mod: -3 }
                                    ].map((z) => (
                                        <button 
                                            key={z.id}
                                            onClick={() => setSelectedZone(z.id as Zone)}
                                            className={`
                                                flex flex-col items-center justify-center px-4 py-2 rounded-lg border transition-all min-w-[80px]
                                                ${selectedZone === z.id 
                                                    ? 'bg-emerald-600 border-emerald-400 text-white shadow-lg scale-105' 
                                                    : 'bg-gray-800/50 border-gray-600 text-gray-400 hover:bg-gray-700 hover:text-white'
                                                }
                                            `}
                                        >
                                            <span className="font-bold text-sm">{z.label}</span>
                                            <span className={`text-[10px] ${z.color || 'opacity-50'}`}>{z.mod === 0 ? '-' : z.mod}</span>
                                        </button>
                                    ))}
                                </div>
                                <Button onClick={() => handlePlayerCommand(turnQueue[0])} className="w-full md:w-auto bg-red-600 hover:bg-red-500 shadow-lg shadow-red-900/40 py-3 px-8 text-sm font-bold tracking-wider whitespace-nowrap h-full flex items-center gap-2">
                                    <Sword size={18} className="animate-pulse"/> ATTACK
                                </Button>
                            </div>
                        ) : (
                            <div className="text-center text-gray-400 text-sm py-2 italic">
                                Click on an enemy sprite to target them.
                            </div>
                        )}
                     </div>
                  </div>
               )}

                {/* Enemy Turn Indicator (Top Center Toast) */}
               {phase === 'COMMAND' && !isPlayerTurn && (
                   <div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-30">
                       <div className="bg-black/60 backdrop-blur border border-red-500/30 text-red-200 px-6 py-2 rounded-full flex items-center gap-3 shadow-xl animate-pulse">
                           <Activity size={16} className="animate-spin"/> Enemy Turn
                       </div>
                   </div>
               )}

           </div>
       </div>

       {/* Floating UI Elements (Outside of 16:9 Frame to save space) */}

       {/* Floating Combat Log (Bottom Right) */}
       <div 
         className={`absolute bottom-4 right-4 z-50 bg-black/80 backdrop-blur-md border border-gray-700 shadow-2xl transition-all duration-300 ease-in-out overflow-hidden flex flex-col
            ${isLogCollapsed ? 'w-10 h-10 rounded-full cursor-pointer hover:bg-gray-800 hover:border-gray-500' : 'w-80 h-64 rounded-xl'}
         `}
         onClick={() => isLogCollapsed && setIsLogCollapsed(false)}
       >
           <div className={`flex items-center justify-between p-2 ${!isLogCollapsed ? 'border-b border-gray-700 bg-black/40' : 'h-full justify-center'}`}>
               {!isLogCollapsed && <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2"><List size={12}/> Combat Log</span>}
               <button 
                  onClick={(e) => { e.stopPropagation(); setIsLogCollapsed(!isLogCollapsed); }}
                  className="text-gray-400 hover:text-white transition-colors"
               >
                   {isLogCollapsed ? <List size={16}/> : <Minimize2 size={14}/>}
               </button>
           </div>
           
           {!isLogCollapsed && (
               <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 font-mono text-[10px] space-y-1 custom-scrollbar bg-black/20">
                   {logs.length === 0 && <div className="text-gray-600 italic text-center mt-4">Battle started...</div>}
                   {logs.map((log, i) => (
                       <div key={i} className={`leading-tight ${log.type === 'attack' ? 'text-blue-300' : ''} ${log.type === 'damage' ? 'text-red-400 font-bold' : ''} ${log.type === 'crit' ? 'text-yellow-400 font-bold' : ''} ${log.type === 'info' ? 'text-gray-500' : ''}`}>
                           {log.text}
                       </div>
                   ))}
               </div>
           )}
       </div>

       {/* Battle Guide (Top Left) */}
       <div 
         className={`absolute top-20 left-4 z-50 bg-black/80 backdrop-blur-md border border-gray-700 shadow-2xl transition-all duration-300 ease-in-out overflow-hidden flex flex-col
            ${isGuideCollapsed ? 'w-10 h-10 rounded-full cursor-pointer hover:bg-gray-800 hover:border-gray-500' : 'w-80 h-96 rounded-xl'}
         `}
         onClick={() => isGuideCollapsed && setIsGuideCollapsed(false)}
       >
           <div className={`flex items-center justify-between p-2 ${!isGuideCollapsed ? 'border-b border-gray-700 bg-emerald-900/20' : 'h-full justify-center'}`}>
               {!isGuideCollapsed && <span className="text-[10px] font-bold text-emerald-300 uppercase tracking-widest flex items-center gap-2"><BookOpen size={12}/> Kampf-Handbuch</span>}
               <button 
                  onClick={(e) => { e.stopPropagation(); setIsGuideCollapsed(!isGuideCollapsed); }}
                  className="text-emerald-300 hover:text-white transition-colors"
                  title="Battle Guide"
               >
                   {isGuideCollapsed ? <Info size={16}/> : <Minimize2 size={14}/>}
               </button>
           </div>
           
           {!isGuideCollapsed && (
               <div className="flex-1 overflow-y-auto p-4 font-sans text-xs space-y-4 custom-scrollbar bg-black/20 text-gray-300">
                   <div className="space-y-1">
                      <h4 className="font-bold text-emerald-400 text-sm border-b border-gray-700 pb-1">1. Attribute</h4>
                      <p><span className="text-white font-bold">GES (Geschick):</span> Bestimmt Initiative & Ausweichen (Verteidigungswert).</p>
                      <p><span className="text-white font-bold">PRA (Präzision):</span> Bestimmt Trefferchance.</p>
                      <p><span className="text-white font-bold">STR (Stärke):</span> Erhöht Durchschlag (Wund-Wahrscheinlichkeit).</p>
                      <p><span className="text-white font-bold">WID (Widerstand):</span> Rüstung gegen Wunden.</p>
                      <p><span className="text-white font-bold">WIL (Wille):</span> Schutz gegen Schock.</p>
                   </div>
                   {/* ... abbreviated guide text ... */}
                   <div className="space-y-1">
                      <h4 className="font-bold text-emerald-400 text-sm border-b border-gray-700 pb-1">5. Schaden</h4>
                      <p>Jede bestätigte Wunde verursacht den Waffenschaden (DMG).</p>
                   </div>
               </div>
           )}
       </div>

       {/* DICE OVERLAY */}
       {showDice && (
           <div className="absolute inset-0 z-[60] flex items-center justify-center pointer-events-none">
               <div className="bg-black/80 backdrop-blur-md p-8 rounded-2xl flex flex-col items-center gap-4 animate-in zoom-in duration-300 border border-white/20 shadow-2xl min-w-[320px]">
                   <div className="text-xl font-bold uppercase tracking-widest text-white drop-shadow-md w-full text-center border-b border-gray-600 pb-2">{diceLabel}</div>
                   {diceSubLabel && <div className="text-sm text-gray-400 -mt-2">{diceSubLabel}</div>}
                   <div className="flex gap-4 flex-wrap justify-center">
                       {activeDice.length === 0 ? (
                           <div className="flex gap-2"><div className="w-16 h-16 rounded-lg bg-gray-800/50 border-2 border-dashed border-gray-500 flex items-center justify-center text-gray-500 font-bold">?</div></div>
                       ) : (
                           activeDice.map((d, i) => (
                               <div key={i}>
                                   {renderDie(d)}
                               </div>
                           ))
                       )}
                   </div>
               </div>
           </div>
       )}
    </div>
  );
};
