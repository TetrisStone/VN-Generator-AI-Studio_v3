import React, { useState, useEffect } from 'react';
import { loadImage } from '../../utils/imageStorage';

interface AsyncVideoProps extends React.VideoHTMLAttributes<HTMLVideoElement> {
    src: string | null | undefined;
}

export const AsyncVideo: React.FC<AsyncVideoProps> = ({ src, className, ...props }) => {
    const [videoSrc, setVideoSrc] = useState<string | null>(null);

    useEffect(() => {
        let isMounted = true;
        const fetchVideo = async () => {
            if (src) {
                const data = await loadImage(src);
                if (isMounted) setVideoSrc(data);
            } else {
                setVideoSrc(null);
            }
        };
        fetchVideo();
        return () => { isMounted = false; };
    }, [src]);

    if (!videoSrc) {
        return null;
    }

    return <video src={videoSrc} className={className} {...props} />;
};
