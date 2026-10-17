import { saveImage } from './imageStorage';

const isBase64Media = (str: string | null | undefined): boolean => {
    return typeof str === 'string' && (str.startsWith('data:image/') || str.startsWith('data:video/') || str.startsWith('data:audio/'));
};

const getMediaType = (str: string): 'image' | 'video' | 'audio' | 'unknown' => {
    if (str.startsWith('data:image/')) return 'image';
    if (str.startsWith('data:video/')) return 'video';
    if (str.startsWith('data:audio/')) return 'audio';
    return 'unknown';
};

export const extractImagesFromProject = async (data: any): Promise<any> => {
    let imagesCount = 0;
    let videosCount = 0;
    let audioCount = 0;

    const processObject = async (obj: any) => {
        if (!obj || typeof obj !== 'object') return;

        if (Array.isArray(obj)) {
            for (let i = 0; i < obj.length; i++) {
                if (isBase64Media(obj[i])) {
                    const mediaType = getMediaType(obj[i]);
                    const id = crypto.randomUUID();
                    await saveImage(id, obj[i]);
                    obj[i] = id;
                    if (mediaType === 'image') imagesCount++;
                    if (mediaType === 'video') videosCount++;
                    if (mediaType === 'audio') audioCount++;
                } else {
                    await processObject(obj[i]);
                }
            }
        } else {
            for (const key in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, key)) {
                    if (isBase64Media(obj[key])) {
                        const mediaType = getMediaType(obj[key]);
                        const id = crypto.randomUUID();
                        await saveImage(id, obj[key]);
                        obj[key] = id;
                        if (mediaType === 'image') imagesCount++;
                        if (mediaType === 'video') videosCount++;
                        if (mediaType === 'audio') audioCount++;
                    } else {
                        await processObject(obj[key]);
                    }
                }
            }
        }
    };

    if (data) {
        await processObject(data);
    }
    
    console.log(`Extracted media into IndexedDB: ${imagesCount} images, ${videosCount} videos, ${audioCount} audio files.`);
    return data;
};
