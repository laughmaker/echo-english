# Echo — 本地英语学习资料库

当前系统由本地 Markdown 资料库和 Echo 学习台组成。入口 `index.html` 是资料库；`study.html` 根据当前条目加载精读、词卡、自测、概念与听力内容。

## 品牌主题

2026-09-26 起，资料库与学习台统一使用 Echo 标识和方案一「暖纸书房」配色。浅色底色为暖纸白 `#F8F6F2`，卡片为 `#FFFDF9`，深色底色为炭灰 `#191A19`，卡片为 `#242522`。陶土棕 `#75452F`（浅色）与柔陶橘 `#E3A482`（深色）仅用于按钮、链接、焦点和少量状态标记。两页共用主题选择，切换后会记住偏好；品牌图标保存在 `assets/echo-logo.png`。

资料库顶栏与学习台顶栏统一为 56px 高；两页 Echo Logo 均为 34×34px，点击后返回资料库首页。两个页面的按钮统一采用胶囊外形；等宽图标按钮和播放键显示为圆形。资料库搜索框也是胶囊形。学习页默认使用本地音源，隐藏在线音源切换与 YouTube 直达按钮，学习台顶部阴影已移除。资料库目录按钮只显示名称，悬停可查看完整路径。

## 启动

```bash
# Run from the project root.
python3 serve.py
```

浏览器打开 `http://127.0.0.1:8777/`。顶部“资料目录”按钮可选择本机资料根目录，悬停按钮可查看当前完整路径；选择会写入 `.library-root` 并在重启后保留（设置 `ENGLISH_LIBRARY_ROOT` 时以环境变量为准）。网页不提供链接或正文录入，统一由 Skill 导入视频与音频。必须使用本项目服务：它负责媒体 Range 播放、读取资料和保存学习进度。直接双击 HTML 或使用 `python3 -m http.server` 无法保存资料。

## 2026-09-26 界面调整

- 两个页面的 Echo Logo 统一为 34×34px 并链接到资料库首页；底栏播放/暂停键强制保持圆形。
- 资料库顶栏只显示目录名称，悬停显示完整路径；搜索框改为胶囊圆角，并移除页面底部保存说明。
- Leah《人生不需要那么着急》概念页按观察、机制、模型转换和行动准则整理成七张核心逻辑卡片；条目文件和逐字稿未改。
- 改动文件：`index.html`、`study.html`、`assets/library.js`、`assets/library.css`、`assets/app.js`、`assets/style.css`、`README.md`。修改前版本保存在 `backups/20260926_before_ui_annotation_changes/`。
- 后续调整：资料库页与学习页 Logo 尺寸统一为 34×34px，两处均可点击回首页；清除学习页对 Logo 图片写入标题首字母的旧逻辑。修改前版本保存在 `backups/20260926_before_global_logo_update/`。
- 后续调整：资料库页和学习页全部 `<button>` 元素统一使用 `999px` 胶囊圆角。修改前版本保存在 `backups/20260926_before_pill_buttons/`。
- 后续调整：学习页顶栏与播放器栏采用和首页相同的页面底色；目录栏与首页侧栏共用颜色，章节选中态和音源占位统一使用主题变量。修改前版本保存在 `backups/20260926_before_study_theme_alignment/`。
- 后续调整：移除资料库页底部保存说明；将资料目录按钮移到右侧主题按钮左边；概念页改为读取每篇 `notes.md` 的通用“核心逻辑卡片”，并移除 Naval 专属措辞。导入 Skill 已同步要求后续资料生成 4–8 张来源有据的逻辑卡片。修改前版本保存在 `backups/20260926_before_all_annotations/`。
- Skill 与系统一致性审查：`ready` 统一要求校对完成且编译页已验证；归档恢复按同一条件判定，并修复恢复流程未读取条目元数据的问题。条目正文中的状态说明也必须与前置元数据一致。
- 项目 Skill 已从 `link-to-english-resource` 重命名为 `echo-english`，同步更新调用示例、空资料库提示和界面元数据。
- README 与 Skill 按当前通用资料库逻辑修订；Skill 按项目根目录读取 `.library-root`，并要求检查概念页文案与卡片来源。
- 项目代码目录名统一为 `echo-english`；学习资料库独立保存在本机，并通过 `.library-root` 配置，不随代码仓库共享。
- 验证完成：资料库与学习页顶栏、按钮和七张核心逻辑卡片已在浏览器检查；学习页 Logo 点击后返回资料库首页；本地视频 Range 请求返回 206。

