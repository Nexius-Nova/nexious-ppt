import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "@/stores/authStore";

// 路由懒加载 - 按需加载页面组件，减少首屏体积
const HomePage = () => import("@/components/pages/HomePage.vue");
const AuthPage = () => import("@/components/pages/AuthPage.vue");
const AgentWorkspace = () => import("@/views/AgentWorkspace.vue");
const AgentUI = () => import("@/components/pages/agentUI.vue");

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "home",
      component: HomePage,
      meta: {
        title: "AI PPT Agent - Nexious PPT",
        public: true
      }
    },
    {
      path: "/login",
      name: "login",
      component: AuthPage,
      meta: {
        title: "登录 - AI PPT Agent",
        public: true
      }
    },
    {
      path: "/my-ppt",
      name: "my-ppt",
      component: AgentWorkspace,
      meta: {
        title: "我的 PPT - AI PPT Agent"
      }
    },
    {
      path: "/templates",
      name: "templates",
      component: AgentWorkspace,
      meta: {
        title: "模板广场 - AI PPT Agent"
      }
    },
    {
      path: "/prompts",
      name: "prompts",
      component: AgentWorkspace,
      meta: {
        title: "提示词管理 - AI PPT Agent"
      }
    },
    {
      path: "/skills",
      name: "skills",
      component: AgentWorkspace,
      meta: {
        title: "Skill 管理 - AI PPT Agent"
      }
    },
    {
      path: "/models",
      name: "models",
      component: AgentWorkspace,
      meta: {
        title: "模型管理 - AI PPT Agent"
      }
    },
    {
      path: "/config",
      name: "config",
      component: AgentWorkspace,
      meta: {
        title: "运行配置 - AI PPT Agent"
      }
    },
    {
      path: "/profile",
      name: "profile",
      component: AgentWorkspace,
      meta: {
        title: "个人中心 - AI PPT Agent"
      }
    },
    {
      path: "/agent-ui",
      name: "agent-ui",
      component: AgentUI,
      meta: {
        title: "Agent 工作流 - AI PPT Agent",
        public: true
      }
    },
    {
      path: "/project/:id/:tab?",
      name: "project-edit",
      component: AgentWorkspace,
      meta: {
        title: "编辑项目 - AI PPT Agent"
      }
    }
  ]
});

router.beforeEach((to) => {
  const authStore = useAuthStore();

  if (to.meta.title) {
    document.title = to.meta.title as string;
  }

  if (!to.meta.public && !authStore.token) {
    return {
      path: "/login",
      query: { redirect: to.fullPath }
    };
  }

  if (to.name === "login" && authStore.token) {
    return "/my-ppt";
  }
});
