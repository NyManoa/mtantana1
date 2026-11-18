import { useEffect } from "react";
import { exportAllData } from "./db";
import { driveConnected, uploadToDrive } from "./gdrive";

export const DRIVE_AUTO_KEY = "mtantana_drive_auto";
export const DRIVE_LAST_KEY = "mtantana_drive_last";

export function isDriveAutoEnabled() {
  try {
    return localStorage.getItem(DRIVE_AUTO_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Sauvegarde automatique dans Google Drive : 15 s après la dernière
 * modification, tant que l'utilisateur a connecté Drive pendant la session
 * (le jeton Google n'est jamais stocké sur le disque).
 */
export function DriveAutoBackup() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onChange = () => {
      if (!isDriveAutoEnabled() || !driveConnected() || !navigator.onLine) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          const at = await uploadToDrive(await exportAllData());
          localStorage.setItem(DRIVE_LAST_KEY, at);
          window.dispatchEvent(new CustomEvent("mtantana:drive-saved"));
        } catch (err) {
          console.warn("[drive] sauvegarde automatique échouée", err);
        }
      }, 15_000);
    };
    window.addEventListener("mtantana:data-changed", onChange);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("mtantana:data-changed", onChange);
    };
  }, []);
  return null;
}
