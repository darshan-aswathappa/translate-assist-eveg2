// Immutable conversation state. One "turn" is: partner utterance (original) →
// English translation → suggested replies in their language. The detected
// language locks on first detection and stays fixed for the thread (it's sent
// as a hint to Whisper on every later utterance).

export interface Suggestion {
  native: string;
  roman: string;
  gloss: string;
}

export interface Turn {
  original: string;
  translation: string;
  suggestions: readonly Suggestion[];
}

export interface Conversation {
  readonly threadId: string | null;
  readonly lockedLanguage: string | null;
  readonly turns: readonly Turn[];
}

export function initialConversation(): Conversation {
  return { threadId: null, lockedLanguage: null, turns: [] };
}

export function withThread(c: Conversation, threadId: string): Conversation {
  return { ...c, threadId };
}

export function withDetectedLanguage(c: Conversation, language: string): Conversation {
  if (c.lockedLanguage !== null || language === "") return c;
  return { ...c, lockedLanguage: language };
}

export function withTurn(c: Conversation, turn: Turn): Conversation {
  return { ...c, turns: [...c.turns, turn] };
}

/** Last `n` partner utterances (originals), oldest first — Claude context. */
export function recentContext(c: Conversation, n: number): string[] {
  return c.turns.slice(-n).map((t) => t.original);
}
