/**
 * 数据库验证脚本
 * 测试数据库连接和查询功能
 */

import {
  getUserById,
  getUserByEmail,
  getAllUsers,
  getUserCount,
} from '../models/user.js';

import {
  getApiKeyById,
  getApiKeysByUserId,
  getDefaultApiKey,
} from '../models/apiKey.js';

import {
  getProjectById,
  getProjectsByUserId,
  getProjectStats,
} from '../models/project.js';

import {
  getSlideById,
  getSlidesByProjectId,
  getSlideCount,
} from '../models/slide.js';

import {
  getImageById,
  getImagesBySlideId,
  getSelectedImage,
} from '../models/image.js';

import { closePool } from '../db/connection.js';

/**
 * 验证数据库功能
 */
async function verifyDatabase() {
  console.log('🔍 开始验证数据库功能...\n');

  try {
    // 1. 验证用户表
    console.log('📊 验证用户表:');
    const userCount = await getUserCount();
    console.log(`  ✅ 用户总数: ${userCount}`);

    const users = await getAllUsers(5);
    console.log(`  ✅ 查询到 ${users.length} 个用户`);

    if (users.length > 0) {
      const user = await getUserById(users[0].id);
      console.log(`  ✅ 用户详情: ${user?.email} (${user?.name})`);

      const userByEmail = await getUserByEmail(users[0].email);
      console.log(`  ✅ 通过邮箱查询: ${userByEmail?.email}`);
    }

    // 2. 验证API密钥表
    console.log('\n🔑 验证API密钥表:');
    if (users.length > 0) {
      const apiKeys = await getApiKeysByUserId(users[0].id);
      console.log(`  ✅ 用户 ${users[0].id} 的API密钥数量: ${apiKeys.length}`);

      if (apiKeys.length > 0) {
        const apiKey = await getApiKeyById(apiKeys[0].id);
        console.log(`  ✅ API密钥详情: ${apiKey?.name} (${apiKey?.type})`);

        const defaultTextKey = await getDefaultApiKey(users[0].id, 'text');
        console.log(`  ✅ 默认文本API密钥: ${defaultTextKey?.name || '无'}`);

        const defaultImageKey = await getDefaultApiKey(users[0].id, 'image');
        console.log(`  ✅ 默认图像API密钥: ${defaultImageKey?.name || '无'}`);
      }
    }

    // 3. 验证项目表
    console.log('\n📁 验证项目表:');
    if (users.length > 0) {
      const projects = await getProjectsByUserId(users[0].id);
      console.log(`  ✅ 用户 ${users[0].id} 的项目数量: ${projects.length}`);

      const stats = await getProjectStats(users[0].id);
      console.log(`  ✅ 项目统计: 总计=${stats.total}, 草稿=${stats.draft}, 生成中=${stats.generating}, 已完成=${stats.completed}`);

      if (projects.length > 0) {
        const project = await getProjectById(projects[0].id);
        console.log(`  ✅ 项目详情: ${project?.title} (${project?.status})`);
      }
    }

    // 4. 验证幻灯片表
    console.log('\n📑 验证幻灯片表:');
    if (users.length > 0) {
      const projects = await getProjectsByUserId(users[0].id);
      if (projects.length > 0) {
        const slides = await getSlidesByProjectId(projects[0].id);
        console.log(`  ✅ 项目 ${projects[0].id} 的幻灯片数量: ${slides.length}`);

        const slideCount = await getSlideCount(projects[0].id);
        console.log(`  ✅ 幻灯片总数: ${slideCount}`);

        if (slides.length > 0) {
          const slide = await getSlideById(slides[0].id);
          console.log(`  ✅ 幻灯片详情: ${slide?.title} (顺序: ${slide?.order_index})`);
        }
      }
    }

    // 5. 验证图片表
    console.log('\n🖼️  验证图片表:');
    if (users.length > 0) {
      const projects = await getProjectsByUserId(users[0].id);
      if (projects.length > 0) {
        const slides = await getSlidesByProjectId(projects[0].id);
        if (slides.length > 0) {
          const images = await getImagesBySlideId(slides[0].id);
          console.log(`  ✅ 幻灯片 ${slides[0].id} 的图片数量: ${images.length}`);

          if (images.length > 0) {
            const image = await getImageById(images[0].id);
            console.log(`  ✅ 图片详情: ${image?.style} 风格`);

            const selectedImage = await getSelectedImage(slides[0].id);
            console.log(`  ✅ 选中的图片: ${selectedImage?.style || '无'}`);
          }
        }
      }
    }

    console.log('\n✅ 数据库验证完成！所有功能正常。');

  } catch (error) {
    console.error('\n❌ 数据库验证失败:', error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

// 执行验证
verifyDatabase();
