import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** Null when env vars are missing — the app then runs in local demo mode. */
export const supabase = url && key ? createClient(url, key) : null;
export const PHOTO_BUCKET = "punchlist-photos";
