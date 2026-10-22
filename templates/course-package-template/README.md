# 课程包模板

- `example.json`：课程内容的结构样例（封面 / 要点 / 时间线 / 引言）。
- `build.mjs`：把内容 JSON 渲染成单文件 HTML 课程包（调用 `../course-render.mjs`）。

```bash
node build.mjs example.json out.html
# 打开 out.html 检查；确认后用 POST /api/packages 上传，或放到 /pkg/ 下
```

AI 生成路径：`POST /api/packages/ai {content}` → 模型出大纲 → 同一渲染器生成课程包。
