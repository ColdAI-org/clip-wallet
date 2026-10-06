/**
 * Background checks for notifications (expo-background-task: BGTaskScheduler on iOS, WorkManager on Android;
 * https://docs.expo.dev/versions/latest/sdk/background-task/).
 *
 * What the OS allows, plainly:
 *  - The interval is a minimum (15 minutes at best); the OS picks the actual time from battery, network and
 *    how often the app is used. On iOS it can be hours, and nothing runs after the user swipes the app away
 *    until they open it again. Background tasks don't run in the iOS simulator.
 *  - So notifications are best-effort, not real-time: there is no push server (by design: no server learns
 *    the user's addresses). While the app is open, a foreground timer checks every minute.
 *
 * The task must be defined at module load (TaskManager.defineTask), so index.ts imports this file.
 */
import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";

export const SOCIAL_TASK = "clip-wallet-notifications";

let poll: (() => Promise<unknown>) | null = null;

/** The wallet hands over its poll function once it is built. */
export function setBackgroundPoll(fn: () => Promise<unknown>) {
  poll = fn;
}

TaskManager.defineTask(SOCIAL_TASK, async () => {
  try {
    if (!poll) return BackgroundTask.BackgroundTaskResult.Failed;
    await poll();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/** Registers (or removes) the periodic task to match the user's notification switch. */
export async function syncBackgroundTask(enabled: boolean): Promise<void> {
  const registered = await TaskManager.isTaskRegisteredAsync(SOCIAL_TASK).catch(() => false);
  if (enabled && !registered) await BackgroundTask.registerTaskAsync(SOCIAL_TASK, { minimumInterval: 15 }).catch(() => undefined);
  if (!enabled && registered) await BackgroundTask.unregisterTaskAsync(SOCIAL_TASK).catch(() => undefined);
}
