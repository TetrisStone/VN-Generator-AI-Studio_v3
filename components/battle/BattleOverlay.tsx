// Battle HUD: AP, action menu, HP/Kraft bars, damage preview, banner, floaters.
import React, { useEffect } from 'react';
import { Shield, Swords, Zap, Sparkles, Heart, Skull, Hourglass } from 'lucide-react';
import { getAbility } from '../../battle/abilities';
import {
  actionApCost, actionMultiplier, actionUnavailableReason, getCombatant, needsSingleTarget, previewDamage,
} from '../../battle/engine';
import { AP_PER_TURN, DIZZY_RECOVERY_PULSES } from '../../battle/config';
import type { ActionId, BattleState, Combatant } from '../../battle/types';
import type { BattleApi, BattleUi } from './useBattleScene';

const ACTION_META: Record<Exclude<ActionId, 'ability'>, { label: string; icon: React.ReactNode; key: string }> = {
  normal_hit: { label: 'Normaler Hit', icon: <Swords size={15} />, key: '1' },
  heavy_hit: { label: 'Starker Hit', icon: <Zap size={15} />, key: '2' },
  block: { label: 'Block', icon: <Shield size={15} />, key: '3' },
};

const pct = (v: number, max: number) => `${Math.max(0, Math.min(100, (v / Math.max(1, max)) * 100))}%`;

function Bar({ value, max, color, height = 6 }: { value: number; max: number; color: string; height?: number }) {
  return (
    <div className="w-full bg-black/60 rounded-full overflow-hidden border border-white/10" style={{ height }}>
      <div className="h-full rounded-full transition-all duration-300" style={{ width: pct(value, max), background: color }} />
    </div>
  );
}

function StatusTag({ c }: { c: Combatant }) {
  if (c.status === 'defeated') return <span className="text-[9px] font-bold text-gray-400 flex items-center gap-0.5"><Skull size={10} /> besiegt</span>;
  if (c.status === 'dizzy') {
    return (
      <span className="text-[9px] font-bold text-yellow-300">
        wankt{c.side === 'hero' ? ` · Spark ${c.recovery}/${DIZZY_RECOVERY_PULSES}` : ''}
      </span>
    );
  }
  if (c.damageFactor < 1) return <span className="text-[9px] font-bold text-sky-300 flex items-center gap-0.5"><Shield size={9} /> Block</span>;
  if (c.atkBuff > 0) return <span className="text-[9px] font-bold text-orange-300">ATK +{Math.round(c.atkBuff * 100)} %</span>;
  return null;
}

