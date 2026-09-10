import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { registerAudioProvider } from './audio-providers.js';

const require = createRequire(import.meta.url);
const ffmpegPath = require('ffmpeg-static');

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, (err, _stdout, stderr) => {
      if (err) reject(new Error(`ffmpeg failed: ${stderr || err.message}`));
      else resolve();
    });
  });
}

// Shape brown/pink noise into a rough ambience bed from prompt keywords. This is a
// synthesized placeholder (no real SFX model), kept low so it sits under dialogue.
function pickNoiseFilter(prompt) {
  const p = String(prompt || '').toLowerCase();
  if (/rain|storm|water|ocean|sea|river/.test(p)) return 'highpass=f=200,lowpass=f=4000,volume=0.25';
  if (/wind|breeze|air/.test(p)) return 'lowpass=f=600,volume=0.3';
  if (/crowd|city|traffic|urban|street/.test(p)) return 'lowpass=f=1200,volume=0.22';
  return 'lowpass=f=900,volume=0.2';
}

async function generateAmbience(outputPath, prompt, duration) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const target = Math.max(0.1, Number(duration) || 5);
  const filter = pickNoiseFilter(prompt);
  await runFfmpeg([
    '-y', '-f', 'lavfi', '-i', `anoisesrc=color=brown:duration=${target.toFixed(3)}:sample_rate=48000`,
    '-af', `${filter},afade=t=in:st=0:d=0.2,afade=t=out:st=${Math.max(0, target - 0.3).toFixed(3)}:d=0.3,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo`,
    '-c:a', 'aac', '-b:a', '128k', outputPath,
  ]);
  return outputPath;
}

export const noiseSfxProvider = {
  id: 'noise-sfx',
  name: 'Synthesized Ambience (Placeholder)',
  capability: 'sfx',
  async generate({ prompt, duration, outputPath, signal }) {
    const startTime = new Date().toISOString();
    const baseLineage = {
      provider: 'noise-sfx',
      model: 'shaped-noise',
      modelVersion: '1.0',
      prompt: prompt || null,
      text: null,
      speakerId: null,
      voiceProfile: null,
      seed: null,
      inputHash: null,
      outputHash: null,
      taskId: null,
      startTime,
      endTime: null,
      fallbackReason: null,
    };
    try {
      if (signal?.aborted) throw new Error('Cancelled');
      await generateAmbience(outputPath, prompt, duration);
      if (signal?.aborted) throw new Error('Cancelled');
      return {
        audioPath: outputPath,
        duration: Math.max(0.1, Number(duration) || 5),
        degraded: false,
        lineage: { ...baseLineage, endTime: new Date().toISOString() },
      };
    } catch (error) {
      const reason = signal?.aborted ? 'Cancelled' : error.message;
      return {
        audioPath: null,
        duration: 0,
        degraded: true,
        fallbackReason: reason,
        lineage: { ...baseLineage, endTime: new Date().toISOString(), fallbackReason: reason },
      };
    }
  },
};

registerAudioProvider(noiseSfxProvider);
