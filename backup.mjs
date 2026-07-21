#!/usr/bin/env node
/*
 * Backs up the punch list: every issue, note and photo record, plus the photo
 * files themselves, into a timestamped folder.
 *
 *   node backup.mjs
 *
 * Reads credentials from .env.local (same file the dev server uses).
 * Writes to ~/Documents/airstream-punchlist-backups/<timestamp>/
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function readEnv() {
  const file = path.join(import.meta.dirname, ".env.local");
  if (!fs.existsSync(file)) {
    console.error("Missing .env.local — copy .env.example and fill it in.");
    process.exit(1);
  }
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

const env = readEnv();
const URL_BASE = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const EMAIL = process.env.PUNCHLIST_EMAIL || "crew@srairbud.app";
const CODE = process.env.PUNCHLIST_CODE;

if (!CODE) {
  console.error("Set the access code first, e.g.:\n  PUNCHLIST_CODE=123456 node backup.mjs");
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = path.join(os.homedir(), "Documents", "airstream-punchlist-backups", stamp);
fs.mkdirSync(path.join(outDir, "photos"), { recursive: true });

async function main() {
  // 1. Sign in
  const authRes = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: CODE }),
  });
  const auth = await authRes.json();
  if (!auth.access_token) {
    console.error("Sign-in failed:", auth.msg || auth.error_description || JSON.stringify(auth));
    process.exit(1);
  }
  const H = { apikey: ANON, Authorization: `Bearer ${auth.access_token}` };

  // 2. Table data
  const tables = {};
  for (const t of ["issues", "notes", "photos"]) {
    const r = await fetch(`${URL_BASE}/rest/v1/${t}?select=*`, { headers: H });
    tables[t] = await r.json();
    if (!Array.isArray(tables[t])) {
      console.error(`Could not read ${t}:`, JSON.stringify(tables[t]));
      process.exit(1);
    }
    console.log(`  ${String(tables[t].length).padStart(3)} ${t}`);
  }
  tables.issues.sort((a, b) => a.num - b.num);
  fs.writeFileSync(
    path.join(outDir, "data.json"),
    JSON.stringify({ exported_at: new Date().toISOString(), ...tables }, null, 2)
  );

  // 3. A human-readable copy, so the list survives even without this app
  const lines = [`SR AIR BUD — FIX-IT PUNCH LIST`, `Backed up ${new Date().toString()}`, ""];
  for (const i of tables.issues) {
    lines.push(`#${i.num} [${i.status.toUpperCase()}]${i.safety ? " [SAFETY]" : ""} ${i.loc}`);
    if (i.descr) lines.push(`    ${i.descr}`);
    for (const n of tables.notes.filter((n) => n.issue_id === i.id)) {
      lines.push(`    - ${n.author || "Note"}${n.type === "question" ? " (question)" : ""}: ${n.body}`);
    }
    const pc = tables.photos.filter((p) => p.issue_id === i.id).length;
    if (pc) lines.push(`    (${pc} photo${pc > 1 ? "s" : ""})`);
    lines.push("");
  }
  fs.writeFileSync(path.join(outDir, "punchlist.txt"), lines.join("\n"));

  // 4. Photo files, fetched through signed URLs
  let ok = 0, failed = 0;
  for (const p of tables.photos) {
    const signRes = await fetch(`${URL_BASE}/storage/v1/object/sign/punchlist-photos/${p.path}`, {
      method: "POST",
      headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: 600 }),
    });
    const sign = await signRes.json();
    if (!sign.signedURL) { failed++; console.warn(`  ! could not sign ${p.path}`); continue; }
    const bin = await fetch(`${URL_BASE}/storage/v1${sign.signedURL}`);
    if (!bin.ok) { failed++; console.warn(`  ! could not download ${p.path}`); continue; }
    const issue = tables.issues.find((i) => i.id === p.issue_id);
    const name = `issue-${String(issue ? issue.num : 0).padStart(2, "0")}-${path.basename(p.path)}`;
    fs.writeFileSync(path.join(outDir, "photos", name), Buffer.from(await bin.arrayBuffer()));
    ok++;
  }
  console.log(`  ${ok} photos downloaded${failed ? `, ${failed} FAILED` : ""}`);

  console.log(`\nBackup written to:\n  ${outDir}`);
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
