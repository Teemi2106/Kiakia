// Purpose-built pre-launch emails. Kept in the shared Edge Function folder so
// the Resend worker can render them without sending HTML through public APIs.

export const KIAKIA_PRODUCTION_URL = "https://www.kiakia.ng";

export interface LaunchEmail {
  subject: string;
  html: string;
  text: string;
}

export type LaunchEmailKind = "welcome" | "announcement";

/** Stable per outbox row so provider retries always submit the same payload. */
export async function createLaunchDeliveryToken(secret: string, outboxId: string, subscriberId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`kiakia-launch-unsubscribe:${outboxId}:${subscriberId}`),
  );
  let binary = "";
  for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function hashLaunchDeliveryToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

function safeUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") throw new Error("Launch email links must use HTTPS");
  return escapeHtml(parsed.toString());
}

function shell(args: {
  preheader: string;
  reference: string;
  eyebrow: string;
  heading: string;
  copy: string;
  closing: string;
  buttonText: string;
  buttonUrl: string;
  unsubscribeUrl: string;
  postscript?: string;
}): string {
  const buttonUrl = safeUrl(args.buttonUrl);
  const unsubscribeUrl = safeUrl(args.unsubscribeUrl);
  const logoUrl = safeUrl(`${KIAKIA_PRODUCTION_URL}/assets/logo-mark.png`);
  const foodUrl = safeUrl(`${KIAKIA_PRODUCTION_URL}/assets/hero-banner.png`);
  const safeReference = escapeHtml(args.reference);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <title>KiaKia</title>
  </head>
  <body style="margin:0;padding:0;background-color:#fff8ee;color:#2b201a;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;font-size:1px;color:#fff8ee;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(args.preheader)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#fff8ee;">
      <tr><td align="center" style="padding:28px 12px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:620px;background-color:#fffdf9;border:1px solid #f0e1d1;border-radius:18px;overflow:hidden;">
          <tr><td align="center" style="padding:25px 24px 16px;">
            <img src="${logoUrl}" width="154" alt="KiaKia" style="display:block;width:154px;max-width:60%;height:auto;border:0;">
          </td></tr>
          <tr><td style="padding:0 24px;">
            <div style="border-top:1px dashed #e8cdb5;font-size:1px;line-height:1px;">&nbsp;</div>
          </td></tr>
          <tr><td style="padding:20px 24px 0;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td style="font-size:11px;font-weight:bold;letter-spacing:1.7px;text-transform:uppercase;color:#a9442d;">${escapeHtml(args.eyebrow)}</td>
                <td align="right" style="font-size:11px;letter-spacing:1px;color:#846e5f;">${safeReference}</td>
              </tr>
            </table>
          </td></tr>
          <tr><td align="center" style="padding:20px 24px 0;">
            <span style="display:inline-block;border:2px solid #c93c2b;border-radius:5px;padding:6px 11px;color:#c93c2b;font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;transform:rotate(-3deg);">Order confirmed</span>
          </td></tr>
          <tr><td style="padding:21px 28px 8px;text-align:center;">
            <h1 style="margin:0;color:#2b201a;font-family:Georgia,'Times New Roman',serif;font-size:30px;line-height:1.2;font-weight:bold;">${escapeHtml(args.heading)}</h1>
          </td></tr>
          <tr><td style="padding:5px 30px 20px;text-align:center;color:#5f4d41;font-size:16px;line-height:1.7;">${args.copy}</td></tr>
          <tr><td style="padding:0 24px;">
            <img src="${foodUrl}" width="572" alt="A KiaKia burger with fries, freshly prepared for your next meal." style="display:block;width:100%;max-width:572px;height:auto;border:0;border-radius:12px;">
          </td></tr>
          <tr><td align="center" style="padding:24px 24px 8px;">
            <a href="${buttonUrl}" style="display:inline-block;background-color:#c63b2b;border:1px solid #c63b2b;border-radius:8px;padding:14px 24px;color:#ffffff;font-size:13px;font-weight:bold;letter-spacing:1.2px;text-decoration:none;">${escapeHtml(args.buttonText)}</a>
          </td></tr>
          <tr><td style="padding:19px 28px 25px;text-align:center;color:#725f51;font-size:14px;line-height:1.65;">
            ${args.closing}
          </td></tr>
          <tr><td style="padding:0 24px;">
            <div style="border-top:1px dashed #e8cdb5;font-size:1px;line-height:1px;">&nbsp;</div>
          </td></tr>
          <tr><td style="padding:18px 24px 25px;text-align:center;color:#846e5f;font-size:12px;line-height:1.7;">
            <p style="margin:0 0 7px;">With love and a little extra pepper,<br><strong style="color:#2b201a;">The KiaKia Team ❤️</strong></p>
            ${args.postscript ? `<p style="margin:8px 0 0;"><strong>P.S.</strong> ${escapeHtml(args.postscript)}</p>` : ""}
            <p style="margin:12px 0 0;">You received this because you joined KiaKia's launch list. <a href="${unsubscribeUrl}" style="color:#a9442d;text-decoration:underline;">Unsubscribe</a></p>
            <p style="margin:9px 0 0;">KiaKia · Made for Lagos appetites.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export function buildLaunchEmail(kind: LaunchEmailKind, unsubscribeUrl: string): LaunchEmail {
  if (kind === "welcome") {
    return {
      subject: "You're on the list! 🍔 KiaKia is cooking...",
      html: shell({
        preheader: "Your KiaKia seat is saved. Good food is getting closer.",
        reference: "KK-FIRST-001",
        eyebrow: "KiaKia · first-to-know list",
        heading: "You're officially on the list!",
        copy: "Hey foodie! 👋<br><br>Well, look who's getting ready to eat! 🎉<br><br>You're on the KiaKia first-to-know list. You secured your spot for behind-the-scenes kitchen prep and a note the moment KiaKia opens.",
        closing: "Your seat is saved, and your appetite can start planning. <strong style=\"color:#a9442d;\">Good food is coming. Fast fast!</strong>",
        buttonText: "SEE THE COUNTDOWN",
        buttonUrl: `${KIAKIA_PRODUCTION_URL}/`,
        unsubscribeUrl,
        postscript: "Start practising your ‘what should I eat first?’ face. 😄",
      }),
      text: [
        "Hey foodie! 👋",
        "",
        "Well, look who's getting ready to eat! 🎉",
        "You're officially on the KiaKia first-to-know list. You secured your spot for behind-the-scenes kitchen prep and a note the moment KiaKia opens.",
        "",
        "Your seat is saved, and your appetite can start planning. Good food is coming. Fast fast!",
        "",
        `See the countdown: ${KIAKIA_PRODUCTION_URL}/`,
        "",
        "With love and a little extra pepper,",
        "The KiaKia Team ❤️",
        "",
        "P.S. Start practising your ‘what should I eat first?’ face. 😄",
        "",
        `Unsubscribe: ${unsubscribeUrl}`,
      ].join("\n"),
    };
  }

  return {
    subject: "We're open! KiaKia is serving Lagos 🍔",
    html: shell({
      preheader: "The wait is over. KiaKia is now ready to serve Lagos.",
      reference: "KK-OPEN-001",
      eyebrow: "KiaKia · launch announcement",
      heading: "Lagos, the kitchen is open!",
      copy: "The wait is over. KiaKia is live, and your next favourite meal is only a few taps away.<br><br>Explore the menu, find something delicious, and let us bring it to you.",
      closing: "The kitchen is ready, Lagos. Pick your next favourite and let KiaKia bring it to you. <strong style=\"color:#a9442d;\">Let's eat!</strong>",
      buttonText: "EXPLORE KIAKIA",
      buttonUrl: `${KIAKIA_PRODUCTION_URL}/home`,
      unsubscribeUrl,
    }),
    text: [
      "Lagos, the kitchen is open!",
      "The wait is over. KiaKia is live, and your next favourite meal is only a few taps away.",
      "Explore the menu, find something delicious, and let us bring it to you.",
      "",
      `Explore KiaKia: ${KIAKIA_PRODUCTION_URL}/home`,
      "",
      "The KiaKia Team ❤️",
      "",
      `Unsubscribe: ${unsubscribeUrl}`,
    ].join("\n"),
  };
}
