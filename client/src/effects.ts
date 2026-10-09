import { usePreferences } from "./store";
let context: AudioContext | undefined;
let unlocked = false;
export function unlockAudio() {
  unlocked = true;
  if (usePreferences.getState().settings.sound) {
    context ??= new AudioContext();
    void context.resume();
  }
}
export function feedback(kind: "select" | "turn" | "line" | "win" | "lose") {
  const s = usePreferences.getState().settings;
  if (s.haptic) {
    const h = window.Telegram?.WebApp.HapticFeedback;
    if (kind === "win") h?.notificationOccurred("success");
    else if (kind === "lose") h?.notificationOccurred("error");
    else h?.impactOccurred(kind === "line" ? "heavy" : "light");
  }
  if (!s.sound || !unlocked) return;
  context ??= new AudioContext();
  void context.resume();
  const freq = {
    select: [440],
    turn: [520, 660],
    line: [660, 880],
    win: [523, 659, 784, 1046],
    lose: [330, 220],
  }[kind];
  freq.forEach((hz, i) => {
    const o = context!.createOscillator(),
      g = context!.createGain(),
      at = context!.currentTime + i * 0.12;
    o.type = "sine";
    o.frequency.value = hz;
    g.gain.setValueAtTime(0.06, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.16);
    o.connect(g);
    g.connect(context!.destination);
    o.start(at);
    o.stop(at + 0.17);
  });
}
