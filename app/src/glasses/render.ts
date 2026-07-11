// Serialized bridge writes for the single full-screen HUD text container.
// All bridge calls go through one promise chain so writes never overlap on the
// BLE link (concurrent writes can crash the connection). The page is one text
// container, so after startup every update is a flicker-free
// textContainerUpgrade — no rebuilds needed.
//
// Adapted from eli5-glasses' bridge/render.ts.

import {
  type EvenAppBridge,
  CreateStartUpPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
} from "@evenrealities/even_hub_sdk";

export const HUD_ID = 1;
export const HUD_NAME = "hud";

let bridge: EvenAppBridge;
let chain: Promise<unknown> = Promise.resolve();

export function initRender(b: EvenAppBridge): void {
  bridge = b;
}

function enqueue(fn: () => Promise<unknown>): void {
  chain = chain.then(fn).catch((err) => console.error("bridge write failed:", err));
}

function hudContainer(content: string): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: 576,
    height: 288,
    borderWidth: 0,
    paddingLength: 8,
    containerID: HUD_ID,
    containerName: HUD_NAME,
    isEventCapture: 1, // all gestures arrive through this container
    content,
  });
}

// One-shot startup page. Returns the StartUpPageCreateResult code (0 = success).
export async function createPage(content: string): Promise<number> {
  return bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: 1,
      textObject: [hudContainer(content)],
    }),
  );
}

// Throttled, flicker-free HUD update. Rapid successive calls coalesce so a
// burst of status changes doesn't flood the serialized bridge queue.
let pendingContent: string | null = null;
let flushScheduled = false;

export function updateHud(content: string): void {
  pendingContent = content;
  if (flushScheduled) return;
  flushScheduled = true;
  setTimeout(() => {
    flushScheduled = false;
    if (pendingContent === null) return;
    const c = pendingContent;
    pendingContent = null;
    enqueue(() =>
      bridge.textContainerUpgrade(
        new TextContainerUpgrade({
          containerID: HUD_ID,
          containerName: HUD_NAME,
          contentOffset: 0,
          contentLength: 0,
          content: c,
        }),
      ),
    );
  }, 120);
}
