/**
 * Sauvegarde dans le Google Drive de l'utilisateur.
 *
 * - Utilise Google Identity Services (jeton OAuth côté navigateur, aucun secret).
 * - Portée `drive.appdata` : l'application ne voit QUE son propre dossier caché
 *   dans le Drive (elle n'a accès à aucun autre fichier de l'utilisateur).
 * - Fonctionne aussi en mode sans compte M'tantana : c'est le compte Google qui
 *   sert de « cloud ».
 *
 * Configuration : définir VITE_GOOGLE_CLIENT_ID (voir README).
 */

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const FILE_NAME = "mtantana-sauvegarde.json";
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";

export const driveConfigured = Boolean(CLIENT_ID);

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}
interface TokenClient {
  requestAccessToken: (opts?: { prompt?: string }) => void;
}
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (cfg: {
            client_id: string;
            scope: string;
            callback: (r: TokenResponse) => void;
            error_callback?: (e: { type: string }) => void;
          }) => TokenClient;
          revoke: (token: string, done?: () => void) => void;
        };
      };
    };
  }
}

let token: { value: string; expires: number } | null = null;
let gisPromise: Promise<void> | null = null;

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisPromise = null;
      reject(new Error("Impossible de charger Google. Vérifiez votre connexion."));
    };
    document.head.appendChild(s);
  });
  return gisPromise;
}

export function driveConnected(): boolean {
  return token !== null && token.expires > Date.now() + 60_000;
}

/** Doit être appelé depuis un clic (le navigateur bloque sinon la fenêtre Google). */
export async function connectDrive(): Promise<void> {
  if (!CLIENT_ID) throw new Error("Google Drive n'est pas configuré (VITE_GOOGLE_CLIENT_ID manquant)");
  if (driveConnected()) return;
  await loadGis();
  await new Promise<void>((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (r) => {
        if (r.error || !r.access_token) {
          reject(new Error("Autorisation Google refusée"));
          return;
        }
        token = { value: r.access_token, expires: Date.now() + (r.expires_in ?? 3600) * 1000 };
        resolve();
      },
      error_callback: (e) => reject(new Error(e.type === "popup_closed" ? "Fenêtre Google fermée" : "Connexion Google impossible")),
    });
    client.requestAccessToken({ prompt: "" });
  });
}

export function disconnectDrive() {
  if (token && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(token.value);
  token = null;
}

async function api(url: string, init: RequestInit = {}): Promise<Response> {
  if (!driveConnected()) throw new Error("Connectez d'abord votre compte Google");
  const res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token!.value}` } });
  if (res.status === 401) {
    token = null;
    throw new Error("Session Google expirée, reconnectez-vous");
  }
  if (!res.ok) throw new Error(`Google Drive : erreur ${res.status}`);
  return res;
}

async function findBackup(): Promise<{ id: string; modifiedTime: string; size?: string } | null> {
  const q = encodeURIComponent(`name = '${FILE_NAME}' and trashed = false`);
  const res = await api(`${API}/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime,size)&orderBy=modifiedTime desc`);
  const data = (await res.json()) as { files?: { id: string; modifiedTime: string; size?: string }[] };
  return data.files?.[0] ?? null;
}

export async function getDriveBackupInfo() {
  return findBackup();
}

export async function uploadToDrive(json: string): Promise<string> {
  const existing = await findBackup();
  if (existing) {
    await api(`${UPLOAD}/files/${existing.id}?uploadType=media`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: json,
    });
  } else {
    const boundary = `mtantana${Math.random().toString(36).slice(2)}`;
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify({ name: FILE_NAME, parents: ["appDataFolder"], mimeType: "application/json" }) +
      `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--`;
    await api(`${UPLOAD}/files?uploadType=multipart`, {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
  }
  return new Date().toISOString();
}

export async function downloadFromDrive(): Promise<string | null> {
  const existing = await findBackup();
  if (!existing) return null;
  const res = await api(`${API}/files/${existing.id}?alt=media`);
  return res.text();
}
