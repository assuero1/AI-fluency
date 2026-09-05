"use client";

import { MessageAudioPlayer, type MessageAudioPlayerProps } from "./MessageAudioPlayer";

/** Mesmo áudio/player com destaque por palavra quando há tempos confiáveis,
 * ou por frase quando o provedor não entrega alinhamento. */
export function MessageWordPlayer(props: MessageAudioPlayerProps) {
  return <MessageAudioPlayer {...props} />;
}
