---
title: "Hello World — 欢迎来到 GenStack 2-Deploys"
description: "我们为什么要把 landing 和 app 拆成两个独立 Vercel 部署"
pubDate: 2026-04-18
tags: ["announcement", "architecture"]
---

# 欢迎来到 GenStack 2-Deploys

这是 GenStack template 家族的第三个成员。它演示了一种**两个独立 Vercel 部署 + 同一个 monorepo** 的架构：

- `main-demo.genstack.rollersoft.com.au` — 这个 Astro 网站（纯静态 + markdown blog）
- `app-demo.genstack.rollersoft.com.au` — 受保护的 SPA + Express API，Logto 登录

## 为什么要拆两个部署？

和上一个模板 [`genstack-spa-astro`](https://github.com/exisz/genstack-spa-astro)（所有东西塞进一个 Vercel 项目，用 rewrites 路径分发）比，本模板把 marketing 站和应用站彻底分开，好处是：

1. **部署/回滚独立** — landing 文案改动不会触发 app 重新构建
2. **缓存策略独立** — Astro 可以全静态 + CDN 边缘缓存，app 保持动态
3. **可观测性清晰** — 两个 Vercel 项目各自的 analytics / logs / domains
4. **团队分工友好** — marketing 团队改 landing 不需要碰 app 的 Node/Prisma 依赖

## 什么时候**不**用本模板？

- 站点小，landing 和 app 一起就几个页面 → 上一个模板 `genstack-spa-astro` 足够
- 需要 landing 和 app 之间**共享 session / cookie** → 跨域会变麻烦，考虑合并部署

## 下一步

[Launch App →](/app-link)
