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
- **登录认证**：首次访问创建管理员账号，之后所有管理 API 默认需要登录，侧边栏登出按钮会清理本地会话。

## 技术架构

```text
ipam/
├── backend/                    # NestJS + Prisma + MySQL
│   ├── prisma/
│   │   ├── schema.prisma       # Prefix、Allocation、Geofeed、Audit、Settings 数据模型
│   │   └── seed.ts             # 示例数据
│   └── src/
│       ├── prefixes/           # 前缀树、CIDR 拆分、IPv4 Pool、批量 IP 操作
│       ├── auth/               # 本地管理员账号、密码哈希、Bearer Token 鉴权
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
CORS_ORIGINS="http://localhost:3003"
AUTH_SECRET="change-this-to-a-long-random-secret"
AUTH_TOKEN_TTL_DAYS=30
```

前端环境变量：

```env
NEXT_PUBLIC_API_URL="http://localhost:3001/api"
```

不要提交真实 `.env` 文件、数据库连接串、Token 或密码。

## 首次登录

系统不再是无认证后台。第一次部署或本地初始化数据库后：

1. 打开前端地址。
2. 如果数据库里还没有用户，登录页会自动进入 **Create first admin** 模式。
3. 创建第一个管理员账号，系统会自动登录。
4. 之后再次访问会进入正常登录模式。

认证说明：

- 密码使用 Node.js 内置 `scrypt` 加盐哈希保存，不保存明文密码。
- 前端使用 `Authorization: Bearer <token>` 访问管理 API。
- Token 保存在浏览器 `localStorage`，点击侧边栏 `Log out` 会清理本地 Token。
- 默认登录有效期为 30 天，可通过 `AUTH_TOKEN_TTL_DAYS` 调整；也兼容旧变量 `AUTH_TOKEN_TTL_HOURS`。
- `AUTH_SECRET` 用于签名 Token，生产环境必须设置为足够长的随机字符串。
- 公开 Geofeed CSV 下载接口仍可匿名访问，方便对外提供 RFC 8805 文件。
- 登录后可在 `Settings` 页面修改当前管理员密码。
- 如果看到 `The table users does not exist in the current database`，说明数据库还没同步，进入 `backend` 执行 `npm run db:push`。

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

## 自动部署：Railway / Zeabur

本项目是 monorepo。Zeabur 一键部署推荐使用模板直接创建分离服务，不需要手动选择目录：

- **Database**：MySQL 服务。
- **Backend**：从仓库根目录使用 `Dockerfile.backend` 构建 NestJS API。
- **Frontend**：从仓库根目录使用 `Dockerfile.frontend` 构建 Next.js 页面。

GitHub 仓库连接到 Railway 或 Zeabur 后，每次 push 到默认分支都可以触发自动部署。

Zeabur 一键部署模板已提供在根目录：

```text
zeabur.yaml
```

该模板会创建 MySQL、Backend、Frontend 三个服务。Backend / Frontend 都从仓库根目录构建，并在模板内明确指定 Dockerfile 内容，因此不需要手动选择 `backend` 或 `frontend` 目录。

本地测试 Zeabur 模板：

```bash
npx zeabur@latest template deploy -f zeabur.yaml
```

### Zeabur Backend 服务配置

Backend 服务根目录：

```text
.
```

Dockerfile：

```text
Dockerfile.backend
```

环境变量：

```env
DATABASE_URL="mysql://USER:PASSWORD@HOST:PORT/DATABASE"
CORS_ORIGINS="https://你的前端域名"
AUTH_SECRET="生成一个足够长的随机字符串"
AUTH_TOKEN_TTL_DAYS=30
```

说明：

- `Dockerfile.backend` 从仓库根目录复制 `backend/`，不需要设置 Root Directory。
- 后端启动时会先执行 `npm run db:push` 同步 Prisma schema，避免出现 `users` 等新表不存在的问题。

### Zeabur Frontend 服务配置

