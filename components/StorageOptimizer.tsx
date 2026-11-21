import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  HardDrive,
  Image as ImageIcon,
  Music,
  Video,
  Box,
  RefreshCw,
  Sparkles,
  Trash2,
  AlertTriangle,
  Loader2,
  CheckCircle2,
} from 'lucide-react';
import { OrnateFrame, FantasyButton } from './ui/Ornate';
import { formatBytes } from '../utils/optimizeGlb';
import {
  analyzeStorage,
  BatchOptimizeProgress,
  BatchOptimizeResult,
  deleteLegacyProjectBackups,
  deleteOrphanedAssets,
  optimizeAllExistingAssets,
  StorageReport,
} from '../utils/storageMaintenance';

interface StorageOptimizerProps {
  onFlushSave?: () => Promise<boolean>;
}

const KIND_LABELS = {
  image: 'Bilder',
  model: '3D-Modelle (GLB)',
  audio: 'Audio',
  video: 'Videos',
} as const;

export const StorageOptimizer: React.FC<StorageOptimizerProps> = ({ onFlushSave }) => {
  const [report, setReport] = useState<StorageReport | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isDeletingOrphans, setIsDeletingOrphans] = useState(false);
  const [progress, setProgress] = useState<BatchOptimizeProgress | null>(null);
  const [batchResult, setBatchResult] = useState<BatchOptimizeResult | null>(null);

  const onFlushSaveRef = useRef(onFlushSave);
  onFlushSaveRef.current = onFlushSave;

  const refreshReport = useCallback(async () => {
    setIsScanning(true);
    try {
      await onFlushSaveRef.current?.().catch(() => {});
      const next = await analyzeStorage();
      setReport(next);
    } catch (err) {
      console.error('Failed to analyze storage:', err);
    } finally {
      setIsScanning(false);
    }
  }, []);

  useEffect(() => {
    refreshReport();
  }, [refreshReport]);

  const handleOptimizeAll = async () => {
    if (isOptimizing || !report) return;
    const optimizableCount = report.byKind.image.count + report.byKind.model.count;
    if (optimizableCount === 0) return;

    setIsOptimizing(true);
    setBatchResult(null);
    setProgress({
      done: 0,
      total: optimizableCount,
      currentId: '',
      currentKind: 'image',
      savedBytes: 0,
    });

    try {
      await onFlushSaveRef.current?.().catch(() => {});
      const result = await optimizeAllExistingAssets((p) => setProgress(p));
      setBatchResult(result);
      await refreshReport();
    } catch (err) {
      console.error('Batch asset optimization failed:', err);
      alert('Fehler bei der nachträglichen Optimierung. Details in der Konsole.');
    } finally {
      setProgress(null);
      setIsOptimizing(false);
    }
  };

  const handleDeleteAllOrphans = async () => {
    if (!report || report.orphaned.length === 0 || isDeletingOrphans) return;
    const confirmed = window.confirm(
      `${report.orphaned.length} verwaiste Assets (${formatBytes(report.orphanedBytes)}) endgültig aus dem Browser-Speicher löschen?\n\nKeine Entität in irgendeinem Projekt verweist mehr auf diese Dateien.`
    );
    if (!confirmed) return;

    setIsDeletingOrphans(true);
    try {
      await onFlushSaveRef.current?.().catch(() => {});
      await deleteOrphanedAssets(report.orphaned.map((a) => a.id));
      await refreshReport();
    } catch (err) {
      console.error('Failed to delete orphaned assets:', err);
      alert('Löschen fehlgeschlagen. Details in der Konsole.');
    } finally {
      setIsDeletingOrphans(false);
    }
  };

  const handleDeleteLegacyBackups = async () => {
    if (!report || report.legacyBackupKeys.length === 0) return;
    const confirmed = window.confirm(
      `${report.legacyBackupKeys.length} alte Migrations-Backups (project_backup_*) löschen, um weiteren Browser-Speicher freizugeben?`
    );
    if (!confirmed) return;

    await deleteLegacyProjectBackups(report.legacyBackupKeys);
    await refreshReport();
  };

  const optimizableTotal = report ? report.byKind.image.count + report.byKind.model.count : 0;

  return (
    <OrnateFrame className="bg-gray-900/80 p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-emerald-300 flex items-center gap-2 uppercase">
            <HardDrive size={16} /> Speicher optimieren
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Übersicht über den IndexedDB-Asset-Speicher, nachträgliche Komprimierung und Bereinigung verwaister Dateien.
          </p>
        </div>
        <FantasyButton
          inline
          icon={<RefreshCw size={14} className={isScanning ? 'animate-spin' : ''} />}
          onClick={() => refreshReport()}
          disabled={isScanning || isOptimizing}
        >
          Aktualisieren
        </FantasyButton>
      </div>

      {/* Category Breakdown */}
      {report ? (
        <>
          <div className="bg-gray-950/70 border border-gray-800 rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-gray-300 font-medium">
                Gesamtverbrauch ({report.totalCount} Assets):
              </span>
              <span className="font-mono font-bold text-emerald-300 text-base">
                {formatBytes(report.totalBytes)}
              </span>
            </div>

            {report.quota && (
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-gray-400 font-mono">
                  <span>Browser-Quota belegt: {formatBytes(report.quota.usage)} / {formatBytes(report.quota.quota)}</span>
                  <span className={report.quota.freeRatio < 0.1 ? 'text-amber-400 font-bold' : ''}>
                    {Math.round(report.quota.freeRatio * 100)} % frei
                  </span>
                </div>
                <div className="w-full bg-gray-800 h-2 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all ${report.quota.freeRatio < 0.1 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    style={{ width: `${Math.min(100, Math.round((1 - report.quota.freeRatio) * 100))}%` }}
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
              <div className="bg-gray-900/90 border border-gray-800 rounded-lg p-3">
                <div className="flex items-center gap-2 text-xs text-emerald-400 font-semibold">
                  <ImageIcon size={14} /> Bilder
                </div>
                <div className="mt-1 font-mono text-sm font-bold text-white">
                  {formatBytes(report.byKind.image.bytes)}
                </div>
                <div className="text-[11px] text-gray-500">{report.byKind.image.count} Dateien</div>
              </div>

              <div className="bg-gray-900/90 border border-gray-800 rounded-lg p-3">
                <div className="flex items-center gap-2 text-xs text-cyan-400 font-semibold">
                  <Box size={14} /> 3D-Modelle
                </div>
                <div className="mt-1 font-mono text-sm font-bold text-white">
                  {formatBytes(report.byKind.model.bytes)}
                </div>
                <div className="text-[11px] text-gray-500">{report.byKind.model.count} Dateien</div>
              </div>

              <div className="bg-gray-900/90 border border-gray-800 rounded-lg p-3">
                <div className="flex items-center gap-2 text-xs text-blue-400 font-semibold">
                  <Music size={14} /> Audio
                </div>
                <div className="mt-1 font-mono text-sm font-bold text-white">
                  {formatBytes(report.byKind.audio.bytes)}
                </div>
                <div className="text-[11px] text-gray-500">{report.byKind.audio.count} Dateien</div>
              </div>

              <div className="bg-gray-900/90 border border-gray-800 rounded-lg p-3">
                <div className="flex items-center gap-2 text-xs text-purple-400 font-semibold">
                  <Video size={14} /> Videos
                </div>
                <div className="mt-1 font-mono text-sm font-bold text-white">
                  {formatBytes(report.byKind.video.bytes)}
                </div>
                <div className="text-[11px] text-gray-500">{report.byKind.video.count} Dateien</div>
              </div>
            </div>
          </div>

          {/* Batch Compression */}
          <div className="bg-gray-950/70 border border-gray-800 rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold text-white">Nachträgliche Komprimierung</h4>
                <p className="text-xs text-gray-400">
                  Komprimiert vorhandene Bilder (WebP) und 3D-Modelle (WebP-Texturen + Meshopt) ohne Verkleinerung bei bereits optimierten Dateien.
                </p>
              </div>
              <FantasyButton
                primary
                inline
                icon={isOptimizing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                onClick={handleOptimizeAll}
                disabled={isOptimizing || isScanning || optimizableTotal === 0}
              >
                {isOptimizing ? 'Optimiere...' : `Alle optimieren (${optimizableTotal})`}
              </FantasyButton>
            </div>

            {progress && (
              <div className="space-y-1.5 bg-gray-900/90 border border-emerald-800/50 rounded-lg p-3">
                <div className="flex justify-between text-xs text-gray-300">
                  <span>
                    Verarbeite {KIND_LABELS[progress.currentKind]} ({progress.done} / {progress.total})
                  </span>
                  <span className="font-mono text-emerald-400">
                    -{formatBytes(progress.savedBytes)} gespart
                  </span>
                </div>
                <div className="w-full bg-gray-800 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-emerald-500 h-full transition-all duration-150"
                    style={{ width: `${progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 100}%` }}
                  />
                </div>
              </div>
            )}

            {batchResult && (
              <div className="bg-emerald-950/30 border border-emerald-700/50 rounded-lg p-3 text-xs space-y-2">
                <div className="flex items-center gap-2 font-semibold text-emerald-300">
                  <CheckCircle2 size={15} />
                  <span>
                    Optimierung abgeschlossen: {formatBytes(batchResult.beforeBytes)} → {formatBytes(batchResult.afterBytes)}
                    {batchResult.beforeBytes > 0 && batchResult.savedBytes > 0 && (
                      <span className="ml-1.5">
                        (-{formatBytes(batchResult.savedBytes)} / -{Math.round((batchResult.savedBytes / batchResult.beforeBytes) * 100)} %)
                      </span>
                    )}
                  </span>
                </div>
                <div className="text-gray-300 font-mono text-[11px]">
                  Optimiert: {batchResult.optimizedCount} · Unverändert übersprungen: {batchResult.skippedCount} · Fehler/Fallback: {batchResult.failedCount}
                </div>
                {batchResult.warnings.length > 0 && (
                  <div className="bg-amber-950/50 border border-amber-800/60 text-amber-200 rounded p-2 max-h-28 overflow-y-auto space-y-0.5 text-[11px]">
                    {batchResult.warnings.map((w, idx) => (
                      <div key={idx}>⚠ {w}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Orphaned Assets */}
          <div className="bg-gray-950/70 border border-gray-800 rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold text-white">
                  Verwaiste Assets ({report.orphaned.length})
                </h4>
                <p className="text-xs text-gray-400">
                  Dateien in IndexedDB, auf die kein Projekt, Charakter, Szene, Karte, Kampf oder Dungeon mehr verweist ({formatBytes(report.orphanedBytes)}).
                </p>
              </div>
              <button
                type="button"
                onClick={handleDeleteAllOrphans}
                disabled={report.orphaned.length === 0 || isDeletingOrphans || isOptimizing}
                className="px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 bg-red-950/60 hover:bg-red-900/70 text-red-200 border-red-800/70 disabled:opacity-40 disabled:pointer-events-none transition-colors"
              >
                {isDeletingOrphans ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                <span>Alle verwaisten löschen</span>
              </button>
            </div>

            {report.orphaned.length > 0 ? (
              <div className="max-h-48 overflow-y-auto border border-gray-800 rounded-lg divide-y divide-gray-800/80 bg-gray-900/50">
                {report.orphaned.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 text-[10px] font-mono uppercase text-gray-300 shrink-0">
                        {item.kind}
                      </span>
                      <span className="font-mono text-gray-300 truncate" title={item.id}>
                        {item.id}
                      </span>
                      <span className="text-[11px] text-gray-500 hidden sm:inline shrink-0">
                        {item.mime}
                      </span>
                    </div>
                    <span className="font-mono text-gray-300 shrink-0">
                      {formatBytes(item.bytes)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-gray-500 italic">
                Keine verwaisten Assets gefunden.
              </div>
            )}

            {report.legacyBackupKeys.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 bg-amber-950/30 border border-amber-800/50 rounded-lg p-3 text-xs text-amber-200">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={15} className="text-amber-400 shrink-0" />
                  <span>
                    Es wurden {report.legacyBackupKeys.length} alte Migrations-Backups (<code>project_backup_*</code>) im <code>keyval</code>-Store gefunden.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleDeleteLegacyBackups}
                  className="px-2.5 py-1 rounded bg-amber-900/60 hover:bg-amber-800 text-amber-100 border border-amber-700 font-semibold transition-colors"
                >
                  Alt-Backups entfernen
                </button>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="flex items-center gap-2 text-xs text-gray-400 py-4">
          <Loader2 size={15} className="animate-spin text-emerald-500" />
          <span>Analysiere Speicherverbrauch...</span>
        </div>
      )}
    </OrnateFrame>
  );
};
