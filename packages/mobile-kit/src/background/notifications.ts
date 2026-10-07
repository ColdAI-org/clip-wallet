/**
 * Local notifications on the phone (no push server): expo-notifications shows the notices the social stream's
 * watcher produces, from a foreground timer and from background runs (background-task.ts).
 *
 *   https://docs.expo.dev/versions/latest/sdk/notifications/ — scheduleNotificationAsync with `trigger: null`
 *   shows a notice now; Android 8+ needs a channel; Android 13+ and iOS ask the user (requestPermissionsAsync).
 */
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import type { Notice, Notifier } from "@clip-wallet/social";

const CHANNEL = "wallet";

let configured = false;
function configure() {
  if (configured) return;
  configured = true;
  // While the app is open, still show the banner (the user may be on another screen).
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

/** Asks for permission (and creates the Android channel). False when the user refuses. */
export async function requestNotificationPermission(): Promise<boolean> {
  configure();
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(CHANNEL, { name: "Wallet", importance: Notifications.AndroidImportance.DEFAULT });
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

export function expoNotifier(): Notifier {
  return {
    async show(n: Notice) {
      configure();
      const perm = await Notifications.getPermissionsAsync();
      if (!perm.granted) return;
      await Notifications.scheduleNotificationAsync({
        identifier: n.id,
        content: { title: n.title, body: n.body, data: { route: n.route ?? "/" } },
        trigger: Platform.OS === "android" ? { channelId: CHANNEL } : null,
      });
    },
  };
}

/** Calls `open(route)` when the user taps a notice (also for the tap that launched the app). */
export function onNotificationTap(open: (route: string) => void): () => void {
  const pick = (r: Notifications.NotificationResponse | null) => {
    const route = r?.notification.request.content.data?.route;
    if (typeof route === "string") open(route);
  };
  void Notifications.getLastNotificationResponseAsync().then(pick, () => undefined);
  const sub = Notifications.addNotificationResponseReceivedListener(pick);
  return () => sub.remove();
}
