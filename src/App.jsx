import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { supabase } from "./supabase.js";
import { SEED } from "./seed.js";
import {
  fetchAll, seedIfEmpty, createIssue, updateIssueDb, deleteIssueDb,
  addNoteDb, resolveNoteDb, addPhotoDb, deletePhotoDb, subscribeAll,
  signIn, signOut, currentSession, onAuthChange, sessionCanEdit,
} from "./db.js";

/* ================= Sr Air Bud — Fix-It Tracker =================
   2026 Airstream Classic 28RB Twin — shakedown punch list
   One shared workspace for the owner and the service team.
================================================================= */

import { PLAN_IMG } from "./floorplan.js";

const VB_W = 1000, VB_H = 373, IMG_Y = 30, IMG_H = 313;

const STATUS = {
  open: { label: "Open", color: "#C0392B", bg: "#FBEAE7" },
  progress: { label: "In progress", color: "#B57A0E", bg: "#FBF3E0" },
  fixed: { label: "Fixed", color: "#2E7D4F", bg: "#E7F3EC" },
  verified: { label: "Verified", color: "#2C6E8A", bg: "#E6F0F5" },
};
const STATUS_ORDER = ["open", "progress", "fixed", "verified"];

const REDUCE_MOTION = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const noteWho = (n) => n.author || "Note";
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);

/* ---------- image compression (returns a JPEG Blob) ---------- */
function compressImage(file, maxDim = 1200, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        c.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("compress failed"))), "image/jpeg", quality);
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ================= Floorplan ================= */
function Floorplan({ issues, selectedId, onSelectPin, placing, onPlace, filterFn }) {
  const svgRef = useRef(null);

  const toViewBox = (e) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * VB_W;
    const y = ((e.clientY - rect.top) / rect.height) * VB_H;
    return { x: Math.round(x), y: Math.round(y) };
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      style={{ width: "100%", display: "block", cursor: placing ? "crosshair" : "default", touchAction: "manipulation" }}
      onClick={(e) => { if (placing) { const p = toViewBox(e); if (p) onPlace(p); } }}
      role="img" aria-label="Floorplan of the Airstream Classic 28RB Twin with issue pins"
    >
      <image href={PLAN_IMG} x="0" y={IMG_Y} width={VB_W} height={IMG_H} preserveAspectRatio="xMidYMid meet" />

      <g fill="#6B737A" fontFamily="'Barlow Condensed', system-ui, sans-serif" fontSize="16" letterSpacing="1.5">
        <text x="180" y="16" textAnchor="middle">ROADSIDE (DRIVER)</text>
        <text x="180" y="368" textAnchor="middle">CURBSIDE (ENTRY)</text>
        <text x="962" y="252" textAnchor="middle">HITCH</text>
        <text x="30" y="192" textAnchor="middle" transform="rotate(-90 30 192)">REAR</text>
      </g>

      {issues.filter(filterFn).slice().sort((a, b) => (a.id === selectedId ? 1 : 0) - (b.id === selectedId ? 1 : 0)).map((it) => {
        const st = STATUS[it.status] || STATUS.open;
        const sel = it.id === selectedId;
        const dimmed = selectedId && !sel;
        return (
          <g key={it.id} transform={`translate(${it.x},${it.y})`}
            style={{ cursor: "pointer", opacity: dimmed ? 0.22 : 1, transition: REDUCE_MOTION ? "none" : "opacity .25s ease" }}
            onClick={(e) => { e.stopPropagation(); if (!placing) onSelectPin(it.id); }}>
            {sel && (
              <circle r="22" fill="none" stroke={st.color} strokeWidth="3" opacity="0.6">
                {!REDUCE_MOTION && <animate attributeName="r" values="18;32;18" dur="1.5s" repeatCount="indefinite" />}
                {!REDUCE_MOTION && <animate attributeName="opacity" values="0.75;0.1;0.75" dur="1.5s" repeatCount="indefinite" />}
              </circle>
            )}
            {it.safety && <circle r={sel ? 24 : 19} fill="none" stroke="#C0392B" strokeWidth="3" strokeDasharray="4 3" />}
            <circle r={sel ? 18 : 14} fill={st.color} stroke="#FFFFFF" strokeWidth={sel ? 3 : 2.5} />
            <text y={sel ? 6 : 5} textAnchor="middle" fill="#fff" fontSize={sel ? 16 : 14} fontWeight="700"
              fontFamily="'Barlow Condensed', system-ui, sans-serif">{it.num}</text>
          </g>
        );
      })}
    </svg>
  );
}

