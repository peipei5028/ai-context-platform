/**
 * LLM Prompt Templates for Wiki Generation
 *
 * All prompts produce deterministic, source-grounded documentation.
 * Templates use {{PLACEHOLDER}} substitution.
 */

// ─── Grouping Prompt ──────────────────────────────────────────────────

export const GROUPING_SYSTEM_PROMPT = `你是一位文档架构师。根据源文件列表及其导出符号，将它们分组为逻辑文档模块。

规则：
- 每个模块应代表一个内聚的功能、层次或领域
- 每个文件必须且只能出现在一个模块中
- 模块名称应使用中文，简洁易懂（如"认证模块"、"数据库层"、"API 路由"）
- 通常项目分为 5-15 个模块，小项目可更少，大项目可更多
- 按功能分组，而非仅按文件类型或目录结构
- 不要为测试文件、配置文件或非源码文件创建模块`;

export const GROUPING_USER_PROMPT = `将以下源文件分组为文档模块。

**文件及其导出符号：**
{{FILE_LIST}}

**目录结构：**
{{DIRECTORY_TREE}}

仅返回 JSON 对象，将模块名映射到文件路径数组。不要输出 markdown 或任何解释。
示例格式：
{
  "认证模块": ["src/auth/login.ts", "src/auth/session.ts"],
  "数据库层": ["src/db/connection.ts", "src/db/models.ts"]
}`;

// ─── Leaf Module Prompt ───────────────────────────────────────────────

export const MODULE_SYSTEM_PROMPT = `你是一位技术文档工程师。为代码模块编写清晰、面向开发者的中文文档。

规则：
- 仅输出文档内容，不要包含任何元评论（如"我写了..."、"以下是文档..."、"本文档涵盖..."等）
- 直接以模块标题和内容开始
- 引用实际的函数名、类名和代码模式，不要虚构 API
- 使用调用图和执行流数据确保准确性，但不要机械地罗列每条边
- 仅在确实有助于理解时才包含 Mermaid 图表，且保持精简（最多 5-10 个节点）
- 根据模块特点自由组织文档结构，没有固定格式要求
- 面向需要理解和参与该模块开发的开发者撰写
- 使用中文撰写，代码标识符和技术术语保留英文原文`;

export const MODULE_USER_PROMPT = `为 **{{MODULE_NAME}}** 模块编写文档。

## 源代码

{{SOURCE_CODE}}

## 调用图与执行流（供参考以确保准确性）

内部调用：{{INTRA_CALLS}}
对外调用：{{OUTGOING_CALLS}}
外部调用：{{INCOMING_CALLS}}
执行流：{{PROCESSES}}

---

为该模块编写完整的中文文档。涵盖其用途、工作原理、关键组件，以及与代码库其他部分的关联方式。根据模块特点自行决定章节和标题结构。仅在确实能帮助理解架构时才包含 Mermaid 图。`;

// ─── Parent Module Prompt ─────────────────────────────────────────────

export const PARENT_SYSTEM_PROMPT = `你是一位技术文档工程师。为包含子模块的父模块编写中文摘要页面。综合子模块的文档内容，不要重新阅读源代码。

规则：
- 仅输出文档内容，不要包含任何元评论（如"我写了..."、"以下是文档..."等）
- 直接以模块标题和内容开始
- 引用子模块中的实际组件名称
- 重点关注子模块之间的协作关系，而非重复各自的文档内容
- 保持简洁——读者可以点击子模块页面查看详情
- 仅在确实能帮助理解子模块关系时才包含 Mermaid 图
- 使用中文撰写，代码标识符保留英文原文`;

export const PARENT_USER_PROMPT = `为 **{{MODULE_NAME}}** 模块编写文档，该模块包含以下子模块：

{{CHILDREN_DOCS}}

跨模块调用：{{CROSS_MODULE_CALLS}}
共享执行流：{{CROSS_PROCESSES}}

---

为该模块组编写简洁的中文概述。说明其用途、子模块之间的协作方式，以及跨模块的关键工作流。使用链接指向子模块页面（如 \`[子模块名](sub-module-slug.md)\`）而非重复其内容。根据实际情况自由组织结构。`;

