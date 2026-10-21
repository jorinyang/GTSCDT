# Game Theory Strategy Course Development Tools（弈策课程开发工具）

**GTSCDT** · v0.4

把一堂企业 AI 培训从「课前生成 → 开场 → 讲授 → 工作坊 → 交作业 → 评分 → 复盘」做成一套可运行的课堂运营系统。讲师用 PPT 或本系统课件都能上课；课堂互动、作业、评分、课程包、嵌入接口与 MCP 都是独立能力。

> 仓库原名 GTSICCDT，v0.2 起更名 **GTSCDT**。仓库是脱敏模板，客户名、讲师信息、接口地址、样例数据均为占位。

---

## 一、设计风格（v0.4）

参考 `wb.gzzhike.cn` 的视觉语言，全站统一：

- **近黑底** `#0E0E10`，卡片 `#1A1A1F`，细线 `#2A2A32`；
- **荧光绿主色** `#CBF74E`，强调操作与选中态；
- **大圆角**：卡片 24px、按钮 12–14px；
- **Inter / PingFang SC** 字体，字号紧凑；
- **分屏登录**：左侧品牌与数据，右侧登录卡（钉钉 / 本地口令双标签）；
- 所有页面共用一个 `templates/ui.css` 主题层，改一处全站生效。

## 二、信息架构（v0.4）

```
/                登录页（未登录）→ 已登录跳 /home
/home            工作台：房间管理(默认) / 模型配置 / 个人信息 / 讲师管理(超管)
/rooms           房间列表（兼容旧入口）
/room?code=      课程房间：四端入口 + 二维码 + 大纲文件 + 生成内容
/room-setup?code= 课程生成：上传大纲/课件 → 生成 → 跳转
/ops?room=       课堂后台：课堂管理 / 作业评分 / 在线答题
/remote?room=    讲师遥控器
/screen?room=    授课大屏（数据 / 课件 / 宣传页）
/join?room=      学员交互端
/report?room=    课堂报告
/packages        课程包管理（上传 / AI 生成 / 编辑）
/package-edit    课程包内容编辑
/teachers        讲师管理（超管）
```

- 钉钉登录保存 **头像 / 姓名 / 角色 / 部门**；首次登录自动进讲师名单，超管可改角色与删除；
- **管理员看全部房间，讲师只看自己的房间**；
- 房间默认名 = **日期 + 城市**，可编辑；可删除（默认房间保护）。

## 三、能力全景

### 1. 身份与工作台

| 能力 | 说明 |
|---|---|
| 钉钉登录 | OAuth2 授权码 + HMAC Cookie，可选本地口令兜底 |
| 头像/姓名/角色 | 登录回调保存 avatarUrl / nick / dept，工作台与后台显示头像 |
| 工作台 | 房间管理（默认）、模型配置、个人信息、讲师管理（仅超管） |
| 讲师管理 | 添加 / 编辑（姓名、角色、部门、unionId）/ 删除 |

### 2. 房间与课程生成

| 能力 | 说明 |
|---|---|
| 房间 | 4 位码、归属讲师、默认日期+城市、可改名/删除 |
| 大纲上传 | **pptx / pdf / html 保留原文件**供展示下载；docx/pptx/pdf 可提取文字 |
| Markdown | 上传 md/txt → 生成统一风格**大纲框架页** |
| 模型生成 | 用「模型配置」里保存的模型，生成课程页 / 宣传页 / 题库 / 过程素材 / 作业场景题 |
| 生成联动 | 生成后自动把题库与作业题应用到房间；进度条完成后给出各页面链接 |

### 3. 课堂四端

| 端 | 能力 |
|---|---|
| 学员交互端 `/join` | 积分、抽签、投票、答题、提交作业、下载素材 |
| 讲师遥控器 `/remote` | 预置题目投票、素材发放、作业开关、开始答题、抢答轮次、工作坊计时、大屏切换、课件翻页 |
| 课堂后台 `/ops` | 课堂管理（投票题库、素材上传、分组、抢答开关、表现分）、作业评分、在线答题 |
| 授课大屏 `/screen` | 数据统计 / 课程页 / 宣传页三视图，学员扫码加入二维码 |

### 4. 内容与集成

