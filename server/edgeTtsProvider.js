import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { registerAudioProvider } from './audio-providers.js';

const require = createRequire(import.meta.url);
const ffmpegPath = require('ffmpeg-static');

const VOICE_BY_LANG = {
  zh: { female: 'zh-CN-XiaoxiaoNeural', male: 'zh-CN-YunxiNeural' },
  en: { female: 'en-US-AriaNeural', male: 'en-US-GuyNeural' },
};
const DEFAULT_VOICE = 'en-US-AriaNeural';

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, (err, _stdout, stderr) => {
      if (err) reject(new Error(`ffmpeg failed: ${stderr || err.message}`));
      else resolve();
    });
  });
}

function detectLang(text) {
  return /[\u4e00-\u9fff]/.test(text || '') ? 'zh' : 'en';
}

// voiceProfile may carry an explicit Edge voice ShortName, a gender hint, or a
// character id. Resolve to a concrete Edge voice for the detected language.
function resolveVoice(text, voiceProfile) {
  const lang = detectLang(text);
  const table = VOICE_BY_LANG[lang] || VOICE_BY_LANG.en;
  const profile = String(voiceProfile || '');
  if (/^[a-z]{2,3}-[a-z0-9]{2,4}-\w+neural$/i.test(profile)) return profile;
  const lower = profile.toLowerCase();
  if (lower.includes('male') && !lower.includes('female')) return table.male;
  return table.female;
}

// Convert the synthesised mp3 to a stereo 48k m4a fitted to the target duration:
// longer speech is trimmed, shorter speech is padded with trailing silence so the
// shot timeline stays in sync.
async function fitToDuration(mp3Path, outputPath, duration) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const target = Math.max(0.1, Number(duration) || 5);
  await runFfmpeg([
    '-y', '-i', mp3Path,
    '-af', `apad,atrim=duration=${target.toFixed(3)},asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo`,
    '-c:a', 'aac', '-b:a', '128k', outputPath,
  ]);
  return outputPath;
}

export const edgeTtsProvider = {
  id: 'edge-tts',
  name: 'Microsoft Edge TTS',
  capability: 'tts',
  async generate({ text, voiceProfile, speakerId, duration, outputPath, signal }) {
    const startTime = new Date().toISOString();
    const voice = resolveVoice(text, voiceProfile);
    const baseLineage = {
      provider: 'edge-tts',
      model: voice,
      modelVersion: 'msedge-tts',
      prompt: null,
      text: text || null,
      speakerId: speakerId || null,
      voiceProfile: voiceProfile || null,
      seed: null,
      inputHash: null,
      outputHash: null,
      taskId: null,
      startTime,
      endTime: null,
      fallbackReason: null,
    };

    if (!text || !String(text).trim()) {
      return { audioPath: null, duration: 0, degraded: true, fallbackReason: 'Empty TTS text',
        lineage: { ...baseLineage, endTime: new Date().toISOString(), fallbackReason: 'Empty TTS text' } };
    }

    const tts = new MsEdgeTTS();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cine-tts-'));
    try {
      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      if (signal?.aborted) throw new Error('Cancelled');
      const { audioFilePath } = await tts.toFile(tmpDir, String(text).slice(0, 2000));
      if (signal?.aborted) throw new Error('Cancelled');
      await fitToDuration(audioFilePath, outputPath, duration);
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
    } finally {
      try { tts.close(); } catch {}
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  },
};

registerAudioProvider(edgeTtsProvider);
