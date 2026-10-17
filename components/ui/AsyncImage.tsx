import React, { useState, useEffect } from 'react';
import { loadImage } from '../../utils/imageStorage';

interface AsyncImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
    src: string | null | undefined;
    fallbackColor?: string;
    fallbackText?: string;
}

export const AsyncImage: React.FC<AsyncImageProps> = ({ src, fallbackColor, fallbackText, className, ...props }) => {
    const [imgSrc, setImgSrc] = useState<string | null>(null);

    useEffect(() => {
        let isMounted = true;
        const fetchImage = async () => {
            if (src) {
                const data = await loadImage(src);
                if (isMounted) setImgSrc(data);
            } else {
                setImgSrc(null);
            }
        };
        fetchImage();
        return () => { isMounted = false; };
    }, [src]);

    if (!imgSrc) {
        if (!fallbackText && !fallbackColor) return null;
        return (
            <div 
                className={`flex items-center justify-center font-bold shadow-2xl ${className || ''}`}
                style={{ backgroundColor: fallbackColor || '#4b5563' }}
            >
                {fallbackText}
            </div>
        );
    }

    return <img src={imgSrc} className={className} {...props} />;
};
