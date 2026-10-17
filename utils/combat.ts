
import { Character, Zone } from "../types";

export interface CombatLog {
  text: string;
  type: 'info' | 'attack' | 'damage' | 'crit' | 'error';
}

export interface ActiveCombatant extends Character {
  currentHp: number;
  status: 'active' | 'woozy' | 'dead';
  recoveryValue: number; // HP equivalent for Woozy state
  isShocked: boolean;
  tempDefenseBonus: number; // From Momentum-Check failure of opponent
  team: 'player' | 'enemy';
  stunnedTurns?: number;
  disarmedTurns?: number;
  crippledTurns?: number;
}

export const STUN_DURATION = 1;
export const DISARM_DURATION = 2;
export const CRIPPLE_DURATION = 3;

export interface DetailedRoll {
    roll: number; // The D20 result
    total: number; // Result + Modifiers
    isSuccess?: boolean;
    label?: string;
}

export interface AttackResult {
  damage: number;
  logs: CombatLog[];
  defenderBonusNextTurn: number;
  
  // Detailed Steps for Visualization
  defenseRoll: DetailedRoll;
  attackRolls: DetailedRoll[];
  woundRolls: DetailedRoll[];
  
  isCrit: boolean;
  isHeadshot: boolean;
  zoneEffect?: 'stun' | 'disarm' | 'cripple' | null;
}

// D20 Helper
export const d20 = () => Math.floor(Math.random() * 20) + 1;

// 1. Initiative
export const rollTeamInitiative = (combatants: ActiveCombatant[]): { total: number, roll: number, bestChar: string } => {
  const sorted = [...combatants].sort((a,b) => (b.stats?.ges || 0) - (a.stats?.ges || 0));
  const bestChar = sorted[0];
  const maxDex = bestChar.stats?.ges || 0;
  const roll = d20();
  return { total: maxDex + roll, roll, bestChar: bestChar.name };
};

// Phase 1: Shock Test
export const performShockTest = (c: ActiveCombatant): { shocked: boolean, log: string, rollData?: DetailedRoll } => {
  if (c.status !== 'active') return { shocked: false, log: '' }; // No shock test if already woozy

  const maxHp = c.stats?.maxHp || 10;
  const hpThreshold = maxHp * 0.25;

  if (c.currentHp < hpThreshold) {
    const roll = d20();
    const wil = c.stats?.wil || 0;
    const total = roll + wil;
    const threshold = 15;
    const success = total >= threshold;
    
    const rollData: DetailedRoll = { roll, total, isSuccess: success, label: `Shock Check (TN 15)` };

    if (success) {
      return { shocked: false, log: `${c.name} fights through the pain.`, rollData };
    } else {
      return { shocked: true, log: `${c.name} goes into SHOCK!`, rollData };
    }
  }
  return { shocked: false, log: '' };
};

