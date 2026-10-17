export const audioManager = {
    bgmVolume: parseFloat(localStorage.getItem('bgmVolume') || '0.5'),
    sfxVolume: parseFloat(localStorage.getItem('sfxVolume') || '1.0'),
    setBgmVolume: (vol: number) => {
        audioManager.bgmVolume = vol;
        localStorage.setItem('bgmVolume', vol.toString());
        // Custom event so App.tsx can update the <audio> tag
        window.dispatchEvent(new CustomEvent('bgmVolumeChanged', { detail: vol }));
    },
    setSfxVolume: (vol: number) => {
        audioManager.sfxVolume = vol;
        localStorage.setItem('sfxVolume', vol.toString());
    }
};

export default audioManager;
