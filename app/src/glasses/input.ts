// Map raw EvenHub events to app actions. Gotchas encoded here (see the
// handle-input skill): clicks on a text container arrive as sysEvent, not
// textEvent, and protobuf omits zero values so a single click's eventType is
// usually `undefined` — always coalesce with ?? 0.

import { OsEventTypeList } from "@evenrealities/even_hub_sdk";

export type GlassesAction =
  | "prev" // swipe up — previous suggestion
  | "next" // swipe down — next suggestion
  | "end-turn" // single tap — end the turn & translate, or resume listening
  | "exit-dialog" // double tap
  | "cleanup" // system/abnormal exit — stop mic, unsubscribe
  | null;

export interface HubEventShape {
  textEvent?: { eventType?: number };
  sysEvent?: { eventType?: number };
  audioEvent?: { audioPcm?: unknown };
}

export function actionForEvent(event: HubEventShape): GlassesAction {
  if (event.textEvent) {
    const t = event.textEvent.eventType ?? 0;
    if (t === OsEventTypeList.SCROLL_TOP_EVENT) return "prev";
    if (t === OsEventTypeList.SCROLL_BOTTOM_EVENT) return "next";
    return null;
  }
  if (event.sysEvent) {
    const t = event.sysEvent.eventType ?? 0;
    if (t === OsEventTypeList.CLICK_EVENT) return "end-turn";
    if (t === OsEventTypeList.DOUBLE_CLICK_EVENT) return "exit-dialog";
    if (
      t === OsEventTypeList.SYSTEM_EXIT_EVENT ||
      t === OsEventTypeList.ABNORMAL_EXIT_EVENT
    ) {
      return "cleanup";
    }
  }
  return null;
}
