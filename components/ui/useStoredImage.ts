import { useEffect, useState } from 'react';
import { loadImage } from '../../utils/imageStorage';

/** Resolves an image id from the images store into a displayable data URL */
export const useStoredImage = (id: string | null | undefined): string | null => {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!id) { setSrc(null); return; }
    loadImage(id).then(data => { if (alive) setSrc(data); }).catch(() => { if (alive) setSrc(null); });
    return () => { alive = false; };
  }, [id]);
  return src;
};
