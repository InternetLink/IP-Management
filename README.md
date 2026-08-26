# IPAM / Geofeed 管理系统

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
    ├── render-platform-configs.mjs # 从发布清单生成平台配置
    ├── test-platform-config-renderer.sh # 平台配置离线回归夹具
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

- Node.js `>=20.9 <21`（前后端、本地 CI 与镜像构建统一使用 Node 20）
- npm 10.x
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
AUTH_TOKEN_TTL_HOURS=720
```

`AUTH_TOKEN_TTL_HOURS` 控制登录 Token 有效时长，默认值为 `720`（30 天）。兼容变量 `AUTH_TOKEN_TTL_DAYS` 设置为正数时优先于小时值；新部署统一使用小时值，便于表达短于一天的有效期。

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

1. 确保后端 `.env`（或运行环境变量）中配置了 `BOOTSTRAP_TOKEN`（至少 16 字符随机字符串）和 `BOOTSTRAP_ADMIN_USERNAME` / `BOOTSTRAP_ADMIN_PASSWORD`。可选设置 `BOOTSTRAP_ADMIN_EMAIL`。
2. 在已部署的运行环境中直接执行编译后的命令，**不要**执行 `npm run build`——生产镜像不包含 `nest` CLI，构建产物已在镜像构建阶段生成好，源码也不在镜像内。

   Railway（combined 镜像，容器工作目录为 `/app`，后端在子目录 `backend/` 下）：

   ```bash
   cd backend
   npm run auth:bootstrap
   ```

   独立 backend 镜像（例如 Zeabur 拆分部署，容器工作目录本身就是后端根目录）：

   ```bash
   npm run auth:bootstrap
   ```

3. 命令成功后打印 `Bootstrap completed.`。如果已经创建过管理员，会打印 `Bootstrap already completed; no action taken.` 并正常退出。
4. 创建成功后建议设置 `BOOTSTRAP_DISABLED=true` 永久禁用该入口。

管理员初始化只由受信任的运维终端执行。Web 登录页不会接收 bootstrap token 或管理员初始密码。

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
npm run build
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
HEROUI_AUTH_TOKEN="your-token" bash ../scripts/npm-ci-private.sh .
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
HEROUI_AUTH_TOKEN="your-token" bash ../scripts/npm-ci-private.sh .
```

`npm ci` 从 npmjs 包仓库下载其余依赖，HeroUI 授权包会在安装期间的 licensed postinstall 阶段读取 `HEROUI_AUTH_TOKEN`。本地 CI 与 GitHub 私有依赖安装都通过 `scripts/npm-ci-private.sh` 创建 mode `0600` 的临时 `NPM_CONFIG_USERCONFIG`；该文件刻意保持为空，用来隔离用户级 npm 配置。令牌只进入 `npm ci` 进程，trap 在成功、失败和信号退出时清理文件。镜像构建通过受保护的 GitHub Actions `release` Environment secret 注入 BuildKit secret mount（`--mount=type=secret,id=heroui_token,env=HEROUI_AUTH_TOKEN,required=true`）。

常用命令：

```bash
npm run lint
npm run typecheck
npm run build
```

## 自动部署：Railway / Zeabur

受保护的 `main` 发布任务只有在 public、private、MySQL integration 和 GitHub protection 四个前置作业全部成功后才会构建并推送镜像。每次 push 的摘要直接取自对应 `docker push` 成功输出，再拉取 `repository@sha256:...` 并比较推送前后的镜像 ID；提交 SHA 标签只承担推送入口，制品仅记录已绑定的不可变 GHCR digest。三张镜像还携带 `org.opencontainers.image.source` 与 `org.opencontainers.image.revision` 标签。

### 镜像清单

| 镜像 | Dockerfile | 端口 | 入口 | HeroUI Secret |
|---|---|---|---|---|
| `ipam-backend` | `Dockerfile.backend` | 8080 | `sh scripts/start-prod.sh` | 不需要 |
| `ipam-frontend` | `Dockerfile.frontend` | 8080 | `node server.js` | BuildKit secret mount |
| `ipam-combined` | `Dockerfile` | 3003(公开) + 3001(内部) | `sh /app/scripts/start-combined.sh` | BuildKit secret mount |

