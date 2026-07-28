// Shared HTML chrome every outbound email (dispatch-notification and
// notify-account-event triggers) renders its content into — one wrapper so
// the scorecard-ledger visual identity (hunter-green header, cream body,
// brass rule) only needs building once rather than duplicated across the
// seven per-trigger templates that come after this. Built to current HTML
// email conventions: table-based layout (Outlook's Word rendering engine
// has no flexbox/grid support), width set as both an attribute and an
// inline style on every <td>, all styling inlined per-element rather than
// left in a <style> block (several clients strip <style> wholesale) — the
// one exception is the prefers-color-scheme override block itself, which
// has to live in <style> to work at all. Clients that strip it just keep
// the inline (light-mode) styles, which is why every element still carries
// its own correct light-mode style attribute regardless of the class.
const FONT_DISPLAY = "Georgia, 'Times New Roman', Times, serif";
const FONT_DATA =
  "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace";
const FONT_SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// Mirrors app.css's scorecard palette (--color-fairway etc.) — that file
// isn't reachable from Deno/email-land, so the hex values are duplicated
// here rather than imported.
const FAIRWAY = "#1b3a2b";
const SCORECARD = "#f3efe3";
const BRASS = "#b8925a";
const INK = "#1a1815";
const SAND = "#dcd0b4";
const MUTED = "#6b6558";

// Dark-mode counterparts: app.css's palette is light-mode-only (scoped to
// the homepage's ledger treatment), so these hold the same hunter-green/
// brass/cream relationship at inverted luminance rather than coming from
// an existing token.
const DARK_OUTER_BG = "#0f0e0c";
const DARK_CARD_BG = "#221f19";

export interface EmailLayoutParams {
  /** Hidden preview text shown in inbox lists before the email is opened. */
  previewText: string;
  /** Large heading at the top of the body card. */
  heading: string;
  /** Pre-built inner HTML — compose with emailParagraph()/emailButton(). */
  bodyHtml: string;
}

export function renderEmailLayout(
  { previewText, heading, bodyHtml }: EmailLayoutParams,
): string {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<title>${escapeHtml(heading)}</title>
<style>
  @media (prefers-color-scheme: dark) {
    .email-outer-bg { background-color: ${DARK_OUTER_BG} !important; }
    .email-card-bg { background-color: ${DARK_CARD_BG} !important; }
    .email-text { color: ${SCORECARD} !important; }
    .email-muted-text { color: ${SAND} !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background-color:${SCORECARD};">
<div style="display:none; max-height:0; overflow:hidden; opacity:0; mso-hide:all;">
${escapeHtml(previewText)}
&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-outer-bg" style="width:100%; background-color:${SCORECARD};">
  <tr>
    <td align="center" style="padding:24px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="email-card-bg" style="width:600px; max-width:600px; background-color:${SCORECARD}; border:1px solid ${BRASS}; border-radius:8px; overflow:hidden;">
        <tr>
          <td bgcolor="${FAIRWAY}" style="background-color:${FAIRWAY}; padding:20px 24px;">
            <span style="font-family:${FONT_DATA}; font-size:12px; letter-spacing:2px; text-transform:uppercase; color:${BRASS};">EMGC &middot; Bet</span>
          </td>
        </tr>
        <tr>
          <td bgcolor="${BRASS}" style="height:4px; line-height:4px; font-size:0; background-color:${BRASS};">&nbsp;</td>
        </tr>
        <tr>
          <td class="email-card-bg" style="background-color:${SCORECARD}; padding:32px 24px;">
            <h1 class="email-text" style="margin:0 0 16px; font-family:${FONT_DISPLAY}; font-size:24px; line-height:1.3; color:${INK};">${
    escapeHtml(heading)
  }</h1>
${bodyHtml}
          </td>
        </tr>
        <tr>
          <td class="email-card-bg" style="background-color:${SCORECARD}; padding:0 24px 24px;">
            <p class="email-muted-text" style="margin:0; font-family:${FONT_SANS}; font-size:12px; line-height:1.5; color:${MUTED};">EMGC Calcutta &mdash; you're receiving this because of activity on your account. Manage notification preferences in Settings.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

export function emailParagraph(text: string): string {
  return `            <p class="email-text" style="margin:0 0 16px; font-family:${FONT_SANS}; font-size:15px; line-height:1.6; color:${INK};">${
    escapeHtml(text)
  }</p>`;
}

export function emailButton(label: string, url: string): string {
  return `            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 4px;">
              <tr>
                <td bgcolor="${FAIRWAY}" style="background-color:${FAIRWAY}; border-radius:4px;">
                  <a href="${
    escapeHtml(url)
  }" style="display:inline-block; padding:12px 24px; font-family:${FONT_SANS}; font-size:14px; font-weight:600; color:${BRASS}; text-decoration:none;">${
    escapeHtml(label)
  }</a>
                </td>
              </tr>
            </table>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
