import { ref, computed, type Ref } from 'vue';

export interface HistoryEntry<T> {
  snapshot: T;
  timestamp: number;
  label?: string;
}

export function useHistory<T>(
  source: Ref<T>,
  options?: {
    maxSteps?: number;
    clone?: (v: T) => T;
    onRestore?: (snapshot: T) => void;
  }
) {
  const maxSteps = options?.maxSteps ?? 50;
  const cloneFn = options?.clone ?? ((v: T) => JSON.parse(JSON.stringify(v)) as T);

  const past = ref<HistoryEntry<T>[]>([]) as Ref<HistoryEntry<T>[]>;
  const future = ref<HistoryEntry<T>[]>([]) as Ref<HistoryEntry<T>[]>;

  const canUndo = computed(() => past.value.length > 0);
  const canRedo = computed(() => future.value.length > 0);

  function snapshot(label?: string) {
    const snap = cloneFn(source.value);
    past.value.push({
      snapshot: snap,
      timestamp: Date.now(),
      label
    });
    if (past.value.length > maxSteps) {
      past.value.shift();
    }
    future.value = [];
  }

  function undo() {
    if (!canUndo.value) return;
    const entry = past.value.pop()!;
    const currentSnap = cloneFn(source.value);
    future.value.push({
      snapshot: currentSnap,
      timestamp: Date.now(),
      label: 'undo'
    });
    const restored = cloneFn(entry.snapshot);
    options?.onRestore?.(restored);
    source.value = restored;
  }

  function redo() {
    if (!canRedo.value) return;
    const entry = future.value.pop()!;
    const currentSnap = cloneFn(source.value);
    past.value.push({
      snapshot: currentSnap,
      timestamp: Date.now(),
      label: 'redo'
    });
    const restored = cloneFn(entry.snapshot);
    options?.onRestore?.(restored);
    source.value = restored;
  }

  function clear() {
    past.value = [];
    future.value = [];
  }

  return {
    snapshot,
    undo,
    redo,
    canUndo,
    canRedo,
    clear,
    pastCount: computed(() => past.value.length),
    futureCount: computed(() => future.value.length)
  };
}
