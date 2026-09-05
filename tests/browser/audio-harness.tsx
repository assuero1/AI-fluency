import React from "react";
import { createRoot } from "react-dom/client";
import { MessageWordPlayer } from "@/components/MessageWordPlayer";
import { VoiceButton } from "@/components/VoiceButton";
import "@/app/globals.css";

const hidden = new URLSearchParams(location.search).has("hidden");
createRoot(document.getElementById("root")!).render(
  <main style={{ maxWidth: 390, padding: 20, margin: "auto" }}>
    <h1>Áudio para aprendizado</h1>
    <section aria-label="Mensagem"><MessageWordPlayer text="Hello world. Learn at your pace. Last word." showTranscript={!hidden} /></section>
    <section aria-label="Palavra"><VoiceButton text="Hello world." label="Ouvir palavra" /></section>
  </main>
);
