# MTX Loop 项目配置

> Geode 已有成熟的轮次编排体系（docs/DEVELOPMENT.md「每轮节奏」+ docs/HANDOFF.md），
> 本配置仅作映射：交付文档不走 docs/rounds/，而是直接写入项目级文档体系
> （ARCHITECTURE.md 契约节 + As-built、ROADMAP.md 完成记录、OBSIDIAN-COMPAT.md
> 套件回归、HANDOFF.md 续接提示词）。执行模式 = Workflow 并行 agent（独占文件
> 所有权），非 ralph-loop。

| 配置项 | 值 |
|--------|-----|
| PROJECT_NAME | Geode |
| ROUNDS_DIR | （不适用——契约写 docs/ARCHITECTURE.md「Round XX additions」节） |
| BACKLOG_FILE | docs/ROADMAP.md（R19+ 候选池 + 已知技术债） |
| DEV_SERVER | http://localhost:1420 |
| APP_MODE | browser + tauri-desktop（双端验证义务，见 ROADMAP 四条底线） |
| TYPECHECK_CMD | npm run typecheck |
| TEST_CMD | node .calibration/r18-diff/run.cjs（渲染管线回归）+ Playwright MCP E2E |
| BUILD_CMD | npm run build（生产）；npm run tauri build（桌面 NSIS） |
| COMMIT_PREFIX | feat(rXX): |
| TEST_ENTRY | http://localhost:1420/?bench=N（性能）；?obsfixture=1（compat fixture） |
| BASELINE_DOC | docs/ARCHITECTURE.md（契约）+ docs/OBSIDIAN-COMPAT.md（套件矩阵） |
