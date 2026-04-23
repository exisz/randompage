---
title: "Astro Content Collections 快速指南"
description: "如何在 landing 端用 markdown 写 blog 而不引入任何 CMS"
pubDate: 2026-04-18
tags: ["astro", "markdown"]
---

# Astro Content Collections 快速指南

本站 blog 用 [Astro Content Collections v2](https://docs.astro.build/en/guides/content-collections/)，零配置零 CMS。

## 新增文章

在 `apps/landing/src/content/blog/` 下建一个 `.md` 文件：

```markdown
---
title: "标题"
description: "摘要"
pubDate: 2026-04-18
tags: ["tag-a", "tag-b"]
---

正文...
```

`/blog` 列表和 `/blog/[slug]` 详情会自动出现。

## 约束

- Frontmatter schema 在 `src/content.config.ts` 里，改 schema 要记得同步 listing/detail 页
- 图片建议放到 `public/` 直接引用，或者用 Astro 的 image optimization
- 代码 block、表格、链接 —— markdown 原生语法全部支持

## 为什么不用 Notion / Contentful？

本模板定位是 **template**，不依赖外部 CMS 让 fork 的项目开箱即用。有需要的话，后续各自站点可以自己接 CMS 替换 loader。
