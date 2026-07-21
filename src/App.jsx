import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { supabase } from "./supabase.js";
import { SEED } from "./seed.js";
import {
  fetchAll, seedIfEmpty, createIssue, updateIssueDb, deleteIssueDb,
  addNoteDb, resolveNoteDb, addPhotoDb, deletePhotoDb, subscribeAll,
  signIn, signOut, currentSession, onAuthChange,
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
function Photos({ issue, onAdd, onRemove, demo }) {
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
            <button aria-label="Remove photo" onClick={async () => {
              if (!demo) { try { await deletePhotoDb(p); } catch { /* ok */ } }
              onRemove(p);
            }}
              style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: 10, border: "none", background: "#3A4046", color: "#fff", fontSize: 11, cursor: "pointer", lineHeight: "20px", padding: 0 }}>×</button>
          </div>
        ))}
        <button onClick={() => fileRef.current && fileRef.current.click()} disabled={busy}
          style={{ width: 74, height: 74, borderRadius: 8, border: "2px dashed #9AA1A7", background: "transparent", color: "#5B6369", cursor: "pointer", fontSize: 12 }}>
          {busy ? "Saving…" : "+ Photo"}
        </button>
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
      await signIn(code.trim());
      onUnlock();
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
          Enter the access code to view and update the punch list.
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

