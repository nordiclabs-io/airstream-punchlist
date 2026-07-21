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

/* Everyone shares one login; the code is the last 6 digits of the VIN. */
export const CREW_EMAIL = "crew@srairbud.app";
