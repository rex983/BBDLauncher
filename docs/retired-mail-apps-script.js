/* eslint-disable @typescript-eslint/no-unused-vars -- Apps Script calls setup/checkMail by name */
/**
 * retiredemployees@bigbuildingsdirect.com → BBD Launcher → Slack
 *
 * Paste into a new Apps Script project (script.google.com) while signed in
 * as retiredemployees@, then:
 *   1. Project Settings → Script properties → add
 *        LAUNCHER_SECRET = <same value as RETIRED_MAIL_SECRET on Vercel>
 *   2. Select `setup` in the toolbar and click Run once (approve access).
 * From then on `checkMail` runs every minute and sends each new email's
 * sender, subject, recipients and a short preview to the launcher, which
 * tags the right managers in #bot-notifications.
 */

const ENDPOINT = "https://bbd-launcher.vercel.app/api/integrations/retired-mail";
const ADDRESS_HEADERS = ["To", "Cc", "Delivered-To", "X-Original-To", "X-Forwarded-To", "X-Forwarded-For"];

function setup() {
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("checkMail").timeBased().everyMinutes(1).create();
  // Start from now so the existing inbox isn't replayed into Slack.
  PropertiesService.getScriptProperties().setProperty("LAST_SEEN", String(Date.now()));
}

function checkMail() {
  const props = PropertiesService.getScriptProperties();
  const secret = props.getProperty("LAUNCHER_SECRET");
  if (!secret) throw new Error("Set the LAUNCHER_SECRET script property first.");
  const lastSeen = Number(props.getProperty("LAST_SEEN") || Date.now());

  // Search a little before lastSeen (Gmail's `after:` is whole seconds),
  // then keep only messages strictly newer than it.
  const after = Math.floor(lastSeen / 1000) - 120;
  const threads = GmailApp.search(`in:inbox after:${after}`, 0, 100);
  const fresh = [];
  threads.forEach((t) =>
    t.getMessages().forEach((m) => {
      if (m.getDate().getTime() > lastSeen && !m.isDraft()) fresh.push(m);
    }),
  );
  fresh.sort((a, b) => a.getDate() - b.getDate());

  let newest = lastSeen;
  for (const m of fresh) {
    const recipients = ADDRESS_HEADERS.map((h) => m.getHeader(h)).filter(Boolean);
    const res = UrlFetchApp.fetch(ENDPOINT, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: `Bearer ${secret}` },
      muteHttpExceptions: true,
      payload: JSON.stringify({
        message_id: m.getId(),
        from: m.getFrom(),
        subject: m.getSubject(),
        preview: m.getPlainBody().slice(0, 1000),
        recipients: recipients.concat([m.getTo(), m.getCc()]),
      }),
    });
    // Stop on failure and retry from here next minute, so nothing is lost.
    if (res.getResponseCode() >= 300) {
      console.error(`Launcher returned ${res.getResponseCode()}: ${res.getContentText()}`);
      break;
    }
    newest = m.getDate().getTime();
  }
  props.setProperty("LAST_SEEN", String(newest));
}