## 本地 Markdown 资料库

默认资料根目录：`../../Sync/English/learning-library/`，条目位于其 `items/` 子目录。可通过顶部目录按钮切换，或用环境变量 `ENGLISH_LIBRARY_ROOT` 固定指定。

### 从链接创建学习资料

项目内的 `$echo-english` Skill 会从视频或音频链接一路处理到 `ready`：保存来源、整理并校对学习材料、生成兼容编译包、打开学习页检查，再更新状态。调用示例：`$echo-english https://…`。校对与编译状态是处理过程中的中间状态；只有来源或运行环境确实阻断且无可用替代时才会停下，并在条目记录具体原因。

每条资料一个目录，以 `index.md` 管理标题、来源、类型和状态；正文/字幕、翻译、词汇、AI 运行记录及学习进度各自保存在 Markdown 中。处理期间按状态流转，完成学习页验证后进入 `ready`。若 `notes.md` 包含 `## 核心逻辑卡片`，编译器会将其中的 4–8 张卡片加载到通用概念页；卡片由每条资料的来源内容整理，不在前端按作者或条目硬编码。

资料详情页会列出可复核的逐字稿、翻译、词汇、笔记、自测与来源快照。遇到现有编译器不支持的资料格式时，技能会在必要范围内补充通用编译或学习页支持，并验证可用后再设为 `ready`。

Naval 资料：`../../Sync/English/learning-library/items/naval-44-harsh-truths/`

- `transcript.md`：英文逐字稿与章节时间戳；`vocab.md`：原词汇分析；`translation.md`：2,979 句中译。
- `source/` 保存迁移前的原文和旧生成文件；`ai-runs/migration.md` 记录迁移边界。
- `compiled/` 是可重建的浏览器数据缓存，不是资料编辑来源。
- 本地视频与封面已迁入 `../../Sync/English/learning-library/items/naval-44-harsh-truths/media/`，由条目元数据引用。

重新编译 Naval 的浏览器数据：

```bash
python3 build/compile_library_item.py naval-44-harsh-truths
```

把链接交给 Codex 的 `$echo-english` Skill 会直接执行完整处理；如果来源或运行环境确实阻断，Skill 会保留已完成内容并说明准确的阻塞原因，不会把中间状态说成 `ready`。

---

以下保留早期 Naval 示例资料的媒体参数和学习数据说明；通用页面规则以本节上方的 Echo 资料库说明及 `$echo-english` Skill 为准。资料媒体、词条数量、概念卡片和听力内容按当前条目变化。

## 学习台能力与示例资料

学习台从所选资料的编译包加载内容。当前精读、词卡、自测、概念和听力五个模式共用同一条目与学习进度；其中的 Naval 视频时长、词频和术语数据仅属于下方示例条目。

## 打开方式

**必须用自带的 `serve.py` 启动**——它实现了 HTTP Range 请求，视频跳转才快：

```bash
# Run from the checked-out project directory.
python3 serve.py            # 默认 http://127.0.0.1:8777/
python3 serve.py 8080       # 换端口
```

> **不要用 `python3 -m http.server`。** 标准库的 `SimpleHTTPRequestHandler` 不实现
> Range 请求：实测对 286 MB 的 Naval 条目视频发一条 `Range: bytes=0-99`，它会
> 返回 `200` 并开始吐完整的 286 MB。后果是你每点一句跳转，浏览器都得把整个视频
> 重新拉一遍，拖动进度条基本不可用。`serve.py` 只多做了这一件事，但它决定体验。

页面需要通过 `serve.py` 打开。直接双击 HTML 会跳过资料库 API，无法读取本地 Markdown、保存学习进度或加载学习数据。

## 媒体与播放器

学习页默认加载当前条目 `index.md` 中配置的本地媒体。主界面的 YouTube 音源切换和直达按钮处于隐藏状态；“播放器诊断”中保留本地文件载入及 YouTube 故障排查选项。播放器支持跳转、A-B 循环、重复、倍速和逐句跟读。