/* ================= Photo strip ================= */
function Photos({ issue, onAdd, onRemove, demo, canEdit }) {
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(null);
  const fileRef = useRef(null);

  const handleFiles = async (files) => {
    setBusy(true);
    for (const f of Array.from(files)) {
      try {
        const blob = await compressImage(f);
        if (demo) {
          onAdd({ id: uid(), path: "", url: URL.createObjectURL(blob) });
        } else {
          const photo = await addPhotoDb(issue.id, blob);
          onAdd(photo);
        }
      } catch { /* skip unreadable file */ }
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {issue.photos.map((p) => (
          <div key={p.id} style={{ position: "relative" }}>
            <img src={p.url} alt="Issue photo" onClick={() => setZoom(p.url)}
              style={{ width: 74, height: 74, objectFit: "cover", borderRadius: 8, border: "1px solid #C9CFD4", cursor: "zoom-in" }} />
            {canEdit && (
              <button aria-label="Remove photo" onClick={async () => {
                if (!demo) { try { await deletePhotoDb(p); } catch { /* ok */ } }
                onRemove(p);
              }}
                style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: 10, border: "none", background: "#3A4046", color: "#fff", fontSize: 11, cursor: "pointer", lineHeight: "20px", padding: 0 }}>×</button>
            )}
          </div>
        ))}
        {canEdit && (
          <button onClick={() => fileRef.current && fileRef.current.click()} disabled={busy}
            style={{ width: 74, height: 74, borderRadius: 8, border: "2px dashed #9AA1A7", background: "transparent", color: "#5B6369", cursor: "pointer", fontSize: 12 }}>
            {busy ? "Saving…" : "+ Photo"}
          </button>
        )}
        {!canEdit && issue.photos.length === 0 && (
          <span style={{ fontSize: 13, color: "#8A9298" }}>No photos yet.</span>
        )}
        <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }}
          onChange={(e) => e.target.files && e.target.files.length && handleFiles(e.target.files)} />
      </div>
      {zoom && (
        <div onClick={() => setZoom(null)} role="dialog" aria-label="Photo preview"
          style={{ position: "fixed", inset: 0, background: "rgba(20,23,26,0.86)", display: "grid", placeItems: "center", zIndex: 60, cursor: "zoom-out", padding: 16 }}>
          <img src={zoom} alt="Enlarged issue photo" style={{ maxWidth: "100%", maxHeight: "90vh", borderRadius: 10 }} />
        </div>
      )}
    </div>
  );
}

/* ================= Access code screen ================= */
function CodeGate({ onUnlock }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true); setErr("");
    try {
      const canEdit = await signIn(code.trim());
      onUnlock(canEdit);
    } catch {
      setErr("That code didn't work. Check with the owner and try again.");
      setBusy(false);
    }
  };

  return (
    <div style={{ fontFamily: "'Barlow', system-ui, sans-serif", background: "#F2F1EC", minHeight: "100vh", display: "grid", placeItems: "center", padding: 20, color: "#23272B" }}>
      <form onSubmit={submit} style={{ background: "#fff", border: "1px solid #C9CFD4", borderRadius: 14, padding: 24, maxWidth: 360, width: "100%", boxShadow: "0 4px 14px rgba(35,39,43,0.08)" }}>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 22, letterSpacing: 1.2, textTransform: "uppercase", borderBottom: "3px solid #C0392B", paddingBottom: 8, marginBottom: 14 }}>
          Sr Air Bud · Fix-It List
        </div>
        <label htmlFor="code" style={{ display: "block", fontSize: 13.5, color: "#5B6369", marginBottom: 8 }}>
          Enter the access code to open the punch list.
        </label>
        <input id="code" value={code} onChange={(e) => setCode(e.target.value)} autoFocus
          type="password" inputMode="numeric" autoComplete="current-password" placeholder="6-digit code"
          style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #C9CFD4", fontSize: 16, fontFamily: "inherit", letterSpacing: 2 }} />
        {err && <div role="alert" style={{ marginTop: 10, fontSize: 13, color: "#C0392B" }}>{err}</div>}
        <button type="submit" disabled={busy || !code.trim()}
          style={{ marginTop: 14, width: "100%", padding: "10px 16px", borderRadius: 8, border: "1px solid #2E3A45", background: "#2E3A45", color: "#fff", fontSize: 15, fontFamily: "inherit", cursor: busy ? "default" : "pointer", opacity: busy || !code.trim() ? 0.6 : 1 }}>
          {busy ? "Checking…" : "Open the list"}
        </button>
        <div style={{ marginTop: 12, fontSize: 12, color: "#8A9298" }}>
          You'll only need to do this once on this device.
        </div>
      </form>
    </div>
  );
}

