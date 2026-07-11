// Glasses-mic capture. After the startup page exists, audioControl(true) opens
// the G2 microphone (AudioInputSource.Glasses) and PCM frames arrive through the
// shared onEvenHubEvent stream as event.audioEvent.audioPcm. We surface each
// frame as a normalized Uint8Array to a sink (the stream client).
//
// NOTE: createStartUpPageContainer MUST succeed before audioControl is called.

import {
  type EvenAppBridge,
  AudioInputSource,
} from "@evenrealities/even_hub_sdk";
import { toPcmBytes } from "./pcm";

export type PcmSink = (frame: Uint8Array) => void;

export interface AudioCapture {
  /** Handle every onEvenHubEvent so audio frames reach the sink. */
  handleEvent: (event: { audioEvent?: { audioPcm?: unknown } }) => void;
  /** Stop the mic. Safe to call multiple times. */
  stop: () => Promise<void>;
}

// Start glasses-mic capture and route frames to `sink`. Returns a handle whose
// handleEvent must be invoked from the app's single onEvenHubEvent subscription.
export async function startCapture(
  bridge: EvenAppBridge,
  sink: PcmSink,
): Promise<AudioCapture> {
  await bridge.audioControl(true, AudioInputSource.Glasses);
  let running = true;

  return {
    handleEvent(event) {
      if (!running) return;
      const pcm = event.audioEvent?.audioPcm;
      if (pcm === undefined || pcm === null) return;
      const bytes = toPcmBytes(pcm);
      if (bytes.length > 0) sink(bytes);
    },
    async stop() {
      if (!running) return;
      running = false;
      try {
        await bridge.audioControl(false);
      } catch (err) {
        console.error("audioControl(false) failed:", err);
      }
    },
  };
}
