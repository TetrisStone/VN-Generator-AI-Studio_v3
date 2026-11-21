import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { getAssetBlob } from './assetStore';

/**
 * Central GLTFLoader factory with MeshoptDecoder enabled for meshopt-compressed GLBs.
 */
export const createGLTFLoader = (): GLTFLoader => {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
};

/**
 * Loads a GLB binary directly as an ArrayBuffer from either an asset ID or a legacy `data:` URL.
 */
export const loadGlbArrayBuffer = async (ref: string | null | undefined): Promise<ArrayBuffer | null> => {
  if (!ref) return null;
  const blob = await getAssetBlob(ref);
  if (!blob) return null;
  return blob.arrayBuffer();
};
