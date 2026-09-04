export const speechLocales: Record<string, string> = {
  en: "en-US",
  es: "es-ES",
  fr: "fr-FR",
  it: "it-IT",
  ja: "ja-JP",
  zh: "zh-CN",
  hi: "hi-IN"
};

const speechLanguageNames: Record<string, string> = {
  en: "inglês (Estados Unidos)",
  es: "espanhol (Espanha)",
  fr: "francês (França)",
  it: "italiano (Itália)",
  ja: "japonês (Japão)",
  zh: "chinês mandarim (China)",
  hi: "hindi (Índia)"
};

export function speechLocale(languageCode: string | undefined) {
  return speechLocales[languageCode?.toLowerCase() ?? ""] ?? "en-US";
}

export function speechLanguageName(languageCode: string | undefined) {
  return speechLanguageNames[languageCode?.toLowerCase() ?? ""] ?? "inglês (Estados Unidos)";
}

export function speechRecognitionErrorMessage(error: string | undefined) {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return "Permissão do microfone negada. Você ainda pode digitar normalmente.";
  }
  if (error === "no-speech") return "Nenhuma fala foi detectada. Tente novamente ou digite sua mensagem.";
  if (error === "audio-capture") return "Nenhum microfone disponível. Você ainda pode digitar normalmente.";
  if (error === "network") return "O reconhecimento de voz perdeu a conexão. Tente novamente ou digite sua mensagem.";
  if (error === "aborted") return null;
  return "Não foi possível transcrever sua fala. Tente novamente ou use a digitação.";
}

function isNoSpaceLanguage(languageCode: string | undefined) {
  const code = languageCode?.toLowerCase().split(/[-_]/)[0];
  return code === "ja" || code === "zh";
}

export function joinSpeechSegments(segments: string[], languageCode: string | undefined) {
  const cleanSegments = segments.map((segment) => normalizeSpeechSpacing(segment)).filter(Boolean);
  if (cleanSegments.length === 0) return "";

  const noSpace = isNoSpaceLanguage(languageCode);
  const joined = cleanSegments
    .map((segment, index) => {
      if (index === 0) return segment;
      const previous = cleanSegments[index - 1];
      if (/[.!?…~。！？।]$/.test(previous)) return segment;
      return noSpace ? segment : lowercaseFirstLetter(segment);
    })
    .join(noSpace ? "" : " ");

  return punctuateSpeechSentence(joined, languageCode);
}

function lowercaseFirstLetter(value: string) {
  const first = value[0];
  if (!first) return value;
  const lowered = first.toLocaleLowerCase();
  return first === lowered ? value : `${lowered}${value.slice(1)}`;
}

export function punctuateSpeechSentence(value: string, languageCode: string | undefined) {
  const clean = normalizeSpeechSpacing(value);
  if (!clean || /[.!?…~。！？।]$/.test(clean)) return clean;
  return `${clean}${looksLikeQuestion(clean, languageCode) ? "?" : "."}`;
}

function normalizeSpeechSpacing(value: string) {
  return value.trim().replace(/\s+([,.;!?])/g, "$1").replace(/\s+/g, " ");
}

export function looksLikeQuestion(value: string, languageCode: string | undefined) {
  const normalized = value
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^[¿¡]\s*/, "");
  const starters: Record<string, RegExp> = {
    en: /^(who|what|where|when|why|how|which|do|does|did|can|could|would|will|is|are|was|were|have|has)\b/,
    es: /^(quien|que|donde|quando|por que|como|cual|cuanto|puedes|podrias|quieres|es|son|tienes|has)\b/,
    pt: /^(quem|que|o que|onde|aonde|quando|por que|porque|como|qual|quais|quanto|quantos|quantas|pode|poderia|voce pode|voce|sera)\b/,
    fr: /^(qui|que|quoi|ou|quand|pourquoi|comment|quel|quelle|combien|est-ce|peux|pourrais|veux|as-tu)\b/,
    it: /^(chi|che|cosa|dove|quando|perche|come|quale|quanto|puoi|potresti|vuoi|hai|sei)\b/,
    ja: /(か|かい|ですか|ますか|でしょうか)$|^(何|どこ|いつ|どう|だれ|誰|なぜ|いくら|どんな)/,
    zh: /(吗|呢|吧)$|^(什么|哪里|哪儿|怎么|谁|为什么|几|多少)/,
    hi: /(?:^|\s)(क्या|कहाँ|कब|क्यों|कैसे|कौन|किस|कितना|कितने|कितनी)(?:$|\s)/
  };
  return (starters[languageCode?.toLowerCase() ?? ""] ?? starters.en).test(normalized);
}

