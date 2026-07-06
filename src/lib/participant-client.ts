import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const URL = import.meta.env.VITE_SUPABASE_URL as string;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

/**
 * Anonymous Supabase client scoped to a single participant session.
 * It sends the session's access_token in the `x-session-token` header so
 * RLS policies can confirm the caller owns the session before returning
 * any rows or accepting any inserts/updates.
 */
export function participantClient(accessToken: string) {
  return createClient<Database>(URL, KEY, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-session-token": accessToken } },
  });
}
