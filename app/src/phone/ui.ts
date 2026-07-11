// Phone companion shell: dark, minimal, three tabs — Live / Sessions / Settings.
// This is what shows on the phone while the HUD runs on the glasses. No
// framework: the views are small enough for direct DOM code.

import { mountLive, type LiveView } from "./live";
import { mountSessions, type SessionsDeps } from "./sessions";
import { mountSettings, type SettingsDeps } from "./settings";

export type TabName = "live" | "sessions" | "settings";

export interface PhoneUi {
  live: LiveView;
  showTab(tab: TabName): void;
  refreshSessions(): void;
}

const CSS = `
  :root { color-scheme: dark; }
  body { margin: 0; background: #0b0f0c; color: #d7e0d9; font: 15px/1.45 -apple-system, system-ui, sans-serif; }
  .ta-shell { display: flex; flex-direction: column; min-height: 100vh; }
  .ta-header { padding: 14px 16px 10px; font-weight: 700; letter-spacing: .04em; color: #7ee08a; }
  .ta-tabs { display: flex; border-bottom: 1px solid #1e2a20; }
  .ta-tab { flex: 1; padding: 10px 0; text-align: center; background: none; border: none; color: #8fa093; font: inherit; }
  .ta-tab.active { color: #7ee08a; border-bottom: 2px solid #7ee08a; }
  .ta-view { flex: 1; padding: 16px; display: none; }
  .ta-view.active { display: block; }
  .ta-status { color: #7ee08a; font-weight: 600; margin-bottom: 4px; }
  .ta-lang { color: #8fa093; font-size: 13px; margin-bottom: 12px; }
  .ta-turn { border-left: 2px solid #2c3f30; padding: 6px 10px; margin-bottom: 10px; }
  .ta-orig { color: #8fa093; font-size: 13px; }
  .ta-trans { margin: 2px 0 4px; }
  .ta-sug { color: #7ee08a; font-size: 13px; }
  .ta-list-item { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 10px 8px; border-bottom: 1px solid #1e2a20; }
  .ta-list-item .meta { color: #8fa093; font-size: 12px; }
  .ta-btn { background: #14371c; color: #7ee08a; border: 1px solid #2c5c36; border-radius: 6px; padding: 8px 14px; font: inherit; }
  .ta-btn.danger { background: #3a1414; color: #e08a7e; border-color: #5c2c2c; }
  .ta-btn.small { padding: 4px 10px; font-size: 13px; }
  .ta-field { margin-bottom: 14px; }
  .ta-field label { display: block; font-size: 13px; color: #8fa093; margin-bottom: 4px; }
  .ta-field input { width: 100%; box-sizing: border-box; background: #101812; color: #d7e0d9; border: 1px solid #2c3f30; border-radius: 6px; padding: 10px; font: inherit; }
  .ta-hint { color: #8fa093; font-size: 12px; margin-top: 2px; }
  .ta-msg { margin-top: 10px; font-size: 13px; color: #7ee08a; min-height: 1.2em; }
  .ta-msg.err { color: #e08a7e; }
  .ta-empty { color: #566a5b; text-align: center; padding: 30px 0; }
  .ta-detail-back { margin-bottom: 12px; }
`;

export function mountPhoneUi(
  root: HTMLElement,
  deps: SettingsDeps & SessionsDeps,
): PhoneUi {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  root.innerHTML = `
    <div class="ta-shell">
      <div class="ta-header">TRANSLATE ASSIST</div>
      <div class="ta-tabs">
        <button class="ta-tab active" data-tab="live">Live</button>
        <button class="ta-tab" data-tab="sessions">Sessions</button>
        <button class="ta-tab" data-tab="settings">Settings</button>
      </div>
      <div class="ta-view active" data-view="live"></div>
      <div class="ta-view" data-view="sessions"></div>
      <div class="ta-view" data-view="settings"></div>
    </div>`;

  const view = (name: TabName): HTMLElement =>
    root.querySelector(`[data-view="${name}"]`) as HTMLElement;

  function showTab(tab: TabName): void {
    for (const el of root.querySelectorAll<HTMLElement>(".ta-tab")) {
      el.classList.toggle("active", el.dataset.tab === tab);
    }
    for (const el of root.querySelectorAll<HTMLElement>(".ta-view")) {
      el.classList.toggle("active", el.dataset.view === tab);
    }
    if (tab === "sessions") sessions.refresh();
  }

  for (const el of root.querySelectorAll<HTMLElement>(".ta-tab")) {
    el.addEventListener("click", () => showTab(el.dataset.tab as TabName));
  }

  const live = mountLive(view("live"));
  const sessions = mountSessions(view("sessions"), deps);
  mountSettings(view("settings"), deps);

  return { live, showTab, refreshSessions: () => sessions.refresh() };
}