所有镜像均为多阶段构建、非 root 运行（UID 1000）、仅含生产依赖。后端启动时通过 `scripts/start-prod.sh` 自动执行 `npm run db:deploy`。受保护发布任务在推送前使用真实 MySQL 8 运行 `scripts/verify-deployment.sh all`，验证 backend 的 live/ready、frontend 页面与 BFF、combined 页面与公开 ready 路径，并在每条路径结束时清理容器。

### 下载发布制品

1. 在目标提交的成功 CI run 中下载 `release-evidence-<commit-sha>` artifact。也可使用 GitHub CLI：

```bash
gh run download RUN_ID --name release-evidence-COMMIT_SHA --dir release-evidence
```

2. 检查制品：

- `image-manifest.json`：schemaVersion 1、`canonical-tar-v1` 算法和三条严格拓扑记录；每条记录包含本地镜像 ID、Dockerfile/build-context SHA、secret 标志、入口、端口、UID、`linux/amd64` 平台和唯一 registry digest。
- `platform-configs/railway.ts`：Railway IaC，`source: image("...@sha256:...")` 指向 combined 镜像。
- `platform-configs/zeabur.yaml`：两个 `PREBUILT_V2` 服务，`spec.source.image` 分别指向 backend 与 frontend 镜像。

清单通过同目录临时文件原子提交；两个平台配置先写入同目录临时目录，完整校验后整体重命名。Artifact 保留 30 天。发布记录应在保留期内保存提交 SHA 和三条不可变 digest；artifact 过期后，从该受保护提交重新运行 `CI` 工作流，并逐条核对新制品 digest 与发布记录。任何 digest 差异都需要作为新构建重新审批和部署。

仓库只保存渲染器，不保存某次发布的 digest，也不保存 Railway、Zeabur 或 zbpack 的 Git 源构建配置。`railway.json`、`zeabur.yaml`、`zbpack.backend.json` 和 `backend/zbpack.json` 的重新出现会使公共 CI 失败。切换到镜像部署前，运维人员需在 Railway 与 Zeabur 控制台断开或退役现有 Git-source/template 集成，避免平台继续从分支触发源码构建；该步骤属于外部平台操作，本仓库脚本只提供验证与交接说明。

### Railway 部署

Railway CLI 只识别放在 **`.railway/railway.ts`**（相对于执行 `railway` 命令的目录）的 IaC 文件，需要把制品中的 `railway.ts` 移动/重命名到该路径，再执行：

```bash
mkdir -p .railway && mv platform-configs/railway.ts .railway/railway.ts
railway login              # 首次使用需要交互登录
railway link                # 关联到目标 Railway 项目
railway config plan         # 从 .railway/railway.ts 预览资源变更
railway config apply        # 应用 .railway/railway.ts
```

该文件仅包含不可变镜像引用和就绪检查；在 Railway 服务设置中另外配置：

```env
DATABASE_URL="mysql://USER:PASSWORD@HOST:PORT/DATABASE"
AUTH_SECRET="生成一个至少 32 字符的随机字符串"
AUTH_TOKEN_TTL_HOURS=720
NEXT_PUBLIC_API_URL="/api"
```

GHCR 包为私有时，在 Railway 的 **Registry Credentials** 中配置具有 `read:packages` 权限的拉取凭据。数据库使用托管或外部 MySQL 8；IaC 不创建可变的数据库镜像。

> Railway 官方已将 `railway.json`/`railway.toml` 这类仓库内 Config-as-Code 标记为 deprecated，计划于 2026-12-01 停止读取，因此本仓库不再保留该文件，与平台演进方向一致。IaC DSL（`railway/iac`）目前仍是 experimental 特性，字段可能变化。

### Zeabur 部署

