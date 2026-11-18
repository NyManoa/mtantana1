import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = (import.meta.env.VITE_SUPABASE_URL ?? "").trim();
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? "").trim();

/**
 * false si l'URL ou la clé Supabase manquent : l'application démarre quand
 * même et seul le mode « sans compte » est proposé (jamais de page blanche).
 */
export const cloudConfigured = /^https?:\/\/.+/.test(url) && !url.includes("xxxxxxxx") && anonKey.length > 20;

if (!cloudConfigured) {
  console.warn("[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY absents ou invalides : mode sans compte uniquement (voir .env.example).");
}

/** Délai maximum d'une requête : un projet en pause ou un réseau lent ne doit jamais figer l'application. */
const REQUEST_TIMEOUT_MS = 12_000;

let reachable = true;
const listeners = new Set<(ok: boolean) => void>();

function setReachable(ok: boolean) {
  if (ok === reachable) return;
  reachable = ok;
  listeners.forEach((l) => l(ok));
}

/** Dernier état connu du serveur (false après une erreur réseau / un délai dépassé). */
export function isCloudReachable() {
  return cloudConfigured && reachable;
}

export function onCloudReachabilityChange(cb: (ok: boolean) => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

const fetchWithTimeout: typeof fetch = async (input, init) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  // Respecte un éventuel signal fourni par l'appelant.
  init?.signal?.addEventListener("abort", () => ctrl.abort());
  try {
    const res = await fetch(input, { ...init, signal: ctrl.signal });
    // 5xx de la passerelle (projet en pause, maintenance) = serveur indisponible.
    setReachable(!(res.status === 502 || res.status === 503 || res.status === 504 || res.status === 540));
    return res;
  } catch (err) {
    setReachable(false);
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Vérifie rapidement si le serveur répond (utilisé au démarrage).
 * Ne lève jamais d'erreur.
 */
export async function pingCloud(timeoutMs = 4000): Promise<boolean> {
  if (!cloudConfigured) return false;
  if (!navigator.onLine) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}/auth/v1/health`, { headers: { apikey: anonKey }, signal: ctrl.signal });
    const ok = res.status < 500;
    setReachable(ok);
    return ok;
  } catch {
    setReachable(false);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// La clé « anon » est publique par conception : la sécurité repose sur les
// policies RLS de la base. Ne JAMAIS mettre la clé service_role côté client.
// Sans configuration, on crée un client vers une adresse invalide : les appels
// échouent proprement au lieu de faire planter l'application au chargement.
export const supabase: SupabaseClient = createClient(cloudConfigured ? url : "https://non-configure.invalid", cloudConfigured ? anonKey : "non-configure", {
  auth: {
    persistSession: cloudConfigured,
    autoRefreshToken: cloudConfigured,
    detectSessionInUrl: cloudConfigured,
    // PKCE : le code reçu par e-mail / Google n'est échangeable que par ce navigateur.
    flowType: "pkce",
  },
  global: { fetch: fetchWithTimeout },
});
