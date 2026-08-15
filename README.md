# IPAM / Geofeed 管理系统

[![Deploy on Zeabur](https://zeabur.com/button.svg)](https://zeabur.com/templates/C5WQBY)

这是一个全栈 IP 地址管理系统，支持层级化 CIDR 前缀管理、IPv4 地址池操作、RFC 8805 Geofeed 管理、审计日志和基础系统设置。

## 核心能力

- **IP 前缀管理**：用树状结构管理根前缀和子前缀，自动校验父子包含关系与同级重叠冲突。
- **CIDR 拆分**：将一个前缀拆分为更小的子前缀，并限制一次性生成数量，避免误操作。
- **IPv4 Pool 管理**：为 IPv4 前缀生成单 IP 地址池，支持单个 IP 编辑和批量操作。
- **批量 IP 操作**：在前缀详情页批量选择 IP，批量标记 `Available`、`Allocated`、`Reserved`，并批量设置使用者、用途和到期日。
- **可视化详情页**：每个前缀详情页展示子前缀地址空间占用、IP Pool 状态分布和 256-bucket 地址热力图。
- **Geofeed**：管理 RFC 8805 CSV 条目，支持导入、导出和公开生成链接。
- **审计与设置**：记录关键资源变更，并提供组织名称、ASN、联系人、告警阈值等配置。
- **登录认证**：操作员通过 CLI 创建第一个管理员账号，之后所有管理 API 需要登录；前端使用 HttpOnly cookie 管理会话。

## 技术架构

```text
ipam/
├── backend/                    # NestJS + Prisma + MySQL
│   ├── prisma/
│   │   ├── schema.prisma       # Prefix、Allocation、Geofeed、Audit、Settings、BootstrapState 数据模型
│   │   ├── migrations/         # 版本化 schema migrations（prisma migrate deploy）
│   │   └── seed.ts             # 示例数据
│   └── src/
│       ├── prefixes/           # 前缀树、CIDR 拆分、IPv4 Pool、批量 IP 操作、分页聚合
│       ├── auth/               # 本地管理员账号、密码哈希、Bearer Token 鉴权、登录限速
│       ├── geofeed/            # RFC 8805 CRUD、CSV 导入导出
│       ├── audit/              # 审计日志查询（游标分页）
│       ├── settings/           # 系统设置
│       ├── dashboard/          # 仪表板统计（带 TTL 缓存）
│       ├── health/             # 就绪探针 /api/health/ready
│       ├── lib/cidr.ts         # CIDR 解析、规范化、包含、重叠、排序
│       └── prisma/             # PrismaService
│
├── frontend/                   # Next.js 16 + React + HeroUI
│   └── src/
│       ├── app/                # Next.js App Router + BFF API routes
│       │   └── api/_lib/       # BFF 信任边界：cookie 管理、CSRF、Origin 校验
│       ├── components/         # 布局与通用 UI 组件
│       ├── views/              # Dashboard、Prefixes、Geofeed、Settings、Help 等页面
│       ├── lib/                # API Client、CIDR 工具
│       └── i18n/               # 英文与繁体中文语言包
│
└── scripts/                    # 运维脚本
    ├── ci-local.sh             # 本地完整 CI 门禁
    ├── verify-image-map.sh     # Docker 镜像清单校验
    ├── verify-deployment.sh    # 部署配置合规校验
    ├── verify-github-protection.sh  # GitHub 分支保护证据收集
    └── install-actionlint.sh   # actionlint 安装
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
- MySQL 或兼容 MySQL 的数据库（MariaDB 亦可）

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
AUTH_SECRET="change-this-to-at-least-32-random-characters"
AUTH_TOKEN_TTL_DAYS=30
```

`AUTH_TOKEN_TTL_DAYS` 控制登录 Token 有效天数（默认 30 天）。如未设置，后端会尝试读取兼容变量 `AUTH_TOKEN_TTL_HOURS`（默认 720 小时 = 30 天）。推荐使用 `AUTH_TOKEN_TTL_DAYS`。

前端环境变量：

```env
NEXT_PUBLIC_API_URL="/api"
API_PROXY_TARGET="http://127.0.0.1:3001"
APP_ORIGIN="http://localhost:3003"
```

`APP_ORIGIN` 是 BFF 层进行 Origin/Referer 校验时使用的前端公开域名（逗号分隔多个）。

不要提交真实 `.env` 文件、数据库连接串、Token 或密码。

## 首次管理员创建（Operator Bootstrap）

系统要求运维人员通过 CLI 完成第一个管理员账号的创建，浏览器端无法直接注册。

1. 确保后端 `.env` 中配置了 `BOOTSTRAP_TOKEN`（至少 16 字符随机字符串）和 `BOOTSTRAP_ADMIN_USERNAME` / `BOOTSTRAP_ADMIN_PASSWORD`。可选设置 `BOOTSTRAP_ADMIN_EMAIL`。
2. 运行 bootstrap 命令：

```bash
cd backend
npm run auth:bootstrap
```

3. 命令成功后打印 `Bootstrap completed.`。如果已经创建过管理员，会打印 `Bootstrap already completed; no action taken.` 并正常退出。
4. 创建成功后建议设置 `BOOTSTRAP_DISABLED=true` 永久禁用该入口。

**浏览器端行为**：当数据库尚无用户时，登录页显示一条提示信息，引导运维人员在服务器上执行 `npm run auth:bootstrap`。页面每 5 秒轮询一次后端状态，发现管理员创建完成后自动切换到正常登录表单。也可点击"Check again"手动刷新。

## 认证架构

系统采用 BFF（Backend-for-Frontend）信任边界模式：

- **浏览器 ↔ BFF（Next.js 服务端路由）**：前端通过 HttpOnly cookie 管理会话。
  - 生产环境 cookie 名：`__Host-ipam_session`（HttpOnly, Secure, SameSite=Lax）+ `__Host-ipam_csrf`（非 HttpOnly, Secure, SameSite=Lax）。
  - 开发环境 cookie 名：`ipam_session` + `ipam_csrf`（同属性但无 Secure）。
  - 浏览器突变请求须带 `x-csrf-token` 头（值必须与 CSRF cookie 一致，双重提交模式）。
  - BFF 校验 `Origin` 头（精确匹配 `APP_ORIGIN` 配置的域名列表），Origin 缺失时回退到 `Referer` 的 origin 部分。
- **BFF ↔ 后端**：BFF 从 HttpOnly session cookie 读取 Token，以 `Authorization: Bearer <token>` 方式转发给后端。浏览器的 Cookie/Authorization 头永远不会直接传递给后端。
- **CLI/直连客户端 ↔ 后端**：直接使用 `Authorization: Bearer <token>` 认证。后端仅通过 Bearer 头验证身份，无 Origin 要求也不读取 cookie。
- 密码使用 Node.js 内置 `scrypt` 加盐哈希保存。
- `AUTH_SECRET` 用于 HMAC 签名 Token，生产环境必须设置为至少 32 字符随机字符串。
- 公开 Geofeed CSV 下载接口仍可匿名访问，方便对外提供 RFC 8805 文件。
- 登录后可在 Settings 页面修改当前管理员密码。

## 启动后端

```bash
cd backend
npm install
npm run db:generate
npm run db:deploy
npm run db:seed          # 可选：填充示例数据
npm run auth:bootstrap   # 首次部署：创建管理员
npm run dev
```

`npm run db:deploy` 使用版本化 Prisma migrations 建立或更新 schema。**不要使用 `npm run db:push`**——`db:push` 仅用于本地原型开发，可能会造成数据丢失；所有环境的正式 schema 变更均通过 `prisma migrate deploy` 执行。

默认 API 地址：

```text
http://localhost:3001/api
```

常用命令：

```bash
npm run build
npm test
npm run typecheck
npm run test:integration    # 需要 TEST_DATABASE_URL 指向一个可写的测试数据库
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

### HeroUI Pro 私有包

前端依赖 `@heroui-pro/react`（私有 npm 包）。安装该包需要 `HEROUI_AUTH_TOKEN`。

**安全规则**：`HEROUI_AUTH_TOKEN` 只能作为临时进程环境变量传入，禁止以下做法：
- 写入仓库内的 `.npmrc` 或 `.env` 文件
- 作为平台级持久普通环境变量
- 写入 Docker 镜像的 `ARG` 或 `ENV` 层
- 出现在日志、缓存、或证据文件中

本地开发传入方式：

```bash
HEROUI_AUTH_TOKEN="your-token" npm ci
```

CI/CD 构建时，此 Token 通过受保护的 GitHub Actions `release` Environment secret 注入 BuildKit secret mount（`--mount=type=secret,id=heroui_token,env=HEROUI_AUTH_TOKEN,required=true`），仅在 `npm ci` 步骤存在，不进入镜像层。

> **当前状态**：Todo 1（HeroUI Pro 可复现安装）仍部分受阻——仓库所有者需提供 `HEROUI_AUTH_TOKEN` 才能完成前端 build/typecheck。后端和前端 lint/unit-test 不受此影响。

常用命令：

```bash
npm run lint
npm run typecheck
npm run build
```

## 自动部署：Railway / Zeabur

本项目是 monorepo。CI 通过 GitHub Actions 构建不可变 Docker 镜像，部署平台消费构建产物。

### 镜像清单

| 镜像 | Dockerfile | 端口 | 入口 | HeroUI Secret |
|---|---|---|---|---|
| `ipam-backend` | `Dockerfile.backend` | 8080 | `sh scripts/start-prod.sh` | 不需要 |
| `ipam-frontend` | `Dockerfile.frontend` | 8080 | `node server.js` | BuildKit secret mount |
| `ipam-combined` | `Dockerfile` | 3003(公开) + 3001(内部) | `sh /app/scripts/start-combined.sh` | BuildKit secret mount |

所有镜像均为多阶段构建、非 root 运行（UID 1000）、仅含生产依赖。后端启动时通过 `scripts/start-prod.sh` 自动执行 `npm run db:deploy`。

### Zeabur 部署

推荐使用根目录 `zeabur.yaml` 一键部署模板，自动创建 `mysql`、`backend`、`frontend` 三个服务：

```bash
npx zeabur@latest template deploy -f zeabur.yaml
```

Backend / Frontend 都从仓库根目录构建（不需要手动选目录），模板内已内联 Dockerfile 内容。

Backend 环境变量：

```env
DATABASE_URL="mysql://USER:PASSWORD@HOST:PORT/DATABASE"
CORS_ORIGINS="https://你的前端域名"
AUTH_SECRET="生成一个足够长的随机字符串"
AUTH_TOKEN_TTL_DAYS=30
```

Frontend 环境变量：

```env
NEXT_PUBLIC_API_URL="/api"
API_PROXY_TARGET="http://${BACKEND_HOST}:8080"
APP_ORIGIN="https://你的前端域名"
```

HeroUI Token 通过 BuildKit secret mount 传入构建阶段。当前 Zeabur 模板已内联 `--mount=type=secret` 指令；如果 Zeabur 平台本身不支持 BuildKit secret 注入，则需要通过 GitHub Actions CI 预构建镜像后推送到容器注册表，再让 Zeabur 拉取镜像。

部署完成后在服务器上执行 `npm run auth:bootstrap` 创建第一个管理员账号（或通过 CI 自动化该步骤）。

注意：在 Zeabur 里普通导入 GitHub 仓库通常只会创建一个服务。要自动创建三服务，必须走模板部署。

### Railway 部署

Railway 不支持用一个配置文件自动创建多服务。有两种方案：

**方案一：分离服务（推荐）**

同一仓库根目录创建两个服务并指定 Dockerfile：
- Backend 服务：`Dockerfile.backend`
- Frontend 服务：`Dockerfile.frontend`

Backend 环境变量：

```env
DATABASE_URL="你的 Railway MySQL 连接串"
CORS_ORIGINS="https://你的前端域名"
AUTH_SECRET="生成一个足够长的随机字符串"
AUTH_TOKEN_TTL_DAYS=30
```

Frontend 环境变量：

```env
NEXT_PUBLIC_API_URL="/api"
API_PROXY_TARGET="https://你的后端域名"
APP_ORIGIN="https://你的前端域名"
```

如果平台没有直接提供 `DATABASE_URL`，后端启动脚本也会自动尝试读取 `MYSQL_CONNECTION_STRING`、`MYSQL_URI`、`MYSQL_URL`、`MYSQL_HOST` / `MYSQL_USERNAME` / `MYSQL_PASSWORD` / `MYSQL_DATABASE` 或 Railway 风格的 `MYSQLHOST` / `MYSQLUSER` / `MYSQLPASSWORD` / `MYSQLDATABASE`。

**方案二：单应用兜底（combined 镜像）**

使用根目录 `Dockerfile` + `railway.json`，同一容器内运行前后端。

```env
DATABASE_URL="你的 Railway MySQL 连接串"
NEXT_PUBLIC_API_URL="/api"
AUTH_SECRET="生成一个足够长的随机字符串"
AUTH_TOKEN_TTL_DAYS=30
```

Railway 会注入 `PORT`，前端监听该端口；后端在容器内部使用 `BACKEND_PORT=3001`。

两种方案的 HeroUI Token 都通过 CI 预构建镜像阶段的 BuildKit secret 传入，部署平台本身不接触该 Token。

### 部署后数据库初始化

后端启动时自动运行 `prisma migrate deploy`。首次部署完成后需通过 CLI 或 CI 运行 `npm run auth:bootstrap` 创建管理员。

## 主要 API

| Method | Endpoint | 说明 |
|---|---|---|
| `GET` | `/api/dashboard` | 仪表板统计 |
| `GET` | `/api/health/ready` | 就绪探针 |
| `GET` | `/api/auth/status` | 检查是否已有管理员用户 |
| `POST` | `/api/auth/login` | 登录（BFF 设置 session cookie）|
| `POST` | `/api/auth/logout` | 登出（撤销 Token，清除 cookie）|
| `GET` | `/api/auth/me` | 获取当前登录用户 |
| `POST` | `/api/auth/password` | 修改当前登录用户密码 |
| `GET` | `/api/prefixes?cursor=&limit=` | 获取根前缀列表（游标分页，`{items, nextCursor}`）|
| `POST` | `/api/prefixes` | 创建根前缀或子前缀 |
| `GET` | `/api/prefixes/:id` | 获取前缀详情和直属子前缀 |
| `GET` | `/api/prefixes/:id/tree` | 获取前缀子树 |
| `PUT` | `/api/prefixes/:id` | 更新前缀元数据 |
| `DELETE` | `/api/prefixes/:id` | 删除前缀及其子项和分配记录 |
| `POST` | `/api/prefixes/:id/split` | 将前缀拆分为子前缀 |
| `POST` | `/api/prefixes/:id/generate-ips` | 生成 IPv4 Pool 地址 |
| `GET` | `/api/prefixes/:id/allocations?cursor=&limit=` | 获取前缀下的 IP 分配记录（游标分页）|
| `GET` | `/api/prefixes/:id/allocations/status-counts` | 获取分配状态分布统计 |
| `GET` | `/api/prefixes/:id/allocations/heatmap` | 获取 256-bucket 地址热力图 |
| `PUT` | `/api/prefixes/:id/allocations/:allocId` | 更新单个 IP 分配记录 |
| `PUT` | `/api/prefixes/:id/allocations` | 批量更新 IP 分配记录 |
| `GET` | `/api/geofeed?cursor=&limit=` | 获取 Geofeed 条目（游标分页）|
| `POST` | `/api/geofeed` | 创建 Geofeed 条目 |
| `GET` | `/api/geofeed/generate` | 下载 RFC 8805 CSV（匿名可用）|
| `POST` | `/api/geofeed/import` | 导入 Geofeed CSV |
| `GET` | `/api/audit?cursor=&limit=` | 获取审计日志（游标分页）|
| `GET` / `PUT` | `/api/settings` | 读取或更新系统设置 |

所有分页接口返回 `{ items: T[], nextCursor: string | null }`，请求参数为 `cursor`（上一页返回的 `nextCursor`）和 `limit`（默认 50，最大 100；Audit 默认 100 最大 500）。

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
- **IP Pool**：展示 `Available`、`Allocated`、`Reserved` 状态分布，并用 256-bucket 热力图按地址区间展示 IP 密度。

## 验证范围

后端包含轻量测试，不依赖真实数据库，覆盖关键 IPAM 行为：

- CIDR 解析、规范化、包含关系、重叠检测和 IP 数值排序。
- 前缀创建、父子校验、同级重叠校验、拆分限制。
- IPv4 Pool 生成、单个 IP 更新、批量 IP 更新和使用量重算。
- 管理员首次创建、登录、Token 校验和密码哈希验证。
- Geofeed CSV 解析、导入结果、字段规范化和导出转义。
- 登录限速（5 次/60 秒窗口）、Token 版本撤销。

集成测试（需要 `TEST_DATABASE_URL`）覆盖：分页、容量回填、分配聚合、地址热力图。

当前已验证命令（在本开发沙箱中实际执行过的）：

```bash
# 后端
cd backend && npm test                   # 单元测试
cd backend && npm run typecheck          # TypeScript 类型检查
cd backend && npm run build              # 构建
cd backend && npm run test:integration   # 集成测试（需 TEST_DATABASE_URL）

# 前端
cd frontend && npm test                  # Vitest 单元测试
cd frontend && npm run lint              # ESLint
# cd frontend && npm run typecheck       # 需要 HEROUI_AUTH_TOKEN（当前受阻）
# cd frontend && npm run build           # 需要 HEROUI_AUTH_TOKEN（当前受阻）

# 运维脚本
bash scripts/verify-image-map.sh         # 镜像清单校验（static 或 Docker 模式）
bash scripts/verify-deployment.sh config # 部署配置合规校验
bash scripts/install-actionlint.sh       # 安装 actionlint
bash scripts/verify-github-protection.sh # GitHub 分支保护证据（需 gh auth + Git 仓库）

# 本地完整 CI
bash scripts/ci-local.sh                 # 需要 TEST_DATABASE_URL + HEROUI_AUTH_TOKEN
```

未在本沙箱中执行的（需要外部凭据/服务）：
- 前端 typecheck/build（需要 `HEROUI_AUTH_TOKEN`）
- Docker 镜像构建和 secret 扫描
- GitHub Actions 完整 CI/CD 流程
- `scripts/verify-github-protection.sh` 的完整校验（需要 Git 仓库 + gh 认证）

## 运维注意事项

### 多实例部署限制

- **仪表板缓存**：`DashboardService` 使用进程内 TTL 缓存（默认 60 秒）。多实例部署时各实例缓存独立更新，用户可能在短时间内看到略有差异的统计数据。这是已知的可接受限制。
- **登录限速**：`LoginThrottle` 基于进程内 Map（5 次/60 秒窗口），每个后端实例独立计数。多实例部署时，攻击者理论上可在 N 个实例各消耗 5 次尝试。如需严格限制，需引入外部 rate-limiter（Redis 等）。

### 数据库迁移

所有环境使用版本化迁移（`prisma migrate deploy`），由后端启动脚本 `scripts/start-prod.sh` 自动执行。

容量相关的 schema 变更按阶段（expand → dual-write → exact-only → contract）依次发布，每个阶段一次发布，不可合并跳跃。详见发布检查清单。

### 备份

在执行任何 schema 迁移前务必备份数据库。`prisma migrate deploy` 是不可逆操作。

## 发布检查清单

发布新版本前，按顺序完成以下步骤：

1. **本地 CI 门禁通过**：

```bash
TEST_DATABASE_URL="..." HEROUI_AUTH_TOKEN="..." bash scripts/ci-local.sh
```

2. **GitHub 分支保护验证**（在 CI 环境中）：

```bash
bash scripts/verify-github-protection.sh
```

确认默认分支启用了保护规则、`release-gate` check 存在、`release` Environment 配置了 reviewer。

3. **Staged migration 发布顺序**：

容量相关的 schema 变更按 expand → dual-write → exact-only → contract 四个阶段依次发布。每次只推进一个 stage 对应的 migration，发布后验证应用正常运行再推进下一阶段。当前磁盘上的 migrations（`backend/prisma/migrations/`）已包含所有阶段；实际部署时 `prisma migrate deploy` 按文件名时间戳顺序依次应用。

4. **回滚策略**：

每个 migration 阶段是向前兼容的（旧代码能读取新 schema）。如果应用出现问题：
- 立即回滚应用代码到上一个版本
- 数据库 schema 保持不变（Prisma migrations 不可逆）
- 如确需回滚 schema，需从备份恢复

5. **打 tag 前确认**：

- 所有 CI gate（unit/integration/typecheck/lint/build）绿色
- Image manifest 验证通过
- 部署配置合规验证通过

## 注意事项

- `backend/dist`、`frontend/.next`、`node_modules`、本地 `.env` 和日志文件默认被忽略。
- `backend/src` 和 `frontend/src` 是主要源码目录。
- IPv6 前缀管理已支持；单个 IPv6 地址池生成暂不实现，避免生成不可控的大规模地址数据。
- 删除前缀会级联删除子前缀和相关分配记录，执行前需要确认影响范围。