先在 Zeabur 控制台断开或退役当前仓库关联的 Git-source 集成/template，再使用制品中的 `platform-configs/zeabur.yaml` 创建 backend/frontend 两个 `PREBUILT_V2` 服务。模板要求外部 MySQL 8 `DATABASE_URL`、前后端域名和 `AUTH_SECRET`，并将 Token TTL 固定为 720 小时默认值。

> Zeabur `PREBUILT_V2` 私有镜像凭据通过每个服务 `spec.source.username` / `spec.source.password` 提供。本仓库生成的 artifact 省略这两个字段。运维人员应在仓库和 artifact 目录之外创建权限为 `0600` 的临时副本，在 backend 与 frontend 的 `spec.source` 下分别加入 GHCR 用户名和仅具备 `read:packages` 的 token，通过受控 Zeabur operator/UI 通道导入，然后删除临时副本并轮换一次性 token。公开 GHCR package 可以直接导入原始 artifact。制品始终保持无 registry、HeroUI 和 npm 凭据。

### 部署后数据库初始化

后端启动时自动运行 `prisma migrate deploy`。首次部署完成后，从受信任的运维终端进入后端运行环境执行 `npm run auth:bootstrap` 创建管理员。

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

前端执行 `npm ci` 时需要通过环境变量提供受保护的 `HEROUI_AUTH_TOKEN`；依赖安装完成后，typecheck 与生产构建可直接运行。

```bash
# 后端
cd backend && npm test                   # 单元测试
cd backend && npm run typecheck          # TypeScript 类型检查
cd backend && npm run build              # 构建
cd backend && npm run test:integration   # 集成测试（需 TEST_DATABASE_URL）

# 前端
cd frontend && npm test                  # Vitest 单元测试
cd frontend && npm run lint              # ESLint
cd frontend && npm run typecheck         # TypeScript 类型检查
cd frontend && npm run build             # 生产构建

# 运维脚本
VERIFY_IMAGE_MAP_MODE=static bash scripts/verify-image-map.sh # 离线镜像定义校验
bash scripts/verify-deployment.sh config # 部署配置合规校验
bash scripts/test-verify-deployment-all.sh # all 模式离线参数/探针/清理夹具
IPAM_BACKEND_IMAGE="$IPAM_BACKEND_IMAGE" IPAM_FRONTEND_IMAGE="$IPAM_FRONTEND_IMAGE" \
  IPAM_COMBINED_IMAGE="$IPAM_COMBINED_IMAGE" TEST_DATABASE_URL="$TEST_DATABASE_URL" \
  bash scripts/verify-deployment.sh all # 受保护 CI 的真实 Docker + MySQL 8 证据
bash scripts/test-platform-config-renderer.sh # digest/拓扑/凭据/旧配置夹具
bash scripts/test-github-protection-policy.sh # 分支保护策略夹具
.cache/tools/actionlint/1.7.7/actionlint .github/workflows/ci.yml
bash scripts/install-actionlint.sh       # 安装 actionlint
bash scripts/verify-github-protection.sh # GitHub 分支保护证据（需 gh auth + Git 仓库）

# 本地完整 CI
bash scripts/ci-local.sh                 # 需要 TEST_DATABASE_URL + HEROUI_AUTH_TOKEN

# 受保护 QA：隔离 MySQL 数据库、生产依赖和编译 CLI bootstrap（含幂等重试）
TEST_DATABASE_URL="..." HEROUI_AUTH_TOKEN="..." bash scripts/ci-local.sh --serve-qa
```

由受保护 CI 提供的外部证据：
- 前端 typecheck/build（需要 `HEROUI_AUTH_TOKEN`）
- 无 secret 构建失败证明、Docker 镜像构建、运行时扫描和 GHCR digest
- MySQL 8 全迁移矩阵与集成测试
- GitHub 分支与 `release` Environment 保护状态

## 运维注意事项

### 多实例部署限制

- **仪表板缓存**：`DashboardService` 使用进程内 TTL 缓存（默认 60 秒）。多实例部署时各实例缓存独立更新，用户可能在短时间内看到略有差异的统计数据。这是已知的可接受限制。
- **登录限速**：`LoginThrottle` 基于进程内 Map（5 次/60 秒窗口），每个后端实例独立计数。多实例部署时，攻击者理论上可在 N 个实例各消耗 5 次尝试。如需严格限制，需引入外部 rate-limiter（Redis 等）。

