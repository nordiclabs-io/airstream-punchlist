import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** Null when env vars are missing — the app then runs in local demo mode. */
export const supabase = url && key
  ? createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: "airbud:session" },
    })
  : null;

export const PHOTO_BUCKET = "punchlist-photos";

/* Two shared logins. The view code opens the list read-only; the edit code
   also allows changes. Which one you typed decides what you can do — the
   database enforces it, the UI just reflects it. */
export const VIEWER_EMAIL = "crew@srairbud.app";
export const EDITOR_EMAIL = "editor@srairbud.app";
