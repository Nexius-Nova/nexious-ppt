import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type {
  AgentParameters,
  ConfigOptionGroups,
  ConfigOptionKey,
  DeckInput,
  InputProcessStep,
  PromptDefinition,
  SkillDefinition,
  UploadedFileContent,
} from '@/types/agent';

const defaultParameters: AgentParameters = {
  summaryLength: 'auto',
  slideCount: 0,
  tone: 'auto',
  imageStyle: 'auto',
  template: 'auto',
  skillIntensity: 0,
  animationEnabled: 'auto',
  animationEffect: 'auto',
};

const defaultConfigOptions: ConfigOptionGroups = {
  slideCount: [],
  summaryLength: [],
  tone: [],
  imageStyle: [],
  skillIntensity: [],
  animationEnabled: [],
  animationEffect: [],
};

export const useInputStore = defineStore('agentInput', () => {
  const input = ref<DeckInput>({ topic: '', content: '', files: [] });
  const parameters = ref<AgentParameters>({ ...defaultParameters });
  const skills = ref<SkillDefinition[]>([]);
  const prompts = ref<PromptDefinition[]>([]);
  const inputProcessSteps = ref<InputProcessStep[]>([]);
  const uploadedFileContents = ref<UploadedFileContent[]>([]);
  const processedInputContent = ref('');
  const selectedPromptId = ref('');
  const selectedTextModelId = ref<string | null>(null);
  const selectedImageModelId = ref<string | null>(null);
  const configOptions = ref<ConfigOptionGroups>({ ...defaultConfigOptions });
  const configRecords = ref<Partial<Record<ConfigOptionKey, any>>>({});
  const configLoadError = ref('');

  const enabledSkills = computed(() => skills.value.filter((skill) => skill.enabled).sort((a, b) => a.order - b.order));
  const runnableSkills = computed(() => skills.value.filter((skill) =>
    skill.runtime === 'prompt-only' ||
    skill.type === 'prompt-only' ||
    skill.testStatus === 'passed'
  ).sort((a, b) => a.order - b.order));
  const runnableEnabledSkills = computed(() => enabledSkills.value.filter((skill) =>
    runnableSkills.value.some((item) => item.id === skill.id)
  ));

  return {
    input,
    parameters,
    skills,
    enabledSkills,
    runnableSkills,
    runnableEnabledSkills,
    prompts,
    inputProcessSteps,
    uploadedFileContents,
    processedInputContent,
    selectedPromptId,
    selectedTextModelId,
    selectedImageModelId,
    configOptions,
    configRecords,
    configLoadError,
  };
});