### 数据库迁移

所有环境使用版本化迁移（`prisma migrate deploy`），由后端启动脚本 `scripts/start-prod.sh` 自动执行。

容量迁移规划为 expand → dual-write → exact-only → contract 四个独立发布阶段。当前仓库只签入 expand migration：`backend/prisma/migrations/20260814200000_capacity_exact_expand/`；dual-write、exact-only 与 contract 仍是后续发布制品，推进前必须分别新增、验证和审批。

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

该脚本的 schemaVersion 2 证据包含以下 14 个布尔字段，全部为 `true` 才得到 `MATCH`：

1. `branchProtected`：默认分支启用保护。
2. `enforceAdmins`：管理员同样受规则约束。
3. `requiredStatusChecks`：启用 required status checks。
4. `strictStatusChecks`：合并前分支必须保持最新。
5. `requiredPullRequestReviews`：启用 PR review。
6. `requiredCheckPresent`：required check 来自 GitHub Actions App `15368`，名称精确为 `release-gate` 或 UI 显示的 `CI / release-gate`。
7. `dismissStaleReviews`：新提交会撤销旧批准。
8. `requireLastPushApproval`：最近一次可审查 push 需要批准。
9. `forcePushDisabled`：force push 关闭。
10. `branchDeletionDisabled`：分支删除关闭。
11. `requiredEnvironmentReviewers`：`release` Environment 至少配置一位 reviewer。
12. `refMatchesDefaultBranch`：运行 ref 等于默认分支。
13. `currentCommitMatches`：请求提交、默认分支 head 与 API commit 一致。
14. `workflowPathMatches`：工作流内容来自 `.github/workflows/ci.yml`。

非布尔门槛还包括 `required_approving_review_count >= 1`、六个 API 响应均为 2xx、合法 JSON、类型完整、携带 ETag，并在五分钟新鲜度窗口内完成。Actions 页面工作流显示名是 `CI`，最终 job 显示名是 `release-gate`；分支保护设置应选择 GitHub Actions 提供的该检查，并移除同名外部 status integration。读取规则的 fine-grained PAT 需要仓库 **Administration: Read** 权限。以上 GitHub 设置属于发布前的外部运维动作，本仓库未代为修改。

3. **Staged migration 发布顺序**：

容量相关的 schema 变更按 expand → dual-write → exact-only → contract 四个阶段依次发布。当前磁盘只包含 expand migration；本次发布只能推进 expand。每个后续阶段都需要独立 migration、代码兼容性验证和单独发布，`prisma migrate deploy` 按文件名时间戳应用当时已签入的阶段。

4. **回滚策略**：

每个 migration 阶段是向前兼容的（旧代码能读取新 schema）。如果应用出现问题：
- 立即回滚应用代码到上一个版本
- 数据库 schema 保持不变（Prisma migrations 不可逆）
- 如确需回滚 schema，需从备份恢复

5. **打 tag 前确认**：

- 所有 CI gate（unit/integration/typecheck/lint/build）绿色
- Image manifest 验证通过
- 部署配置合规验证通过

当前上游基础镜像 `node:20-bookworm-slim` 与 CI MySQL `mysql:8` 仍使用标签。当前仓库和本地环境缺少可复核的官方 registry digest 元数据，因此该项记录为 MEDIUM provenance 残余；后续只从官方 registry 元数据取得对应平台 digest，再在独立变更中固定，禁止手工猜测摘要。

## 注意事项

- `backend/dist`、`frontend/.next`、`node_modules`、本地 `.env` 和日志文件默认被忽略。
- `backend/src` 和 `frontend/src` 是主要源码目录。
- IPv6 前缀管理已支持；单个 IPv6 地址池生成暂不实现，避免生成不可控的大规模地址数据。
- 删除前缀会级联删除子前缀和相关分配记录，执行前需要确认影响范围。
