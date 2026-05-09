# IPAM / Geofeed 管理系统

这是一个全栈 IP 地址管理系统，支持层级化 CIDR 前缀管理、IPv4 地址池操作、RFC 8805 Geofeed 管理、审计日志和基础系统设置。

## 核心能力

- **IP 前缀管理**：用树状结构管理根前缀和子前缀，自动校验父子包含关系与同级重叠冲突。
- **CIDR 拆分**：将一个前缀拆分为更小的子前缀，并限制一次性生成数量，避免误操作。
- **IPv4 Pool 管理**：为 IPv4 前缀生成单 IP 地址池，支持单个 IP 编辑和批量操作。
- **批量 IP 操作**：在前缀详情页批量选择 IP，批量标记 `Available`、`Allocated`、`Reserved`，并批量设置使用者、用途和到期日。
- **可视化详情页**：每个前缀详情页展示子前缀地址空间占用、IP Pool 状态分布和地址顺序热力图。
- **Geofeed**：管理 RFC 8805 CSV 条目，支持导入、导出和公开生成链接。
- **审计与设置**：记录关键资源变更，并提供组织名称、ASN、联系人、告警阈值等配置。

## 技术架构

```text
ipam/
├── backend/                    # NestJS + Prisma + MySQL
│   ├── prisma/
│   │   ├── schema.prisma       # Prefix、Allocation、Geofeed、Audit、Settings 数据模型
│   │   └── seed.ts             # 示例数据
│   └── src/
│       ├── prefixes/           # 前缀树、CIDR 拆分、IPv4 Pool、批量 IP 操作
│       ├── geofeed/            # RFC 8805 CRUD、CSV 导入导出
│       ├── audit/              # 审计日志查询
│       ├── settings/           # 系统设置
│       ├── dashboard/          # 仪表板统计
│       ├── lib/cidr.ts         # CIDR 解析、规范化、包含、重叠、排序
│       └── prisma/             # PrismaService
│
└── frontend/                   # Next.js 16 + React + HeroUI
    └── src/
        ├── app/                # Next.js App Router
        ├── components/         # 布局与通用 UI 组件
        ├── views/              # Dashboard、Prefixes、Geofeed、Settings、Tools 等页面
        ├── lib/                # API Client、CIDR 工具、Geofeed 工具
        ├── data/               # 类型与本地回退数据
        └── i18n/               # 英文与繁体中文语言包
```

当前核心数据模型围绕 `Prefix` 设计：

- 根前缀的 `parentId = null`。
- 子前缀必须完全包含在父前缀内。
- 同一个父前缀下的子前缀不能互相重叠。
- IPv4 Pool 的单 IP 分配记录挂载在对应 `Prefix` 下。
- Geofeed 条目可以关联到匹配的 `Prefix`。

## 环境要求

- Node.js 20+ 或 22+
- npm
- MySQL 或兼容 MySQL 的数据库

## 环境变量

从示例文件复制本地环境配置：

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

后端环境变量：

```env
DATABASE_URL="mysql://USER:PASSWORD@HOST:PORT/DATABASE"
PORT=3001
```

前端环境变量：

```env
NEXT_PUBLIC_API_URL="http://localhost:3001/api"
```

不要提交真实 `.env` 文件、数据库连接串、Token 或密码。

## 启动后端

```bash
cd backend
npm install
npm run db:generate
npm run db:push
npm run db:seed
npm run dev
```

默认 API 地址：

```text
http://localhost:3001/api
```

常用命令：

```bash
npm run build
npm test
```

## 启动前端

```bash
cd frontend
npm install
npm run dev
```

默认前端地址：

```text
http://localhost:3003
```

如果私有 HeroUI Pro 包需要 registry 认证，请在本机 npm 配置或 shell 环境变量中配置 Token，不要把私有 Token 写入仓库。

常用命令：

```bash
npm run lint
npx tsc --noEmit
npm run build
```

## 主要 API

| Method | Endpoint | 说明 |
|---|---|---|
| `GET` | `/api/dashboard` | 仪表板统计 |
| `GET` | `/api/prefixes` | 获取根前缀列表 |
| `POST` | `/api/prefixes` | 创建根前缀或子前缀 |
| `GET` | `/api/prefixes/:id` | 获取前缀详情和直属子前缀 |
| `GET` | `/api/prefixes/:id/tree` | 获取前缀子树 |
| `PUT` | `/api/prefixes/:id` | 更新前缀元数据 |
| `DELETE` | `/api/prefixes/:id` | 删除前缀及其子项和分配记录 |
| `POST` | `/api/prefixes/:id/split` | 将前缀拆分为子前缀 |
| `POST` | `/api/prefixes/:id/generate-ips` | 生成 IPv4 Pool 地址 |
| `GET` | `/api/prefixes/:id/allocations` | 获取前缀下的 IP 分配记录 |
| `PUT` | `/api/prefixes/:id/allocations/:allocId` | 更新单个 IP 分配记录 |
| `PUT` | `/api/prefixes/:id/allocations` | 批量更新 IP 分配记录 |
| `GET` | `/api/geofeed` | 获取 Geofeed 条目 |
| `POST` | `/api/geofeed` | 创建 Geofeed 条目 |
| `GET` | `/api/geofeed/generate` | 下载 RFC 8805 CSV |
| `POST` | `/api/geofeed/import` | 导入 Geofeed CSV |
| `GET` | `/api/audit` | 获取审计日志 |
| `GET` / `PUT` | `/api/settings` | 读取或更新系统设置 |

## IP Pool 批量操作

在前缀详情页生成 IPv4 Pool 后，可以：

- 勾选多个 IP 地址。
- 直接批量标记为 `Available`、`Allocated` 或 `Reserved`。
- 打开批量编辑弹窗，统一设置 `assignee`、`purpose`、`expiryDate`。
- 批量操作后自动刷新列表、统计数量和前缀 `usedIPs`。

后端接口会校验所有 `allocationIds` 必须属于当前前缀，避免跨前缀误更新。

## 可视化

每个前缀详情页包含两类可视化：

- **Address Space**：展示直属子前缀在当前前缀地址空间内的位置和占比，点击色块可进入子前缀。
- **IP Pool**：展示 `Available`、`Allocated`、`Reserved` 状态分布，并用小格子按地址顺序展示每个 IP 的状态。

## 验证范围

后端包含轻量测试，不依赖真实数据库，覆盖关键 IPAM 行为：

- CIDR 解析、规范化、包含关系、重叠检测和 IP 数值排序。
- 前缀创建、父子校验、同级重叠校验、拆分限制。
- IPv4 Pool 生成、单个 IP 更新、批量 IP 更新和使用量重算。
- Geofeed CSV 解析、导入结果、字段规范化和导出转义。

当前已验证命令：

```bash
cd backend && npm test
cd backend && npm run build
cd frontend && npm run lint
cd frontend && npx tsc --noEmit
cd frontend && npm run build
```

## 注意事项

- `backend/dist`、`frontend/.next`、`node_modules`、本地 `.env` 和日志文件默认被忽略。
- `backend/src` 和 `frontend/src` 是主要源码目录。
- IPv6 前缀管理已支持；单个 IPv6 地址池生成暂不实现，避免生成不可控的大规模地址数据。
- 删除前缀会级联删除子前缀和相关分配记录，执行前需要确认影响范围。
