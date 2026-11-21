import React from 'react';
import { useAssetUrl } from './useAssetUrl';

interface AsyncVideoProps extends React.VideoHTMLAttributes<HTMLVideoElement> {
    src: string | null | undefined;
}

export const AsyncVideo: React.FC<AsyncVideoProps> = ({ src, className, ...props }) => {
    const videoSrc = useAssetUrl(src);

    if (!videoSrc) {
        return null;
    }

    return <video src={videoSrc} className={className} {...props} />;
};
