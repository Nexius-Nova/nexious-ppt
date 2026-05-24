<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { ChevronDown, Check } from 'lucide-vue-next';

const props = defineProps<{
  modelValue: string;
  options: Array<{ label: string; value: string; description?: string }>;
  disabled?: boolean;
  placeholder?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const isOpen = ref(false);
const selectRef = ref<HTMLElement | null>(null);

const selectedOption = computed(() => 
  props.options.find(opt => opt.value === props.modelValue)
);

const displayLabel = computed(() => 
  selectedOption.value?.label || props.placeholder || '请选择'
);

function toggleDropdown() {
  if (!props.disabled) {
    isOpen.value = !isOpen.value;
  }
}

function selectOption(value: string) {
  emit('update:modelValue', value);
  isOpen.value = false;
}

function handleClickOutside(event: MouseEvent) {
  if (selectRef.value && !selectRef.value.contains(event.target as Node)) {
    isOpen.value = false;
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});
</script>

<template>
  <div ref="selectRef" class="ui-select" :class="{ 'ui-select--open': isOpen, 'ui-select--disabled': disabled }">
    <button
      type="button"
      class="ui-select__trigger"
      :disabled="disabled"
      @click="toggleDropdown"
    >
      <span class="ui-select__label" :class="{ 'ui-select__label--placeholder': !selectedOption }">
        {{ displayLabel }}
      </span>
      <ChevronDown class="ui-select__icon" :size="14" :class="{ 'ui-select__icon--rotated': isOpen }" />
    </button>

    <Transition name="dropdown">
      <div v-show="isOpen" class="ui-select__dropdown">
        <div class="ui-select__options">
          <button
            v-for="option in options"
            :key="option.value"
            type="button"
            class="ui-select__option"
            :class="{ 'ui-select__option--selected': option.value === modelValue }"
            @click="selectOption(option.value)"
          >
            <span class="ui-select__option-content">
              <span class="ui-select__option-label">{{ option.label }}</span>
              <span v-if="option.description" class="ui-select__option-desc">{{ option.description }}</span>
            </span>
            <Check v-if="option.value === modelValue" class="ui-select__option-check" :size="14" />
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.ui-select {
  position: relative;
  width: 100%;
}

.ui-select--disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.ui-select__trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 40px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-surface);
  color: var(--color-text);
  padding: 0 12px;
  font-size: 14px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.ui-select__trigger:hover:not(:disabled) {
  border-color: var(--color-border-strong);
}

.ui-select--open .ui-select__trigger {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-soft);
}

.ui-select__trigger:disabled {
  background: var(--color-panel);
  cursor: not-allowed;
}

.ui-select__label {
  flex: 1;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ui-select__label--placeholder {
  color: var(--color-placeholder);
}

.ui-select__icon {
  flex-shrink: 0;
  color: var(--color-muted);
  transition: transform var(--transition-fast);
}

.ui-select__icon--rotated {
  transform: rotate(180deg);
}

.ui-select__dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 1000;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-surface);
  box-shadow: var(--shadow-panel);
  overflow: hidden;
}

.ui-select__options {
  max-height: 280px;
  overflow-y: auto;
  padding: 6px;
}

.ui-select__option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 10px 12px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text);
  text-align: left;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.ui-select__option:hover {
  background: var(--color-panel);
}

.ui-select__option--selected {
  background: var(--color-accent-soft);
  color: var(--color-accent);
}

.ui-select__option--selected:hover {
  background: var(--color-accent-soft);
}

.ui-select__option-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.ui-select__option-label {
  font-size: 13px;
  font-weight: 500;
}

.ui-select__option-desc {
  font-size: 11px;
  color: var(--color-subtle);
}

.ui-select__option-check {
  flex-shrink: 0;
  color: var(--color-accent);
}

/* Dropdown animation */
.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.15s ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
