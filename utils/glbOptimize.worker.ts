import { WebIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

export interface GlbWorkerRequest {
  id: number;
  buffer: ArrayBuffer;
  maxTextureSize: number;
  quality: number;
}

export interface GlbWorkerSuccess {
  id: number;
  ok: true;
  buffer: ArrayBuffer;
  triangles: number;
  maxTextureResolution: number;
  clipNames: string[];
  originalClipNames: string[];
}

export interface GlbWorkerError {
  id: number;
  ok: false;
  error: string;
}

export type GlbWorkerResponse = GlbWorkerSuccess | GlbWorkerError;

const countDocumentTriangles = (doc: ReturnType<WebIO['readBinary']> extends Promise<infer D> ? D : never): number => {
  let triangles = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const mode = prim.getMode();
      const indices = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      const count = indices ? indices.getCount() : pos ? pos.getCount() : 0;
      if (mode === 4) {
        triangles += Math.floor(count / 3);
      } else if (mode === 5 || mode === 6) {
        triangles += Math.max(0, count - 2);
      }
    }
  }
  return triangles;
};

self.onmessage = async (ev: MessageEvent<GlbWorkerRequest>) => {
  const { id, buffer, maxTextureSize, quality } = ev.data;
  try {
    await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);

    const io = new WebIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({
        'meshopt.decoder': MeshoptDecoder,
        'meshopt.encoder': MeshoptEncoder,
      });

    const doc = await io.readBinary(new Uint8Array(buffer));
    const originalClipNames = doc
      .getRoot()
      .listAnimations()
      .map((anim) => anim.getName());

    // Geometry & animation cleanup without altering skeleton/rigging or clip names
    await doc.transform(dedup(), prune(), resample(), weld());

    // Browser-native texture compression to WebP using createImageBitmap + OffscreenCanvas
    let maxTextureResolution = 0;
    let hasWebPTexture = false;

    for (const tex of doc.getRoot().listTextures()) {
      const img = tex.getImage();
      if (!img || img.byteLength === 0) continue;

      const mime = (tex.getMimeType() || 'image/png').toLowerCase();
      if (mime === 'image/webp') {
        hasWebPTexture = true;
      }

      let bitmap: ImageBitmap | null = null;
      try {
        bitmap = await createImageBitmap(new Blob([new Uint8Array(img)], { type: mime }));
        const origLongest = Math.max(bitmap.width, bitmap.height);
        const scale = origLongest > maxTextureSize ? maxTextureSize / origLongest : 1;
        const targetW = Math.max(1, Math.round(bitmap.width * scale));
        const targetH = Math.max(1, Math.round(bitmap.height * scale));
        const needsResize = targetW !== bitmap.width || targetH !== bitmap.height;

        maxTextureResolution = Math.max(maxTextureResolution, targetW, targetH);

        if (typeof OffscreenCanvas !== 'undefined' && (needsResize || mime !== 'image/webp')) {
          const canvas = new OffscreenCanvas(targetW, targetH);
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(bitmap, 0, 0, targetW, targetH);
            const webpBlob = await canvas.convertToBlob({ type: 'image/webp', quality });
            if (webpBlob.type === 'image/webp' && (needsResize || webpBlob.size < img.byteLength)) {
              const webpBytes = new Uint8Array(await webpBlob.arrayBuffer());
              tex.setImage(webpBytes);
              tex.setMimeType('image/webp');
              hasWebPTexture = true;
            }
          }
        }
      } catch (texErr) {
        console.warn('GLB texture WebP compression skipped for texture:', tex.getName(), texErr);
      } finally {
        bitmap?.close();
      }
    }

    if (hasWebPTexture) {
      doc.createExtension(EXTTextureWebP).setRequired(true);
    }

    await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));

    const triangles = countDocumentTriangles(doc);
    const clipNames = doc
      .getRoot()
      .listAnimations()
      .map((anim) => anim.getName());

    const outUint8 = await io.writeBinary(doc);
    const outBuffer = outUint8.buffer.slice(
      outUint8.byteOffset,
      outUint8.byteOffset + outUint8.byteLength
    ) as ArrayBuffer;

    const response: GlbWorkerSuccess = {
      id,
      ok: true,
      buffer: outBuffer,
      triangles,
      maxTextureResolution,
      clipNames,
      originalClipNames,
    };
    (self as unknown as Worker).postMessage(response, [outBuffer]);
  } catch (err: any) {
    const response: GlbWorkerError = {
      id,
      ok: false,
      error: err?.message || String(err),
    };
    (self as unknown as Worker).postMessage(response);
  }
};
