import { useEffect, useState } from 'react';
import { getAssetUrl, isDirectUrl, releaseAssetUrl } from '../../utils/assetStore';

/**
 * Acquires a refcounted ObjectURL (or passes direct URLs through) and automatically releases it
 * when the asset ID changes or the component unmounts.
 */
export const useAssetUrl = (id: string | null | undefined): string | null => {
  const [url, setUrl] = useState<string | null>(() => (id && isDirectUrl(id) ? id : null));

  useEffect(() => {
    let cancelled = false;
    let acquiredUrl: string | null = null;

    if (!id) {
      setUrl(null);
      return;
    }

    if (isDirectUrl(id)) {
      setUrl(id);
      return;
    }

    getAssetUrl(id)
      .then((resolved) => {
        if (cancelled) {
          if (resolved) releaseAssetUrl(id, resolved);
          return;
        }
        acquiredUrl = resolved;
        setUrl(resolved);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });

    return () => {
      cancelled = true;
      if (acquiredUrl) {
        releaseAssetUrl(id, acquiredUrl);
        acquiredUrl = null;
      }
    };
  }, [id]);

  return url;
};
