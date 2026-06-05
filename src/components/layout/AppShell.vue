<template>
  <div class="app-shell">
    <slot />
  </div>
</template>

<style scoped>
.app-shell {
  display: grid;
  grid-template-columns: 240px 1fr;
  grid-template-rows: 56px 1fr;
  grid-template-areas:
    "header header"
    "sidebar main";
  gap: 0;
  width: 100vw;
  height: 100dvh;
  background: var(--color-bg);
  overflow: hidden;
  transition: grid-template-columns var(--transition-fast);
}

.app-shell--nav-collapsed {
  grid-template-columns: 68px 1fr;
}

.app-shell--workflow-focus {
  grid-template-columns: 1fr;
  grid-template-areas:
    "header"
    "main";
}

.app-shell--workflow-focus :slotted(.side-nav) {
  display: none;
}

@media (max-width: 860px) {
  .app-shell {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr auto;
    grid-template-areas:
      "header"
      "main"
      "sidebar";
  }

  .app-shell--nav-collapsed {
    grid-template-columns: 1fr;
  }

  .app-shell--workflow-focus {
    grid-template-rows: auto 1fr;
    grid-template-areas:
      "header"
      "main";
  }
}
</style>
