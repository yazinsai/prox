import { useSyncExternalStore } from 'react';
import { createSharedClock } from '@/utils/time/sharedClock';

// A single clock for this workspace, following the auth-file cooldown view.
// Second precision ensures an elapsed restriction is no longer labelled active
// while waiting for the next provider inventory poll.
const clock = createSharedClock({ intervalMs: 1000 });
const serverNow = clock.getSnapshot();
const serverSnapshot = () => serverNow;
const noSubscription = () => () => {};

export function useDashboardCooldownClock(enabled: boolean): number {
  return useSyncExternalStore(
    enabled ? clock.subscribe : noSubscription,
    clock.getSnapshot,
    serverSnapshot
  );
}
