// Tier resolution: which credentials drive the pipeline. Pro (a stored device
// token from a redeemed license) wins over free (bring-your-own keys); with
// neither, the phone UI shows the onboarding tier picker.

import type { UserKeys } from "./phone/keys";

export type Tier = "free" | "pro";

export type Credentials =
  | { tier: "free"; keys: UserKeys }
  | { tier: "pro"; deviceToken: string };

export function resolveCredentials(
  keys: UserKeys,
  deviceToken: string,
): Credentials | null {
  if (deviceToken) return { tier: "pro", deviceToken };
  if (keys.deepgramKey && keys.anthropicKey) return { tier: "free", keys };
  return null;
}
