// Supabase project for syncing between devices (Supabase dashboard → Project Settings → API).
// The anon / publishable key is meant to be public: Row Level Security in supabase/schema.sql
// limits every signed-in user to their own rows. Leave both empty to keep the app device-only.
export const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY || '';

export const syncConfigured = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
