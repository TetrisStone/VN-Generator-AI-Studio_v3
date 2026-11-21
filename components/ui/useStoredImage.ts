import { useAssetUrl } from './useAssetUrl';

/** Resolves an asset id from the assets store into a refcounted displayable URL */
export const useStoredImage = (id: string | null | undefined): string | null => {
  return useAssetUrl(id);
};
