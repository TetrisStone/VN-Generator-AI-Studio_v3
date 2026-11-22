import type { GlbWorkerRequest, GlbWorkerResponse } from './glbOptimize.worker';

export type GlbRole = 'character' | 'chunk';

export interface OptimizeGlbOptions {
  role: GlbRole;
  maxTextureSize?: 1024 | 2048;
  quality?: number;
  fileName?: string;
}

export interface GlbOptimizationReport {
  fileName?: string;
  role: GlbRole;
  originalBytes: number;
  optimizedBytes: number;
  triangles: number;
  maxTextureResolution: number;
  clipNames: string[];
  warnings: string[];
  fallbackUsed: boolean;
  errorMessage?: string;
}

export interface OptimizeGlbResult {
  blob: Blob;
  buffer: ArrayBuffer;
  report: GlbOptimizationReport;
}

const CHARACTER_MAX_BYTES = 5 * 1024 * 1024;
const CHARACTER_MAX_TRIANGLES = 20_000;
const CHUNK_MAX_BYTES = 2 * 1024 * 1024;
const WORKER_TIMEOUT_MS = 20_000;

let workerInstance: Worker | null = null;
let nextRequestId = 1;
const pendingRequests = new Map<
  number,
  {
    resolve: (res: GlbWorkerResponse) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();

const resetWorker = (err: Error) => {
  if (workerInstance) {
    workerInstance.terminate();
    workerInstance = null;
  }
  for (const pending of pendingRequests.values()) {
    clearTimeout(pending.timer);
    pending.reject(err);
  }
  pendingRequests.clear();
};

const getWorker = (): Worker => {
  if (!workerInstance) {
    workerInstance = new Worker(new URL('./glbOptimize.worker.ts', import.meta.url), {
      type: 'module',
    });
    workerInstance.onmessage = (ev: MessageEvent<GlbWorkerResponse>) => {
      const msg = ev.data;
      const pending = pendingRequests.get(msg.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      pendingRequests.delete(msg.id);
      pending.resolve(msg);
    };
    workerInstance.onerror = (ev) => {
      resetWorker(new Error(ev.message || 'GLB optimization worker failed'));
    };
    workerInstance.onmessageerror = () => {
      resetWorker(new Error('GLB optimization worker message deserialization failed'));
    };
  }
  return workerInstance;
};

const runWorkerOptimize = (
  buffer: ArrayBuffer,
  maxTextureSize: number,
  quality: number
): Promise<GlbWorkerResponse> => {
  const id = nextRequestId++;
  const worker = getWorker();
  const transferableBuffer = buffer.slice(0);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pendingRequests.has(id)) {
        resetWorker(
          new Error(`Zeitüberschreitung (${WORKER_TIMEOUT_MS / 1000} s) bei der GLB-Optimierung`)
        );
      }
    }, WORKER_TIMEOUT_MS);
    pendingRequests.set(id, { resolve, reject, timer });
    const req: GlbWorkerRequest = {
      id,
      buffer: transferableBuffer,
      maxTextureSize,
      quality,
    };
    worker.postMessage(req, [transferableBuffer]);
  });
};

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const buildBudgetWarnings = (role: GlbRole, bytes: number, triangles: number): string[] => {
  const warnings: string[] = [];
  if (role === 'character') {
    if (bytes > CHARACTER_MAX_BYTES) {
      warnings.push(
        `Budget überschritten: Charakter-GLB ist ${formatBytes(bytes)} groß (Empfehlung: ≤ 5,00 MB).`
      );
    }
    if (triangles > CHARACTER_MAX_TRIANGLES) {
      warnings.push(
        `Budget überschritten: Charakter hat ${triangles.toLocaleString('de-DE')} Dreiecke (Empfehlung: ≤ 20.000).`
      );
    }
  } else if (bytes > CHUNK_MAX_BYTES) {
    warnings.push(
      `Budget überschritten: Chunk-GLB ist ${formatBytes(bytes)} groß (Empfehlung: ≤ 2,00 MB).`
    );
  }
  return warnings;
};

/**
 * Optimizes a GLB file in a Web Worker (dedup, prune, resample, weld, WebP textures, meshopt).
 * Falls back safely to the original file if optimization fails or drops animation clips.
 */
export const optimizeGlbBlob = async (
  input: Blob,
  options: OptimizeGlbOptions
): Promise<OptimizeGlbResult> => {
  const maxTextureSize = options.maxTextureSize ?? 1024;
  const quality = options.quality ?? 0.85;
  const rawBuffer = await input.arrayBuffer();
  const originalBytes = rawBuffer.byteLength;

  try {
    const res = await runWorkerOptimize(rawBuffer, maxTextureSize, quality);
    if (res.ok === false) {
      throw new Error(('error' in res && res.error) ? res.error : 'Unbekannter GLB-Optimierungsfehler');
    }

    const lostClip = res.originalClipNames.some((name) => !res.clipNames.includes(name));
    if (lostClip) {
      const originalBlob =
        input.type === 'model/gltf-binary'
          ? input
          : new Blob([rawBuffer], { type: 'model/gltf-binary' });
      const warnings = [
        'GLB-Optimierung verworfen, um alle Animations-Clips unverändert zu erhalten – Originaldatei gespeichert.',
        ...buildBudgetWarnings(options.role, originalBytes, res.triangles),
      ];
      return {
        blob: originalBlob,
        buffer: rawBuffer,
        report: {
          fileName: options.fileName,
          role: options.role,
          originalBytes,
          optimizedBytes: originalBytes,
          triangles: res.triangles,
          maxTextureResolution: res.maxTextureResolution,
          clipNames: res.originalClipNames,
          warnings,
          fallbackUsed: true,
        },
      };
    }

    const keepOriginal = res.buffer.byteLength >= originalBytes;
    const finalBuffer = keepOriginal ? rawBuffer : res.buffer;
    const finalBytes = finalBuffer.byteLength;
    const finalBlob =
      keepOriginal && input.type === 'model/gltf-binary'
        ? input
        : new Blob([finalBuffer], { type: 'model/gltf-binary' });

    const warnings = buildBudgetWarnings(options.role, finalBytes, res.triangles);
    if (keepOriginal) {
      warnings.unshift('Originaldatei beibehalten, da sie bereits kleiner oder gleich groß war.');
    }

    return {
      blob: finalBlob,
      buffer: finalBuffer,
      report: {
        fileName: options.fileName,
        role: options.role,
        originalBytes,
        optimizedBytes: finalBytes,
        triangles: res.triangles,
        maxTextureResolution: res.maxTextureResolution,
        clipNames: res.clipNames,
        warnings,
        fallbackUsed: false,
      },
    };
  } catch (err: any) {
    const errorMessage = err?.message || String(err);
    console.warn('GLB optimization failed, falling back to original:', err);
    const originalBlob =
      input.type === 'model/gltf-binary'
        ? input
        : new Blob([rawBuffer], { type: 'model/gltf-binary' });
    const warnings = [
      `GLB-Optimierung fehlgeschlagen (${errorMessage}) – Originaldatei wurde gespeichert.`,
      ...buildBudgetWarnings(options.role, originalBytes, 0),
    ];

    return {
      blob: originalBlob,
      buffer: rawBuffer,
      report: {
        fileName: options.fileName,
        role: options.role,
        originalBytes,
        optimizedBytes: originalBytes,
        triangles: 0,
        maxTextureResolution: 0,
        clipNames: [],
        warnings,
        fallbackUsed: true,
        errorMessage,
      },
    };
  }
};
