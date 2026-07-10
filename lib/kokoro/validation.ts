export const MAX_SYNTHESIS_TEXT_LENGTH = 1200;

export class SynthesisValidationError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export type SynthesisConfig = {
  defaultVoice: string;
  outputFormat: string;
  speed?: number;
  allowedVoices: string[];
  allowedFormats: string[];
};

export function resolveSynthesisRequest(
  input: string,
  options: { voice?: string; format?: string; speed?: number } | undefined,
  config: SynthesisConfig
) {
  const text = input.trim();
  if (!text) throw new SynthesisValidationError("Text is required for speech synthesis.");
  if (text.length > MAX_SYNTHESIS_TEXT_LENGTH) {
    throw new SynthesisValidationError("Text is too long for speech synthesis.", 413);
  }

  const voice = options?.voice?.trim() || config.defaultVoice;
  const outputFormat = (options?.format?.trim() || config.outputFormat).toLowerCase();
  const speed = options?.speed ?? config.speed ?? 1;
  if (!config.allowedVoices.includes(voice)) throw new SynthesisValidationError("Voice is not allowed for speech synthesis.");
  if (!config.allowedFormats.includes(outputFormat)) throw new SynthesisValidationError("Audio format is not allowed for speech synthesis.");
  if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) throw new SynthesisValidationError("Speech speed is not allowed.");

  return { text, voice, outputFormat, speed };
}
