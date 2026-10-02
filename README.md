# Echo

**Hear it. Say it. Keep it.**

Echo 是一个围绕**影子跟读与英语背诵**设计的本地学习工具。选择自己感兴趣的英语视频或音频，逐句聆听、跟读，再通过复习和回忆把内容留在脑中。

仓库包含学习界面、本地服务、Markdown 学习资料编译工具，以及 `$echo-english` Codex Skill。学习资料和媒体保存在代码仓库之外，个人内容可以独立管理。

## 学习方式

Echo 将听、说、记忆放在同一份真实语料里：

1. **听**：结合逐句稿和译文理解原声内容。
2. **跟读**：播放句子并模仿发音和节奏；需要时放慢速度或循环练习。
3. **回忆**：通过词汇复习、来源笔记和自测题检查自己是否记住。
4. **继续练习**：学习进度保存在本地，之后可以从资料库继续。

学习台提供逐句阅读、章节导航、本地音视频播放、倍速与重复控制、词汇卡、自测、概念笔记和听力材料。每篇资料包含的学习内容取决于其来源和处理结果。

## 环境要求

- Python 3
- 现代桌面浏览器
- 如需从链接创建学习资料，使用支持项目 Skill 的 Codex/Agent

浏览已有资料只需 Python 标准库，无需安装额外 Python 包。

## 启动

在仓库目录运行：

```bash
python3 serve.py
```

浏览器打开 <http://127.0.0.1:8777/>。也可以指定端口：

```bash
python3 serve.py 8080
```

请通过 `serve.py` 访问应用。它提供本地资料 API、保存学习进度，并支持媒体跳转所需的 HTTP Range 请求。服务只监听本机地址。

## 设置学习资料库

默认资料库路径为仓库目录下的 `../../Sync/English/learning-library/`。可以在页面右上角点击 **资料目录** 选择其他目录；所选路径会保存在本地配置文件 `.library-root`，该文件不会提交到 Git。

也可以在启动时指定资料库路径。环境变量优先于 `.library-root`：

```bash
ENGLISH_LIBRARY_ROOT="/path/to/learning-library" python3 serve.py
```

每篇学习资料保存在 `learning-library/items/<资料 ID>/` 下，常见结构如下：

```text
learning-library/
└── items/
    └── example-item/
        ├── index.md          # 标题、来源、状态和文件路径
        ├── transcript.md     # 英文逐字稿；适用时包含时间戳
        ├── translation.md    # 对齐译文
        ├── vocab.md          # 重点词汇和短语
        ├── notes.md          # 笔记和来源要点
        ├── quiz.md           # 回忆题；有内容时提供
        ├── media/            # 可选的本地音频、视频和封面
        ├── compiled/         # 自动生成的浏览器数据
        └── progress.md       # 本地学习进度
```

媒体文件放在对应资料自己的 `media/` 目录，并在 `index.md` 中声明，例如 `media_path: media/audio.m4a`。`compiled/` 是可以重新生成的缓存；日常编辑请修改 Markdown 源文件。导入资料所需的字幕、译文和媒体取决于具体来源，并非每篇都会具备所有文件。

## 使用 `$echo-english` Skill 导入资料

项目 Skill 位于 `.agents/skills/echo-english/`。在 Codex 中打开本仓库，然后将视频或音频链接交给 Skill：

```text
$echo-english https://example.com/video
```

Skill 会指导 Codex 完成资料导入流程：检查是否已有相同来源，获取并保留来源材料，整理逐字稿及适用的学习内容，对照来源校对，编译学习数据，并在本地应用中验证页面。只有完成必要校对和页面验证后，资料才会标记为 `ready`；来源或运行环境有阻碍时，会记录已完成内容和具体限制。

链接处理需要 Codex 当前环境具备该平台可用的内容获取或转录工具。字幕、音频和媒体的可获取情况因来源而异；Skill 应记录证据缺口，不补造缺失内容。生成的学习资料仍建议自行检查。

如果 Codex 没有识别 `$echo-english`，请确认打开的是本仓库，并检查 `.agents/skills/echo-english/SKILL.md` 是否可用。

## 重新编译学习数据

修改某篇资料的 Markdown 文件后，可按资料 ID 重新生成浏览器数据：

```bash
python3 build/compile_library_item.py example-item
python3 build/check_item.py example-item
```

`example-item` 应替换为 `learning-library/items/` 下对应的目录名。编译器使用与应用相同的资料库路径配置。

`check_item.py` 是编译后的体检命令，退出码非 0 表示该篇还不能算完成。它检查：

- `vocab.md` 是否包含编译器需要的中文小节（一、～十一、）
- 各板块解析结果是否为空（概念、习语、听力四表、学习计划、附录等）
- 编译产物是否比源文件旧（改了 Markdown 忘记重编）
- `vocab.md` 里写的语速与 `transcript.md` 实测值是否一致（防止把别的篇目的数字带进来）

修改 `assets/app.js` 后，请同时更新 `study.html` 里的 `app.js?v=` 版本号，否则浏览器仍会使用旧缓存。

## 仓库结构

```text
index.html                         资料库和资料详情页
study.html                         学习台
serve.py                           本地服务和资料 API
assets/                            页面样式、交互脚本和 Logo
build/compile_library_item.py      编译单篇学习资料
build/generate_data.py             从 Markdown 生成学习数据
build/check_item.py                编译后体检（缺小节/空板块/数据陈旧/数字不符）
.agents/skills/echo-english/       从链接创建学习资料的 Codex 流程
```

仓库提供应用和导入流程，不包含可供所有人共用的课程资料库。使用者可以通过 Skill 添加自己的学习内容，并将资料库存放在自行管理的目录中。