// Phase 2: Execution Algorithm
export const resolveAttack = (
  attacker: ActiveCombatant, 
  defender: ActiveCombatant, 
  zone: Zone
): AttackResult => {
  
  const logs: CombatLog[] = [];
  const stats = attacker.stats!;
  const defStats = defender.stats!;
  
  let weapon = stats.weapon;
  // Disarm impacts Weapon
  if (attacker.disarmedTurns && attacker.disarmedTurns > 0) {
      weapon = { name: 'Fists', at: 1, mod: 0, dmg: 1, cap: 2 };
  }

  // Zone Mods
  let zoneMalus = 0;
  let isHeadshot = false;
  
  switch(zone) {
    case 'head': zoneMalus = 6; isHeadshot = true; break;
    case 'arm': zoneMalus = 4; break;
    case 'leg': zoneMalus = 3; break;
    default: zoneMalus = 0; // Torso
  }

  // --- Step 1: Target Number (TN) - Defense Roll ---
  let defRollVal = d20();
  
  let effectiveGes = defStats.ges;
  if (defender.crippledTurns && defender.crippledTurns > 0) {
      effectiveGes = Math.floor(effectiveGes / 2);
  }
  
  let tn = defRollVal + (defender.isShocked ? 0 : effectiveGes); 
  
  // WOOZY OVERRIDE: Evasion is 1
  if (defender.status === 'woozy') {
      defRollVal = 1;
      tn = 1; // Effectively 1 to make hitting almost guaranteed
  }

  const defenseRoll: DetailedRoll = { roll: defRollVal, total: tn, label: defender.status === 'woozy' ? 'Woozy (Defenseless)' : `Evasion (GES ${effectiveGes})` };
  
  if (defender.status === 'woozy') {
      logs.push({ text: `${defender.name} is defenseless!`, type: 'info' });
  } else {
      logs.push({ text: `${defender.name} evades: TN ${tn} (Roll ${defRollVal})`, type: 'info' });
  }

  // --- Step 2: The Salve (Hit Roll) ---
  const diceCount = weapon.at;
  const attackRolls: DetailedRoll[] = [];
  
  const hits: { total: number, isNat20: boolean }[] = [];
  let bestRoll = 0;
  let nat20 = false;
  
  const shockPenalty = attacker.currentHp < (stats.maxHp * 0.25) && !attacker.isShocked ? 2 : 0; 

  for(let i=0; i < diceCount; i++) {
    const roll = d20();
    const isNat20Hit = (roll === 20);
    if (isNat20Hit) nat20 = true;
    
    const total = roll + stats.pra + weapon.mod - zoneMalus - shockPenalty;
    const isHit = total > tn || isNat20Hit;

    attackRolls.push({ roll, total, isSuccess: isHit });

    if (isHit) {
      hits.push({ total, isNat20: isNat20Hit });
    }
    if (total > bestRoll) bestRoll = total;
  }

  logs.push({ text: `${attacker.name} attacks: [${attackRolls.map(r => r.total).join(', ')}] vs TN ${tn}`, type: 'attack' });

  // Momentum Check (Counter Advantage)
  let defenderBonusNextTurn = 0;
  if (hits.length === 0 && bestRoll < (tn - 10)) {
    defenderBonusNextTurn = 4;
    logs.push({ text: `Attack missed badly! ${defender.name} gains Counter Advantage.`, type: 'info' });
  }

  if (hits.length === 0) {
    return { 
        damage: 0, logs, defenderBonusNextTurn,
        defenseRoll, attackRolls, woundRolls: [],
        isCrit: false, isHeadshot: false
    };
  }

  // --- Step 3: Wound Roll (Durchschlag) ---
  // Note: Even if woozy, body resistance (WID) applies to damage calculation
  const threshold = 10 - (stats.str - defStats.wid);
  let confirmedWounds = 0;
  const woundRolls: DetailedRoll[] = [];

  for(let i=0; i < hits.length; i++) {
    if (hits[i].isNat20) {
      confirmedWounds++;
      woundRolls.push({ roll: 20, total: 20, isSuccess: true, label: `Crit Auto-Wound` });
    } else {
      const r = d20();
      const isWound = r > threshold;
      woundRolls.push({ roll: r, total: r, isSuccess: isWound, label: `Wound Check (> ${threshold})` });
      
      if (isWound) {
        confirmedWounds++;
      }
    }
  }

  logs.push({ text: `Wound Rolls (Need > ${threshold}): [${woundRolls.filter(r => r.label !== 'Crit Auto-Wound').map(r => r.total).join(', ')}]`, type: 'info' });
  logs.push({ text: `${confirmedWounds} Wounds confirmed.`, type: 'info' });

  if (confirmedWounds === 0) {
    logs.push({ text: `Hit but no penetration!`, type: 'info' });
    return { 
        damage: 0, logs, defenderBonusNextTurn,
        defenseRoll, attackRolls, woundRolls,
        isCrit: false, isHeadshot: false
    };
  }

  // --- Step 4: Damage Calculation ---
  let rawDamage = 0;

  for (let i = 0; i < confirmedWounds; i++) {
    let woundDmg = weapon.dmg; 
    
    // Weapon Cap Check
    if (weapon.cap !== null && woundDmg > weapon.cap) {
      woundDmg = weapon.cap;
    }
    
    rawDamage += woundDmg;
  }

  // Defender Limit Check removed - limit is used for Woozy recovery, not damage cap.
  const finalDamage = rawDamage;

  logs.push({ text: `${attacker.name} deals ${finalDamage} DAMAGE to ${defender.name}!`, type: 'damage' });

  // --- Step 5: Critical Effects ---
  let zoneEffect: 'stun' | 'disarm' | 'cripple' | null = null;
  if (nat20) {
    if (zone === 'head') {
        zoneEffect = 'stun';
        logs.push({ text: `CRITICAL HEADSHOT! ${defender.name} is stunned!`, type: 'crit' }); 
    }
    if (zone === 'arm') {
        zoneEffect = 'disarm';
        logs.push({ text: `CRITICAL HIT TO ARM! Disarmed!`, type: 'crit' });
    }
    if (zone === 'leg') {
        zoneEffect = 'cripple';
        logs.push({ text: `CRITICAL HIT TO LEG! Crippled!`, type: 'crit' });
    }
  }

  return { 
      damage: finalDamage, logs, defenderBonusNextTurn,
      defenseRoll, attackRolls, woundRolls,
      isCrit: nat20, isHeadshot: isHeadshot, zoneEffect
  };
};