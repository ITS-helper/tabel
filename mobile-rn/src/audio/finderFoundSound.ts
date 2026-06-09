import { createAudioPlayer, setAudioModeAsync } from "expo-audio";

const FINDER_SOUND = require("../../assets/sounds/finder-found.mp3");

let audioModeReady = false;
let activePlayer: ReturnType<typeof createAudioPlayer> | null = null;

async function ensureAudioMode(): Promise<void> {
  if (audioModeReady) return;
  await setAudioModeAsync({ playsInSilentMode: true });
  audioModeReady = true;
}

/** Звук «метка найдена». */
export async function playFinderFoundSound(): Promise<void> {
  try {
    await ensureAudioMode();
    activePlayer?.release();
    const player = createAudioPlayer(FINDER_SOUND);
    activePlayer = player;
    player.play();
  } catch (e) {
    console.warn("[finderFoundSound]", e);
  }
}