| 后端 | 条件 | 说明 |
|---|---|---|
| **本地音源** | `media/` 里有音视频文件 | **已内置，默认走这条**——离线、不受网络与地区限制影响 |
| **YouTube 诊断路径** | 页面允许嵌入，且能访问 youtube.com | 主界面不显示切换按钮；诊断面板显示状态与错误码（101 / 150 = 禁止嵌入，100 = 视频不存在） |

### 已内置的离线视频

`items/naval-44-harsh-truths/media/video.mp4` 是 Naval 条目自带的完整视频（286 MB，H.264 640×320 + AAC 立体声，
3 小时 16 分 19 秒）。页面启动时会根据该条目 `index.md` 的 `media_path` 加载它并**直接切到本地音源**，
不需要联网，也不需要任何额外设置。

为什么是 360p：播放器方框在界面上只有 **150×84 px**，更高分辨率肉眼无差别，
却会让文件从 286 MB 涨到 900 MB（720p）或 2.6 GB（1080p）。

### 换成自己的音源

把文件放入对应资料目录的 `media/`，并在该资料的 `index.md` 设置 `media_path: media/文件名`，刷新即可加载。每篇只加载元数据明确指定的媒体；其他文件不会自动选择。推荐使用浏览器兼容的 `.m4a`、`.mp3` 或 `.mp4`。

也可以点 **音源 → 本地音源 → 选择文件…** 临时载入任意文件，或直接拖拽到播放器方框。

自己下载音频的参考命令：

```bash
# 注意：yt-dlp 请用较新版本，旧版对 YouTube 的播放器客户端适配会失效
yt-dlp -f "ba[ext=m4a]" -o "../../Sync/English/learning-library/items/naval-44-harsh-truths/media/audio.%(ext)s" \
  "https://www.youtube.com/watch?v=KyfUysrNaco"
```

视频封面是可选资源：放在本篇 `media/poster.jpg` 并在 `index.md` 设置 `poster_path: media/poster.jpg`，播放器方框在未播放时就会显示它，
而不是一块黑框。自带的这一张是这么取的：

```bash
ffmpeg -ss 1 -i ../../Sync/English/learning-library/items/naval-44-harsh-truths/media/video.mp4 -frames:v 1 -vf "scale=640:-2" -q:v 4 -y ../../Sync/English/learning-library/items/naval-44-harsh-truths/media/poster.jpg
```

纯音频不用管封面——那时方框显示的是「♪ 本地音源」徽标。

> **踩坑记录（2026-09-17 实测）**：用 yt-dlp `2026.06.09` 下载本视频会稳定失败——
> 元数据能取到，但真正下载时 `SSL: UNEXPECTED_EOF_WHILE_READING` 之后 `HTTP Error 403`。
> 换官方独立二进制 `2026.08.19` 后正常。另外新版已经没有 `-f 18`（360p 渐进式单文件），
> 需要从 DASH 分片合并：`-f "134+140" --merge-output-format mp4`（需要 ffmpeg）。
> 走代理时显式指定：`--proxy http://127.0.0.1:7897`。

顶栏出现播放错误时，<code>重试连接</code> 可在网络恢复后**不刷新页面**重新拉起播放器；
<code>播放器诊断</code> 会列出页面协议、后端状态、YouTube 错误码、本地音源状态与
自动探测结果，并附上下载命令。

## 布局

- 顶栏（标题 / 五个模式 / 进度 / 主题）**常驻顶部，永不随内容滚走**；
- 精读模式下 **章节栏 / 逐字稿 / 本节目标词三栏各自独立滚动**，互不干扰；
- 词汇卡、自测、概念、听力四个模式的正文在各自面板内滚动，顶栏同样固定；
- 底栏播放条高度随内容自适应，不会被裁切。

## 五个模式

| 模式 | 作用 |
|---|---|
| **精读** | 章节导航、逐句稿、目标词高亮与释义；有时间戳的句子可跳转到对应位置 |
| **词汇卡** | 显示当前条目的词汇、短语和概念，支持按类型、层级、主题、掌握状态筛选与全文搜索 |
| **自测** | 按当前条目生成练习；答题进度写入本篇 `progress.md` 并保留浏览器缓存 |
| **概念** | 优先显示 `notes.md` 的“核心逻辑卡片”，其次显示条目概念；都没有时退回重点短语。卡片和说明由当前来源材料生成，页面不使用固定作者框架 |
| **听力** | 显示当前编译包提供的语音、字幕、语速及学习说明；内容按条目而异 |

