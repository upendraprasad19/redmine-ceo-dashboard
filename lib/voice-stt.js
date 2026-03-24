/**
 * lib/voice-stt.js
 *
 * Voice-to-text using Groq Whisper API (free).
 * Downloads Telegram voice/audio, transcribes via Groq.
 */

import Groq from 'groq-sdk';
import fs from 'fs';
import path from 'path';
import os from 'os';

export async function transcribeVoice(fileUrl) {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  // Download the voice file from Telegram
  const tmpPath = path.join(os.tmpdir(), `voice_${Date.now()}.ogg`);

  try {
    const res = await fetch(fileUrl);
    if (!res.ok) throw new Error(`Failed to download voice: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(tmpPath, buffer);

    // Transcribe via Groq Whisper
    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath),
      model: 'whisper-large-v3',
      language: 'en',
    });

    return transcription.text || '';
  } finally {
    // Cleanup temp file
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}
