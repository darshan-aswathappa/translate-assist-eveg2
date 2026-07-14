// POST /stripe-webhook — Stripe event sink (deployed with JWT verification
// off; authenticity comes from the Stripe signature instead).
//
//   checkout.session.completed          → mint a license key + email it to the buyer
//   customer.subscription.updated       → map Stripe status onto the license
//   customer.subscription.deleted       → license canceled
//   invoice.payment_failed              → license past_due
//
// The plan (monthly/yearly) is read from the subscription's billing interval,
// so no price-ID mapping needs to live in env. Inserts are idempotent on
// stripe_checkout_session_id — Stripe retries deliveries. Delivery is by email
// (Resend): Stripe's hosted confirmation page can only show static text, so the
// per-purchase key is mailed instead. If the email send fails we throw so the
// handler returns 500 and Stripe retries; the license row already exists, so
// the retry re-fetches the (still un-activated) key and re-sends without
// minting a duplicate.

import Stripe from "npm:stripe";
import { generateLicenseKey, serviceClient, sha256Hex } from "../_shared/license.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  httpClient: Stripe.createFetchHttpClient(),
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();

const RESEND_API_URL = "https://api.resend.com/emails";
// Resend's shared test sender only delivers to the Resend account owner; set
// RESEND_FROM to a verified-domain address to reach real buyers.
const DEFAULT_FROM = "Translate Assist <onboarding@resend.dev>";

type LicenseStatus = "active" | "past_due" | "canceled";

function statusFor(subscriptionStatus: Stripe.Subscription.Status): LicenseStatus {
  if (subscriptionStatus === "active" || subscriptionStatus === "trialing") return "active";
  if (subscriptionStatus === "past_due" || subscriptionStatus === "unpaid") return "past_due";
  return "canceled";
}

function licenseEmailHtml(licenseKey: string): string {
  return `<!doctype html><html><body style="margin:0;background:#EEEEEE;font:400 16px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;color:#1A1A1A">
<div style="max-width:420px;margin:0 auto;padding:32px 20px">
  <div style="background:#FFFFFF;border-radius:20px;padding:24px">
    <h1 style="font-size:22px;margin:0 0 12px">You're Pro 🎉</h1>
    <p style="color:#7B7B7B;font-size:14px;margin:8px 0">This is your Translate Assist Pro license key. It can be activated on <strong>one device</strong>, so keep it safe.</p>
    <div style="font:600 20px/1.3 ui-monospace,'SF Mono',Menlo,monospace;background:rgba(26,26,26,0.04);border:1px solid rgba(0,0,0,0.10);border-radius:14px;padding:16px;text-align:center;margin:16px 0;word-break:break-all">${licenseKey}</div>
    <ol style="color:#4A4A4A;font-size:14px;padding-left:20px">
      <li style="margin:6px 0">Open <strong>Translate Assist</strong> in the Even Hub app</li>
      <li style="margin:6px 0">Choose <strong>Pro</strong> (or Settings → Upgrade to Pro)</li>
      <li style="margin:6px 0">Paste the key and tap <strong>Activate</strong></li>
    </ol>
  </div>
</div></body></html>`;
}

async function sendLicenseEmail(to: string, licenseKey: string): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.error("RESEND_API_KEY not set — cannot deliver license key");
    throw new Error("RESEND_API_KEY missing");
  }
  const res = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: Deno.env.get("RESEND_FROM") ?? DEFAULT_FROM,
      to,
      subject: "Your Translate Assist Pro license key",
      html: licenseEmailHtml(licenseKey),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("resend send failed", res.status, detail.slice(0, 300));
    throw new Error(`resend ${res.status}`);
  }
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const subscriptionId = typeof session.subscription === "string"
    ? session.subscription
    : session.subscription?.id ?? null;
  if (!subscriptionId) {
    console.error("checkout session without subscription", session.id);
    return;
  }
  const email = session.customer_details?.email ?? session.customer_email ?? null;
  const supabase = serviceClient();

  // Idempotency: on a Stripe retry the row already exists. Reuse it rather than
  // minting a second key. license_key_plain is present until activation, so we
  // can still (re)send the email; once activated it's null and we stop.
  const { data: existing } = await supabase
    .from("licenses")
    .select("license_key_plain")
    .eq("stripe_checkout_session_id", session.id)
    .maybeSingle();

  let licenseKey: string | null;
  if (existing) {
    licenseKey = (existing as { license_key_plain: string | null }).license_key_plain;
  } else {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const interval = subscription.items.data[0]?.price.recurring?.interval;
    const plan = interval === "year" ? "yearly" : "monthly";

    licenseKey = generateLicenseKey();
    const { error } = await supabase.from("licenses").upsert(
      {
        license_key_hash: await sha256Hex(licenseKey),
        license_key_plain: licenseKey,
        stripe_checkout_session_id: session.id,
        stripe_customer_id: typeof session.customer === "string"
          ? session.customer
          : session.customer?.id ?? null,
        stripe_customer_email: email,
        stripe_subscription_id: subscriptionId,
        plan,
        status: "active",
      },
      { onConflict: "stripe_checkout_session_id", ignoreDuplicates: true },
    );
    if (error) {
      console.error("license insert failed", error.message);
      throw new Error("license insert failed");
    }
  }

  if (!licenseKey) return; // Already activated — nothing to deliver.
  if (!email) {
    console.error("no customer email on session — cannot deliver key", session.id);
    return;
  }
  await sendLicenseEmail(email, licenseKey);
}

async function setStatusBySubscription(subscriptionId: string, status: LicenseStatus): Promise<void> {
  const { error } = await serviceClient()
    .from("licenses")
    .update({ status })
    .eq("stripe_subscription_id", subscriptionId);
  if (error) console.error("status update failed", error.message);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "",
      undefined,
      cryptoProvider,
    );
  } catch (err) {
    console.error("signature verification failed", err instanceof Error ? err.message : String(err));
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        await setStatusBySubscription(sub.id, statusFor(sub.status));
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        await setStatusBySubscription(sub.id, "canceled");
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = typeof invoice.subscription === "string"
          ? invoice.subscription
          : invoice.subscription?.id;
        if (subId) await setStatusBySubscription(subId, "past_due");
        break;
      }
      default:
        console.log("unhandled event", event.type);
    }
  } catch (err) {
    // Return 500 so Stripe retries the delivery.
    console.error("webhook handler failed", err instanceof Error ? err.message : String(err));
    return new Response("Handler error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
