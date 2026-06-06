import { Audio } from "expo-av";

let ready = false;

async function ensureAudioMode(): Promise<void> {
  if (ready) return;
  await Audio.setAudioModeAsync({
    playsInSilentModeIOS: true,
    shouldDuckAndroid: true,
  });
  ready = true;
}

/** Звук «метка найдена» — technologia-meme-2.mp3 */
export async function playFinderFoundSound(): Promise<void> {
  try {
    await ensureAudioMode();
    const { sound } = await Audio.Sound.createAsync(
      require("../../assets/sounds/finder-found.mp3"),
      { shouldPlay: true, volume: 1 },
    );
    sound.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded && status.didJustFinish) {
        void sound.unloadAsync();
      }
    });
  } catch (e) {
    console.warn("[finderFoundSound]", e);
  }
}
