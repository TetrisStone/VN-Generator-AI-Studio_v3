let audioCtx: AudioContext | null = null;

export const playSynthSfx = (type: 'miss' | 'hit' | 'crit' | 'death', volume: number = 1.0) => {
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        if (type === 'miss') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(400, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.2);
            gainNode.gain.setValueAtTime(0.1 * volume, audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01 * volume, audioCtx.currentTime + 0.2);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.2);
        } else if (type === 'hit') {
            osc.type = 'square';
            osc.frequency.setValueAtTime(150, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(50, audioCtx.currentTime + 0.1);
            gainNode.gain.setValueAtTime(0.1 * volume, audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01 * volume, audioCtx.currentTime + 0.1);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.1);
        } else if (type === 'crit') {
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(600, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(50, audioCtx.currentTime + 0.3);
            gainNode.gain.setValueAtTime(0.15 * volume, audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01 * volume, audioCtx.currentTime + 0.3);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.3);
        } else if (type === 'death') {
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(100, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(20, audioCtx.currentTime + 0.8);
            gainNode.gain.setValueAtTime(0.2 * volume, audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01 * volume, audioCtx.currentTime + 0.8);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.8);
        }
    } catch (e) {
        console.error("Audio synth error", e);
    }
};

export default playSynthSfx;
