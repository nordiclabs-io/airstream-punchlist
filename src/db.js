import { supabase, PHOTO_BUCKET, VIEWER_EMAIL, EDITOR_EMAIL } from "./supabase.js";
import { SEED } from "./seed.js";

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/* The photo bucket is private, so images are served through short-lived signed URLs.
   fetchAll refreshes them on every load, on window focus, and on any live change. */
const SIGNED_URL_TTL = 60 * 60 * 8;

async function signedUrlMap(paths) {
  if (!supabase || paths.length === 0) return {};
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL);
  if (error) return {};
  const map = {};
  (data || []).forEach((d) => { if (d.path && d.signedUrl) map[d.path] = d.signedUrl; });
  return map;
}

/* ---------- shared login ---------- */

/** True when this session may change things (i.e. the edit code was used). */
export function sessionCanEdit(session) {
  return !!session && session.user && session.user.email === EDITOR_EMAIL;
}

/* One box, two possible codes: try the view code first since most people have
   that one, then the edit code. Returns true when the code grants editing. */
export async function signIn(code) {
  const viewer = await supabase.auth.signInWithPassword({ email: VIEWER_EMAIL, password: code });
  if (!viewer.error) return false;

  const editor = await supabase.auth.signInWithPassword({ email: EDITOR_EMAIL, password: code });
  if (!editor.error) return true;

  throw editor.error;
}

export async function signOut() {
  try { await supabase.auth.signOut(); } catch { /* already gone */ }
}

export async function currentSession() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function onAuthChange(cb) {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_e, session) => cb(session));
  return () => { try { data.subscription.unsubscribe(); } catch { /* ok */ } };
}

/* Map a DB issue row (+related) to the shape the UI uses */
function toUiIssue(row, notes, photos, urlMap) {
  return {
    id: row.id,
    num: row.num,
    loc: row.loc,
    desc: row.descr,
    safety: row.safety,
    status: row.status,
    x: row.x,
    y: row.y,
    notes: notes
      .filter((n) => n.issue_id === row.id)
      .map((n) => ({ id: n.id, author: n.author, type: n.type, text: n.body, resolved: n.resolved, ts: new Date(n.created_at).getTime() })),
    photos: photos
      .filter((p) => p.issue_id === row.id)
      .map((p) => ({ id: p.id, path: p.path, url: urlMap[p.path] || "" })),
  };
}

export async function fetchAll() {
  const [{ data: issues, error: e1 }, { data: notes, error: e2 }, { data: photos, error: e3 }] = await Promise.all([
    supabase.from("issues").select("*").order("num", { ascending: true }),
    supabase.from("notes").select("*").order("created_at", { ascending: true }),
    supabase.from("photos").select("*").order("created_at", { ascending: true }),
  ]);
  if (e1 || e2 || e3) throw e1 || e2 || e3;
  const urlMap = await signedUrlMap((photos || []).map((p) => p.path));
  return {
    issues: (issues || []).map((r) => toUiIssue(r, notes || [], photos || [], urlMap)),
    nextNum: (issues || []).reduce((m, r) => Math.max(m, r.num), 0) + 1,
  };
}

/** Insert the 23 shakedown issues on first ever load. */
export async function seedIfEmpty() {
  const { count, error } = await supabase.from("issues").select("id", { count: "exact", head: true });
  if (error) throw error;
  if (count && count > 0) return false;
  const rows = SEED.map((s) => ({ num: s.n, loc: s.loc, descr: s.desc, safety: s.safety, status: "open", x: s.x, y: s.y }));
  const { error: e2 } = await supabase.from("issues").insert(rows);
  if (e2) throw e2;
  return true;
}

export async function createIssue({ num, x, y }) {
  const { data, error } = await supabase
    .from("issues")
    .insert({ num, x, y, loc: "New issue", descr: "" })
    .select()
    .single();
  if (error) throw error;
  return toUiIssue(data, [], [], {});
}

export async function updateIssueDb(id, patch) {
  const dbPatch = {};
  if ("loc" in patch) dbPatch.loc = patch.loc;
  if ("desc" in patch) dbPatch.descr = patch.desc;
  if ("safety" in patch) dbPatch.safety = patch.safety;
  if ("status" in patch) dbPatch.status = patch.status;
  if ("x" in patch) dbPatch.x = patch.x;
  if ("y" in patch) dbPatch.y = patch.y;
  if (Object.keys(dbPatch).length === 0) return;
  const { error } = await supabase.from("issues").update(dbPatch).eq("id", id);
  if (error) throw error;
}

export async function deleteIssueDb(issue) {
  if (issue.photos && issue.photos.length) {
    try { await supabase.storage.from(PHOTO_BUCKET).remove(issue.photos.map((p) => p.path)); }
    catch { /* files may already be gone */ }
  }
  const { error } = await supabase.from("issues").delete().eq("id", issue.id);
  if (error) throw error;
}

export async function addNoteDb(issueId, { author, type, text }) {
  const { data, error } = await supabase
    .from("notes")
    .insert({ issue_id: issueId, author, type, body: text })
    .select()
    .single();
  if (error) throw error;
  return { id: data.id, author: data.author, type: data.type, text: data.body, resolved: data.resolved, ts: new Date(data.created_at).getTime() };
}

export async function resolveNoteDb(noteId) {
  const { error } = await supabase.from("notes").update({ resolved: true }).eq("id", noteId);
  if (error) throw error;
}

export async function addPhotoDb(issueId, blob) {
  const path = `${issueId}/${uid()}.jpg`;
  const { error: e1 } = await supabase.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: "image/jpeg" });
  if (e1) throw e1;
  const { data, error: e2 } = await supabase.from("photos").insert({ issue_id: issueId, path }).select().single();
  if (e2) throw e2;
  const { data: signed } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
  return { id: data.id, path, url: (signed && signed.signedUrl) || "" };
}

export async function deletePhotoDb(photo) {
  try { await supabase.storage.from(PHOTO_BUCKET).remove([photo.path]); }
  catch { /* file may already be gone */ }
  const { error } = await supabase.from("photos").delete().eq("id", photo.id);
  if (error) throw error;
}

/** Live updates: call cb whenever anyone else changes anything. Returns unsubscribe fn. */
export function subscribeAll(cb) {
  const channel = supabase
    .channel("punchlist-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "issues" }, cb)
    .on("postgres_changes", { event: "*", schema: "public", table: "notes" }, cb)
    .on("postgres_changes", { event: "*", schema: "public", table: "photos" }, cb)
    .subscribe();
  return () => { try { supabase.removeChannel(channel); } catch { /* ok */ } };
}
