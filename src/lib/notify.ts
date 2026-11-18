/**
 * Notifications système du navigateur / de l'application installée.
 * Activées par l'utilisateur, appareil par appareil (Ordres → « Notifications
 * sur cet appareil »). Affichées seulement quand l'onglet n'est pas visible :
 * sinon le message apparaît déjà dans l'application.
 */
const PREF_KEY = "mtantana_system_notifications";

export function systemNotificationsSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

export function systemNotificationsEnabled() {
  if (!systemNotificationsSupported()) return false;
  try {
    return localStorage.getItem(PREF_KEY) === "on" && Notification.permission === "granted";
  } catch {
    return false;
  }
}

export async function enableSystemNotifications(): Promise<boolean> {
  if (!systemNotificationsSupported()) return false;
  const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  const ok = perm === "granted";
  try {
    localStorage.setItem(PREF_KEY, ok ? "on" : "off");
  } catch {
    /* ignore */
  }
  return ok;
}

export function disableSystemNotifications() {
  try {
    localStorage.setItem(PREF_KEY, "off");
  } catch {
    /* ignore */
  }
}

export function showSystemNotification(title: string, body: string, tag: string, onClick?: () => void) {
  if (!systemNotificationsEnabled() || document.visibilityState === "visible") return;
  try {
    const n = new Notification(title, { body, tag, icon: "/icon-192.png", badge: "/icon-192.png" });
    n.onclick = () => {
      window.focus();
      onClick?.();
      n.close();
    };
  } catch {
    // Android Chrome exige le service worker pour les notifications.
    navigator.serviceWorker?.ready
      .then((reg) => reg.showNotification(title, { body, tag, icon: "/icon-192.png" }))
      .catch(() => undefined);
  }
}