/* ================= Main App ================= */
export default function App() {
  const demo = !supabase;
  const [authed, setAuthed] = useState(demo);
  const [authReady, setAuthReady] = useState(demo);
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
      setAuthReady(true);
    });
    const unsub = onAuthChange((s) => {
      setAuthed(!!s);
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

  if (!authed) return <CodeGate onUnlock={() => setAuthed(true)} />;

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
            style={{ width: "100%", fontWeight: 600, fontSize: 16, border: "none", borderBottom: "1px dashed #C9CFD4", padding: "2px 0", fontFamily: "inherit", background: "transparent" }} />
          <textarea value={selected.desc} onChange={(e) => updateIssueText(selected.id, { desc: e.target.value })} aria-label="Issue description"
            placeholder="Describe the issue…" rows={2}
            style={{ width: "100%", fontSize: 13.5, border: "none", borderBottom: "1px dashed #C9CFD4", padding: "4px 0", fontFamily: "inherit", resize: "vertical", background: "transparent", color: "#3A4046" }} />
        </div>
        <button onClick={() => setSelectedId(null)} aria-label="Close details" style={{ ...btn(false), padding: "5px 10px" }}>✕</button>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10, alignItems: "center" }}>
        <select value={selected.status} onChange={(e) => updateIssue(selected.id, { status: e.target.value })} aria-label="Status"
          style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #C9CFD4", fontSize: 13, fontFamily: "inherit", background: STATUS[selected.status].bg, color: STATUS[selected.status].color, fontWeight: 600 }}>
          {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
        </select>
        <button style={btn(selected.safety)} onClick={() => updateIssue(selected.id, { safety: !selected.safety })}>⚠ Safety item</button>
        <button style={btn(false)} onClick={() => { setMovingId(selected.id); setMapOpen(true); }}>Move pin</button>
        <button style={{ ...btn(false), color: "#C0392B", borderColor: "#E3B4AC" }}
          onClick={() => { if (window.confirm(`Delete issue #${selected.num} — ${selected.loc}? This can't be undone.`)) deleteIssue(selected); }}>Delete</button>
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 600, fontSize: 15, letterSpacing: 0.8, textTransform: "uppercase", color: "#5B6369", marginBottom: 6 }}>Photos</div>
        <Photos issue={selected} demo={demo}
          onAdd={(p) => patchLocal(selected.id, (i) => ({ photos: [...i.photos, p] }))}
          onRemove={(p) => patchLocal(selected.id, (i) => ({ photos: i.photos.filter((x) => x.id !== p.id) }))} />
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 600, fontSize: 15, letterSpacing: 0.8, textTransform: "uppercase", color: "#5B6369", marginBottom: 6 }}>
          Notes & questions
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {selected.notes.length === 0 && <div style={{ fontSize: 13, color: "#8A9298" }}>No notes yet. Add a repair note or ask a question — anyone with the link can reply.</div>}
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
              {n.type === "question" && !n.resolved && (
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
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={2}
            placeholder="Add a repair note or a question…"
            aria-label="New note"
            style={{ flex: "1 1 220px", padding: "8px 10px", borderRadius: 8, border: "1px solid #C9CFD4", fontSize: 13.5, fontFamily: "inherit", resize: "vertical" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 150 }}>
            <input value={noteAuthor} onChange={(e) => setName(e.target.value)} placeholder="Your name (optional)" aria-label="Your name"
              style={{ padding: "6px 9px", borderRadius: 8, border: "1px solid #C9CFD4", fontSize: 12.5, fontFamily: "inherit" }} />
            <label style={{ fontSize: 12.5, display: "flex", gap: 5, alignItems: "center", color: "#3A4046" }}>
              <input type="checkbox" checked={noteIsQuestion} onChange={(e) => setNoteIsQuestion(e.target.checked)} />
              This is a question
            </label>
            <button style={{ ...btn(true), padding: "8px 16px" }} onClick={addNote} disabled={!noteText.trim()}>Add {noteIsQuestion ? "question" : "note"}</button>
          </div>
        </div>
      </div>
    </section>
  ) : null;

  const diagramCard = (
    <div style={{ background: "#FAFAF8", border: "1px solid #C9CFD4", borderRadius: 14, padding: "6px 6px 2px", boxShadow: "0 4px 12px rgba(35,39,43,0.12)", maxWidth: 680, margin: "0 auto", width: "100%" }}>
      {mapOpen && (
        <Floorplan issues={issues} selectedId={selectedId} onSelectPin={selectPin}
          placing={placing || !!movingId} onPlace={handlePlace} filterFn={filterFn} />
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "4px 4px 8px", fontSize: 11.5, color: "#5B6369", alignItems: "center" }}>
        {mapOpen && STATUS_ORDER.map((s) => (
          <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: 5, background: STATUS[s].color, display: "inline-block" }} />{STATUS[s].label}
          </span>
        ))}
        {mapOpen && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 12, height: 12, borderRadius: 7, border: "2px dashed #C0392B", display: "inline-block" }} />Safety
          </span>
        )}
        {!mapOpen && <span style={{ fontWeight: 600, color: "#3A4046", fontSize: 12.5 }}>Floorplan hidden</span>}
        <span style={{ flex: 1 }} />
        <button style={{ ...btn(false), padding: "5px 10px", fontSize: 12.5 }} onClick={() => setMapOpen(!mapOpen)}
          aria-expanded={mapOpen}>{mapOpen ? "Hide map ▴" : "Show map ▾"}</button>
        {!placing && !movingId ? (
          <button onClick={() => { setPlacing(true); setSelectedId(null); setMapOpen(true); }}
            style={{ ...btn(true), padding: "5px 11px", fontSize: 12.5 }}>+ Add issue</button>
        ) : (
          <span style={{ display: "inline-flex", gap: 8, alignItems: "center", background: "#E6F0F5", border: "1px solid #2C6E8A", borderRadius: 8, padding: "5px 10px", fontSize: 12.5 }}>
            {movingId ? "Tap the diagram to reposition the pin" : "Tap the diagram where the issue is"}
            <button style={{ ...btn(false), padding: "3px 8px", fontSize: 12 }} onClick={() => { setPlacing(false); setMovingId(null); }}>Cancel</button>
          </span>
        )}
      </div>
    </div>
  );

  const filtered = issues.filter(filterFn).sort((a, b) => (b.safety ? 1 : 0) - (a.safety ? 1 : 0) || a.num - b.num);
  const listBlock = (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {filtered.map((it) => {
        const st = STATUS[it.status];
        const q = it.notes.filter((n) => n.type === "question" && !n.resolved).length;
        return (
          <div key={it.id} ref={(el) => { itemRefs.current[it.id] = el; }}>
          <div role="button" tabIndex={0}
            onClick={() => setSelectedId(it.id === selectedId ? null : it.id)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedId(it.id === selectedId ? null : it.id); } }}
            style={{ width: "100%", textAlign: "left", background: it.id === selectedId ? "#FFF" : "#FAFAF8", border: "1px solid " + (it.id === selectedId ? "#2E3A45" : "#D5DADD"), borderRadius: 10, padding: "10px 12px", cursor: "pointer", fontFamily: "inherit", display: "flex", gap: 10, alignItems: "flex-start" }}>
            <span style={{ minWidth: 30, height: 30, borderRadius: 15, background: st.color, color: "#fff", display: "grid", placeItems: "center", fontWeight: 700, fontFamily: "'Barlow Condensed', sans-serif", border: it.safety ? "2px dashed #7B241C" : "none" }}>{it.num}</span>
            <span style={{ flex: 1 }}>
              <span style={{ fontWeight: 600, fontSize: 14.5 }}>{it.loc}</span>
              {it.safety && <span style={{ marginLeft: 6, fontSize: 11, color: "#C0392B", fontWeight: 600 }}>⚠ SAFETY</span>}
              {q > 0 && <span style={{ marginLeft: 6, fontSize: 11, background: "#FBF3E0", color: "#B57A0E", padding: "2px 6px", borderRadius: 6 }}>{q} question{q > 1 ? "s" : ""}</span>}
              <span style={{ display: "block", fontSize: 13, color: "#5B6369", marginTop: 2 }}>{it.desc}</span>
              {(it.photos.length > 0 || it.notes.length > 0) && (
                <span style={{ display: "block", fontSize: 11.5, color: "#8A9298", marginTop: 3 }}>
                  {it.photos.length > 0 && `📷 ${it.photos.length}`}
                  {it.photos.length > 0 && it.notes.length > 0 && "  ·  "}
                  {it.notes.length > 0 && `💬 ${it.notes.length}`}
                </span>
              )}
            </span>
            <span style={{ fontSize: 11.5, color: st.color, background: st.bg, padding: "3px 8px", borderRadius: 6, whiteSpace: "nowrap" }}>{st.label}</span>
          </div>
          {it.id === selectedId && <div style={{ marginTop: 6 }}>{detailPanel}</div>}
          </div>
        );
      })}
      {filtered.length === 0 && (
        <div style={{ color: "#5B6369", fontSize: 14, padding: 20, textAlign: "center" }}>No issues match these filters. Clear the filters to see the full list.</div>
      )}
    </div>
  );

  const toolbar = (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", padding: "8px 2px" }}>
      <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status"
        style={{ padding: "6px 9px", borderRadius: 8, border: "1px solid #C9CFD4", fontSize: 12.5, fontFamily: "inherit", background: "#fff" }}>
        <option value="all">All statuses</option>
        {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
      </select>
      <button style={{ ...btn(safetyOnly), padding: "6px 10px", fontSize: 12.5 }} onClick={() => setSafetyOnly(!safetyOnly)}>⚠ Safety</button>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" aria-label="Search issues"
        style={{ flex: "1 1 110px", minWidth: 100, padding: "6px 9px", borderRadius: 8, border: "1px solid #C9CFD4", fontSize: 12.5, fontFamily: "inherit" }} />
      <button style={{ ...btn(false), padding: "6px 10px", fontSize: 12.5 }} onClick={copySummary}>{copied ? "Copied ✓" : "Copy summary"}</button>
      {!demo && (
        <button style={{ ...btn(false), padding: "6px 10px", fontSize: 12.5 }} onClick={() => signOut()}>Lock</button>
      )}
    </div>
  );

  return (
    <div style={{ fontFamily: "'Barlow', system-ui, -apple-system, sans-serif", background: "#F2F1EC", height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden", color: "#23272B" }}>
      <style>{`
        * { box-sizing: border-box; }
        button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible, [role="button"]:focus-visible { outline: 2px solid #2C6E8A; outline-offset: 2px; }
        @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
      `}</style>

      {/* ===== Header ===== */}
      <header style={{ background: "linear-gradient(180deg,#3A4046,#2E3A45)", color: "#F2F1EC", padding: "8px 14px", borderBottom: "3px solid #C0392B", flexShrink: 0 }}>
        <div style={{ maxWidth: 980, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 18, letterSpacing: 1.2, textTransform: "uppercase" }}>
              Sr Air Bud · Fix-It List
            </span>
            <span style={{ fontSize: 10.5, color: "#8A9298" }}>
              {demo ? "Demo mode" : saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved ✓" : saveState === "offline" ? "Not saved" : ""}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5 }}>
            <div style={{ flex: 1, height: 6, background: "#23272B", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ width: pct + "%", height: "100%", background: "linear-gradient(90deg,#2E7D4F,#2C6E8A)", transition: REDUCE_MOTION ? "none" : "width .4s" }} />
            </div>
            <span style={{ fontSize: 11, color: "#B9C1C7", whiteSpace: "nowrap" }}>
              {done}/{issues.length} done · {stats.open} open
              {stats.questions > 0 && <span style={{ color: "#F0C36D" }}> · {stats.questions} ?</span>}
            </span>
          </div>
        </div>
      </header>

      <main style={{ flex: 1, minHeight: 0, maxWidth: 980, width: "100%", margin: "0 auto", padding: "8px 12px 10px", display: "flex", flexDirection: "column" }}>
        {demo && (
          <div style={{ flexShrink: 0, background: "#FBF3E0", border: "1px solid #D9971E", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 8 }}>
            Demo mode — the database isn't connected yet, so changes won't be saved. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see README) to go live.
          </div>
        )}
        {!demo && saveState === "offline" && (
          <div style={{ flexShrink: 0, background: "#FBF3E0", border: "1px solid #D9971E", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 8 }}>
            Can't reach the database right now — check your connection. Recent changes may not be saved.
          </div>
        )}

        <div style={{ flexShrink: 0 }}>{diagramCard}</div>
        <div style={{ flexShrink: 0, maxWidth: 820, width: "100%", margin: "0 auto" }}>{toolbar}</div>
        {showHelp && (
          <div style={{ flexShrink: 0, maxWidth: 820, width: "100%", margin: "0 auto 8px", background: "#E6F0F5", border: "1px solid #2C6E8A", borderRadius: 8, padding: "7px 10px", fontSize: 12.5, display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ flex: 1 }}>New here? Tap any numbered pin or list item to see details, add photos, and leave notes or questions. Update the status inside each issue as repairs are completed.</span>
            <button onClick={dismissHelp} style={{ ...btn(false), padding: "3px 9px", fontSize: 12 }}>Got it</button>
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingBottom: 10, WebkitOverflowScrolling: "touch" }}>
          <div style={{ maxWidth: 820, margin: "0 auto" }}>
            {listBlock}
            <p style={{ fontSize: 12.5, color: "#5B6369", marginTop: 12 }}>
              Tap a pin or a list item to open its details — the selected pin lights up while the rest dim. Dashed red rings are safety items.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
