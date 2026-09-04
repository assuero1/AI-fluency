/**
 * Monta uma única faixa de áudio contínua a partir de várias URLs: baixa e
 * decodifica tudo em paralelo, concatena as amostras e reempacota como um só
 * WAV (blob URL). Assim a mensagem toca num único <audio> — sem gap entre as
 * partes — usando o elemento de mídia nativo, que não depende de gesto do
 * usuário nem de rota de áudio (diferente de AudioContext, problemático no
 * iOS quando o play acontece depois de awaits de rede).
 */

export type SeamlessTrack = {
  /** Blob URL de um WAV contínuo com todas as partes. */
  audioUrl: string;
  /** Posição inicial (segundos) de cada parte dentro da faixa concatenada. */
  partOffsets: number[];
  duration: number;
  dispose: () => void;
};

export async function buildSeamlessTrack(urls: string[]): Promise<SeamlessTrack> {
  if (urls.length === 0) throw new Error("No audio parts.");
  const DecodeContext =
    window.OfflineAudioContext ??
    (window as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!DecodeContext) throw new Error("Web Audio API unavailable.");

  // decodeAudioData vive em BaseAudioContext: o contexto offline decodifica
  // sem precisar de gesto nem de AudioContext "running".
  const decodeContext = new DecodeContext(1, 1, 44100);
  const buffers = await Promise.all(urls.map(async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Audio fetch failed: ${response.status}`);
    const raw = await response.arrayBuffer();
    try {
      return await decodeContext.decodeAudioData(raw);
    } catch (decodeErr) {
      throw new Error(`decodeAudioData failed for ${url}: ${decodeErr instanceof Error ? decodeErr.message : String(decodeErr)}`);
    }
  }));

  const sampleRate = buffers[0]?.sampleRate ?? 44100;
  // Pausa sutil entre frases (~180ms) e respiro final (~200ms) para não cortar a seco
  const interGapSamples = buffers.length > 1 ? Math.round(sampleRate * 0.18) : 0;
  const tailSilenceSamples = Math.round(sampleRate * 0.2);

  const partOffsets: number[] = [];
  let totalLength = 0;
  buffers.forEach((part, index) => {
    partOffsets.push(totalLength / sampleRate);
    totalLength += part.length;
    if (index < buffers.length - 1) {
      totalLength += interGapSamples;
    }
  });
  totalLength += tailSilenceSamples;

  const channelCount = Math.max(...buffers.map((part) => part.numberOfChannels));
  const merged: Float32Array[] = [];
  for (let channel = 0; channel < channelCount; channel += 1) {
    merged.push(new Float32Array(totalLength));
  }
  let writeOffset = 0;
  buffers.forEach((part, index) => {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const source = part.getChannelData(Math.min(channel, part.numberOfChannels - 1));
      merged[channel].set(source, writeOffset);
    }
    writeOffset += part.length;
    if (index < buffers.length - 1) {
      writeOffset += interGapSamples;
    }
  });

  const wavBytes = encodeWav(merged, sampleRate);
  const blobUrl = URL.createObjectURL(new Blob([wavBytes], { type: "audio/wav" }));
  return {
    audioUrl: blobUrl,
    partOffsets,
    duration: totalLength / sampleRate,
    dispose: () => URL.revokeObjectURL(blobUrl)
  };
}

/** Empacota amostras float32 [-1, 1] como WAV PCM 16-bit. */
function encodeWav(channels: Float32Array[], sampleRate: number) {
  const channelCount = channels.length;
  const frameCount = channels[0]?.length ?? 0;
  const bytesPerSample = 2;
  const dataSize = frameCount * channelCount * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channels[channel][frame]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += bytesPerSample;
    }
  }
  return buffer;
}
