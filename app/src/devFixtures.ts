// Canned conversation for VITE_DEV_MODE=true — iterate on the HUD and phone UI
// without glasses, mic, or API keys.

import type { Suggestion } from "./conversation/thread";
import type { PhoneUi } from "./phone/ui";

const SUGGESTIONS: Suggestion[] = [
  { native: "はい、少しだけ。", roman: "Hai, sukoshi dake.", gloss: "Yes, just a little." },
  {
    native: "すみません、あまり得意ではありません。",
    roman: "Sumimasen, amari tokui dewa arimasen.",
    gloss: "Sorry, I'm not very good at it.",
  },
  { native: "いいえ、話せません。", roman: "Iie, hanasemasen.", gloss: "No, I can't speak it." },
];

export function runDevFixtures(deps: {
  setResult: (translation: string, suggestions: Suggestion[]) => void;
  showStatus: (label: string) => void;
  ui: PhoneUi;
}): void {
  deps.ui.live.setLanguage("ja");
  deps.showStatus("LISTENING");
  setTimeout(() => deps.showStatus("TRANSCRIBING"), 1200);
  setTimeout(() => deps.showStatus("THINKING"), 2200);
  setTimeout(() => deps.setResult("Do you speak English?", SUGGESTIONS), 3400);
}
