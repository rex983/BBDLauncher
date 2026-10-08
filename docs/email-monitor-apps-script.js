/* eslint-disable @typescript-eslint/no-unused-vars -- Apps Script calls setup/checkMail by name */
/**
 * Email monitor: a watched mailbox → BBD Launcher → Slack
 * Managed and monitored at https://bbd-launcher.vercel.app/admin/email-monitor
 *
 * One script for every watched mailbox (retiredemployees@, orders@). It
 * reports which mailbox it runs on, so install a copy on each account:
 * paste into a new Apps Script project (script.google.com) while signed in
 * as that mailbox, then:
 *   1. Project Settings → Script properties → add
 *        LAUNCHER_SECRET = <same value as RETIRED_MAIL_SECRET on Vercel>
 *   2. Pick `setup` in the toolbar's function dropdown and click Run once
 *      (approve access).
 * From then on `checkMail` runs every minute and sends each new email's
 * sender, subject, recipients, a short preview and its bulk-mail headers to
 * the launcher. The launcher decides whether it's real (Slack alert) or junk
 * (left in the archive, labelled "Launcher/Junk" here). Every orders@ email
 * alerts.
 *
 * Updating an existing install: replace the code and Save. No need to run
 * setup again.
 */

const LAUNCHER = "https://bbd-launcher.vercel.app";
const ENDPOINT = `${LAUNCHER}/api/integrations/retired-mail`;
const HEARTBEAT = `${ENDPOINT}/heartbeat`;
// The account this script runs as, i.e. the mailbox it watches. The
// trailing _ keeps it out of the Run menu, so only setup/checkMail show.
function mailbox_() {
  return Session.getEffectiveUser().getEmail().toLowerCase();
}
const HEARTBEAT_EVERY_MS = 5 * 60 * 1000;
const JUNK_LABEL = "Launcher/Junk";
const ADDRESS_HEADERS = ["X-Gm-Original-To", "To", "Cc", "Delivered-To", "X-Original-To", "X-Forwarded-To", "X-Forwarded-For"];
// Signals the spam filter uses to tell newsletters from people.
const BULK_HEADERS = ["List-Unsubscribe", "List-Id", "Precedence", "Auto-Submitted", "Return-Path", "X-Mailer"];

function setup() {
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("checkMail").timeBased().everyMinutes(1).create();
  // Start from now so the existing inbox isn't replayed into Slack.
  PropertiesService.getScriptProperties().setProperty("LAST_SEEN", String(Date.now()));
}

function post(url, secret, body) {
  return UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: `Bearer ${secret}` },
    muteHttpExceptions: true,
    payload: JSON.stringify({ mailbox: mailbox_(), ...body }),
  });
}

function checkMail() {
  const props = PropertiesService.getScriptProperties();
  const secret = props.getProperty("LAUNCHER_SECRET");
  if (!secret) throw new Error("Set the LAUNCHER_SECRET script property first.");
  try {
    processNewMail(props, secret);
  } catch (err) {
    // Tell the launcher so /admin/email-monitor shows it, then fail the run.
    post(HEARTBEAT, secret, { error: String(err && err.message ? err.message : err).slice(0, 1000) });
    throw err;
  }
  // Check in every few minutes so the launcher knows the script is alive.
  const lastPing = Number(props.getProperty("LAST_PING") || 0);
  if (Date.now() - lastPing > HEARTBEAT_EVERY_MS) {
    const res = post(HEARTBEAT, secret, {});
    if (res.getResponseCode() < 300) props.setProperty("LAST_PING", String(Date.now()));
  }
}

function processNewMail(props, secret) {
  const lastSeen = Number(props.getProperty("LAST_SEEN") || Date.now());

  // Search a little before lastSeen (Gmail's `after:` is whole seconds),
  // then keep only messages strictly newer than it. `in:anywhere` because
  // forwarding often archives or trashes Gmail's copy right away.
  const after = Math.floor(lastSeen / 1000) - 120;
  const query = `in:anywhere after:${after} -in:sent -in:drafts -in:spam`;
  const threads = GmailApp.search(query, 0, 100);
  const fresh = [];
  threads.forEach((t) =>
    t.getMessages().forEach((m) => {
      if (m.getDate().getTime() > lastSeen && !m.isDraft()) fresh.push({ m, t });
    }),
  );
  fresh.sort((a, b) => a.m.getDate() - b.m.getDate());
  if (fresh.length) console.log(`${fresh.length} new message(s) since ${new Date(lastSeen).toISOString()}`);

  // Gmail's own tabs, as a spam signal. Apps Script can't read a message's
  // category directly, so ask which of these threads are in each tab.
  const category = {};
  if (fresh.length) {
    ["promotions", "social", "updates", "forums"].forEach((c) =>
      GmailApp.search(`${query} category:${c}`, 0, 100).forEach((t) => (category[t.getId()] = c)),
    );
  }

  let newest = lastSeen;
  for (const { m, t } of fresh) {
    const headers = {};
    BULK_HEADERS.forEach((h) => {
      const v = m.getHeader(h);
      if (v) headers[h] = String(v).slice(0, 2000);
    });
    const res = post(ENDPOINT, secret, {
      message_id: m.getId(),
      from: m.getFrom(),
      subject: m.getSubject(),
      preview: m.getPlainBody().slice(0, 1000),
      recipients: ADDRESS_HEADERS.map((h) => m.getHeader(h)).filter(Boolean).concat([m.getTo(), m.getCc()]),
      headers,
      category: category[t.getId()] || null,
    });
    console.log(`"${m.getSubject()}" → ${res.getResponseCode()} ${res.getContentText()}`);
    // Stop on failure and retry from here next minute, so nothing is lost.
    if (res.getResponseCode() >= 300) {
      props.setProperty("LAST_SEEN", String(newest));
      throw new Error(`Launcher returned ${res.getResponseCode()}: ${res.getContentText()}`);
    }
    try {
      if (JSON.parse(res.getContentText()).junk) {
        t.addLabel(GmailApp.getUserLabelByName(JUNK_LABEL) || GmailApp.createLabel(JUNK_LABEL));
      }
    } catch (e) {
      console.log(`Couldn't label: ${e}`);
    }
    newest = m.getDate().getTime();
  }
  props.setProperty("LAST_SEEN", String(newest));
}