// A restauração da rota no iOS não tem evento observável: depois do ditado, a
// AVAudioSession sai do modo gravação (auricular) de volta ao alto-falante no
// próprio ritmo do WebKit. 350ms mostrou-se insuficiente em produção — o TTS
// às vezes ainda saía no auricular. 800ms cobre o caso com folga e só é pago
// por quem ditou há pouco.
const AUDIO_ROUTE_RESTORE_MS = 800;

let micReleasedAt = 0;
let routeNudgeAudio: HTMLAudioElement | null = null;
let routeNudgePrepared = false;

/**
 * Marca a liberação do microfone e "acorda" a rota de playback: toca o WAV
 * silencioso no elemento dedicado do nudge (destravado por
 * `prepareRouteNudgeElement`), forçando a AVAudioSession do iOS a sair do modo
 * gravação (auricular) e voltar ao alto-falante antes do próximo TTS. Sem o
 * nudge, a restauração dependia só do wait fixo de `AUDIO_ROUTE_RESTORE_MS` —
 * e às vezes o áudio saía no auricular.
 */
export function releaseMicForPlayback() {
  micReleasedAt = Date.now();
  nudgePlaybackRoute();
}

/**
 * Garante o elemento dedicado do nudge e o destrava dentro do gesto atual
 * (mesmo mecanismo do `unlockAudioForPlayback`): um <audio> que já tocou
 * dentro de um gesto aceita play() programático depois. Sem isso o nudge —
 * disparado pela liberação do microfone, fora de qualquer gesto — é rejeitado
 * pelo iOS e nunca reconduz a rota ao alto-falante.
 */
export function prepareRouteNudgeElement() {
  if (typeof window === "undefined" || typeof Audio === "undefined") return;
  if (routeNudgePrepared) return;
  try {
    routeNudgeAudio ??= new Audio();
    const audio = routeNudgeAudio;
    if (audio.src !== silentWavUri()) audio.src = silentWavUri();
    audio.muted = true;
    const attempt = audio.play();
    const finish = () => {
      audio.pause();
      audio.muted = false;
    };
    if (attempt && typeof attempt.then === "function") {
      // Só marca como preparado se o play foi aceito: uma rejeição (ex.:
      // chamada fora de gesto) pode ser tentada de novo no próximo gesto.
      attempt.then(
        () => {
          finish();
          routeNudgePrepared = true;
        },
        () => undefined
      );
    } else {
      finish();
      routeNudgePrepared = true;
    }
  } catch {
    // Destravar o nudge é best-effort; o wait de AUDIO_ROUTE_RESTORE_MS segue.
  }
}

export function msUntilAudioRouteRestored(now = Date.now()) {
  return Math.max(0, AUDIO_ROUTE_RESTORE_MS - (now - micReleasedAt));
}

/** WAV silencioso (~50ms, PCM 8-bit mono 8kHz) como data URI, montado uma vez. */
let cachedSilentWavUri: string | null = null;

export function silentWavUri() {
  if (cachedSilentWavUri) return cachedSilentWavUri;
  const sampleRate = 8000;
  const sampleCount = 400;
  const bytes = new Uint8Array(44 + sampleCount);
  const view = new DataView(bytes.buffer);
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + sampleCount, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // byte rate (8-bit mono)
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits por amostra
  writeAscii(36, "data");
  view.setUint32(40, sampleCount, true);
  bytes.fill(0x80, 44); // silêncio em PCM 8-bit
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  cachedSilentWavUri = `data:audio/wav;base64,${btoa(binary)}`;
  return cachedSilentWavUri;
}

function nudgePlaybackRoute() {
  if (typeof window === "undefined" || typeof Audio === "undefined") return;
  try {
    // Sem elemento destravado em gesto, um <audio> novo criado aqui (fora do
    // gesto) é rejeitado pelo iOS — o fallback segue best-effort para
    // desktop/Android, que não exigem gesto.
    routeNudgeAudio ??= new Audio();
    const audio = routeNudgeAudio;
    // Mute ou volume 0 fazem o iOS pular a (re)seleção de rota; o silêncio vem
    // das próprias amostras do WAV, então toca com volume real.
    audio.muted = false;
    try {
      audio.volume = 1;
    } catch {
      // O iPhone ignora volume em <audio>; as amostras silenciosas bastam.
    }
    if (audio.src !== silentWavUri()) audio.src = silentWavUri();
    void audio.play().catch(() => undefined);
  } catch {
    // O nudge é best-effort; o wait de AUDIO_ROUTE_RESTORE_MS continua valendo.
  }
}
