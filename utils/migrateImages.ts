import { dataUrlToBlob, detectAssetKind, saveAsset } from './assetStore';

const isBase64Media = (str: unknown): str is string => {
    return typeof str === 'string' && /^data:(image|video|audio|model|application\/octet-stream)[;/,]/i.test(str);
};

export const extractImagesFromProject = async (data: any): Promise<any> => {
    let imagesCount = 0;
    let videosCount = 0;
    let audioCount = 0;
    let modelCount = 0;

    // Deduplicate identical inline payloads within the same project import
    const dedupe = new Map<string, Array<{ raw: string; id: string }>>();

    const storeDataUrl = async (raw: string): Promise<string> => {
        const key = `${raw.length}:${raw.slice(0, 64)}:${raw.slice(-64)}`;
        const bucket = dedupe.get(key);
        if (bucket) {
            const hit = bucket.find(entry => entry.raw === raw);
            if (hit) return hit.id;
        }

        const blob = dataUrlToBlob(raw);
        const id = crypto.randomUUID();
        const rec = await saveAsset(id, blob);

        if (rec.kind === 'image') imagesCount++;
        else if (rec.kind === 'video') videosCount++;
        else if (rec.kind === 'audio') audioCount++;
        else if (rec.kind === 'model') modelCount++;

        if (bucket) bucket.push({ raw, id });
        else dedupe.set(key, [{ raw, id }]);

        return id;
    };

    const processObject = async (obj: any) => {
        if (!obj || typeof obj !== 'object') return;

        if (Array.isArray(obj)) {
            for (let i = 0; i < obj.length; i++) {
                if (isBase64Media(obj[i])) {
                    obj[i] = await storeDataUrl(obj[i]);
                } else {
                    await processObject(obj[i]);
                }
            }
        } else {
            for (const key of Object.keys(obj)) {
                const val = obj[key];
                if (isBase64Media(val)) {
                    const id = await storeDataUrl(val);
                    if (key === 'dataBase64') {
                        obj.assetId = id;
                        delete obj.dataBase64;
                    } else {
                        obj[key] = id;
                    }
                } else {
                    await processObject(val);
                }
            }
        }
    };

    if (data) {
        await processObject(data);
    }

    console.log(
        `Extracted media into IndexedDB assets: ${imagesCount} images, ${videosCount} videos, ${audioCount} audio, ${modelCount} 3D models (kind detector fallback: ${detectAssetKind('image/png')}).`
    );
    return data;
};
