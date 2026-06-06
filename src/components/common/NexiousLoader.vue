<script setup lang="ts">
withDefaults(
  defineProps<{
    size?: 'sm' | 'md' | 'lg';
    inverse?: boolean;
  }>(),
  {
    size: 'md',
    inverse: false
  }
);
</script>

<template>
  <span class="nexious-loader" :class="[`nexious-loader--${size}`, { 'nexious-loader--inverse': inverse }]" aria-hidden="true">
    <span class="nexious-loader__deck">
      <span class="nexious-loader__sheet nexious-loader__sheet--back" />
      <span class="nexious-loader__sheet nexious-loader__sheet--middle" />
      <span class="nexious-loader__sheet nexious-loader__sheet--front">
        <span />
        <span />
        <span />
      </span>
    </span>
    <span class="nexious-loader__track">
      <span />
      <span />
      <span />
    </span>
  </span>
</template>

<style scoped>
.nexious-loader {
  --loader-size: 44px;
  --loader-sheet-width: 32px;
  --loader-sheet-height: 24px;
  --loader-radius: 6px;
  --loader-ink: var(--color-accent);
  --loader-soft: var(--color-accent-soft);
  --loader-border: color-mix(in srgb, var(--color-accent) 34%, var(--color-border));
  --loader-surface: var(--color-surface);

  position: relative;
  display: inline-grid;
  place-items: center;
  width: var(--loader-size);
  height: var(--loader-size);
  color: var(--loader-ink);
}

.nexious-loader--sm {
  --loader-size: 24px;
  --loader-sheet-width: 18px;
  --loader-sheet-height: 14px;
  --loader-radius: 4px;
}

.nexious-loader--lg {
  --loader-size: 54px;
  --loader-sheet-width: 40px;
  --loader-sheet-height: 30px;
  --loader-radius: 7px;
}

.nexious-loader--inverse {
  --loader-ink: var(--color-inverse);
  --loader-soft: color-mix(in srgb, var(--color-inverse) 20%, transparent);
  --loader-border: color-mix(in srgb, var(--color-inverse) 52%, transparent);
  --loader-surface: color-mix(in srgb, var(--color-inverse) 16%, transparent);
}

.nexious-loader__deck {
  position: relative;
  width: var(--loader-sheet-width);
  height: var(--loader-sheet-height);
}

.nexious-loader__sheet {
  position: absolute;
  inset: 0;
  border: 1px solid var(--loader-border);
  border-radius: var(--loader-radius);
  background: var(--loader-surface);
  box-shadow: 0 1px 2px rgb(15 23 42 / 8%);
}

.nexious-loader__sheet--back {
  transform: translate(-5px, 5px);
  opacity: 0.38;
  animation: loader-sheet-back 1.45s ease-in-out infinite;
}

.nexious-loader__sheet--middle {
  transform: translate(-2px, 2px);
  opacity: 0.68;
  animation: loader-sheet-middle 1.45s ease-in-out infinite;
}

.nexious-loader__sheet--front {
  display: grid;
  grid-template-rows: 1fr 1fr 1fr;
  gap: 3px;
  padding: 5px;
  background: var(--loader-soft);
  animation: loader-sheet-front 1.45s ease-in-out infinite;
}

.nexious-loader__sheet--front span {
  display: block;
  width: 100%;
  height: 2px;
  border-radius: var(--radius-full);
  background: currentColor;
  opacity: 0.8;
  transform-origin: left center;
  animation: loader-line 1.45s ease-in-out infinite;
}

.nexious-loader__sheet--front span:nth-child(2) {
  width: 74%;
  animation-delay: 110ms;
}

.nexious-loader__sheet--front span:nth-child(3) {
  width: 48%;
  animation-delay: 220ms;
}

.nexious-loader__track {
  position: absolute;
  right: 8px;
  bottom: 4px;
  left: 8px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 3px;
}

.nexious-loader--sm .nexious-loader__track {
  right: 4px;
  bottom: 2px;
  left: 4px;
  gap: 2px;
}

.nexious-loader__track span {
  height: 3px;
  border-radius: var(--radius-full);
  background: currentColor;
  opacity: 0.24;
  animation: loader-track 1.05s ease-in-out infinite;
}

.nexious-loader--sm .nexious-loader__track span {
  height: 2px;
}

.nexious-loader__track span:nth-child(2) {
  animation-delay: 140ms;
}

.nexious-loader__track span:nth-child(3) {
  animation-delay: 280ms;
}

@keyframes loader-sheet-back {
  0%,
  100% {
    transform: translate(-5px, 5px);
  }

  45% {
    transform: translate(-7px, 6px);
  }
}

@keyframes loader-sheet-middle {
  0%,
  100% {
    transform: translate(-2px, 2px);
  }

  45% {
    transform: translate(-3px, 1px);
  }
}

@keyframes loader-sheet-front {
  0%,
  100% {
    transform: translate(0, 0);
  }

  45% {
    transform: translate(3px, -2px);
  }
}

@keyframes loader-line {
  0%,
  100% {
    transform: scaleX(0.56);
    opacity: 0.45;
  }

  45% {
    transform: scaleX(1);
    opacity: 0.92;
  }
}

@keyframes loader-track {
  0%,
  100% {
    opacity: 0.24;
    transform: translateY(0);
  }

  45% {
    opacity: 0.95;
    transform: translateY(-1px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .nexious-loader__sheet,
  .nexious-loader__sheet--front span,
  .nexious-loader__track span {
    animation-duration: 1ms;
    animation-iteration-count: 1;
  }
}
</style>
