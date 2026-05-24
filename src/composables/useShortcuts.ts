import { onMounted, onUnmounted } from 'vue';

export type ShortcutHandler = (event: KeyboardEvent) => void;

export interface ShortcutDef {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
  description: string;
  handler: ShortcutHandler;
  /** Only fire when no input/textarea/select is focused */
  skipWhenEditing?: boolean;
}

function isEditingElement(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    target.isContentEditable
  );
}

function matchShortcut(event: KeyboardEvent, def: ShortcutDef): boolean {
  const ctrlKey = event.ctrlKey || event.metaKey; // Cmd on Mac = metaKey
  const needsCtrl = def.ctrl || def.meta;

  if (needsCtrl && !ctrlKey) return false;
  if (!needsCtrl && ctrlKey) return false;
  if (def.shift && !event.shiftKey) return false;
  if (def.alt && !event.altKey) return false;

  const eventKey = event.key.toLowerCase();
  const defKey = def.key.toLowerCase();
  return eventKey === defKey;
}

export function useShortcuts(shortcuts: ShortcutDef[]) {
  function onKeyDown(event: KeyboardEvent) {
    // Skip if Escape (always allowed) or check editing state
    if (event.key !== 'Escape') {
      if (isEditingElement(event.target)) {
        // Still allow Cmd/Ctrl+K and Cmd/Ctrl+Enter in inputs
        const isSpecial = (event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'k' || event.key === 'Enter');
        if (!isSpecial) return;
      }
    }

    for (const def of shortcuts) {
      if (matchShortcut(event, def)) {
        if (def.skipWhenEditing !== false || !isEditingElement(event.target)) {
          event.preventDefault();
          event.stopPropagation();
          def.handler(event);
          return;
        }
      }
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', onKeyDown);
  });

  onUnmounted(() => {
    window.removeEventListener('keydown', onKeyDown);
  });
}