// ─── Overview Prompt ──────────────────────────────────────────────────

export const OVERVIEW_SYSTEM_PROMPT = `你是一位技术文档工程师。为代码仓库 wiki 编写中文总览页面。这是新开发者看到的第一页。

规则：
- 仅输出文档内容，不要包含任何元评论（如"我写了..."、"页面已经重写..."等）
- 直接以项目标题和内容开始
- 表达清晰友好——这是整个代码库的入口
- 引用实际的模块名称，方便读者导航到对应文档
- 包含一个高层 Mermaid 架构图，仅展示最重要的模块及其关系（最多 10 个节点）。新开发者应能在 10 秒内理解全局
- 不要创建模块索引表格或逐个列出模块描述——在正文中自然地链接到模块页面即可
- 使用模块间调用边和执行流数据确保准确性，但不要原样堆砌
- 使用中文撰写，代码标识符保留英文原文`;

export const OVERVIEW_USER_PROMPT = `为该仓库的 wiki 编写中文总览页面。

## 项目信息

{{PROJECT_INFO}}

## 模块概要

{{MODULE_SUMMARIES}}

## 参考数据（供参考以确保准确性——不要原样复制）

模块间调用边：{{MODULE_EDGES}}
关键系统流程：{{TOP_PROCESSES}}

---

为该项目编写清晰的中文总览：项目做什么、架构如何、关键的端到端流程。包含一个简洁的 Mermaid 架构图（最多 10 个节点，仅展示全局视图）。在正文中自然地链接到模块页面（如 \`[模块名](module-slug.md)\`），而非在表格中列出。如果提供了项目配置信息，包含简要的安装部署说明。根据可读性自由组织页面结构。`;

// ─── Template Substitution Helper ─────────────────────────────────────

/**
 * Replace {{PLACEHOLDER}} tokens in a template string.
 */
export function fillTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

// ─── Formatting Helpers ───────────────────────────────────────────────

/**
 * Format file list with exports for the grouping prompt.
 */
export function formatFileListForGrouping(
  files: Array<{ filePath: string; symbols: Array<{ name: string; type: string }> }>,
): string {
  return files
    .map((f) => {
      const exports =
        f.symbols.length > 0
          ? f.symbols.map((s) => `${s.name} (${s.type})`).join(', ')
          : '无导出';
      return `- ${f.filePath}: ${exports}`;
    })
    .join('\n');
}

/**
 * Build a directory tree string from file paths.
 */
export function formatDirectoryTree(filePaths: string[]): string {
  const dirs = new Set<string>();
  for (const fp of filePaths) {
    const parts = fp.replace(/\\/g, '/').split('/');
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join('/'));
    }
  }

  const sorted = Array.from(dirs).sort();
  if (sorted.length === 0) return '(扁平结构)';

  return (
    sorted.slice(0, 50).join('\n') +
    (sorted.length > 50 ? `\n... 及其他 ${sorted.length - 50} 个目录` : '')
  );
}

/**
 * Format call edges as readable text.
 */
export function formatCallEdges(
  edges: Array<{ fromFile: string; fromName: string; toFile: string; toName: string }>,
): string {
  if (edges.length === 0) return '无';
  return edges
    .slice(0, 30)
    .map((e) => `${e.fromName} (${shortPath(e.fromFile)}) → ${e.toName} (${shortPath(e.toFile)})`)
    .join('\n');
}

/**
 * Format process traces as readable text.
 */
export function formatProcesses(
  processes: Array<{
    label: string;
    type: string;
    steps: Array<{ step: number; name: string; filePath: string }>;
  }>,
): string {
  if (processes.length === 0) return '未检测到该模块的执行流。';

  return processes
    .map((p) => {
      const stepsText = p.steps
        .map((s) => `  ${s.step}. ${s.name} (${shortPath(s.filePath)})`)
        .join('\n');
      return `**${p.label}** (${p.type}):\n${stepsText}`;
    })
    .join('\n\n');
}

/**
 * Shorten a file path for readability.
 */
function shortPath(fp: string): string {
  const parts = fp.replace(/\\/g, '/').split('/');
  return parts.length > 3 ? parts.slice(-3).join('/') : fp;
}