/** Small nameplate floating above each figure */
function Nameplate({ c, x, y, isTarget, isSelected, preview, onEnter, onLeave, onClick }: {
  c: Combatant; x: number; y: number; isTarget: boolean; isSelected: boolean;
  preview: string | null; onEnter: () => void; onLeave: () => void; onClick: () => void;
}) {
  if (c.status === 'defeated') return null;
  const enemy = c.side === 'enemy';
  const ring = isSelected ? 'border-sky-300 shadow-sky-500/40' : isTarget ? 'border-yellow-300 shadow-yellow-500/40' : enemy ? 'border-orange-500/50' : 'border-cyan-500/50';
  return (
    <div
      className={`absolute -translate-x-1/2 -translate-y-full pointer-events-auto cursor-pointer select-none bg-gray-950/85 backdrop-blur-sm border rounded-lg px-2 py-1 shadow-lg ${ring}`}
      style={{ left: x, top: y, width: 118 }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={onClick}
    >
      <div className="flex items-center justify-between gap-1">
        <span className={`text-[10px] font-bold truncate ${enemy ? 'text-orange-200' : c.isSpark ? 'text-amber-200' : 'text-cyan-100'}`}>{c.name}</span>
        <StatusTag c={c} />
      </div>
      <div className="flex items-center gap-1 mt-0.5">
        <Heart size={9} className="text-rose-400 shrink-0" />
        <Bar value={c.hp} max={c.stats.maxHp} color={c.status === 'dizzy' ? '#a3a3a3' : enemy ? '#ef4444' : '#22c55e'} />
        <span className="text-[9px] text-gray-300 tabular-nums w-11 text-right">{c.hp}/{c.stats.maxHp}</span>
      </div>
      {enemy && c.stats.maxKraft > 0 && (
        <div className="flex items-center gap-1 mt-0.5">
          <Zap size={9} className="text-amber-300 shrink-0" />
          <Bar value={c.kraft} max={c.stats.maxKraft} color="#f59e0b" height={5} />
          <span className="text-[9px] text-gray-300 tabular-nums w-11 text-right">{c.kraft}/{c.stats.maxKraft}</span>
        </div>
      )}
      {preview && (
        <div className={`mt-1 text-center text-[10px] font-extrabold rounded px-1 ${preview.startsWith('GNADEN') ? 'bg-rose-600 text-white' : 'bg-yellow-400 text-black'}`}>
          {preview}
        </div>
      )}
    </div>
  );
}

function previewText(s: BattleState, actorId: string | null, actionId: ActionId | null, targetId: string): string | null {
  if (!actorId || !actionId) return null;
  const actor = getCombatant(s, actorId);
  const target = getCombatant(s, targetId);
  if (!actor || !target) return null;
  const ap = actionApCost(actor, actionId);
  const mult = actionMultiplier(actor, actionId);
  if (mult === null || target.side === actor.side) {
    const ab = actionId === 'ability' ? getAbility(actor.stats.abilityId) : undefined;
    return `${ab?.name ?? 'Aktion'} · ${ap} AP`;
  }
  const p = previewDamage(s, actorId, targetId, mult);
  if (!p) return null;
  if (p.coupDeGrace) return `GNADENSTOSS · ${ap} AP`;
  return `${p.min === p.max ? p.min : `${p.min}–${p.max}`} Schaden · ${ap} AP`;
}

export function BattleOverlay({ ui, api }: { ui: BattleUi; api: BattleApi }) {
  const s = ui.state;

  // Keyboard: 1–4 actions, Enter/Space end turn, Esc cancel target
  useEffect(() => {
    if (!ui.active) return;
    const onKey = (e: KeyboardEvent) => {
      if (!ui.inputEnabled) return;
      if (e.key === '1') api.selectAction('normal_hit');
      else if (e.key === '2') api.selectAction('heavy_hit');
      else if (e.key === '3') api.selectAction('block');
      else if (e.key === '4') api.selectAction('ability');
      else if (e.key === 'Enter') api.endTurn();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [ui.active, ui.inputEnabled, api]);

  if (!ui.active && !ui.defeatText) return null;

  const heroes = s ? s.combatants.filter(c => c.side === 'hero') : [];
  const actor = s && ui.selectedId ? getCombatant(s, ui.selectedId) : undefined;
  const ability = actor ? getAbility(actor.stats.abilityId) : undefined;
  const playerTurn = s?.turn === 'hero';
  const spark = heroes.find(h => h.isSpark);
  const actionIds: ActionId[] = ['normal_hit', 'heavy_hit', 'block', ...(ability ? (['ability'] as ActionId[]) : [])];

  return (
    <div className="absolute inset-0 z-40 pointer-events-none font-sans">
      {/* Banner */}
      {ui.banner && (
        <div className="absolute inset-x-0 top-[18%] flex justify-center">
          <div className={`px-10 py-3 rounded-2xl text-3xl md:text-4xl font-black tracking-wide shadow-2xl border-2 backdrop-blur-md animate-pulse
            ${ui.banner.tone === 'hero' ? 'bg-cyan-950/80 border-cyan-400 text-cyan-100'
              : ui.banner.tone === 'enemy' ? 'bg-rose-950/80 border-rose-500 text-rose-100'
              : ui.banner.tone === 'victory' ? 'bg-amber-900/80 border-amber-300 text-amber-50'
              : 'bg-gray-900/80 border-gray-500 text-gray-100'}`}>
            {ui.banner.text}
          </div>
        </div>
      )}

      {/* Defeat text */}
      {ui.defeatText && (
        <div className="absolute inset-0 bg-black/75 flex items-center justify-center px-6">
          <div className="max-w-lg text-center">
            <Sparkles className="mx-auto text-amber-300 mb-3" size={36} />
            <div className="text-2xl font-black text-amber-100 mb-2">Niederlage</div>
            <div className="text-gray-200">{ui.defeatText}</div>
          </div>
        </div>
      )}

      {s && ui.active && (
        <>
          {/* Nameplates */}
          {s.combatants.map(c => {
            const a = ui.anchors[c.id];
            if (!a) return null;
            const isTarget = ui.validTargetIds.includes(c.id);
            return (
              <Nameplate
                key={c.id}
                c={c}
                x={a.x}
                y={a.y}
                isTarget={isTarget}
                isSelected={ui.selectedId === c.id}
                preview={isTarget && ui.hoverTargetId === c.id ? previewText(s, ui.selectedId, ui.actionId, c.id) : null}
                onEnter={() => api.hoverTarget(c.id)}
                onLeave={() => api.hoverTarget(null)}
                onClick={() => (isTarget ? api.chooseTarget(c.id) : api.selectActor(c.id))}
              />
            );
          })}

          {/* Floating numbers */}
          {ui.floaters.map(f => (
            <div
              key={f.id}
              className="absolute -translate-x-1/2 battle-floater font-black drop-shadow-[0_2px_2px_rgba(0,0,0,0.9)] whitespace-nowrap"
              style={{
                left: f.x,
                top: f.y,
                fontSize: f.kind === 'damage' ? 26 : f.kind === 'coup' ? 22 : 15,
                color: f.kind === 'damage' ? '#fff1f2' : f.kind === 'heal' ? '#86efac' : f.kind === 'coup' ? '#fb7185' : f.kind === 'kraft' ? '#fcd34d' : f.kind === 'block' ? '#7dd3fc' : '#e5e7eb',
                WebkitTextStroke: f.kind === 'damage' ? '1px #b91c1c' : undefined,
              }}
            >
              {f.text}
            </div>
          ))}

          {/* Top: round / turn / Spark mode */}
          <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2">
            <div className="bg-gray-950/85 border border-gray-700 rounded-xl px-3 py-1.5 text-xs font-bold text-gray-200 flex items-center gap-2">
              <span>Runde {s.round}</span>
              <span className={playerTurn ? 'text-cyan-300' : 'text-rose-300'}>{playerTurn ? 'Dein Zug' : 'Gegnerzug'}</span>
              {!ui.inputEnabled && <Hourglass size={12} className="text-gray-400 animate-spin" />}
            </div>
            {spark && (
              <div
                className={`rounded-xl px-3 py-1.5 text-xs font-bold flex items-center gap-1.5 border ${s.sparkMode === 'heal' ? 'bg-emerald-950/85 border-emerald-500 text-emerald-200' : 'bg-amber-950/85 border-amber-500 text-amber-200'}`}
                title={s.sparkMode === 'heal' ? 'Spark heilt den am längsten wankenden Helden (kein Kraftentzug)' : 'Spark entzieht jedem aktiven Gegner Kraft'}
              >
                <Sparkles size={13} className={s.sparkMode === 'heal' ? '' : 'animate-pulse'} />
                Spark: {s.sparkMode === 'heal' ? 'Heilen' : 'Kraftentzug'}
                <span className="text-gray-300 font-semibold ml-1">{spark.hp}/{spark.stats.maxHp} LP</span>
              </div>
            )}
          </div>

          {/* Bottom-left: party list */}
          <div className="absolute left-3 bottom-3 w-60 pointer-events-auto space-y-1.5">
            {heroes.map(h => {
              const selectable = playerTurn && ui.inputEnabled && !h.isSpark && h.status === 'active';
              return (
                <button
                  key={h.id}
                  disabled={!selectable}
                  onClick={() => api.selectActor(h.id)}
                  className={`w-full text-left bg-gray-950/85 border rounded-lg px-2.5 py-1.5 transition-colors
                    ${ui.selectedId === h.id ? 'border-sky-300 bg-sky-950/70' : 'border-gray-700'}
                    ${selectable ? 'hover:border-sky-400' : 'opacity-80 cursor-default'}`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-bold ${h.isSpark ? 'text-amber-200' : 'text-cyan-100'}`}>{h.isSpark ? '✦ ' : ''}{h.name}</span>
                    <StatusTag c={h} />
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <Bar value={h.hp} max={h.stats.maxHp} color={h.status === 'dizzy' ? '#a3a3a3' : h.isSpark ? '#fbbf24' : '#22c55e'} height={7} />
                    <span className="text-[10px] text-gray-300 tabular-nums w-14 text-right">{h.hp}/{h.stats.maxHp}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Bottom-center: AP + action menu */}
          {playerTurn && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 pointer-events-auto">
              <div className="bg-gray-950/90 border border-cyan-700/60 rounded-2xl px-4 py-3 shadow-2xl backdrop-blur-md min-w-[420px]">
                <div className="flex items-center justify-between mb-2 gap-4">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mr-1">AP</span>
                    {Array.from({ length: AP_PER_TURN }, (_, k) => (
                      <span key={k} className={`w-4 h-4 rounded-full border-2 ${k < s.ap ? 'bg-cyan-400 border-cyan-200 shadow-[0_0_8px_#22d3ee]' : 'bg-gray-800 border-gray-600'}`} />
                    ))}
                    <span className="text-xs font-bold text-cyan-200 ml-1 tabular-nums">{s.ap}/{AP_PER_TURN}</span>
                  </div>
                  <div className="text-xs text-gray-300 truncate">
                    {actor ? <>Aktiv: <b className="text-sky-200">{actor.name}</b> <span className="text-gray-500">(ATK {actor.stats.atk} · DEF {actor.stats.def})</span></> : 'Wähle eine Figur'}
                  </div>
                </div>
                <div className="flex gap-2">
                  {actionIds.map(id => {
                    const reason = actor ? actionUnavailableReason(s, actor.id, id) : 'Keine Figur gewählt.';
                    const disabled = !ui.inputEnabled || !!reason;
                    const meta = id === 'ability'
                      ? { label: ability?.name ?? 'Fähigkeit', icon: <Sparkles size={15} />, key: '4' }
                      : ACTION_META[id];
                    const cost = actor ? actionApCost(actor, id) : id === 'heavy_hit' ? 2 : 1;
                    const chosen = ui.actionId === id;
                    const title = reason
                      ? `${meta.label}: ${reason}`
                      : id === 'ability' && ability ? `${ability.name}: ${ability.description}` : meta.label;
                    return (
                      <button
                        key={id}
                        disabled={disabled}
                        title={title}
                        onClick={() => (chosen ? api.cancel() : api.selectAction(id))}
                        className={`flex-1 min-w-[88px] rounded-xl border px-2 py-2 text-left transition-all
                          ${chosen ? 'bg-yellow-400 text-black border-yellow-200' : disabled ? 'bg-gray-900 text-gray-600 border-gray-800' : 'bg-gray-800 text-gray-100 border-gray-600 hover:border-cyan-400 hover:bg-gray-700'}`}
                      >
                        <div className="flex items-center gap-1.5 text-xs font-bold">{meta.icon}{meta.label}</div>
                        <div className="text-[10px] mt-0.5 opacity-80">{cost} AP · [{meta.key}]{actor?.usedActions.includes(id) ? ' · benutzt' : ''}</div>
                      </button>
                    );
                  })}
                  <button
                    disabled={!ui.inputEnabled}
                    onClick={() => api.endTurn()}
                    className="rounded-xl border px-3 py-2 text-xs font-bold bg-rose-900/70 border-rose-600 text-rose-100 hover:bg-rose-800 disabled:opacity-40"
                    title="Zug beenden [Enter] – nicht genutzte AP verfallen"
                  >
                    Zug<br />beenden
                  </button>
                </div>
                <div className="text-[10px] text-gray-400 mt-2 h-3.5">
                  {ui.message
                    ? <span className="text-rose-300">{ui.message}</span>
                    : ui.actionId && actor
                      ? needsSingleTarget(actor, ui.actionId) ? 'Ziel anklicken (Feld oder Namensschild) · Rechtsklick/Esc bricht ab' : ''
                      : 'Figur → Aktion → Ziel. Jede Aktions-ID einmal pro Figur und Zug.'}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default BattleOverlay;
