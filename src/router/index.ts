import { createRouter, createWebHistory } from 'vue-router';
import AgentWorkspace from '@/views/AgentWorkspace.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: AgentWorkspace,
      meta: {
        title: 'AI PPT Agent 工作区'
      }
    },
    {
      path: '/my-ppt',
      name: 'my-ppt',
      component: AgentWorkspace,
      meta: {
        title: '我的 PPT - AI PPT Agent'
      }
    },
    {
      path: '/prompts',
      name: 'prompts',
      component: AgentWorkspace,
      meta: {
        title: '提示词管理 - AI PPT Agent'
      }
    },
    {
      path: '/skills',
      name: 'skills',
      component: AgentWorkspace,
      meta: {
        title: 'Skill 管理 - AI PPT Agent'
      }
    },
    {
      path: '/models',
      name: 'models',
      component: AgentWorkspace,
      meta: {
        title: '模型管理 - AI PPT Agent'
      }
    },
    {
      path: '/templates',
      name: 'templates',
      component: AgentWorkspace,
      meta: {
        title: '模版广场 - AI PPT Agent'
      }
    },
    {
      path: '/config',
      name: 'config',
      component: AgentWorkspace,
      meta: {
        title: '运行配置 - AI PPT Agent'
      }
    },
    {
      path: '/project/:id/:tab?',
      name: 'project-edit',
      component: AgentWorkspace,
      meta: {
        title: '编辑项目 - AI PPT Agent'
      }
    }
  ]
});

router.beforeEach((to) => {
  if (to.meta.title) {
    document.title = to.meta.title as string;
  }
});
