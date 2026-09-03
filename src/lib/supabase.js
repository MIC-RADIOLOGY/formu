// src/lib/supabase.js
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.warn(
    "[supabase] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. " +
      "Bet tracker will not persist until these are set in .env — see .env.example."
  );
}

export const supabase = url && anonKey ? createClient(url, anonKey) : null;

/* -------------------------------------------------------------
   Bets table helpers
   Expected schema (see supabase/schema.sql):
     id         uuid primary key default gen_random_uuid()
     match      text not null
     stake      numeric not null
     odds       numeric not null
     result     text not null default 'pending'  -- 'pending' | 'win' | 'loss'
     created_at timestamptz not null default now()
------------------------------------------------------------- */

export async function listBets() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("bets")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function addBet({ match, stake, odds }) {
  if (!supabase) throw new Error("Supabase not configured.");
  const { data, error } = await supabase
    .from("bets")
    .insert([{ match, stake, odds, result: "pending" }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateBetResult(id, result) {
  if (!supabase) throw new Error("Supabase not configured.");
  const { data, error } = await supabase
    .from("bets")
    .update({ result })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteBet(id) {
  if (!supabase) throw new Error("Supabase not configured.");
  const { error } = await supabase.from("bets").delete().eq("id", id);
  if (error) throw error;
}

/** Subscribe to realtime changes on the bets table. Returns an unsubscribe fn. */
export function subscribeToBets(onChange) {
  if (!supabase) return () => {};
  const channel = supabase
    .channel("bets-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "bets" }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}