> 左栏章节条目**只切换文稿视图，不跳时间**；要跳到某一章的开头，点该章第一句即可。

## 键盘快捷键（精读模式）

| 按键 | 作用 |
|---|---|
| `空格` | 播放 / 暂停 |
| `←` `→` | 上一句 / 下一句（自动跳到当前句并开始播放） |
| `L` | 循环当前句 |
| `R` | 重复当前句 3 次 |
| `N` `P` | 下一章 / 上一章 |
| `Esc` | 关闭详情面板 |

底部还有 **0.75× / 1.0× / 1.25× / 1.5×** 变速。建议先用 0.75× 建立轮廓，再回到原速。

## 建议的入门路径

1. 精读模式跳到 `21:02 Ways To Raise Your Self-Esteem` 或 `1:07:20 What Is Happiness?`——这两段用词最日常；
2. 词汇卡筛选「首轮 40 词」，把这些先过一遍；
3. 自测模式选「核心词」范围，10 题一轮，答错的会自动进错题队列；
4. 听力面板把填充词表读一遍——把 `you know`、`I think` 从「需要理解的内容」降级为「背景噪声」。

## 本地资源统一管理

所有学习资料的本地媒体都归属对应的 `learning-library/items/<id>/media/`。在同目录 `index.md` 中用相对条目根目录的 `media_path` 和可选 `poster_path` 声明；播放器通过资料 API 加载并支持 HTTP Range 跳转。项目根目录不再设置共享 `media/`。

## 目录结构

```
echo-english/
├── serve.py                本地服务（支持 Range，视频 seek 必需）
├── index.html              资料库入口
├── study.html              当前条目的通用学习台
├── assets/
│   ├── library.css/js      资料库和本地 Markdown 管理
│   ├── style.css           学习台深色 / 浅色双主题
│   └── app.js              学习台交互逻辑
└── build/
    ├── generate_data.py   从逐字稿与词汇 Markdown 生成学习数据
    └── compile_library_item.py 编译资料库条目的 Markdown 学习材料

../../Sync/English/learning-library/
└── items/naval-44-harsh-truths/  Naval 的 Markdown、媒体与学习资料
```

排查「拖动进度条到底取了多少数据」时，用日志模式启动，会打印每一条 Range 请求：

```bash
NAVAL_LOG_MEDIA=1 python3 serve.py
# → GET /api/items/naval-44-harsh-truths/media → 206 Range=bytes=9437184-
```

## 重新生成 Naval 学习缓存

资料库中的 Markdown 是可编辑主档；`compiled/` 下的浏览器缓存可随时重建。Naval 资料的标准命令是：

```bash
python3 build/compile_library_item.py naval-44-harsh-truths
```

生成脚本会完成：解析章节与带时间戳句子 → 解析词汇 Markdown → 为每个词条
用「逐词屈折变形 + 不规则动词表」在正文中定位首次出现时间与最佳例句 → 输出每个句子的
**精确匹配字符区间**（前端因此不需要重复实现词形匹配）→ 预计算每章涉及的词条。

> 定位用的是 `finditer` 而非 `search`：同一句里重复出现的词条（例如
> `They come in the moment, they leave in the moment.`）必须**两处都高亮**，
> 只取首处会造成「右栏统计 3 次、正文只亮 1 次」的矛盾。

## 已知限制

- **逐字稿是 YouTube 自动字幕**，无标点、无人工校对。因此句子边界是脚本按标点和长度
  切分的，逐句循环偶尔会跨半句。另有 9 处已核实的识别错误列在「听力」面板的勘误表里
  （`Dionius` → **Diogenes**、`heristics` → **heuristics** 等）。
- 260 个词条中有 **3 个无法定位时间戳**（`heuristic`、`hedonic adaptation`、`the game of life`）：
  它们在正文中没有对应的字面形式，因此没有跳转按钮。
- 词义与音标取自公开词典接口，已针对视频语境做裁剪，但个别释义可能与语境有偏差，
  以视频中的实际用法为准。
- Naval 条目视频有 286 MB，位于同步盘（`Documents/Sync/`）下。若不需要离线播放，可删除该条目的视频并清空 `media_path`；播放器将使用在线来源。
