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
  height: 100vh;
  background: var(--color-bg);
  overflow: hidden;
  transition: grid-template-columns var(--transition-fast);
}

.app-shell--nav-collapsed {
  grid-template-columns: 68px 1fr;
}
</style>
