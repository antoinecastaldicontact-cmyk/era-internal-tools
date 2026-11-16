/**
 * ERA Release Drive
 *
 * Gives era-internal-tools what it needs to drop release files into Google Drive,
 * without a Google Cloud project or a service account (same mechanism as 129 Onboarding Drive):
 *   - a short-lived Drive token for the server (never sent to the artist's browser),
 *   - the ID of the root folder « ERA — Releases », created in the Drive of the script owner,
 *   - the internal mail « Release form submitted » (action « mail », MailApp).
 *
 * Setup (once, signed in as acastaldi@eramusic.io):
 *   1. script.google.com > New project > paste this file and appsscript.json (Project settings > show manifest).
 *   2. Run setup() once, accept the permissions. The log prints RELEASE_APPS_SCRIPT_SECRET and the folder link.
 *   3. Deploy > New deployment > Web app — Execute as: Me ; Who has access: Anyone.
 *   4. Give the /exec URL and the secret to Claude (Vercel env RELEASE_APPS_SCRIPT_URL / RELEASE_APPS_SCRIPT_SECRET).
 * The root folder can be moved anywhere in your Drive: its ID does not change.
 *
 * Code update: Deploy > Manage deployments > pencil > Version: New version.
 * Never create a new deployment: the /exec URL would change.
 */

const ROOT_NAME = 'ERA — Releases';
const ROOT_ID = ''; // empty = folder created by setup()

function setup() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SECRET')) {
    props.setProperty('SECRET', (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''));
  }
  const root = rootFolder_();
  Logger.log('RELEASE_APPS_SCRIPT_SECRET = ' + props.getProperty('SECRET'));
  Logger.log('Root folder: https://drive.google.com/drive/folders/' + root);
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) {}
  const secret = PropertiesService.getScriptProperties().getProperty('SECRET');
  if (!secret || body.secret !== secret) return json_({ error: 'forbidden' });
  if (body.action === 'mail') return mail_(body);
  return json_({ token: ScriptApp.getOAuthToken(), rootId: rootFolder_(), expiresIn: 1200 });
}

// Internal mail: recipients come from the server config (ERA), never from the artist.
function mail_(b) {
  const to = (Array.isArray(b.to) ? b.to : []).filter(function (a) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a); }).slice(0, 10);
  if (!to.length || !b.subject) return json_({ error: 'mail: missing recipients or subject' });
  const opts = { name: 'ERA Release Form' };
  if (b.html) opts.htmlBody = String(b.html);
  if (b.replyTo && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.replyTo)) opts.replyTo = b.replyTo;
  try {
    MailApp.sendEmail(to.join(','), String(b.subject).slice(0, 250), String(b.text || ''), opts);
    return json_({ sent: true, to: to });
  } catch (err) {
    return json_({ error: 'mail: ' + err.message });
  }
}

function doGet() {
  return json_({ ok: true, service: 'ERA Release Drive' });
}

function rootFolder_() {
  if (ROOT_ID) return ROOT_ID;
  const props = PropertiesService.getScriptProperties();
  const known = props.getProperty('ROOT_ID');
  if (known) return known;
  const res = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ name: ROOT_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  });
  const id = JSON.parse(res.getContentText()).id;
  props.setProperty('ROOT_ID', id);
  return id;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