/* ================= Unlock editing ================= */
function UnlockDialog({ onClose, onUnlocked }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true); setErr("");
    try {
      const canEdit = await signIn(code.trim());
      if (!canEdit) {
        setErr("That's the view-only code. You need the edit code to make changes.");
        setBusy(false);
        return;
      }
      onUnlocked();
    } catch {
      setErr("That code didn't work.");
      setBusy(false);
    }
  };

  return (
    <div role="dialog" aria-label="Unlock editing" onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(20,23,26,0.6)", display: "grid", placeItems: "center", zIndex: 70, padding: 16 }}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit}
        style={{ background: "#fff", border: "1px solid #C9CFD4", borderRadius: 14, padding: 20, maxWidth: 340, width: "100%", fontFamily: "'Barlow', system-ui, sans-serif" }}>
        <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>Unlock editing</div>
        <div style={{ fontSize: 13, color: "#5B6369", marginBottom: 10 }}>
          You're viewing in read-only mode. Enter the edit code to make changes.
        </div>
        <input value={code} onChange={(e) => setCode(e.target.value)} autoFocus type="password"
          autoComplete="current-password" placeholder="Edit code" aria-label="Edit code"
          style={{ width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid #C9CFD4", fontSize: 15, fontFamily: "inherit" }} />
        {err && <div role="alert" style={{ marginTop: 8, fontSize: 12.5, color: "#C0392B" }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button type="button" onClick={onClose}
            style={{ flex: 1, padding: "9px 12px", borderRadius: 8, border: "1px solid #C9CFD4", background: "#fff", color: "#3A4046", fontSize: 14, fontFamily: "inherit", cursor: "pointer" }}>Cancel</button>
          <button type="submit" disabled={busy || !code.trim()}
            style={{ flex: 1, padding: "9px 12px", borderRadius: 8, border: "1px solid #2E3A45", background: "#2E3A45", color: "#fff", fontSize: 14, fontFamily: "inherit", cursor: "pointer", opacity: busy || !code.trim() ? 0.6 : 1 }}>
            {busy ? "Checking…" : "Unlock"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ================= Main App ================= */
export default function App() {
  const demo = !supabase;
  const [authed, setAuthed] = useState(demo);
  const [authReady, setAuthReady] = useState(demo);
  const [canEdit, setCanEdit] = useState(demo);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [doc, setDoc] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [placing, setPlacing] = useState(false);
  const [movingId, setMovingId] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [safetyOnly, setSafetyOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [saveState, setSaveState] = useState("idle");
  const [noteText, setNoteText] = useState("");
  const [noteIsQuestion, setNoteIsQuestion] = useState(false);
  const [noteAuthor, setNoteAuthor] = useState(() => {
    try { return localStorage.getItem("airbud:name") || ""; } catch { return ""; }
  });
  const [copied, setCopied] = useState(false);
  const [mapOpen, setMapOpen] = useState(true);
  const [showHelp, setShowHelp] = useState(() => {
    try { return !localStorage.getItem("airbud:help-dismissed"); } catch { return true; }
  });
  const itemRefs = useRef({});
  const pendingText = useRef({});   // issueId -> { patch, timer }
  const refetchTimer = useRef(null);

  const setName = (v) => {
    setNoteAuthor(v);
    try { localStorage.setItem("airbud:name", v); } catch { /* ok */ }
  };
  const dismissHelp = () => {
    setShowHelp(false);
    try { localStorage.setItem("airbud:help-dismissed", "1"); } catch { /* ok */ }
  };

  const refetch = useCallback(async () => {
    if (demo) return;
    try {
      const fresh = await fetchAll();
      // Overlay any local text edits that haven't been pushed yet
      Object.entries(pendingText.current).forEach(([id, p]) => {
        const i = fresh.issues.find((x) => x.id === id);
        if (i && p.patch) Object.assign(i, p.patch);
      });
      setDoc(fresh);
      setSaveState("saved");
    } catch {
      setSaveState("offline");
    }
  }, [demo]);

  /* restore an existing login, and follow sign-in / sign-out */
  useEffect(() => {
    if (demo) return;
    let alive = true;
    currentSession().then((s) => {
      if (!alive) return;
      setAuthed(!!s);
      setCanEdit(sessionCanEdit(s));
      setAuthReady(true);
    });
    const unsub = onAuthChange((s) => {
      setAuthed(!!s);
      setCanEdit(sessionCanEdit(s));
      setAuthReady(true);
      if (!s) setDoc(null);
    });
    return () => { alive = false; unsub(); };
  }, [demo]);

  /* initial load + live subscription */
  useEffect(() => {
    if (!authed) return;
    let alive = true;
    (async () => {
      if (demo) {
        setDoc({
          issues: SEED.map((s) => ({ id: uid(), num: s.n, loc: s.loc, desc: s.desc, safety: s.safety, status: "open", x: s.x, y: s.y, notes: [], photos: [] })),
          nextNum: SEED.length + 1,
        });
        return;
      }
      try {
        await seedIfEmpty();
        if (!alive) return;
        await refetch();
      } catch {
        if (alive) setSaveState("offline");
        // still show the seed locally so the page is usable
        setDoc({
          issues: SEED.map((s) => ({ id: uid(), num: s.n, loc: s.loc, desc: s.desc, safety: s.safety, status: "open", x: s.x, y: s.y, notes: [], photos: [] })),
          nextNum: SEED.length + 1,
        });
      }
    })();
    if (demo) return () => { alive = false; };
    const unsub = subscribeAll(() => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      refetchTimer.current = setTimeout(refetch, 400);
    });
    const onFocus = () => refetch();
    window.addEventListener("focus", onFocus);
    return () => { alive = false; unsub(); window.removeEventListener("focus", onFocus); };
  }, [demo, refetch, authed]);

  const issues = doc ? doc.issues : [];
  const selected = issues.find((i) => i.id === selectedId) || null;

  /* ---------- mutation helpers (optimistic local + DB push) ---------- */
  const patchLocal = (id, patch) =>
    setDoc((d) => ({ ...d, issues: d.issues.map((i) => (i.id === id ? { ...i, ...(typeof patch === "function" ? patch(i) : patch) } : i)) }));

  const push = async (fn) => {
    if (demo) return;
    setSaveState("saving");
    try { await fn(); setSaveState("saved"); }
    catch { setSaveState("offline"); }
  };

  /* immediate updates (status, safety, position) */
  const updateIssue = (id, patch) => {
    patchLocal(id, patch);
    push(() => updateIssueDb(id, patch));
  };

  /* debounced updates for typed fields */
  const updateIssueText = (id, patch) => {
    patchLocal(id, patch);
    const entry = pendingText.current[id] || { patch: {} };
    entry.patch = { ...entry.patch, ...patch };
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      const toPush = entry.patch;
      delete pendingText.current[id];
      push(() => updateIssueDb(id, toPush));
    }, 700);
    pendingText.current[id] = entry;
    if (!demo) setSaveState("saving");
  };

  const selectPin = (id) => {
    const next = id === selectedId ? null : id;
    setSelectedId(next);
    if (next) {
      setTimeout(() => {
        const el = itemRefs.current[next];
        if (el) el.scrollIntoView({ behavior: REDUCE_MOTION ? "auto" : "smooth", block: "center" });
      }, 80);
    }
  };

  const handlePlace = ({ x, y }) => {
    if (movingId) {
      updateIssue(movingId, { x, y });
      setMovingId(null); setPlacing(false);
      return;
    }
    setPlacing(false);
    if (demo) {
      const it = { id: uid(), num: doc.nextNum, loc: "New issue", desc: "", safety: false, status: "open", x, y, notes: [], photos: [] };
      setDoc((d) => ({ ...d, issues: [...d.issues, it], nextNum: d.nextNum + 1 }));
      setSelectedId(it.id);
      return;
    }
    setSaveState("saving");
    createIssue({ num: doc.nextNum, x, y })
      .then((it) => {
        setDoc((d) => ({ ...d, issues: [...d.issues, it], nextNum: d.nextNum + 1 }));
        setSelectedId(it.id);
        setSaveState("saved");
      })
      .catch(() => setSaveState("offline"));
  };

  const addNote = () => {
    if (!noteText.trim() || !selected) return;
    const draft = { author: noteAuthor.trim(), type: noteIsQuestion ? "question" : "note", text: noteText.trim() };
    setNoteText(""); setNoteIsQuestion(false);
    if (demo) {
      patchLocal(selected.id, (i) => ({ notes: [...i.notes, { id: uid(), ...draft, resolved: false, ts: Date.now() }] }));
      return;
    }
    setSaveState("saving");
    addNoteDb(selected.id, draft)
      .then((n) => { patchLocal(selected.id, (i) => ({ notes: [...i.notes, n] })); setSaveState("saved"); })
      .catch(() => setSaveState("offline"));
  };

  const resolveQuestion = (issueId, noteId) => {
    patchLocal(issueId, (i) => ({ notes: i.notes.map((x) => (x.id === noteId ? { ...x, resolved: true } : x)) }));
    push(() => resolveNoteDb(noteId));
  };

  const deleteIssue = (issue) => {
    setDoc((d) => ({ ...d, issues: d.issues.filter((i) => i.id !== issue.id) }));
    if (selectedId === issue.id) setSelectedId(null);
    if (!demo) push(() => deleteIssueDb(issue));
  };

  const filterFn = (it) => {
    if (statusFilter !== "all" && it.status !== statusFilter) return false;
    if (safetyOnly && !it.safety) return false;
    if (search) {
      const qq = search.toLowerCase();
      if (!(`${it.num} ${it.loc} ${it.desc}`.toLowerCase().includes(qq))) return false;
    }
    return true;
  };

  const stats = useMemo(() => {
    const s = { open: 0, progress: 0, fixed: 0, verified: 0, questions: 0 };
    issues.forEach((i) => {
      s[i.status] = (s[i.status] || 0) + 1;
      i.notes.forEach((n) => { if (n.type === "question" && !n.resolved) s.questions++; });
    });
    return s;
  }, [issues]);
  const done = stats.fixed + stats.verified;
  const pct = issues.length ? Math.round((done / issues.length) * 100) : 0;

  const copySummary = async () => {
    const lines = ["SR AIR BUD — FIX-IT PUNCH LIST", "2026 Airstream Classic 28RB Twin", ""];
    STATUS_ORDER.forEach((st) => {
      const group = issues.filter((i) => i.status === st);
      if (!group.length) return;
      lines.push(`== ${STATUS[st].label.toUpperCase()} (${group.length}) ==`);
      group.forEach((i) => {
        lines.push(`#${i.num} ${i.loc}${i.safety ? " [SAFETY]" : ""}`);
        if (i.desc) lines.push(`   ${i.desc}`);
        i.notes.forEach((n) => lines.push(`   • ${noteWho(n)}${n.type === "question" ? " (question)" : ""}: ${n.text}`));
      });
      lines.push("");
    });
    try { await navigator.clipboard.writeText(lines.join("\n")); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { /* clipboard unavailable */ }
  };

  const fmtDate = (ts) => new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " +
    new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  if (!authReady) {
    return (
      <div style={{ fontFamily: "system-ui, sans-serif", padding: 40, textAlign: "center", color: "#5B6369" }}>
        Loading…
      </div>
    );
  }

  if (!authed) return <CodeGate onUnlock={(edit) => { setCanEdit(edit); setAuthed(true); }} />;

  if (!doc) {
    return (
      <div style={{ fontFamily: "system-ui, sans-serif", padding: 40, textAlign: "center", color: "#5B6369" }}>
        Loading punch list…
      </div>
    );
  }

  const btn = (active) => ({
    padding: "7px 12px", borderRadius: 8, border: "1px solid " + (active ? "#2E3A45" : "#C9CFD4"),
    background: active ? "#2E3A45" : "#fff", color: active ? "#fff" : "#3A4046",
    fontSize: 13, cursor: "pointer", fontFamily: "inherit",
  });

  const detailPanel = selected ? (
    <section aria-label={`Issue ${selected.num} details`} style={{ marginTop: 8, background: "#FFFFFF", border: "1px solid #C9CFD4", borderRadius: 14, padding: 14, boxShadow: "0 4px 14px rgba(35,39,43,0.08)" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
        <span style={{ minWidth: 34, height: 34, borderRadius: 17, background: STATUS[selected.status].color, color: "#fff", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 16, fontFamily: "'Barlow Condensed', sans-serif" }}>{selected.num}</span>
        <div style={{ flex: 1, minWidth: 200 }}>
          <input value={selected.loc} onChange={(e) => updateIssueText(selected.id, { loc: e.target.value })} aria-label="Location"
            readOnly={!canEdit}
            style={{ width: "100%", fontWeight: 600, fontSize: 16, border: "none", borderBottom: canEdit ? "1px dashed #C9CFD4" : "none", padding: "2px 0", fontFamily: "inherit", background: "transparent" }} />
          <textarea value={selected.desc} onChange={(e) => updateIssueText(selected.id, { desc: e.target.value })} aria-label="Issue description"
            placeholder={canEdit ? "Describe the issue…" : ""} rows={2} readOnly={!canEdit}
            style={{ width: "100%", fontSize: 13.5, border: "none", borderBottom: canEdit ? "1px dashed #C9CFD4" : "none", padding: "4px 0", fontFamily: "inherit", resize: "vertical", background: "transparent", color: "#3A4046" }} />
        </div>
        <button onClick={() => setSelectedId(null)} aria-label="Close details" style={{ ...btn(false), padding: "5px 10px" }}>✕</button>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10, alignItems: "center" }}>
        {canEdit ? (
          <select value={selected.status} onChange={(e) => updateIssue(selected.id, { status: e.target.value })} aria-label="Status"
            style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #C9CFD4", fontSize: 13, fontFamily: "inherit", background: STATUS[selected.status].bg, color: STATUS[selected.status].color, fontWeight: 600 }}>
            {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
          </select>
        ) : (
          <span style={{ padding: "7px 10px", borderRadius: 8, fontSize: 13, background: STATUS[selected.status].bg, color: STATUS[selected.status].color, fontWeight: 600 }}>
            {STATUS[selected.status].label}
          </span>
        )}
        {!canEdit && selected.safety && (
          <span style={{ fontSize: 12.5, color: "#C0392B", fontWeight: 600 }}>⚠ Safety item</span>
        )}
        {canEdit && <>
          <button style={btn(selected.safety)} onClick={() => updateIssue(selected.id, { safety: !selected.safety })}>⚠ Safety item</button>
          <button style={btn(false)} onClick={() => { setMovingId(selected.id); setMapOpen(true); }}>Move pin</button>
          <button style={{ ...btn(false), color: "#C0392B", borderColor: "#E3B4AC" }}
            onClick={() => { if (window.confirm(`Delete nlarge�${selected.num} — ${selected.loc}? This can't be undone.`)) deleteIssue(selected); }}>Delete</button>
        </>}
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 600, fontSize: 15, letterSpacing: 0.8, textTransform: "uppercase", color: "#5B6369", marginBottom: 6 }}>Photos</div>
        <Photos nlarg={selected} demo={demo} canEdit={canEdit}
          onAdd={(p) => patchLocal(selected.id, (i) => ({ photos: [...i.photos, p] }))}
          onRemove={(p) => patchLocal(selected.id, (i) => ({ photos: i.photos.filter((x) => x.id !== p.id) }))} />
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 600, fontSize: 15, letterSpacing: 0.8, textTransform: "uppercase", color: "#5B6369", marginBottom: 6 }}>
          Notes & questions
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {selected.notes.length === 0 && (
            <div style={{ fontSize: 13, color: "#8A9298" }}>
              {canEdit
                ? "No notes yet. Add a repair note or ask a question — anyone with the edit code can reply."
                : "No notes yet."}
            </div>
          )}
          {selected.notes.map((n) => (
            <div key={n.id} style={{ background: n.type === "question" ? "#FBF3E0" : "#F5F6F7", borderRadius: 8, padding: "8px 10px", fontSize: 13.5, borderLeft: `3px solid ${n.type === "question" ? "#B57A0E" : "#2C6E8A"}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 2 }}>
                <span style={{ fontWeight: 600, fontSize: 12, color: n.type === "question" ? "#B57A0E" : "#2C6E8A" }}>
                  {noteWho(n)}{n.type === "question" ? " · Question" : ""}
                  {n.type === "question" && !n.resolved && <span style={{ marginLeft: 6, color: "#B57A0E" }}>needs answer</span>}
                  {n.type === "question" && n.resolved && <span style={{ marginLeft: 6, color: "#2E7D4F" }}>answered ✓</span>}
                </span>
                <span style={{ fontSize: 11, color: "#8A9298" }}>{fmtDate(n.ts)}</span>
              </div>
              {n.text}
              {n.type === "question" && !n.resolved && canEdit && (
                <div style={{ marginTop: 6 }}>
                  <button style={{ ...btn(false), padding: "4px 9px", fontSize: 12 }}
                    onClick={() => resolveQuestion(selected.id, n.id)}>
                    Mark answered
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
        {canEdit && <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={2}
            placeholder="Add a repair note or a question…"
            aria-label="New note"
            style={{ flex: "1 1 220px", padding: "8px 10px", borderRadius: 8, border: "1px solid #C9CFD4", fontSize: 13.5, fontFamily: "inherit", resize: "vertical" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 150 }}>
            <input value={noteAuthor} onChange={(e) => setName(e.target.value)} placeholder="Your name (optional)" aria-label="Your name"
              style={{ padding: "6px 9px", borderRadius: 8, border: "1px solid #C9CFD4", fontSize: 12.5, fontFamily: "inherit" }} />
            <label 2" }} />
            <label 2" }} />
          herit", resize: "vertical" }} />
          <div style={{ displaect value={selected.stk={() => setSelectedI.type === "questiue)} pe={{ fc   <box" c   <g: "
    setNoteTe       placeholder="Add a d, (i) => (="Your nac   <g:)         herit",  tton>
isstyle={{ fldit && <div stysetCode(e.targeze: 12 }}
                  falseCFD4", fontSize: 6 "flexit deletePhelecteborderRadiushor: noteAuthor.}>w no{
    setNoteText(""); setNoteIsQuest}0392B", borderColor: olumn", gap: 6 p: 12 }}>
    olumn", ga 10pvaluexportteI push) --localStoagramCts).=rif", background: "#Fus: 14, paddingAgAg8 boxShadow: "0 4px 14px rgba(35,39,43,0.08)" }}>
      <divize: ze: 45" : "#={{ display: "fle2", gap: 10, alignIt12)"ui, sans-ser680={noteTeplay:

  c }}>
        <dedI.type =={howHelp aria-label="Ph    >
    ) retu=ctedId }) {
      s => patchLId}circle r="22 => patc"22
           MovingI={ }}
    rim(!);
     }e Airstr={Issue(movin}tus !== slay: !== s         heflex", ganTop: 10, alignItems: "center" }}>
        {canEdit ? (
 k={() => resolesol8eQuestion(select1access code to open tht value={selected.status} onChangehowHelp ariabel}</option>)}
       ontWeight: 600 }}>ect>
    10, alignItems: "cin(fal-enter" t value={selected.stk=it ? 4tName(e.target.val}</span>
     }>
    1#3A4046", c1lor: "#fff", font5ed.status].color, fontus].labelnItems: "cin(fal-      
     
          <span fety && (
          <span std.safety)} ohowHelp aria-label="Pval}</span>
     nItems: "cin(fal-enter" t value={selected.stk=it ? 4tName(e.target.val}</span>
     }>
    123A4046", c12or: "#fff", font7or: "#5B6369", cursor: { if (winnItems: "cin(fal-      
     ick={(fety && (
          <span style={{ fontShowHelp ari= "question" ? "#B57A0E" : "#2C6 "pointer" }}>Cancel</button>   tNam    >
    hidden{ fontSize: 11, c= "question" ? "} onChedId(null)} aria2 }}
                    onClick={() => r5"question" ? "#B57A0E   tNa" style={{ ...btn(f ...btn(ShowHelpnEdit && <divx", bex"quddiushowHelp.tehowHelp t("Hide{nop ▴oteIsismi{nop ▾t}0392B", borderColotSize: 12.tTimeout(        margi);
     > updateIssue(seetails" style={{ ...bt{(), num: doc /* clipboe));
  };

  conse={{ ...btn(false), cborderRadius: 8, borde       falseCFD4", fontS5ze: 15, foel</button>   tNam+code tedId=== 0 && (
        s: 8, fontSize: 13, backgroundnItems: "cin(fal-enter" it ? (
 t value={selected.stk=us: 14, paddin", "ver#fff", fontSize: 14, fogress", "t: `3px solid ${n.type ===5"question" ? "#B57A0E   tNa>
        )}
  );
     > u"Top     toagramnCha"
 cal(id,p((s) iNoteIsTop     toagramnw }} style={{ we={ap((n) => (
    2 }}
                    onClick={() => r3sol8eQuestion(select2tNa" style={{ ...bt{(), num: doc.nextNu setPlacing(false);
usy || !code.trim()}
                 <span style={{ f olumn", ga 1/
export d& it.status !==-------- mutat : 0) - (b.id ==edId ? 1 : 0)).b`   ${i.deconst st =a`   ${i.deconst srimae(sest be(seissues.leng    B"#5B6=rif", background: "#F0 }}>
            <input value={noteAuthor} onC        </la{us !==--open;
        const sel = it.id === selectedId;
             <g keyq!sel;
=== "qutyle={{ring(36)
    return s;
  }, [issues]);
  coor: "#8ate(${it.x},${it.y})`}
       FBF3E0" :yle={{ isplamoothelecteavior: REDUCE_MOyle={t sell"none" stroke={s: "#C0392B"g: "9px tabropag={0ge�${selected.num} — ${sele      .catch(() => next) {
      setTimeout(( => sge�${selected.nuKeyDownce(p); } }}
   e.E0" returEed.starime.E0" retur ")     tBusy(true); setEe      .catch(() => next) {
      setTimeout(( => s Classic 28RBborderBottom: canEdit ? "1px dh list…
  op) tk=us: 14, padd) => next) {
      setTing:  13.5, AgAg8 boxShadow: "0 4px 14p "#2E) => next) {
      setTinSize: 13, cuD5DADD")or: "#fff", fontSizeFD4", fontSize: 16, folPanel = selected ? (
    <section aria-l "wrap" }}>
        <span style={{ minWidth: 34, hetName(e.target.val}</span>
     [selected.s#3A4046", c3lor: "#fff", fontS5ed.status].col        ight: 700, fontSize: 16, fontFamily: "'Barlow Condensed', sans-serif" }}>{seltSize: 15, letterSpacing: 0.8, textTransfoxShadow:392B" stro?369", cursor: 7B241Cvertical",{n.te  );
}

/  {n.type === "que= "question" ? "} onChedI.type === "questi "question" ? "#B57A0E" : "#2C6E8A" }}>
  4  tNa>;
    }
    {n.type === "quest0392B" strokeWi/span>}
                </spa         </div>
               {canEdit && <>
          );
  { fontSize: 11, color: {q >8" }}>i/span>}
                </spa         </divus: 14, paddingSize: n.type === "questiarent" }} />
   : "#2E3A45", color: g: "4{q}yle={{ fl{q >81o?36sd && <s{ fontSize: 11, color:  13, backgroundnItems: "c          Enter the tions
        </div>
     xt} o2tNa>;
  targe    {n.type === "quest0E) =, color: "#8A9>8" riml;
=== "q: "#8A9>8")         <button style=13, backgroundnItems: "c          Enter the1access code t       v>
     xt} o3· Question" : ""}
     ) =, color: "#8A9>8"    `📷    re, color: "#8A}`}uestion" : ""}
     ) =, color: "#8A9>8"    l;
=== "q: "#8A9>8"    " & !n "}uestion" : ""}
     ) ==== "q: "#8A9>8"    `💬    re=== "q: "#8A}`}uestion" : ""}
      {n.type === "questnEdit && <div sty  {n.type === "que= "question" ? " Enter the1access code        ig.status].col       k={() => r3sol8eQues3A45", color: g,nw eavrginertica> setNote    <span st  {n.type === "qtyle={{ display: {) => next) {
      seap: "wrap" }}>
  se), padding: "4{elected.numTop: 12 }}>
     nClick={() => filep ==============la{us !==--or: "#8A9298" }}>
          "wrap" }}>
  ons
        </div>y: busy || !cow', system-uih list…
      </def} typlectedImts) =tylsetus !==s. C
   styleus !==snChase stylefmeounChan code screen ================= *
[id];
    olbar6=rif", background: "#F0 }}>
            <in        {canEdit ? 6
 t value={selected.stk=D4", fontSize:2 "flex"
ssue(selected.id, { steturn false       placeholder="AdyOnly] = uselete="current-passwssue pins"
    if byyle={{ "
"1px solid #C9CFD4", fontSize: 12.5, fontFamily: "inherit" }} />
            <label 2" }} />
            <label 2" }} />ly: "inherit", cursons-serif", fon  </selid, { etyOn>A{
  e={{ esstyle={{ 
ATUS[s].label}</option>)}
          </select>
        ) : (
          <span style={{ padding:  10px", borderRa 2 }}
                    const qq)
      <divize: estion" ? "#B57A0E   tNa" style={{ ...btn(fseState(""(!  const qq)} onClick={(lexWrap: "wrap", lected.id, { lo}`.t       placeholder="Adyo}`.tl="Your name"
              styyo}`.tidth:borderRadius:o}`.tplected"
"1px solid #C9CFDr: "1px sol1estion"ge={(e) => 00,D4", fontSize: 12.5, fontFamily: "inherit" }} />
            <label 2" }} />
            <label 2" }} />
          he 2 }}
                    onClick={() => rze: estion" ? "#B57A0E   tNa" style={{ FIX-IT PUN (
Open] >
   pen] >✓d &&  peyylIT PUNt}0392B", borderCo{n = ( [iss                <butt12 }}
                  falseCFD4", fontSze: estion" ? "#B57A0E   tNa" style={{ ...btn(fe(null);
  falseor: "#5B6369", mar92B", borderCo=======la{n = ( [is(ull)} aria2 }}
                    onClick={() => rze: estion" ? "#B57A0E   tNa" style={{ ...btnvalOutr.}>L#5Bar92B", borderCo================= *
[ians-serif", background: "#F2F1EC", minHeight: "100vh", displa-apple-vh", dlay: "grid", placeItems: "center", padh: 20, color: "#23272B" }}>        <input value={noteAuthorzoomflisplahidden"background: "#fff", border: "1ound:>{`ull)} ari*   bo: 3iz) => rit" }-bo:;   style={{92B", :ssues-visible,er="6-:ssues-visible,et.value):ssues-visible,e0px", :ssues-visible,e[0392B"g: "9px]:ssues-visible;
  ut(fal::2 "e: 14, fogress;  ut(fal-offceIte2 ";   style={{@sue = (pconsrs-=--uced-moalue={=--uce)   *     : "splay: cal" !imt [aant;     style=` st und:>fontFami{ult func Head  dese;
  cadding:  head  dound: "#Fus: 14, paddi(falar-grilyted(180deg,r" }}>C,nSize: )"background:ter", padD4", fontSize: 42.5, fontFa4 }}>
          Sr Air Bud · <inShrink
      A9298" }}>
          You'sans-ser980={noteTeplay:

  cnone" stroke={s: "#C: 8, flexWrap: "wrap", marginBottom: 2 }}>
                t value={seleuthR{
     <span style={{ fontWeightName(e.target.val}</span>
      fontSize: 22, letterSpacing: 1.2, textTransform: "uppercase", borderBott18: "3px solid #C0392B", paddingBottom: 8, marginB· Question" : ""}
r="code" style={{ display: "block"iv sty  {n.type === "que= "question" ? " Enter the0access code t       dd a repair note or  = (       ( mpaddiol , noteId retur { patc     {!canEdit && , noteId retur { edc     {!] >✓d && , noteId retur=> {
   ne witt  { edc && <span style={{ st  {n.type === "qtyle={{ display: : "#C: 8, flexWrap: "wrap", mart value={selected.stk=it ? e={noteText} o tNa>
        )}
 e={selected.loc} onChanh: 20, c6ly: "inherit", cu"#fff", fontFamily: "i3orzoomflisplahidden"nt: "space-between", gap: 8, flexanEdit  : 0+ "%padh: 20, color% placeItems: "ce(falar-grilyted(90deg,r      ,fogress)"ba  : "splay: , 80);
    }
  };cal",{ontWnEdi .4s>
          herit", r  </div>
        {)}</span>
              </div>
       B9C1CerLew eavrginertica> setNote repair note or  al"}/{{
    const l}gth ? yle{ / iss   i}    i repair note or  / iss, flexDir >8" }}>i/span>}
      ckground:t0C36DtNote yle{ / iss, flexDir} ?{ fontSize: 11, colorst  {n.type === "qtyle={{ displayain App =======head   fontFamilm conlected.loc} onChange=g: 20, c-ui, sans-ser980={w  </div>
      )teTeplay:

  c }D4", fontSize: 2e: estion"3272B" }}>        <input value={noteAuthatus} onChange = ( [is(ull)} ari
 e={selected.loc} oShrink
  ivus: 14, paddingSize: n.rit" }} />
         D9971ErLeft: `3px solid ${n.type === "que2tion" ? "#B57A0E"the punch list.
        </label>     ( mpadNo no    tatauthRple    d];nils`} yeteIso{(e) =>  wo      < { ed code VITE_SUPABASE_URLdemo)VITE_SUPABASE_ANON_KEY(`${e , ADME)nChagourn;
.}}>
     nClick={() => fileyle={{ fontS = ( [is , noteId retur=> {
   n[is(ull)} ari
 e={selected.loc} oShrink
  ivus: 14, paddingSize: n.rit" }} />
         D9971ErLeft: `3px solid ${n.type === "que2tion" ? "#B57A0E"the punch list.
        </label>  C     ue)) =tyl tatauthRpr 20, cawNo noc   < yius:d];nilslue. Rected{(e) =>  may0px"   < { ed }}>
     nClick={() => fileyl
)} ari
 e={selected.loc} oShrink
  : "4{eoagramCts)}arginBottom: 10 }}>
          } oShrink
  iv, sans-ser820={w  </div>
      )teTeplay:

  c: "4{  olbar}arginBottom: 10{n = ( [iss                <butt10 }}>
          } oShrink
  iv, sans-ser820={w  </div>
      )teTeplay:

  l8eQues3s: 14, paddin"DEFF1 boxShadow: "0 4px 14px rgba(35,39,43,0.08)" } ${n.type ===7e: estion" ? "#B57A0E   k={() => setSelectedI.type === "queRdiv>
    o noyiudiv>
bion�e eoomythngId]g: {(e) =>  
        return;
 .}}>
     nClick={() => fileyle={{ fontcalStora         <butt10 }}>
          } oShrink
  iv, sans-ser820={w  </div>
      )teTeplay:

  l8eQues3s: 14, paddin", "ver#fff", fontSize: 14, fogress", "t: `3px solid ${n.type ===7e: estion" ? "#B57A0E   k=        <textarea value={t value={selected.status} onChang"que= "question" ? "} onChedI.type === "quest ask a question — anyone wiew  }} ? Top .entnumb==---pconorunChateavinChase sutton>
,(sel .id, (i)emo)le{ eted.notoru, flexDir. Uety i     ish(`==i "sadNe)) =={{ wease"
    s luern;Edit cd     )}
          {seleew  }} ? Top .entnumb==---pconorunChateavinChase sext.utton>
,(.id, (i)emo)=== "q"Edit && <div sty  {n.type === "que=etails" style={{torage.setI}                   onClick={() => r3solveQuestion(selected.i>Goatea0392B", borderColor: olumn", gap: 6)}nput value={selected.loc} onChange=g: 20, c-uizoomflisY:};

  c· Fix-It List
  an sWebkitOoomflisSlock:) => rtouchcnone" stroke={s: "#C: 8, flex, sans-ser820={noteTeplay:

  cnone" stroke={sst     B"#5BEdit && <div stp>⚠ Safety item</span>
        )}
   </div>
     xt} o1: 12, color: n.type Top .-pconoruaunChateavinCha valuext.utton>
No no    etails`} pconl 20,s upew eli     useE=  m. Dursor:=--- (!as luersck={() => s.dit && <div styp.type === "qtyle={{ displayain App =======m co>fontFami{tDoc] = us [is(ull)} aria] = useState");
  co{{ ...btn(fe(null);
  true); photos: i.pho");
    {{ ...bt{(), e(null);
  true);;return (
   fontFamily: orderCo================= *}