| 能力 | 说明 |
|---|---|
| 课程包 | 上传 HTML、AI 生成、在线编辑五类内容（课程页/宣传页/题库/素材/作业） |
| 房间资产 | 作业任务预渲染为 `quests.html`，学员页按版本缓存加载 |
| 嵌入 | `/embed.js` + `/embed` 小组件 |
| MCP | `/mcp` JSON-RPC，10 个课堂工具 |
| 报告 | `/report` 汇总学员、小组、答题、作业，CSV 导出 |

## 四、快速开始

```bash
cd templates
node server.mjs
```

打开：

- 登录 `http://127.0.0.1:8899/`
- 工作台 `http://127.0.0.1:8899/home`
- 课堂房间 `/room?code=ROOM0`
- 课程生成 `/room-setup?code=ROOM0`
- 课堂后台 `/ops?room=ROOM0`
- 遥控器 `/remote?room=ROOM0`
- 大屏 `/screen?room=ROOM0`
- 学员端 `/join?room=ROOM0`
- 课程包 `/packages`
- 报告 `/report?room=ROOM0`

环境变量：

| 变量 | 作用 |
|---|---|
| `PORT` | 端口，默认 8899 |
| `SESSION_SECRET` | 登录 Cookie HMAC 密钥 |
| `LOCAL_TEACHER_PASSWORD` | 本地口令兜底 |
| `DINGTALK_CLIENT_ID` / `DINGTALK_CLIENT_SECRET` / `DINGTALK_CORP_ID` | 钉钉登录与部门同步 |
| `REQUIRE_AUTH` | `1` 开启强制登录 |
| `PUBLIC_URL` | 公网地址，用于钉钉回调 |
| `MCP_TOKEN` | MCP 访问令牌 |
| `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE` / `DEEPSEEK_MODEL` | 模型兜底配置 |

## 五、部署

- **局域网**：讲师机 `node server.mjs`；
- **公网**：Node 主机 + HTTPS + 钉钉回调白名单，Docker：
  ```bash
  docker build -t gtscdt .
  docker run -p 8899:8899 -e SESSION_SECRET=... -e DINGTALK_CLIENT_ID=... gtscdt
  ```
- 当前线上：`https://gtscdt.clawshell.online`

## 六、课堂使用顺序

完整版见 [docs/06-课堂使用说明-按课程流程.md](docs/06-课堂使用说明-按课程流程.md)。

1. 课前：登录 → 建房（日期+城市）→ 上传大纲/课件 → 生成；
2. 开场：学员扫码 → 抽签分组 → 讲积分规则；
3. 上午：投票、抢答、随堂答题；
4. 下午：推送行动卡 → 计时 → 学员做题 → 开作业提交；
5. 评分：后台作业评分 + AI 评分复核；
6. 复盘：报告导出、公布积分；
7. 课后：保留房间或删除。

## 七、版本记录

- **v0.1**：六页面 + 局域网服务 + FC；
- **v0.2**：后台四标签、在线答题、模型管理、AI 评分；
- **v0.3**：房间模型、大屏/遥控器、讲师登录、课程包、嵌入与 MCP；
- **v0.4（当前）**：参考 wb 风格的全站主题与分屏登录；登录后工作台（房间管理默认、模型/个人信息/讲师管理）；房间归属与管理员/讲师可见范围；房间默认日期+城市、可编辑删除；大纲原文件保留与 md 框架页；遥控器/后台/大屏/学员端联动；房间四端卡片与二维码；头像与身份展示。

## 八、目录

```
GTSCDT/
├─ templates/
│  ├─ server.mjs               房间/鉴权/生成/上传/接口/MCP
│  ├─ ui.css                   全站主题（参考 wb 风格）
│  ├─ login.html               分屏登录
│  ├─ home.html                工作台
│  ├─ room.html / room-setup.html
│  ├─ ops（course/admin.html）/ remote.html / screen.html / report.html
│  ├─ live.html（/join）/ rooms.html / teachers.html / packages.html
│  ├─ package-edit.html / course-shell.html / embed.html
│  ├─ course-render.mjs / qrcode.min.js
│  ├─ course/                  课件与作业评分
│  ├─ course-package-template/ 课程包模板
│  ├─ materials/               学员素材
│  └─ fc/index.py              阿里云 FC（v0.2 能力）
├─ docs/                       方法论、大纲、系统说明、部署、架构、使用说明
├─ deploy/                     Nginx / Compose / 环境变量模板
└─ scripts/                    部署脚本
```

## License

MIT © jorinyang