Frontend 服务根目录：

```text
.
```

Dockerfile：

```text
Dockerfile.frontend
```

环境变量：

```env
NEXT_PUBLIC_API_URL="https://你的后端域名/api"
```

说明：

- `Dockerfile.frontend` 从仓库根目录复制 `frontend/`，不需要设置 Root Directory。
- `NEXT_PUBLIC_API_URL` 必须填写后端公开域名，并保留 `/api` 后缀。
- 后端 `CORS_ORIGINS` 必须包含前端公开域名，否则浏览器会拦截 API 请求。

### Railway 部署要点

Railway 可以分开部署，但 Railway 没有用一个 `railway.json` 自动创建多服务的简单机制。你可以不选目录，改为同一个仓库根目录创建两个服务并指定 Dockerfile：

- Backend 服务：仓库根目录 + `Dockerfile.backend`
- Frontend 服务：仓库根目录 + `Dockerfile.frontend`

如果你想完全不选目录、不选 Dockerfile，才使用根目录 `Dockerfile` + `railway.json` 的单应用兜底方案。

Backend 环境变量：

```env
DATABASE_URL="你的 Railway MySQL 连接串"
CORS_ORIGINS="https://你的前端域名"
AUTH_SECRET="生成一个足够长的随机字符串"
AUTH_TOKEN_TTL_DAYS=30
```

如果平台没有直接提供 `DATABASE_URL`，后端启动脚本也会自动尝试读取 `MYSQL_CONNECTION_STRING`、`MYSQL_URI`、`MYSQL_URL`、`MYSQL_HOST` / `MYSQL_USERNAME` / `MYSQL_PASSWORD` / `MYSQL_DATABASE` 或 Railway 风格的 `MYSQLHOST` / `MYSQLUSER` / `MYSQLPASSWORD` / `MYSQLDATABASE`。

Frontend 环境变量：

```env
NEXT_PUBLIC_API_URL="https://你的后端域名/api"
```

单应用兜底方案：

- `Dockerfile`：同一个容器内运行 Next.js 前端和 NestJS 后端。
- `railway.json`：强制 Railway 使用根目录 Dockerfile builder。

单应用环境变量：

```env
DATABASE_URL="你的 Railway MySQL 连接串"
NEXT_PUBLIC_API_URL="/api"
AUTH_SECRET="生成一个足够长的随机字符串"
AUTH_TOKEN_TTL_DAYS=30
```

Railway 会注入 `PORT`，前端会监听该端口；后端在容器内部使用 `BACKEND_PORT=3001`。

### Zeabur 部署要点

1. 推荐直接使用根目录 `zeabur.yaml` 作为一键部署模板。
2. 模板会创建 `mysql`、`backend`、`frontend` 三个服务。
3. Backend / Frontend 都从仓库根目录构建，不需要你选择 `backend` 或 `frontend` 目录。
4. 模板内已明确 Dockerfile 内容，不再走 Static 自动探测。
5. 部署完成后打开 Frontend 域名创建第一个管理员账号。

如果日志出现 `Environment variable not found: DATABASE_URL`，说明当前后端服务没有收到数据库连接变量。直接给 Backend 服务补 `DATABASE_URL`，或确认 MySQL 服务的 `MYSQL_CONNECTION_STRING` 已暴露给 Backend。

## 主要 API

| Method | Endpoint | 说明 |
|---|---|---|
| `GET` | `/api/dashboard` | 仪表板统计 |
| `GET` | `/api/auth/status` | 检查是否已有管理员用户 |
| `POST` | `/api/auth/bootstrap` | 首次创建管理员，仅在无用户时可用 |
| `POST` | `/api/auth/login` | 登录并获取 Bearer Token |
| `GET` | `/api/auth/me` | 获取当前登录用户 |
| `POST` | `/api/auth/password` | 修改当前登录用户密码 |
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
- 管理员首次创建、登录、Token 校验和密码哈希验证。
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
