const state = {
  sessions: [],
  current: null,
  stream: null,
  timelineItems: [],
  bootstrapCwd: "",
  draftCwd: "",
  draftPolicy: "ask",
  draftModel: "",
  statusById: new Map(),
  unreadById: new Map(),
  foldedProjects: new Set(),
  groups: [],
  tags: new Map(),
  currentView: "project",
  currentFilter: null,
  tagTarget: null,
  searchResults: [],
  searchIndex: -1,
  login: null,
  workspaceBrowserPath: "",
  workspaceBrowserParent: "",
  directoryPicker: "browse",
  pickingFolder: false,
  workspaceDirectories: [],
  tree: { cwd: "", children: new Map(), expanded: new Set(), loading: new Set(), truncated: new Set(), errors: new Map(), results: null, resultsTruncated: false },
  treeExpandedByCwd: new Map(),
  workspaces: [],
  preview: { tabs: [], active: -1, open: false, wrap: localStorage.getItem("stepcode.previewWrap") !== "0" },
  errorTimer: null,
  showArchived: false,
  policiesCache: [],
  modes: { goal: false, plan: false, ultraloop: false },
  goalDraft: "",
  attachments: [],
  modelPanelView: "compact",
  theme: localStorage.getItem("stepcode.theme") || "system",
  locale: localStorage.getItem("stepcode.locale") || "zh-CN",
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

/** Reference a symbol from the sprite in index.html; sizing comes from CSS. */
const icon = (name, size = "md") =>
  `<svg class="icon icon--${size}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

const ICONS = {
  folder: icon("folder", "md"),
  file: icon("file", "xs"),
  tree: icon("tree", "sm"),
  open: icon("open", "sm"),
  plus: icon("plus", "sm"),
  more: icon("more", "xs"),
  tool: icon("tool", "2xs"),
  copy: icon("copy", "xs"),
  tag: icon("tag", "xs"),
  archive: icon("archive", "sm"),
};

const TAG_COLORS = {
  red: "#D14343",
  orange: "#E2822E",
  yellow: "#C7A500",
  green: "#43A24B",
  blue: "#3E82C9",
  purple: "#8E6BD9",
  pink: "#D96890",
  gray: "#8F8981",
};

const I18N = {
  "zh-CN": {
    newConversation: "新建会话",
    search: "搜索",
    searchTitle: "搜索会话",
    searchPlaceholder: "搜索会话",
    searchSelect: "选择",
    searchOpen: "打开",
    searchClose: "关闭",
    noSearchResults: "没有匹配的会话",
    recentFolders: "最近的文件夹",
    chooseFolder: "选择文件夹…",
    addWorkspace: "添加工作区",
    go: "前往",
    searchInDirectory: "在此目录下搜索…",
    workspaceHelp: "点击文件夹进入，再点“打开此文件夹”将其添加为工作区。",
    cancel: "取消",
    openFolder: "打开此文件夹",
    emptyDirectory: "没有子文件夹",
    projects: "项目",
    groups: "分组",
    conversations: "会话",
    archivedConversations: "归档会话",
    recent: "最近",
    openWorkspace: "打开工作区",
    fileTree: "文件树",
    newConversationInWorkspace: "在此工作区新建会话",
    justNow: "刚刚",
    upgrade: "升级",
    appearance: "外观",
    language: "语言",
    settings: "设置",
    logout: "退出登录",
    themeSystem: "跟随系统",
    themeLight: "浅色",
    themeDark: "深色",
    settingsDescription: "管理 StepCode Web 的界面偏好。",
    appearanceDescription: "选择浅色、深色或跟随系统。",
    languageDescription: "切换 Web 界面语言。",
    localMode: "StepCode Web · 本地模式",
    loggedOut: "已退出登录",
    loggedOutHint: "请从终端重新启动 StepCode Web 获取新的访问链接。",
    emptyConversation: "还没有消息 — 在下方输入开始对话",
    messagePlaceholder: "输入消息…",
    idle: "空闲",
    running: "运行中",
    waiting: "等待输入",
    completed: "已完成",
    failed: "失败",
    ask: "逐条确认",
    readOnly: "只读",
    bypass: "自动执行",
    autopilot: "自动续跑",
    noProjectConversations: "还没有项目会话。",
    noArchivedProjectConversations: "没有已归档的项目会话。",
    ungrouped: "未分组",
    noGroupedConversations: "还没有可分组的会话。",
    createGroup: "新建分组",
    useColor: "用这个颜色新建",
    noCategory: "无分类",
    groupNamePlaceholder: "分组名称",
    confirm: "确定",
    rename: "重命名",
    archive: "归档会话",
    restore: "恢复会话",
    delete: "删除会话",
    confirmDelete: "删除会话“{name}”？此操作不可撤销。",
    code: "代码",
    copy: "复制",
    copied: "已复制",
    me: "我",
    step: "Step",
    searchComing: "全局搜索将在批 2 提供；一期可按项目浏览会话。",
    settingsOpened: "设置",
    resizeSidebar: "拖动调整侧边栏宽度，双击复位",
    authExpiredTitle: "连接已断开",
    authExpiredBody: "启动链接只能使用一次，服务端重启后也会更换。请用服务端最新打印的地址重新打开。",
    reload: "重新加载",
    "policy.ask.label": "逐条确认",
    "policy.ask.description": "安全工具直接运行；写入与命令先询问",
    "policy.read-only.label": "只读",
    "policy.read-only.description": "只允许读取和发现类工具，不做任何修改",
    "policy.bypass.label": "自动执行",
    "policy.bypass.description": "普通工具不再询问；危险命令仍会确认",
    "policy.autopilot.label": "自动续跑",
    "policy.autopilot.description": "跳过普通审批，并在模型偶发失败后自动继续",
    noPolicies: "没有可用的权限模式",
    pin: "置顶",
    unpin: "取消置顶",
    searchModels: "搜索模型…",
    noModels: "没有匹配的模型",
    moreModels: "更多模型…",
    backToModels: "返回模型列表",
    modelSwitchHint: "切换模型或思考程度会使已有的提示词缓存失效。建议新建会话，避免额外的 token 消耗。",
    thinkingEffort: "思考强度",
    defaultEffort: "默认",
    effortOff: "关闭",
    effortMinimal: "极简",
    effortLow: "低",
    effortMedium: "中",
    effortHigh: "高",
    effortXhigh: "较高",
    effortMax: "最高",
    effortUnsupported: "当前模型不支持调节思考强度",
    pinned: "置顶",
    others: "其他模型",
    modes: "模式",
    modeGoal: "目标",
    modeGoalDesc: "把任务拆成可验收的目标并跟踪进度",
    modePlan: "计划",
    modePlanDesc: "先出执行计划，确认后再逐步实施",
    modeUltraloop: "Ultraloop",
    modeUltraloopDesc: "多智能体编排，自动拆分并并行推进",
    modeHint: "可多选，也可只选一个",
    goalPlaceholder: "输入目标内容，回车开启",
    attach: "添加附件",
    attachments: "附件",
    removeAttachment: "移除附件",
    submitFeedback: "提交反馈",
    feedbackCommentPlaceholder: "填写详情以帮助我们改进体验，提交内容会包括当前对话的日志",
    submit: "提交",
    feedbackSubmitted: "感谢反馈",
    feedbackGood: "有帮助",
    feedbackBad: "待改进",
    forkHere: "从此处分叉",
    forkCancelled: "分叉未完成",
    usage: "用量",
    "feedbackTopic.taskResult": "任务结果",
    "feedbackTopic.instructionFollowing": "指令理解与遵循",
    "feedbackTopic.productInteraction": "产品功能与交互",
    "feedbackTopic.stabilitySpeed": "稳定性和速度",
    "feedbackTopic.resourceCost": "资源使用与费用",
    "feedbackTopic.safetyPrivacy": "安全隐私与权限",
    "feedbackTopic.other": "其他",
    attachmentTooLarge: "附件超过大小上限",
    attachmentUnreadable: "无法读取该附件",
    confirmLogout: "退出 StepCode Web？需要从终端重新获取访问链接。",
    workspaceBusy: "当前会话结束后再切换工作区。",
    workspaceSwitched: "已切换到 {name}，发送消息时创建新会话。",
    workspaceOpened: "已打开 {name} 工作区。",
    browserCopyDenied: "浏览器未允许复制，请手动选择文本。",
    generating: "正在生成回复…",
    loadingTree: "正在读取文件树…",
    emptyFolder: "空文件夹",
    modelLogin: "模型登录",
    loginNone: "未登录：Web 端不提供登录界面。",
    loginConfigured: "已登录：{provider}{profile}",
    loginProfileSuffix: " · {profile}",
    loginFromEnvironment: "来源：环境变量 STEP_API_KEY（只读，请在启动命令中修改）",
    loginFromFile: "来源：{path}",
    loginHint: "Web 复用终端里的登录。要更换账号或重新登录，在项目目录执行：",
    loginCopied: "命令已复制",
    pickWorkspaceFolder: "选择工作区文件夹",
    folderPickerFailed: "无法打开系统文件夹选择器（{reason}），已改用内置浏览。",
    listTruncated: "条目过多，仅显示前 1000 项。",
    searchTruncated: "结果过多，请缩小搜索范围。",
    refresh: "刷新",
    removeWorkspace: "移除工作区",
    confirmRemoveWorkspace: "从工作区列表移除“{name}”？不会删除任何文件。",
    noConversationsYet: "还没有会话",
    filePreview: "文件预览",
    closePreview: "收起文件预览",
    openPreview: "展开文件预览",
    closeTab: "关闭",
    wrapLines: "自动换行",
    reloadFile: "重新读取文件",
    copyFile: "复制文件内容",
    renderedPreview: "渲染预览",
    loadingFile: "正在读取文件…",
    binaryFile: "二进制文件，无法预览。",
    fileTooLarge: "文件过大（{size}），无法预览。",
    linesTruncated: "文件过长，仅显示前 {count} 行。",
    noMatchingFiles: "没有匹配的文件。",
    approvalWaiting: "等待审批",
    denied: "已拒绝",
    approved: "已允许",
    deny: "拒绝",
    approveOnce: "仅本次允许",
    approveSession: "本会话允许",
    currentTask: "当前任务",
    tasks: "任务",
    task: "任务",
    subagents: "子智能体",
    subagent: "子智能体",
    steps: "步骤",
    done: "已完成",
    notStarted: "待开始",
    returned: "已返回",
    noTasks: "暂无任务",
    usageTitle: "token 用量 · 当前会话",
    usageCumulative: "tok 累计",
    usageInput: "输入",
    usageOutput: "输出",
    usageTurns: "统计",
    usageAssistantTurns: "助手轮次",
  },
  "en-US": {
    newConversation: "New conversation",
    search: "Search",
    searchTitle: "Search conversations",
    searchPlaceholder: "Search conversations",
    searchSelect: "Select",
    searchOpen: "Open",
    searchClose: "Close",
    noSearchResults: "No matching conversations",
    recentFolders: "Recent folders",
    chooseFolder: "Choose folder…",
    addWorkspace: "Add workspace",
    go: "Go",
    searchInDirectory: "Search in this directory…",
    workspaceHelp: "Open a folder, then choose “Open this folder” to add it as a workspace.",
    cancel: "Cancel",
    openFolder: "Open this folder",
    emptyDirectory: "No subfolders",
    projects: "Projects",
    groups: "Groups",
    conversations: "Conversations",
    archivedConversations: "Archived",
    recent: "Recent",
    openWorkspace: "Open workspace",
    fileTree: "File tree",
    newConversationInWorkspace: "New conversation in workspace",
    justNow: "now",
    upgrade: "Upgrade",
    appearance: "Appearance",
    language: "Language",
    settings: "Settings",
    logout: "Log out",
    themeSystem: "System",
    themeLight: "Light",
    themeDark: "Dark",
    settingsDescription: "Manage StepCode Web interface preferences.",
    appearanceDescription: "Choose light, dark, or system appearance.",
    languageDescription: "Change the Web interface language.",
    localMode: "StepCode Web · Local mode",
    loggedOut: "Logged out",
    loggedOutHint: "Restart StepCode Web from the terminal to get a new access link.",
    emptyConversation: "No messages yet — start a conversation below",
    messagePlaceholder: "Type a message…",
    idle: "Idle",
    running: "Running",
    waiting: "Waiting",
    completed: "Completed",
    failed: "Failed",
    ask: "Ask each time",
    readOnly: "Read only",
    bypass: "Auto execute",
    autopilot: "Autopilot",
    noProjectConversations: "No project conversations yet.",
    noArchivedProjectConversations: "No archived project conversations.",
    ungrouped: "Ungrouped",
    noGroupedConversations: "No conversations to group.",
    createGroup: "New group",
    useColor: "Create with this color",
    noCategory: "No category",
    groupNamePlaceholder: "Group name",
    confirm: "Confirm",
    rename: "Rename",
    archive: "Archive",
    restore: "Restore",
    delete: "Delete",
    confirmDelete: "Delete “{name}”? This cannot be undone.",
    code: "Code",
    copy: "Copy",
    copied: "Copied",
    me: "Me",
    step: "Step",
    searchComing: "Global search arrives in batch 2. Browse conversations by project for now.",
    settingsOpened: "Settings",
    resizeSidebar: "Drag to resize the sidebar, double-click to reset",
    authExpiredTitle: "Disconnected",
    authExpiredBody: "The launch link works once, and changes when the server restarts. Reopen the address the server last printed.",
    reload: "Reload",
    "policy.ask.label": "Ask",
    "policy.ask.description": "Safe tools run; writes and commands ask first",
    "policy.read-only.label": "Read Only",
    "policy.read-only.description": "Read and discovery tools only, no modifications",
    "policy.bypass.label": "Bypass",
    "policy.bypass.description": "Ordinary tools run without approval; dangerous commands still ask",
    "policy.autopilot.label": "Autopilot",
    "policy.autopilot.description": "Skip ordinary approvals and resume transient model failures",
    noPolicies: "No permission modes available",
    pin: "Pin",
    unpin: "Unpin",
    searchModels: "Search models…",
    noModels: "No matching models",
    moreModels: "More models…",
    backToModels: "Back to models",
    modelSwitchHint: "Switching model or thinking effort invalidates the existing prompt cache. Start a new conversation to avoid extra token spend.",
    thinkingEffort: "Thinking effort",
    defaultEffort: "Default",
    effortOff: "Off",
    effortMinimal: "Minimal",
    effortLow: "Low",
    effortMedium: "Medium",
    effortHigh: "High",
    effortXhigh: "Higher",
    effortMax: "Max",
    effortUnsupported: "This model cannot adjust thinking effort",
    pinned: "Pinned",
    others: "Other models",
    modes: "Modes",
    modeGoal: "Goal",
    modeGoalDesc: "Break the task into verifiable goals and track progress",
    modePlan: "Plan",
    modePlanDesc: "Draft a plan first, then implement step by step after approval",
    modeUltraloop: "Ultraloop",
    modeUltraloopDesc: "Multi-agent orchestration that splits and parallelises the work",
    modeHint: "Multi-select or single-select",
    goalPlaceholder: "Type the goal, then press Enter",
    attach: "Add attachment",
    attachments: "Attachments",
    removeAttachment: "Remove attachment",
    submitFeedback: "Submit feedback",
    feedbackCommentPlaceholder: "Add detail to help us improve. Submitting includes the current conversation log.",
    submit: "Submit",
    feedbackSubmitted: "Thanks for the feedback",
    feedbackGood: "Helpful",
    feedbackBad: "Needs work",
    forkHere: "Fork from here",
    forkCancelled: "The fork did not complete",
    usage: "Usage",
    "feedbackTopic.taskResult": "Task result",
    "feedbackTopic.instructionFollowing": "Instruction following",
    "feedbackTopic.productInteraction": "Product & interaction",
    "feedbackTopic.stabilitySpeed": "Stability & speed",
    "feedbackTopic.resourceCost": "Resource & cost",
    "feedbackTopic.safetyPrivacy": "Safety & privacy",
    "feedbackTopic.other": "Other",
    attachmentTooLarge: "Attachment exceeds the size limit",
    attachmentUnreadable: "Could not read that attachment",
    confirmLogout: "Log out of StepCode Web? You will need a new terminal launch link.",
    workspaceBusy: "Wait for the current conversation to finish before changing workspace.",
    workspaceSwitched: "Switched to {name}. A new conversation will be created when you send.",
    workspaceOpened: "Opened the {name} workspace.",
    browserCopyDenied: "The browser blocked copying. Select the text manually.",
    generating: "Generating…",
    loadingTree: "Loading file tree…",
    emptyFolder: "Empty folder",
    modelLogin: "Model login",
    loginNone: "Not signed in. There is no login screen in the Web UI.",
    loginConfigured: "Signed in: {provider}{profile}",
    loginProfileSuffix: " · {profile}",
    loginFromEnvironment: "Source: the STEP_API_KEY environment variable (read-only; change it in the launch command)",
    loginFromFile: "Source: {path}",
    loginHint: "The Web UI reuses the terminal sign-in. To switch accounts or sign in again, run this in the project directory:",
    loginCopied: "Command copied",
    pickWorkspaceFolder: "Select Workspace Directory",
    folderPickerFailed: "Could not open the system folder picker ({reason}); using the built-in browser.",
    listTruncated: "Too many entries; showing the first 1000.",
    searchTruncated: "Too many results; narrow the search.",
    refresh: "Refresh",
    removeWorkspace: "Remove workspace",
    confirmRemoveWorkspace: "Remove “{name}” from the workspace list? No files are deleted.",
    noConversationsYet: "No conversations yet",
    filePreview: "File preview",
    closePreview: "Hide file preview",
    openPreview: "Show file preview",
    closeTab: "Close",
    wrapLines: "Wrap lines",
    reloadFile: "Reload file",
    copyFile: "Copy file contents",
    renderedPreview: "Rendered preview",
    loadingFile: "Loading file…",
    binaryFile: "Binary file; no preview available.",
    fileTooLarge: "File is too large to preview ({size}).",
    linesTruncated: "Long file; showing the first {count} lines.",
    noMatchingFiles: "No matching files.",
    approvalWaiting: "Awaiting approval",
    denied: "Denied",
    approved: "Approved",
    deny: "Deny",
    approveOnce: "Allow once",
    approveSession: "Allow for session",
    currentTask: "Current task",
    tasks: "Tasks",
    task: "Task",
    subagents: "Subagents",
    subagent: "Subagent",
    steps: "Steps",
    done: "Done",
    notStarted: "Not started",
    returned: "Returned",
    noTasks: "No tasks",
    usageTitle: "Token usage · this session",
    usageCumulative: "tok total",
    usageInput: "Input",
    usageOutput: "Output",
    usageTurns: "Breakdown",
    usageAssistantTurns: "Assistant turns",
  },
};

const TAG_COLOR_NAMES = {
  "zh-CN": { red: "红色", orange: "橙色", yellow: "黄色", green: "绿色", blue: "蓝色", purple: "紫色", pink: "粉色", gray: "灰色" },
  "en-US": { red: "Red", orange: "Orange", yellow: "Yellow", green: "Green", blue: "Blue", purple: "Purple", pink: "Pink", gray: "Gray" },
};

const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");

function t(key, values = {}) {
  let text = I18N[state.locale]?.[key] ?? I18N["zh-CN"][key] ?? key;
  for (const [name, value] of Object.entries(values)) text = text.replace(`{${name}}`, String(value));
  return text;
}

function resolvedTheme(theme = state.theme) {
  return theme === "system" ? (systemTheme.matches ? "dark" : "light") : theme;
}

function renderPreferenceControls() {
  $("#themeValue").textContent = t(state.theme === "system" ? "themeSystem" : state.theme === "dark" ? "themeDark" : "themeLight");
  $("#languageValue").textContent = state.locale === "en-US" ? "English" : "简体中文";
  $("#settingsThemeSelect").value = state.theme;
  $("#settingsLanguageSelect").value = state.locale;
  $$("[data-theme-choice]").forEach((button) => button.classList.toggle("active", button.dataset.themeChoice === state.theme));
  $$("[data-language-choice]").forEach((button) =>
    button.classList.toggle("active", button.dataset.languageChoice === state.locale),
  );
  if (state.current) renderPolicies(state.current);
  else renderPolicies({ policies: state.policiesCache ?? [], permissionPreset: state.draftPolicy });
  renderModePicker();
}

function applyTheme(theme, persist = true) {
  state.theme = ["system", "light", "dark"].includes(theme) ? theme : "system";
  document.documentElement.dataset.theme = resolvedTheme();
  if (persist) localStorage.setItem("stepcode.theme", state.theme);
  renderPreferenceControls();
}

function applyLocale(locale, persist = true) {
  state.locale = locale === "en-US" ? "en-US" : "zh-CN";
  document.documentElement.lang = state.locale;
  if (persist) localStorage.setItem("stepcode.locale", state.locale);
  $$("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  $$("[data-i18n-placeholder]").forEach((element) => {
    element.placeholder = t(element.dataset.i18nPlaceholder);
  });
  // `data-i18n-title` marks an element whose accessible name comes from this
  // key, so keep title and aria-label in step.
  $$("[data-i18n-title]").forEach((element) => {
    element.title = t(element.dataset.i18nTitle);
    element.setAttribute("aria-label", element.title);
  });
  const chord = (key) => (navigator.platform.startsWith("Mac") ? `⌥⌘${key}` : `Ctrl+Alt+${key}`);
  $("#addWorkspace").dataset.tooltip = `${t("addWorkspace")} ${chord("O")}`;
  $("#addWorkspace").setAttribute("aria-label", t("addWorkspace"));
  $("#previewClose").title = `${t("closePreview")} ${navigator.platform.startsWith("Mac") ? "⇧⌘B" : "Ctrl+Shift+B"}`;
  if (state.tree.cwd) renderTree();
  renderPreview();
  const policyLabels = {
    ask: t("ask"),
    "read-only": t("readOnly"),
    bypass: t("bypass"),
    autopilot: t("autopilot"),
  };
  renderPreferenceControls();
  renderSessionLists();
  renderTimeline();
  if (!$("#searchModal").hidden) renderSearchResults($("#globalSearchInput").value);
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

function contentText(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .filter((part) => part?.type === "text")
    .map((part) => part.text)
    .join("");
}

function renderMarkdown(value) {
  const blocks = [];
  const source = String(value).replace(/```([^\n]*)\n([\s\S]*?)```/g, (_match, language, code) => {
    const label = language.trim() || t("code");
    const index =
      blocks.push(
        `<div class="code-block"><div class="code-block-header"><span>${escapeHtml(label)}</span><button class="copy-code" type="button">${t("copy")}</button></div><pre><code>${escapeHtml(code)}</code></pre></div>`,
      ) - 1;
    return `\u0000${index}\u0000`;
  });
  let html = escapeHtml(source)
    .replace(/^### (.+)$/gm, "<h4>$1</h4>")
    .replace(/^## (.+)$/gm, "<h3>$1</h3>")
    .replace(/^# (.+)$/gm, "<h2>$1</h2>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br>");
  return html.replace(/\u0000(\d+)\u0000/g, (_match, index) => blocks[Number(index)] ?? "");
}

function compact(value, limit = 120) {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function toolInputSummary(input) {
  if (!input || typeof input !== "object") return "无输入摘要";
  return compact(
    Object.entries(input)
      .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
      .join(" "),
  );
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
  });
  if (response.status === 401) showAuthBanner();
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error ?? `HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * The launch token is single-use and the signing secret is per config root, so
 * a stale cookie is a normal occurrence rather than a bug. Say so loudly:
 * otherwise every subsequent call fails silently and the UI just looks empty.
 */
function showAuthBanner() {
  const banner = $("#authBanner");
  if (banner) banner.hidden = false;
}

async function exchange() {
  const token = new URLSearchParams(location.hash.slice(1)).get("token");
  if (!token) return;
  try {
    await api("/auth/exchange", { method: "POST", body: JSON.stringify({ token }) });
    history.replaceState(null, "", `${location.pathname}${location.search}`);
  } catch (error) {
    showAuthBanner();
    throw error;
  }
}

function basename(path) {
  if (!path) return "最近";
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) || path;
}

function sessionTitle(session) {
  return session?.name || session?.firstMessage || (session?.id ? `Session ${session.id.slice(0, 8)}` : t("newConversation"));
}

function stateLabel(status) {
  return t(status);
}

function taskStatus(session) {
  if (state.current?.id === session.id) return state.current.status ?? "idle";
  return state.statusById.get(session.id) ?? (session.messageCount > 0 ? "completed" : "idle");
}

function relativeTime(value) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 60_000) return t("justNow");
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`;
  return `${Math.floor(elapsed / 86_400_000)}d`;
}

function emptyList(text) {
  const element = document.createElement("div");
  element.className = "empty-list";
  element.textContent = text;
  return element;
}

function groupName(key) {
  return state.groups.find((group) => group.key === key)?.name ?? "";
}

function buildSessionRow(session, grouped = false) {
  const status = taskStatus(session);
  const unread = state.unreadById.get(session.id) === true;
  const tag = state.tags.get(session.id);
  const row = document.createElement("div");
  row.className = `session-row ${status}${state.current?.id === session.id ? " active" : ""}${unread ? " unread" : ""}`;
  row.role = "button";
  row.tabIndex = 0;
  row.dataset.sessionId = session.id;
  const badge =
    status === "running" || status === "waiting" || status === "failed"
      ? `<span class="session-badge ${status}">${stateLabel(status)}</span>`
      : "";
  const tagMarkup = tag
    ? `<button class="tag-diamond session-tag" type="button" style="--tag-color:${TAG_COLORS[tag]}" title="${escapeHtml(groupName(tag))}" aria-label="${escapeHtml(groupName(tag))}"></button>`
    : "";
  row.innerHTML = `<i class="session-dot" aria-hidden="true"></i><span class="session-title-wrap"><span class="session-title">${escapeHtml(sessionTitle(session))}</span></span><span class="session-meta">${badge}<time class="session-time">${escapeHtml(relativeTime(session.modified))}</time>${grouped ? "" : `<button class="session-tag-button" type="button" title="${t("groups")}" aria-label="${t("groups")}">${ICONS.tag}</button>`}<button class="session-menu-button" type="button" title="${t("settings")}" aria-label="${t("settings")}">${ICONS.more}</button>${tagMarkup}</span>`;
  const open = () => {
    state.unreadById.set(session.id, false);
    void openSession(session.id);
  };
  row.addEventListener("click", (event) => {
    if (event.target.closest(".session-menu-button,.session-tag-button,.session-tag")) return;
    open();
  });
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
    }
  });
  row.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    openSessionMenu(session, event.clientX, event.clientY);
  });
  row.querySelector(".session-menu-button").addEventListener("click", (event) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    openSessionMenu(session, rect.right, rect.bottom + 4);
  });
  row.querySelector(".session-tag-button")?.addEventListener("click", (event) => {
    event.stopPropagation();
    openTagPicker(session, event.currentTarget);
  });
  row.querySelector(".session-tag")?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (state.currentView === "project") applyTagFilter(state.currentFilter === tag ? null : tag);
  });
  return row;
}

function renderSessionLists() {
  const projectGroups = $("#projectGroups");
  const recentTasks = $("#recentTasks");
  projectGroups.replaceChildren();
  recentTasks.replaceChildren();
  const visible = state.sessions.filter((session) => session.archived === state.showArchived);
  const projects = new Map();
  const recent = [];
  for (const session of visible) {
    if (!session.cwd || session.cwdAvailable === false) {
      recent.push(session);
      continue;
    }
    const sessions = projects.get(session.cwd) ?? [];
    sessions.push(session);
    projects.set(session.cwd, sessions);
  }
  // Registered workspaces stay listed even before their first conversation.
  const registered = new Set(state.workspaces.filter((workspace) => workspace.available).map((workspace) => workspace.path));
  if (!state.showArchived) {
    for (const cwd of registered) if (!projects.has(cwd)) projects.set(cwd, []);
  }
  for (const [cwd, sessions] of projects) {
    const group = document.createElement("section");
    group.className = `project-group${state.foldedProjects.has(cwd) ? " folded" : ""}`;
    const header = document.createElement("div");
    header.className = "project-header";
    header.innerHTML = `${ICONS.folder}<span class="project-name">${escapeHtml(basename(cwd))}</span><span class="project-actions"><button class="icon-button project-action tree-button" type="button" data-tooltip="${t("fileTree")}" aria-label="${t("fileTree")}">${ICONS.tree}</button><button class="icon-button project-action new-project-session" type="button" data-tooltip="${t("newConversationInWorkspace")}" aria-label="${t("newConversationInWorkspace")}">${ICONS.plus}</button>${registered.has(cwd) && !sessions.length ? `<button class="icon-button project-action remove-workspace" type="button" data-tooltip="${t("removeWorkspace")}" aria-label="${t("removeWorkspace")}">${icon("close-sm", "sm")}</button>` : ""}</span>`;
    group.dataset.cwd = cwd;
    // The whole bar toggles the group; no separate disclosure control.
    header.addEventListener("click", () => {
      if (state.foldedProjects.has(cwd)) state.foldedProjects.delete(cwd);
      else state.foldedProjects.add(cwd);
      group.classList.toggle("folded");
    });
    header.querySelector(".tree-button").addEventListener("click", (event) => {
      event.stopPropagation();
      void openTree({ cwd });
    });
    header.querySelector(".remove-workspace")?.addEventListener("click", (event) => {
      event.stopPropagation();
      void removeWorkspace(cwd);
    });
    header.querySelector(".new-project-session").addEventListener("click", (event) => {
      event.stopPropagation();
      startDraft(cwd);
    });
    const body = document.createElement("div");
    body.className = "project-sessions";
    const inner = document.createElement("div");
    for (const session of sessions) inner.append(buildSessionRow(session));
    if (!sessions.length) inner.append(emptyList(t("noConversationsYet")));
    body.append(inner);
    group.append(header, body);
    projectGroups.append(group);
  }
  for (const session of recent) recentTasks.append(buildSessionRow(session));
  if (!projects.size) {
    projectGroups.append(emptyList(state.showArchived ? t("noArchivedProjectConversations") : t("noProjectConversations")));
  }
  $("#recentGroup").hidden = recent.length === 0;
  $("#listHeading").textContent = state.showArchived ? t("archivedConversations") : t("conversations");
  $("#archiveToggle").classList.toggle("active", state.showArchived);
  $("#archiveToggle").title = state.showArchived ? t("conversations") : t("archivedConversations");
  renderWorkspaceOptions();
  renderGroupedView(
    state.sessions.filter((session) => !session.archived),
    state.sessions.filter((session) => session.archived),
  );
  switchConversationView(state.currentView, false);
  applyTagFilter(state.currentFilter);
}

function switchConversationView(view, clearFilter = true) {
  state.currentView = view === "group" ? "group" : "project";
  if (clearFilter && state.currentView === "group") state.currentFilter = null;
  $$("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === state.currentView));
  $("#projectView").hidden = state.currentView !== "project";
  $("#groupedView").hidden = state.currentView !== "group";
  $("#tagFilter").hidden = state.currentView !== "project" || !state.currentFilter;
}

function applyTagFilter(key, updateRows = true) {
  state.currentFilter = key || null;
  const filter = $("#tagFilter");
  filter.hidden = !state.currentFilter || state.currentView !== "project";
  if (state.currentFilter) {
    $("#tagFilterDiamond").style.setProperty("--tag-color", TAG_COLORS[state.currentFilter]);
    $("#tagFilterName").textContent = groupName(state.currentFilter);
  }
  if (!updateRows) return;
  $$("#projectView .session-row").forEach((row) => {
    row.style.display = !state.currentFilter || state.tags.get(row.dataset.sessionId) === state.currentFilter ? "" : "none";
  });
  $$("#projectGroups .project-group").forEach((group) => {
    group.style.display = [...group.querySelectorAll(".session-row")].some((row) => row.style.display !== "none") ? "" : "none";
  });
}

function renderGroupedView(visibleSessions, archivedSessions) {
  const view = $("#groupedView");
  view.replaceChildren();
  let rendered = false;
  for (const color of Object.keys(TAG_COLORS)) {
    const group = state.groups.find((candidate) => candidate.key === color);
    if (!group) continue;
    const sessions = visibleSessions.filter((session) => state.tags.get(session.id) === color);
    if (!sessions.length) continue;
    rendered = true;
    view.append(buildGroupedSection(group.name, color, sessions));
  }
  const ungrouped = visibleSessions.filter((session) => !state.tags.has(session.id));
  if (ungrouped.length) {
    rendered = true;
    view.append(buildGroupedSection(t("ungrouped"), null, ungrouped));
  }
  if (archivedSessions.length) {
    rendered = true;
    view.append(buildGroupedSection(t("archivedConversations"), null, archivedSessions, true));
  }
  if (!rendered) view.append(emptyList(t("noGroupedConversations")));
}

function buildGroupedSection(name, color, sessions, archived = false) {
  const section = document.createElement("section");
  section.className = `group-section${archived ? " archived-group" : ""}`;
  section.style.setProperty("--group-color", archived ? "var(--ink-3)" : color ? TAG_COLORS[color] : "var(--line)");
  const heading = document.createElement("div");
  heading.className = "group-heading";
  heading.innerHTML = archived
    ? `${ICONS.archive}<span>${escapeHtml(name)}</span>`
    : `<span class="tag-diamond" style="--tag-color:${color ? TAG_COLORS[color] : "var(--line-strong)"}"></span><span>${escapeHtml(name)}</span>`;
  heading.addEventListener("click", () => section.classList.toggle("folded"));
  const body = document.createElement("div");
  body.className = "group-sessions";
  for (const session of sessions) body.append(buildSessionRow(session, true));
  const spine = document.createElement("i");
  spine.className = "group-spine";
  section.append(heading, spine, body);
  return section;
}

function positionTagPicker(anchor) {
  const picker = $("#tagPicker");
  picker.hidden = false;
  const rect = anchor.getBoundingClientRect();
  picker.style.left = `${Math.min(rect.right - picker.offsetWidth, window.innerWidth - picker.offsetWidth - 8)}px`;
  picker.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - picker.offsetHeight - 8)}px`;
}

function openTagPicker(session, anchor) {
  state.tagTarget = session;
  const picker = $("#tagPicker");
  const used = new Set(state.groups.map((group) => group.key));
  picker.innerHTML = state.groups
    .map(
      (group) =>
        `<button type="button" data-tag="${group.key}"><span class="tag-diamond" style="--tag-color:${TAG_COLORS[group.key]}"></span><span>${escapeHtml(group.name)}</span></button>`,
    )
    .join("");
  const fresh = Object.keys(TAG_COLORS).filter((color) => !used.has(color));
  if (fresh.length) {
    picker.insertAdjacentHTML(
      "beforeend",
      `<div class="tag-picker-caption">${t("createGroup")}</div>${fresh.map((color) => `<button type="button" data-new-tag="${color}"><span class="tag-diamond" style="--tag-color:${TAG_COLORS[color]}"></span><span>${t("useColor")}</span></button>`).join("")}`,
    );
  }
  picker.insertAdjacentHTML(
    "beforeend",
    `<div class="tag-picker-divider"></div><button type="button" data-tag=""><span class="tag-diamond"></span><span>${t("noCategory")}</span></button>`,
  );
  picker.onclick = (event) => {
    event.stopPropagation();
    const item = event.target.closest("[data-tag],[data-new-tag]");
    if (!item) return;
    if (item.dataset.newTag) {
      showTagNameInput(item.dataset.newTag);
      return;
    }
    const tag = item.dataset.tag;
    if (!tag || state.tags.get(session.id) === tag) state.tags.delete(session.id);
    else state.tags.set(session.id, tag);
    picker.hidden = true;
    renderSessionLists();
  };
  positionTagPicker(anchor);
}

function showTagNameInput(color) {
  const picker = $("#tagPicker");
  const fallback = TAG_COLOR_NAMES[state.locale][color];
  picker.innerHTML = `<div class="tag-create"><span class="tag-diamond" style="--tag-color:${TAG_COLORS[color]}"></span><input id="tagNameInput" maxlength="12" placeholder="${t("groupNamePlaceholder")}"><button type="button" id="tagNameConfirm">${t("confirm")}</button></div>`;
  const input = $("#tagNameInput");
  const accept = () => {
    state.groups.push({ key: color, name: input.value.trim() || fallback });
    state.tags.set(state.tagTarget.id, color);
    picker.hidden = true;
    renderSessionLists();
  };
  const ime = enterGuard(input);
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter" && !ime(event)) accept();
    if (event.key === "Escape") picker.hidden = true;
  });
  $("#tagNameConfirm").addEventListener("click", accept);
  input.focus();
}

function knownWorkspaces() {
  const values = new Set();
  if (state.bootstrapCwd) values.add(state.bootstrapCwd);
  if (state.draftCwd) values.add(state.draftCwd);
  if (state.current?.cwd) values.add(state.current.cwd);
  for (const workspace of state.workspaces) if (workspace.available) values.add(workspace.path);
  for (const session of state.sessions) {
    if (session.cwd && session.cwdAvailable !== false) values.add(session.cwd);
  }
  return [...values].sort((left, right) => basename(left).localeCompare(basename(right), "zh-CN"));
}

function renderWorkspaceOptions() {
  const control = $("#workspaceControl");
  $("#workspaceControl").hidden = Boolean(state.current);
  if (!state.current) {
    // Before bootstrap there is no folder yet, and basename() would render its
    // "recent" placeholder as if it were a workspace name. Leave the markup's
    // neutral label in place until a real path arrives.
    const cwd = state.draftCwd || state.bootstrapCwd;
    if (cwd) $("#workspaceButtonName").textContent = basename(cwd);
  }
  const workspaces = knownWorkspaces();
  if (!control) return;
  const list = $("#workspaceRecentList");
  list.replaceChildren();
  for (const path of workspaces) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `workspace-recent-item${path === state.draftCwd ? " selected" : ""}`;
    item.innerHTML = `${ICONS.folder}<span><strong>${escapeHtml(basename(path))}</strong><small>${escapeHtml(path)}</small></span>${path === state.draftCwd ? '<span class="workspace-check">✓</span>' : ""}`;
    item.addEventListener("click", () => {
      startDraft(path);
      closeWorkspacePopover();
    });
    list.append(item);
  }
  if (!workspaces.length) list.append(emptyList(t("emptyDirectory")));
}

function openWorkspacePopover() {
  renderWorkspaceOptions();
  $("#workspacePopover").hidden = false;
  $("#workspaceButton").setAttribute("aria-expanded", "true");
}

function closeWorkspacePopover() {
  $("#workspacePopover").hidden = true;
  $("#workspaceButton").setAttribute("aria-expanded", "false");
}

function closeWorkspaceBrowser() {
  $("#workspaceBrowserModal").hidden = true;
}

function renderWorkspaceDirectoryList(query = "") {
  const list = $("#workspaceDirectoryList");
  const normalized = query.trim().toLowerCase();
  list.replaceChildren();
  const directories = state.workspaceDirectories.filter((entry) => !normalized || entry.name.toLowerCase().includes(normalized));
  if (!directories.length) {
    list.append(emptyList(t("emptyDirectory")));
    return;
  }
  for (const directory of directories) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "workspace-directory-item";
    item.innerHTML = `${ICONS.folder}<span>${escapeHtml(directory.name)}</span>`;
    item.addEventListener("click", () => void loadWorkspaceDirectory(directory.path));
    list.append(item);
  }
}

async function loadWorkspaceDirectory(path) {
  try {
    const data = await api(`/api/v1/directories?path=${encodeURIComponent(path || "")}`);
    state.workspaceBrowserPath = data.path;
    state.workspaceBrowserParent = data.parent;
    state.workspaceDirectories = data.directories;
    $("#workspacePathInput").value = data.path;
    $("#workspaceDirectorySearch").value = "";
    renderWorkspaceDirectoryList();
  } catch (error) {
    showError(error.message);
  }
}

async function openWorkspaceBrowser() {
  closeWorkspacePopover();
  $("#workspaceBrowserModal").hidden = false;
  await loadWorkspaceDirectory(state.draftCwd || state.bootstrapCwd);
  $("#workspacePathInput").focus();
}

function searchableText(session) {
  return [session.name, session.firstMessage, session.allMessagesText, session.cwd]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function openSearch() {
  $("#searchModal").hidden = false;
  $("#globalSearchInput").value = "";
  state.searchIndex = -1;
  renderSearchResults("");
  $("#globalSearchInput").focus();
}

function closeSearch() {
  $("#searchModal").hidden = true;
  state.searchResults = [];
  state.searchIndex = -1;
}

function renderSearchResults(query) {
  const normalized = query.trim().toLowerCase();
  const sessions = state.sessions
    .filter((session) => session.cwdAvailable !== false)
    .filter((session) => !normalized || searchableText(session).includes(normalized))
    .sort((left, right) => new Date(right.modified).getTime() - new Date(left.modified).getTime())
    .slice(0, 50);
  state.searchResults = sessions;
  const results = $("#globalSearchResults");
  results.replaceChildren();
  if (!sessions.length) {
    results.append(emptyList(t("noSearchResults")));
    return;
  }
  const projects = new Map();
  for (const session of sessions) {
    const key = session.cwd || "";
    const items = projects.get(key) ?? [];
    items.push(session);
    projects.set(key, items);
  }
  let index = 0;
  for (const [cwd, items] of projects) {
    const group = document.createElement("section");
    group.className = "search-project";
    group.innerHTML = `<div class="search-project-header">${ICONS.folder}<span>${escapeHtml(basename(cwd) || t("recent"))}</span></div>`;
    for (const session of items) {
      const result = document.createElement("button");
      result.className = `search-result${index === state.searchIndex ? " selected" : ""}`;
      result.type = "button";
      result.dataset.index = String(index);
      result.innerHTML = `<span class="search-result-main"><strong>${escapeHtml(sessionTitle(session))}</strong><small>${escapeHtml(session.firstMessage || session.allMessagesText || "")}</small></span><time>${escapeHtml(relativeTime(session.modified))}</time>`;
      result.addEventListener("click", () => {
        closeSearch();
        void openSession(session.id);
      });
      group.append(result);
      index += 1;
    }
    results.append(group);
  }
}

function moveSearchSelection(delta) {
  if (!state.searchResults.length) return;
  state.searchIndex = (state.searchIndex + delta + state.searchResults.length) % state.searchResults.length;
  $$(".search-result").forEach((result, index) => {
    result.classList.toggle("selected", index === state.searchIndex);
  });
  document.querySelector(`.search-result[data-index="${state.searchIndex}"]`)?.scrollIntoView({ block: "nearest" });
}

function openSelectedSearchResult() {
  const session = state.searchResults[state.searchIndex >= 0 ? state.searchIndex : 0];
  if (!session) return;
  closeSearch();
  void openSession(session.id);
}

function toggleArchived() {
  state.showArchived = !state.showArchived;
  renderSessionLists();
}

function closeSessionMenu() {
  $("#sessionMenu").hidden = true;
}

function openSessionMenu(session, x, y) {
  const menu = $("#sessionMenu");
  menu.innerHTML = `<button type="button" data-action="rename">${t("rename")}</button><button type="button" data-action="archive">${session.archived ? t("restore") : t("archive")}</button><button class="danger" type="button" data-action="delete">${t("delete")}</button>`;
  menu.hidden = false;
  menu.style.left = `${Math.min(x, window.innerWidth - menu.offsetWidth - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - menu.offsetHeight - 8)}px`;
  menu.onclick = async (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    closeSessionMenu();
    try {
      if (action === "rename") {
        const name = window.prompt(t("rename"), sessionTitle(session));
        if (name?.trim()) {
          await api(`/api/v1/sessions/${session.id}/name`, {
            method: "PATCH",
            body: JSON.stringify({ name: name.trim() }),
          });
        }
      }
      if (action === "archive") {
        await api(`/api/v1/sessions/${session.id}/archive`, {
          method: "PATCH",
          body: JSON.stringify({ archived: !session.archived }),
        });
      }
      if (action === "delete" && window.confirm(t("confirmDelete", { name: sessionTitle(session) }))) {
        await api(`/api/v1/sessions/${session.id}`, { method: "DELETE" });
        if (state.current?.id === session.id) startDraft(state.bootstrapCwd);
      }
      await refreshSessions();
    } catch (error) {
      showError(error.message);
    }
  };
}

/** Build a workspace-scoped API URL; `cwd` selects the folder, not a session. */
function workspaceApi(cwd, endpoint, params = {}) {
  return `/api/v1/workspace${endpoint}?${new URLSearchParams({ cwd, ...params })}`;
}

/** Directory paths from the root down to the parent of `path`. */
function ancestorPaths(path) {
  const parts = path.split("/");
  return parts.slice(0, -1).map((_part, index) => parts.slice(0, index + 1).join("/"));
}

/**
 * Load one directory level. The tree is lazy: a repository with a large
 * `node_modules` costs nothing until that folder is expanded.
 */
async function loadTreeDirectory(path) {
  const tree = state.tree;
  const cwd = tree.cwd;
  tree.loading.add(path);
  renderTree();
  try {
    const data = await api(workspaceApi(cwd, "/files", { path }));
    if (state.tree.cwd !== cwd) return;
    tree.children.set(path, data.entries);
    if (data.truncated) tree.truncated.add(path);
    else tree.truncated.delete(path);
    tree.errors.delete(path);
  } catch (error) {
    if (state.tree.cwd === cwd) tree.errors.set(path, error.message);
  } finally {
    tree.loading.delete(path);
    if (state.tree.cwd === cwd) renderTree();
  }
}

async function openTree(project) {
  const cwd = project.cwd;
  if (state.tree.cwd !== cwd) {
    // Which folders were open is remembered per workspace for this page load.
    const expanded = state.treeExpandedByCwd.get(cwd) ?? new Set();
    state.treeExpandedByCwd.set(cwd, expanded);
    state.tree = {
      cwd,
      children: new Map(),
      expanded,
      loading: new Set(),
      truncated: new Set(),
      errors: new Map(),
      results: null,
      resultsTruncated: false,
    };
  }
  state.tree.results = null;
  $("#fileTreeName").textContent = basename(cwd);
  $("#fileTreeName").title = cwd;
  $("#fileTreeSearch").value = "";
  $("#fileTree").classList.add("open");
  $("#fileTreeSearch").focus();
  await refreshTree();
}

/** Re-read every directory that is on screen, dropping ones that disappeared. */
async function refreshTree() {
  const tree = state.tree;
  if (!tree.cwd) return;
  const paths = ["", ...[...tree.expanded].filter((path) => ancestorPaths(path).every((parent) => tree.expanded.has(parent)))];
  await Promise.all(paths.map((path) => loadTreeDirectory(path)));
  for (const path of [...tree.errors.keys()]) {
    if (!path) continue;
    tree.expanded.delete(path);
    tree.children.delete(path);
    tree.errors.delete(path);
  }
  renderTree();
}

function toggleTreeDirectory(path, expand = !state.tree.expanded.has(path)) {
  const tree = state.tree;
  if (expand) {
    tree.expanded.add(path);
    if (!tree.children.has(path)) {
      void loadTreeDirectory(path);
      return;
    }
  } else {
    tree.expanded.delete(path);
  }
  renderTree();
}

/** Leave search and open the tree down to `path`, loading levels as needed. */
async function revealInTree(path) {
  const tree = state.tree;
  $("#fileTreeSearch").value = "";
  tree.results = null;
  for (const directory of [...ancestorPaths(path), path]) {
    tree.expanded.add(directory);
    if (!tree.children.has(directory)) await loadTreeDirectory(directory);
  }
  renderTree();
  treeRow(path)?.scrollIntoView({ block: "nearest" });
  treeRow(path)?.focus();
}

function treeRow(path) {
  return [...$("#fileTreeBody").querySelectorAll(".file-row")].find((row) => row.dataset.path === path);
}

function buildTreeRow(entry, level, detail = "") {
  const tree = state.tree;
  const directory = entry.kind === "directory";
  const expanded = directory && !tree.results && tree.expanded.has(entry.path);
  const active = state.preview.tabs[state.preview.active];
  const row = document.createElement("div");
  row.className = `file-row${directory ? " directory" : ""}${expanded ? " expanded" : ""}${
    !directory && active?.cwd === tree.cwd && active.path === entry.path ? " active" : ""
  }`;
  row.role = "treeitem";
  row.tabIndex = 0;
  row.dataset.path = entry.path;
  row.dataset.kind = entry.kind;
  row.title = entry.path;
  row.style.paddingLeft = `${6 + level * 14}px`;
  row.setAttribute("aria-level", String(level + 1));
  if (directory && !tree.results) row.setAttribute("aria-expanded", String(expanded));
  const twisty = directory && !tree.results ? icon("chevronRight", "menu") : "";
  row.innerHTML = `<span class="file-twisty">${twisty}</span>${directory ? (expanded ? icon("open", "sm") : icon("folder", "sm")) : ICONS.file}<span class="file-name">${escapeHtml(entry.name)}</span>${detail ? `<small class="file-detail">${escapeHtml(detail)}</small>` : ""}`;
  return row;
}

function appendTreeLevel(body, path, level) {
  const tree = state.tree;
  const entries = tree.children.get(path);
  if (!entries) {
    const text = tree.errors.get(path) ?? (tree.loading.has(path) ? t("loadingTree") : "");
    if (text) body.append(treeNote(text, level));
    return;
  }
  if (!entries.length && path) body.append(treeNote(t("emptyFolder"), level));
  for (const entry of entries) {
    body.append(buildTreeRow(entry, level));
    if (entry.kind === "directory" && tree.expanded.has(entry.path)) appendTreeLevel(body, entry.path, level + 1);
  }
  if (tree.truncated.has(path)) body.append(treeNote(t("listTruncated"), level));
}

function treeNote(text, level) {
  const note = emptyList(text);
  note.classList.add("file-note");
  note.style.paddingLeft = `${24 + level * 14}px`;
  return note;
}

function renderTree() {
  const tree = state.tree;
  const body = $("#fileTreeBody");
  // Rebuilding the rows drops focus; put it back on the same path afterwards.
  const focused = body.contains(document.activeElement) ? document.activeElement.dataset.path : undefined;
  body.replaceChildren();
  if (tree.results) {
    for (const entry of tree.results) {
      const parent = entry.path.includes("/") ? entry.path.slice(0, entry.path.lastIndexOf("/")) : "";
      body.append(buildTreeRow(entry, 0, parent));
    }
    if (!tree.results.length) body.append(emptyList(t("noMatchingFiles")));
    else if (tree.resultsTruncated) body.append(treeNote(t("searchTruncated"), 0));
  } else {
    appendTreeLevel(body, "", 0);
    if (!body.childElementCount) body.append(emptyList(t("emptyFolder")));
  }
  if (focused !== undefined) treeRow(focused)?.focus();
}

let treeSearchTimer = 0;
let treeSearchSequence = 0;

/**
 * Name search runs on the server: with a lazy tree the browser only holds the
 * folders already opened, so a client-side filter would miss most of the repo.
 */
function searchTree(query) {
  window.clearTimeout(treeSearchTimer);
  const sequence = ++treeSearchSequence;
  const tree = state.tree;
  if (!query.trim()) {
    tree.results = null;
    renderTree();
    return;
  }
  treeSearchTimer = window.setTimeout(async () => {
    try {
      const data = await api(workspaceApi(tree.cwd, "/search", { q: query }));
      if (sequence !== treeSearchSequence || state.tree !== tree) return;
      tree.results = data.entries;
      tree.resultsTruncated = data.truncated;
      renderTree();
    } catch (error) {
      showError(error.message);
    }
  }, 160);
}

function activateTreeRow(row) {
  const path = row.dataset.path;
  if (row.dataset.kind === "file") void openFile(state.tree.cwd, path);
  else if (state.tree.results) void revealInTree(path);
  else toggleTreeDirectory(path);
}

function handleTreeKeydown(event) {
  const row = event.target.closest(".file-row");
  if (!row) return;
  const rows = [...$("#fileTreeBody").querySelectorAll(".file-row")];
  const index = rows.indexOf(row);
  const directory = row.dataset.kind === "directory" && !state.tree.results;
  if (event.key === "Enter" || event.key === " ") activateTreeRow(row);
  else if (event.key === "ArrowDown") rows[index + 1]?.focus();
  else if (event.key === "ArrowUp") rows[index - 1]?.focus();
  else if (event.key === "ArrowRight" && directory) toggleTreeDirectory(row.dataset.path, true);
  else if (event.key === "ArrowLeft" && directory && row.classList.contains("expanded")) toggleTreeDirectory(row.dataset.path, false);
  else return;
  event.preventDefault();
}

/* ── File preview ─────────────────────────────────────────────────────── */

const PREVIEW_WIDTH_KEY = "stepcode.previewWidth";
const PREVIEW_WRAP_KEY = "stepcode.previewWrap";
const PREVIEW_MIN = 320;
const PREVIEW_DEFAULT = 560;
/** Above this many characters a file is shown without highlighting. */
const HIGHLIGHT_LIMIT = 300_000;
/** Above this many lines only the head of the file is rendered. */
const PREVIEW_LINE_LIMIT = 10_000;

const KEYWORDS = new Set(
  "abstract and as assert async await break case catch class const continue def default defer del delete do elif else enum except export extends false final finally fn for from func function global go if impl implements import in instanceof interface is lambda let match mod module mut new nil none not null of or package pass private protected pub public raise readonly return self static struct super switch then this throw trait true try type typeof undefined use var void while with yield None True False fi esac done echo local select where insert update create table"
    .split(" "),
);

const STRING_RULE = `"(?:\\\\.|[^"\\\\\\n])*"?|'(?:\\\\.|[^'\\\\\\n])*'?`;
const NUMBER_RULE = "\\b(?:0[xX][\\da-fA-F_]+|\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)\\b";
const WORD_RULE = "[A-Za-z_$][\\w$]*";
const wordClass = (text) => (KEYWORDS.has(text) ? "keyword" : "");

/**
 * One regex per language family, with a class per capture group. This is a
 * colouring aid, not a parser: it knows comments, strings, numbers and a shared
 * keyword list, which is enough to make a file scannable without shipping a
 * grammar per language.
 */
const HIGHLIGHT_FAMILIES = {
  clike: {
    pattern: new RegExp(`(//[^\\n]*|/\\*[\\s\\S]*?(?:\\*/|$))|(${STRING_RULE}|\`(?:\\\\[\\s\\S]|[^\`\\\\])*\`?)|(${NUMBER_RULE})|(${WORD_RULE})`, "g"),
    classes: ["comment", "string", "number", wordClass],
  },
  hash: {
    pattern: new RegExp(`(#[^\\n]*)|("""[\\s\\S]*?(?:"""|$)|'''[\\s\\S]*?(?:'''|$)|${STRING_RULE})|(${NUMBER_RULE})|(${WORD_RULE})`, "g"),
    classes: ["comment", "string", "number", wordClass],
  },
  sql: {
    pattern: new RegExp(`(--[^\\n]*|/\\*[\\s\\S]*?(?:\\*/|$))|(${STRING_RULE})|(${NUMBER_RULE})|(${WORD_RULE})`, "g"),
    classes: ["comment", "string", "number", (text) => wordClass(text.toLowerCase())],
  },
  json: {
    pattern: /("(?:\\.|[^"\\\n])*"(?=\s*:))|("(?:\\.|[^"\\\n])*"?)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g,
    classes: ["key", "string", "number", "keyword"],
  },
  markup: {
    pattern: /(<!--[\s\S]*?(?:-->|$))|(<\/?[A-Za-z][\w:.-]*|\/?>)|("[^"\n]*"|'[^'\n]*')/g,
    classes: ["comment", "tag", "string"],
  },
  markdown: {
    pattern: /(^```[^\n]*\n[\s\S]*?(?:^```[^\n]*$|(?![\s\S])))|(^#{1,6} [^\n]*$)|(`[^`\n]+`)/gm,
    classes: ["string", "keyword", "string"],
  },
};

const LANGUAGE_FAMILIES = {
  clike: "js jsx mjs cjs ts tsx mts cts java c h cc cpp hpp cs go rs swift kt kts scala php dart css scss less proto groovy gradle",
  hash: "py rb sh bash zsh fish yaml yml toml ini conf env properties pl r tf dockerfile makefile mk gitignore npmrc editorconfig",
  sql: "sql",
  json: "json jsonc json5 jsonl map webmanifest",
  markup: "html htm xml svg vue svelte plist",
  markdown: "md markdown mdx",
};

/** The display language of a path: its extension, or its name for dotfiles. */
function fileLanguage(path) {
  const name = basename(path).toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1) : name.replace(/^\./, "");
}

function highlightFamily(language) {
  for (const [family, languages] of Object.entries(LANGUAGE_FAMILIES)) {
    if (languages.split(" ").includes(language)) return HIGHLIGHT_FAMILIES[family];
  }
  return undefined;
}

/** Split `content` into escaped HTML lines, coloured when a family matches. */
function highlightLines(content, language) {
  const lines = [""];
  const push = (text, className) => {
    text.split("\n").forEach((part, index) => {
      if (index) lines.push("");
      if (!part) return;
      const escaped = escapeHtml(part);
      lines[lines.length - 1] += className ? `<span class="tok-${className}">${escaped}</span>` : escaped;
    });
  };
  const family = content.length <= HIGHLIGHT_LIMIT ? highlightFamily(language) : undefined;
  if (!family) {
    push(content, "");
    return lines;
  }
  let cursor = 0;
  for (const match of content.matchAll(family.pattern)) {
    if (!match[0]) continue;
    push(content.slice(cursor, match.index), "");
    const group = match.findIndex((value, index) => index > 0 && value !== undefined) - 1;
    const rule = family.classes[group];
    push(match[0], typeof rule === "function" ? rule(match[0]) : rule);
    cursor = match.index + match[0].length;
  }
  push(content.slice(cursor), "");
  return lines;
}

function formatBytes(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function setPreviewOpen(open) {
  state.preview.open = open;
  $("#previewPanel").hidden = !open;
  $(".app").classList.toggle("preview-open", open);
  $("#previewShow").hidden = open || !state.preview.tabs.length;
}

async function openFile(cwd, path) {
  const preview = state.preview;
  let index = preview.tabs.findIndex((tab) => tab.cwd === cwd && tab.path === path);
  if (index < 0) {
    index = preview.tabs.push({ cwd, path, file: null, error: "", loading: false, rendered: false }) - 1;
  }
  preview.active = index;
  setPreviewOpen(true);
  if (preview.tabs[index].file) renderPreview();
  else await loadPreviewTab(preview.tabs[index]);
}

async function loadPreviewTab(tab) {
  tab.loading = true;
  tab.error = "";
  renderPreview();
  try {
    tab.file = await api(workspaceApi(tab.cwd, "/file", { path: tab.path }));
  } catch (error) {
    tab.file = null;
    tab.error = error.message;
  }
  tab.loading = false;
  renderPreview();
}

function closePreviewTab(index) {
  const preview = state.preview;
  preview.tabs.splice(index, 1);
  if (preview.active >= index) preview.active = Math.max(0, preview.active - 1);
  if (!preview.tabs.length) {
    preview.active = -1;
    setPreviewOpen(false);
  }
  renderPreview();
}

function previewMessage(text) {
  const message = document.createElement("div");
  message.className = "preview-message";
  message.textContent = text;
  return message;
}

function buildCodeView(file) {
  const view = document.createElement("div");
  view.className = `code-view${state.preview.wrap ? " wrap" : ""}`;
  const lines = highlightLines(file.content, fileLanguage(file.path));
  // A trailing newline is the end of the last line, not an extra empty one.
  if (lines.length > 1 && lines.at(-1) === "") lines.pop();
  const shown = lines.slice(0, PREVIEW_LINE_LIMIT);
  view.innerHTML = shown.map((line) => `<div class="code-line">${line || " "}</div>`).join("");
  view.style.setProperty("--line-digits", String(String(shown.length).length));
  if (lines.length > shown.length) view.append(previewMessage(t("linesTruncated", { count: PREVIEW_LINE_LIMIT })));
  return view;
}

function renderPreview() {
  const preview = state.preview;
  const tab = preview.tabs[preview.active];
  const tabs = $("#previewTabs");
  tabs.replaceChildren();
  preview.tabs.forEach((candidate, index) => {
    const button = document.createElement("div");
    button.className = `preview-tab${index === preview.active ? " active" : ""}`;
    button.role = "tab";
    button.tabIndex = 0;
    button.dataset.index = String(index);
    button.title = candidate.path;
    button.setAttribute("aria-selected", String(index === preview.active));
    button.innerHTML = `${ICONS.file}<span>${escapeHtml(basename(candidate.path))}</span><button class="preview-tab-close" type="button" title="${t("closeTab")}" aria-label="${t("closeTab")}">${icon("close-sm", "xs")}</button>`;
    tabs.append(button);
  });
  tabs.querySelector(".preview-tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });

  const body = $("#previewBody");
  body.replaceChildren();
  const file = tab?.file;
  const text = file?.kind === "text";
  const markdown = text && highlightFamily(fileLanguage(file.path)) === HIGHLIGHT_FAMILIES.markdown;
  $("#previewMode").hidden = !markdown;
  $("#previewMode").setAttribute("aria-pressed", String(Boolean(tab?.rendered)));
  $("#previewWrap").hidden = !text || Boolean(markdown && tab.rendered);
  $("#previewWrap").setAttribute("aria-pressed", String(preview.wrap));
  $("#previewCopy").hidden = !text;
  $("#previewReload").hidden = !tab;
  const path = $("#previewPath");
  path.replaceChildren();
  if (tab) {
    // Server paths are relative with "/"; show them in the workspace's own style.
    const separator = tab.cwd.includes("\\") && !tab.cwd.includes("/") ? "\\" : "/";
    const full = `${tab.cwd.replace(/[\\/]+$/, "")}${separator}${tab.path.split("/").join(separator)}`;
    const directory = full.slice(0, -basename(tab.path).length);
    path.innerHTML = `<span><bdi>${escapeHtml(directory)}</bdi></span><strong>${escapeHtml(basename(tab.path))}</strong>${file ? `<small>${formatBytes(file.size)}</small>` : ""}`;
    path.title = full;
  }
  if (state.tree.cwd) {
    for (const row of $("#fileTreeBody").querySelectorAll(".file-row")) {
      row.classList.toggle("active", row.dataset.kind === "file" && tab?.cwd === state.tree.cwd && tab.path === row.dataset.path);
    }
  }
  if (!tab) return;
  if (tab.loading) body.append(previewMessage(t("loadingFile")));
  else if (tab.error) body.append(previewMessage(tab.error));
  else if (file.kind === "image") {
    const image = document.createElement("img");
    image.className = "preview-image";
    image.alt = basename(file.path);
    image.src = workspaceApi(tab.cwd, "/raw", { path: tab.path });
    body.append(image);
  } else if (file.kind === "binary") body.append(previewMessage(t("binaryFile")));
  else if (file.kind === "too-large") body.append(previewMessage(t("fileTooLarge", { size: formatBytes(file.size) })));
  else if (markdown && tab.rendered) {
    const rendered = document.createElement("div");
    rendered.className = "preview-markdown message-body";
    rendered.innerHTML = renderMarkdown(file.content);
    wireCopyActions(rendered);
    body.append(rendered);
  } else body.append(buildCodeView(file));
  body.scrollTop = 0;
}

function previewMaxWidth() {
  return Math.max(PREVIEW_MIN, Math.round(window.innerWidth * 0.6));
}

function applyPreviewWidth(width, persist = true) {
  const resolved = Math.min(previewMaxWidth(), Math.max(PREVIEW_MIN, Math.round(width)));
  $(".app").style.setProperty("--preview-width", `${resolved}px`);
  if (persist) localStorage.setItem(PREVIEW_WIDTH_KEY, String(resolved));
  return resolved;
}

function initPreviewPanel() {
  const stored = Number.parseInt(localStorage.getItem(PREVIEW_WIDTH_KEY) ?? "", 10);
  applyPreviewWidth(Number.isFinite(stored) ? stored : PREVIEW_DEFAULT, false);
  const resizer = $("#previewResizer");
  let originX = 0;
  let originWidth = PREVIEW_DEFAULT;
  resizer.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    resizer.setPointerCapture(event.pointerId);
    $(".app").classList.add("resizing");
    originX = event.clientX;
    originWidth = $("#previewPanel").getBoundingClientRect().width;
  });
  resizer.addEventListener("pointermove", (event) => {
    // The panel sits on the right, so dragging left makes it wider.
    if (resizer.hasPointerCapture(event.pointerId)) applyPreviewWidth(originWidth - (event.clientX - originX), false);
  });
  const finish = (event) => {
    if (!resizer.hasPointerCapture(event.pointerId)) return;
    resizer.releasePointerCapture(event.pointerId);
    $(".app").classList.remove("resizing");
    applyPreviewWidth($("#previewPanel").getBoundingClientRect().width);
  };
  resizer.addEventListener("pointerup", finish);
  resizer.addEventListener("pointercancel", finish);
  resizer.addEventListener("dblclick", () => applyPreviewWidth(PREVIEW_DEFAULT));
  resizer.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.shiftKey ? SIDEBAR_KEYBOARD_STEP_LARGE : SIDEBAR_KEYBOARD_STEP;
    applyPreviewWidth($("#previewPanel").getBoundingClientRect().width + (event.key === "ArrowLeft" ? step : -step));
  });

  $("#previewTabs").addEventListener("click", (event) => {
    const tab = event.target.closest(".preview-tab");
    if (!tab) return;
    const index = Number(tab.dataset.index);
    if (event.target.closest(".preview-tab-close")) closePreviewTab(index);
    else {
      state.preview.active = index;
      renderPreview();
    }
  });
  $("#previewTabs").addEventListener("auxclick", (event) => {
    const tab = event.target.closest(".preview-tab");
    if (tab && event.button === 1) closePreviewTab(Number(tab.dataset.index));
  });
  $("#previewTabs").addEventListener("keydown", (event) => {
    const tab = event.target.closest(".preview-tab");
    if (!tab || event.target !== tab || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    state.preview.active = Number(tab.dataset.index);
    renderPreview();
  });
  $("#previewClose").addEventListener("click", () => setPreviewOpen(false));
  $("#previewShow").addEventListener("click", () => setPreviewOpen(true));
  $("#previewWrap").addEventListener("click", () => {
    state.preview.wrap = !state.preview.wrap;
    localStorage.setItem(PREVIEW_WRAP_KEY, state.preview.wrap ? "1" : "0");
    $("#previewWrap").setAttribute("aria-pressed", String(state.preview.wrap));
    $("#previewBody .code-view")?.classList.toggle("wrap", state.preview.wrap);
  });
  $("#previewMode").addEventListener("click", () => {
    const tab = state.preview.tabs[state.preview.active];
    if (!tab) return;
    tab.rendered = !tab.rendered;
    renderPreview();
  });
  $("#previewReload").addEventListener("click", () => {
    const tab = state.preview.tabs[state.preview.active];
    if (tab) void loadPreviewTab(tab);
  });
  $("#previewCopy").addEventListener("click", () => {
    const file = state.preview.tabs[state.preview.active]?.file;
    if (file?.kind === "text") void copyText(file.content);
  });
}

/* ── Workspaces ───────────────────────────────────────────────────────── */

async function refreshWorkspaces() {
  state.workspaces = (await api("/api/v1/workspaces")).workspaces;
  renderSessionLists();
}

/** Register a folder as a workspace and start a draft conversation in it. */
async function addWorkspace(path) {
  try {
    const workspace = await api("/api/v1/workspaces", { method: "POST", body: JSON.stringify({ path }) });
    await refreshWorkspaces();
    state.foldedProjects.delete(workspace.path);
    startDraft(workspace.path);
    showError(t("workspaceSwitched", { name: workspace.name }), false);
  } catch (error) {
    showError(error.message);
  }
}

/**
 * "Add workspace": the system folder chooser when the Host can open one on
 * this machine, the in-page browser otherwise.
 *
 * The browser cannot open a native chooser that yields a path, so the Host
 * opens it and the request stays pending until the user answers. A failure
 * (helper missing, dialog crashed) falls back to the in-page browser rather
 * than leaving the button dead.
 */
async function chooseWorkspaceFolder() {
  if (state.directoryPicker !== "native") {
    await openWorkspaceBrowser();
    return;
  }
  if (state.pickingFolder) return;
  state.pickingFolder = true;
  $("#addWorkspace").setAttribute("aria-busy", "true");
  try {
    const { path } = await api("/api/v1/workspaces/pick", {
      method: "POST",
      body: JSON.stringify({ title: t("pickWorkspaceFolder"), startIn: state.draftCwd || state.bootstrapCwd }),
    });
    if (path) await addWorkspace(path);
  } catch (error) {
    showError(t("folderPickerFailed", { reason: error.message }));
    await openWorkspaceBrowser();
  } finally {
    state.pickingFolder = false;
    $("#addWorkspace").removeAttribute("aria-busy");
  }
}

async function removeWorkspace(path) {
  if (!window.confirm(t("confirmRemoveWorkspace", { name: basename(path) }))) return;
  try {
    await api(`/api/v1/workspaces?${new URLSearchParams({ path })}`, { method: "DELETE" });
    if (!state.current && state.draftCwd === path) state.draftCwd = state.bootstrapCwd;
    await refreshWorkspaces();
  } catch (error) {
    showError(error.message);
  }
}

function timelineFromEntries(entries = []) {
  const items = [];
  const toolResults = new Map();
  for (const entry of entries) {
    if (entry.type === "message" && entry.message?.role === "toolResult") {
      toolResults.set(entry.message.toolCallId, entry.message);
    }
  }
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (message.role === "toolResult") continue;
    const text = contentText(message.content);
    if (text) {
      items.push({
        itemId: `message-${entry.id}`,
        entryId: entry.id,
        kind: "message",
        role: message.role,
        content: text,
        usage: entry.usage,
        timestamp: entry.timestamp,
      });
    }
    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const block of message.content.filter((part) => part?.type === "toolCall")) {
        const result = toolResults.get(block.id);
        items.push({
          itemId: `tool-${block.id}`,
          kind: "tool",
          state: result?.isError ? "failed" : result ? "completed" : "pending",
          toolName: block.name,
          inputSummary: toolInputSummary(block.arguments),
          outputSummary: result ? compact(contentText(result.content)) : "",
        });
      }
    }
  }
  return items;
}

async function copyText(value, successText = t("copied")) {
  try {
    await navigator.clipboard.writeText(value);
    showError(successText, false);
  } catch {
    showError(t("browserCopyDenied"));
  }
}

/** Topic ids, mirroring FEEDBACK_TOPICS on the server. */
const FEEDBACK_TOPICS = [
  "taskResult",
  "instructionFollowing",
  "productInteraction",
  "stabilitySpeed",
  "resourceCost",
  "safetyPrivacy",
  "other",
];

const FEEDBACK_TOPIC_LABELS = {
  taskResult: "任务结果",
  instructionFollowing: "指令理解与遵循",
  productInteraction: "产品功能与交互",
  stabilitySpeed: "稳定性和速度",
  resourceCost: "资源使用与费用",
  safetyPrivacy: "安全隐私与权限",
  other: "其他",
};

function openFeedback(sentiment) {
  state.feedback ??= { sentiment, topic: null, comment: "" };
  state.feedback.sentiment = sentiment;
  state.feedback.topic = null;
  $("#feedbackComment").value = "";
  renderFeedbackTopics();
  $("#feedbackModal").hidden = false;
  requestAnimationFrame(() => $("#feedbackComment").focus());
}

function closeFeedback() {
  $("#feedbackModal").hidden = true;
}

function renderFeedbackTopics() {
  const box = $("#feedbackTopics");
  box.replaceChildren();
  for (const topic of FEEDBACK_TOPICS) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "feedback-topic";
    chip.textContent = t(`feedbackTopic.${topic}`) === `feedbackTopic.${topic}` ? FEEDBACK_TOPIC_LABELS[topic] : t(`feedbackTopic.${topic}`);
    chip.setAttribute("aria-pressed", state.feedback?.topic === topic ? "true" : "false");
    chip.addEventListener("click", () => {
      state.feedback.topic = state.feedback.topic === topic ? null : topic;
      renderFeedbackTopics();
    });
    box.append(chip);
  }
}

async function submitFeedback() {
  if (!state.current || !state.feedback) return;
  const submit = $("#feedbackSubmit");
  submit.disabled = true;
  try {
    const result = await api(`/api/v1/sessions/${state.current.id}/feedback`, {
      method: "POST",
      body: JSON.stringify({
        sentiment: state.feedback.sentiment,
        comment: $("#feedbackComment").value,
        ...(state.feedback.topic ? { topic: state.feedback.topic } : {}),
      }),
    });
    closeFeedback();
    showError(result.message || t("feedbackSubmitted"));
  } catch (error) {
    showError(error.message);
  } finally {
    submit.disabled = false;
  }
}

async function forkAtEntry(entryId) {
  if (!state.current) return;
  try {
    const result = await api(`/api/v1/sessions/${state.current.id}/fork`, {
      method: "POST",
      body: JSON.stringify({ ...(entryId ? { entryId } : {}) }),
    });
    if (result.cancelled) {
      showError(t("forkCancelled"));
      return;
    }
    // The fork binds a new session underneath; follow it.
    await openSession(result.sessionId);
    await refreshSessions();
  } catch (error) {
    showError(error.message);
  }
}

function wireMessageActions(container) {
  container.querySelectorAll(".vote-up, .vote-down").forEach((button) => {
    button.addEventListener("click", () => {
      const sentiment = button.classList.contains("vote-up") ? "up" : "down";
      const row = button.closest(".message-actions");
      // One vote visible at a time; clicking the active one clears it.
      const already = button.getAttribute("aria-pressed") === "true";
      row.querySelectorAll(".vote-up, .vote-down").forEach((other) => other.setAttribute("aria-pressed", "false"));
      button.setAttribute("aria-pressed", already ? "false" : "true");
      openFeedback(sentiment);
    });
  });
  container.querySelectorAll(".fork-message").forEach((button) => {
    button.addEventListener("click", () => {
      const article = button.closest("article");
      forkAtEntry(article?.dataset.entryId);
    });
  });
}

function wireCopyActions(container) {
  container.querySelectorAll(".copy-message").forEach((button) => {
    button.addEventListener("click", () => void copyText(button.closest(".message").dataset.content));
  });
  container.querySelectorAll(".copy-code").forEach((button) => {
    button.addEventListener("click", () => void copyText(button.closest(".code-block").querySelector("code").textContent));
  });
}

function renderTimeline() {
  const container = $("#streamInner");
  container.replaceChildren();
  if (!state.timelineItems.length) {
    container.innerHTML =
      `<div class="empty-state"><div class="empty-wordmark"><span>STEP</span><strong>CODE</strong></div><p>${t("emptyConversation")}</p></div>`;
    return;
  }
  for (const item of state.timelineItems) {
    if (item.kind === "message") {
      const message = document.createElement("article");
      message.className = `message ${item.role === "user" ? "user" : "assistant"}`;
      message.dataset.content = item.content || "";
      if (item.entryId) message.dataset.entryId = item.entryId;
      message.innerHTML = `<div class="message-body">${renderMarkdown(item.content || t("generating"))}</div>${messageActions(item)}`;
      container.append(message);
      continue;
    }
    if (item.kind === "tool") {
      const tool = document.createElement("div");
      tool.className = `tool-row ${item.state ?? ""}`;
      const result = item.outputSummary ? `<span>·</span><span>${escapeHtml(item.outputSummary)}</span>` : "";
      tool.innerHTML = `${ICONS.tool}<span class="tool-name">${escapeHtml(item.toolName)}</span><span>·</span><span>${escapeHtml(item.inputSummary || "无输入摘要")}</span>${result}`;
      container.append(tool);
      continue;
    }
    if (item.kind === "approval") container.append(buildApproval(item.approval));
  }
  wireCopyActions(container);
  wireMessageActions(container);
  $("#stream").scrollTop = $("#stream").scrollHeight;
  // Derived from the timeline just rendered, so they stay in step with it.
  updateTaskBanner();
  updateUsageTrigger();
}

/**
 * The row under an assistant turn: copy, vote, fork, then what the turn cost and
 * when it happened.
 *
 * Voting opens the feedback dialog rather than firing a silent request — a
 * thumbs-down with no detail is much less useful than one with a topic.
 */
function messageActions(item) {
  if (item.role !== "assistant") return "";
  const tokens = item.usage ? item.usage.input + item.usage.output : 0;
  const usage = tokens
    ? `<span class="message-usage">${icon("gauge", "xs")}${t("usage")} ${formatTokens(tokens)} tok</span>`
    : "";
  const time = item.timestamp ? `<span class="message-time">${escapeHtml(relativeTime(item.timestamp))}</span>` : "";
  return `<div class="message-actions">
    <button class="message-action copy-message" type="button" title="${t("copy")}" aria-label="${t("copy")}">${ICONS.copy}</button>
    <button class="message-action vote-up" type="button" aria-pressed="false" title="${t("feedbackGood")}" aria-label="${t("feedbackGood")}">${icon("thumbsUp", "sm")}</button>
    <button class="message-action vote-down" type="button" aria-pressed="false" title="${t("feedbackBad")}" aria-label="${t("feedbackBad")}">${icon("thumbsDown", "sm")}</button>
    <button class="message-action fork-message" type="button" title="${t("forkHere")}" aria-label="${t("forkHere")}">${icon("fork", "sm")}</button>
    ${usage}${time}
  </div>`;
}

/** 45.9K rather than 45900, so the row stays one line. */
function formatTokens(count) {
  if (count < 1000) return String(count);
  const kilo = count / 1000;
  return `${kilo >= 100 ? Math.round(kilo) : kilo.toFixed(1)}K`;
}

function buildApproval(approval) {
  const panel = document.createElement("div");
  panel.className = "approval";
  const preview = approval.preview
    ? `\n${approval.preview.path ? `路径：${approval.preview.path}\n` : ""}${approval.preview.before ? `修改前：${compact(approval.preview.before, 240)}\n` : ""}${approval.preview.after ? `修改后：${compact(approval.preview.after, 240)}` : ""}`
    : "";
  panel.innerHTML = `<strong>${escapeHtml(approval.toolName)} · ${t("approvalWaiting")}</strong><p>${escapeHtml(`${approval.message}${preview}`)}</p><div class="approval-actions"><button data-verdict="deny" type="button">${t("deny")}</button><button data-verdict="approve" type="button">${t("approveOnce")}</button><button class="approve" data-verdict="approve_for_session" type="button">${t("approveSession")}</button></div>`;
  panel.querySelectorAll("[data-verdict]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await api(`/api/v1/sessions/${state.current.id}/approvals/decision`, {
          method: "POST",
          body: JSON.stringify({ id: approval.id, verdict: button.dataset.verdict }),
        });
        panel.querySelector(".approval-actions").replaceChildren();
        panel.querySelector("strong").textContent =
          button.dataset.verdict === "deny"
            ? `${approval.toolName} · ${t("denied")}`
            : `${approval.toolName} · ${t("approved")}`;
      } catch (error) {
        showError(error.message);
      }
    });
  });
  return panel;
}

function mergeSessionSummary(snapshot) {
  const index = state.sessions.findIndex((session) => session.id === snapshot.id);
  if (index >= 0) state.sessions[index] = { ...state.sessions[index], ...snapshot };
  else state.sessions.unshift(snapshot);
}

/**
 * Open/close behaviour shared by every composer popover.
 *
 * Returns a handle so callers only supply `render()`, which refills the panel
 * each time it opens. Dismissal is centralised here rather than repeated per
 * picker: outside pointerdown, Escape, and losing focus to another control.
 */
function setupPopover(trigger, popover, render) {
  const close = () => {
    if (popover.hidden) return;
    popover.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  };
  const open = () => {
    // One panel at a time: opening this one closes any sibling.
    for (const other of $$(".control-popover")) {
      if (other !== popover && !other.hidden) other.dispatchEvent(new CustomEvent("controlpopover:close"));
    }
    render();
    popover.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
  };
  trigger.addEventListener("click", () => (popover.hidden ? open() : close()));
  popover.addEventListener("controlpopover:close", close);
  document.addEventListener("pointerdown", (event) => {
    if (popover.hidden) return;
    if (popover.contains(event.target) || trigger.contains(event.target)) return;
    close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !popover.hidden) {
      close();
      trigger.focus();
    }
  });
  return { open, close };
}

/** One row in a composer popover: icon, title, description, optional trailing slot. */
function controlOption({ id, icon: iconName, title, description, meta, selected, pinned, onPin, onSelect }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "control-option";
  button.setAttribute("role", "option");
  button.setAttribute("aria-selected", selected ? "true" : "false");
  if (iconName) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "icon icon--md control-option-icon");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#i-${iconName}`);
    svg.append(use);
    button.append(svg);
  }
  const body = document.createElement("span");
  body.className = "control-option-body";
  const titleRow = document.createElement("span");
  titleRow.className = "control-option-title";
  titleRow.textContent = title;
  body.append(titleRow);
  if (description) {
    const desc = document.createElement("span");
    desc.className = "control-option-desc";
    desc.textContent = description;
    body.append(desc);
  }
  if (meta?.length) {
    const metaRow = document.createElement("span");
    metaRow.className = "control-option-meta";
    metaRow.textContent = meta.join(" · ");
    body.append(metaRow);
  }
  button.append(body);
  if (onPin) {
    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = "control-option-pin";
    pin.setAttribute("aria-pressed", pinned ? "true" : "false");
    pin.title = pinned ? t("unpin") : t("pin");
    pin.innerHTML = icon("star");
    pin.addEventListener("click", (event) => {
      event.stopPropagation();
      onPin();
    });
    button.append(pin);
  }
  if (selected) {
    const check = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    check.setAttribute("class", "icon icon--sm control-option-check");
    check.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#i-check");
    check.append(use);
    button.append(check);
  }
  button.addEventListener("click", () => onSelect(id));
  return button;
}

/** An empty-state row for a popover that has nothing to show. */
function hint(text) {
  const row = document.createElement("div");
  row.className = "control-popover-empty";
  row.textContent = text;
  return row;
}

/** A muted explanatory line, as opposed to an empty-state hint. */
function note(text) {
  const row = document.createElement("div");
  row.className = "control-popover-note";
  row.textContent = text;
  return row;
}

/** Human-readable model metadata for the picker rows. */
function modelMeta(model) {
  const meta = [];
  if (model.contextWindow) meta.push(`${Math.round(model.contextWindow / 1000)}K 上下文`);
  if (model.maxTokens) meta.push(`${Math.round(model.maxTokens / 1000)}K 输出`);
  if (model.input?.includes("image")) meta.push("支持图片");
  return meta;
}

/** Icons and copy for each permission preset, keyed by the kernel's preset id. */
const POLICY_ICONS = {
  ask: "shield",
  "read-only": "eye",
  bypass: "zap",
  autopilot: "loop",
};

/** t() with an explicit fallback, for strings the kernel already supplies. */
function tOr(key, fallback) {
  const value = t(key);
  return value === key ? fallback : value;
}

function policyLabel(preset) {
  return tOr(`policy.${preset.id}.label`, preset.label);
}

function policyDescription(preset) {
  return tOr(`policy.${preset.id}.description`, preset.description);
}

function renderPolicies(snapshot) {
  const presets = snapshot.policies ?? [];
  const current = snapshot.permissionPreset ?? state.draftPolicy;
  const triggerIcon = $("#policyTrigger").querySelector("use");
  if (triggerIcon) triggerIcon.setAttribute("href", `#i-${POLICY_ICONS[current] ?? "shield"}`);
  $("#policyLabel").textContent = tOr(`policy.${current}.label`, t(current));
  const popover = $("#policyPopover");
  popover.replaceChildren();
  if (!presets.length) {
    popover.append(hint(t("noPolicies")));
    return;
  }
  for (const preset of presets) {
    popover.append(
      controlOption({
        id: preset.id,
        icon: POLICY_ICONS[preset.id],
        title: policyLabel(preset),
        description: policyDescription(preset),
        selected: preset.id === current,
        onSelect: (id) => {
          state.draftPolicy = id;
          $("#policyMenu").dispatchEvent(new CustomEvent("policychange", { detail: { preset: id } }));
          policyPopover.close();
        },
      }),
    );
  }
}

const policyPopover = setupPopover($("#policyTrigger"), $("#policyPopover"), () => {
  renderPolicies(state.current ?? { policies: state.policiesCache ?? [], permissionPreset: state.draftPolicy });
});

/** How many models the compact view shows before deferring to "more models". */
const COMPACT_MODEL_COUNT = 4;

/** Model ids the user pinned, kept locally so they survive a session change. */
const PINNED_MODELS_KEY = "stepcode.pinnedModels";

function pinnedModels() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PINNED_MODELS_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function togglePinnedModel(key) {
  const current = pinnedModels();
  const next = current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key];
  localStorage.setItem(PINNED_MODELS_KEY, JSON.stringify(next));
  return next;
}

const modelKey = (model) => `${model.provider}\u0000${model.id}`;

function groupLabel(text) {
  const row = document.createElement("div");
  row.className = "control-popover-group";
  row.textContent = text;
  return row;
}

/**
 * One panel for model and thinking effort, in two views.
 *
 * They are chosen together — effort is a property of a model, and the kernel
 * only exposes the levels a given model supports — so splitting them into two
 * popovers meant guessing the effort before knowing the model.
 *
 * The default view stays short: a few models, the effort as a segmented
 * control, and a "more models" row. Search and pinning live behind that row,
 * because a catalog of five needs neither and a catalog of fifty needs both —
 * and putting them on the first screen made the common case look like a
 * database query.
 */
function renderModelPicker(snapshot) {
  const models = snapshot.models ?? [];
  const pinned = pinnedModels();
  const levels = snapshot.availableThinkingLevels ?? [];
  const currentKey = snapshot.model ? modelKey(snapshot.model) : "";
  const active = models.find((model) => modelKey(model) === currentKey);
  const effort = snapshot.thinkingLevel;

  const effortSuffix = effort ? ` · ${t(EFFORT_LABELS[effort] ?? effort)}` : "";
  $("#modelLabel").textContent = `${active?.name ?? (currentKey ? snapshot.model.id : t("defaultModel"))}${effortSuffix}`;

  const popover = $("#modelPopover");
  popover.replaceChildren();

  const list = document.createElement("div");
  popover.append(list);

  /** Model rows for one set of candidates, with optional pin toggles. */
  const paintRows = (candidates, { pinnable }) => {
    list.replaceChildren();
    if (!candidates.length) {
      list.append(hint(t("noModels")));
      return;
    }
    let othersLabelled = false;
    for (const model of candidates) {
      const key = modelKey(model);
      if (!othersLabelled && !pinned.includes(key)) {
        list.append(groupLabel(t("others")));
        othersLabelled = true;
      }
      list.append(
        controlOption({
          id: key,
          icon: "cube",
          title: model.name || model.id,
          description: model.id,
          meta: modelMeta(model),
          selected: key === currentKey,
          pinned: pinnable ? pinned.includes(key) : false,
          onPin: pinnable
            ? () => {
                togglePinnedModel(key);
                paintRows(currentCandidates(), { pinnable });
              }
            : undefined,
          onSelect: (value) => selectModel(value),
        }),
      );
    }
  };

  /**
   * The short list: whatever is pinned, then the active model, then enough of
   * the rest to fill the panel. Capped so a large catalog does not turn the
   * default view into a scroll.
   */
  const compactCandidates = () => {
    const chosen = models.filter((model) => pinned.includes(modelKey(model)));
    if (active && !chosen.includes(active)) chosen.push(active);
    for (const model of models) {
      if (chosen.length >= COMPACT_MODEL_COUNT) break;
      if (!chosen.includes(model)) chosen.push(model);
    }
    return chosen;
  };

  const currentCandidates = () =>
    state.modelPanelView === "all" ? [...models] : compactCandidates();

  if (state.modelPanelView === "all") {
    const search = document.createElement("div");
    search.className = "control-popover-search";
    search.innerHTML = icon("search", "sm");
    const input = document.createElement("input");
    input.type = "search";
    input.placeholder = t("searchModels");
    input.setAttribute("aria-label", t("searchModels"));
    search.append(input);
    popover.prepend(search);

    const filter = (query) => {
      const needle = query.trim().toLowerCase();
      paintRows(
        models.filter(
          (model) =>
            !needle ||
            model.id.toLowerCase().includes(needle) ||
            (model.name ?? "").toLowerCase().includes(needle) ||
            model.provider.toLowerCase().includes(needle),
        ),
        { pinnable: true },
      );
    };
    input.addEventListener("input", () => filter(input.value));
    filter("");
    requestAnimationFrame(() => input.focus());
  } else {
    paintRows(compactCandidates(), { pinnable: false });
  }

  const effortSection = document.createElement("div");
  effortSection.className = "control-popover-section";
  popover.append(effortSection);
  const paintEffort = () => {
    effortSection.replaceChildren();
    const label = document.createElement("span");
    label.className = "control-segmented-label";
    label.textContent = t("thinkingEffort");
    const group = document.createElement("div");
    group.className = "control-segmented-group";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", t("thinkingEffort"));
    if (!levels.length) {
      // No levels means the model cannot adjust effort at all; say so rather
      // than rendering an empty row of buttons.
      const none = document.createElement("span");
      none.className = "control-segment-none";
      none.textContent = t("effortUnsupported");
      group.append(none);
    } else {
      for (const level of levels) {
        const segment = document.createElement("button");
        segment.type = "button";
        segment.className = "control-segment";
        segment.textContent = t(EFFORT_LABELS[level] ?? level);
        segment.setAttribute("aria-pressed", level === effort ? "true" : "false");
        segment.addEventListener("click", () => selectEffort(level));
        group.append(segment);
      }
    }
    effortSection.append(label, group);
  };

  /**
   * Applying a model re-renders the panel rather than closing it, so the effort
   * list below immediately reflects the model just chosen.
   */
  async function selectModel(value) {
    const [provider, modelId] = value.split("\u0000");
    state.draftModel = value;
    if (!state.current) return;
    try {
      const next = await api(`/api/v1/sessions/${state.current.id}/model`, {
        method: "PATCH",
        body: JSON.stringify({ provider, modelId }),
      });
      renderSnapshot(next);
      if (!$("#modelPopover").hidden) renderModelPicker(next);
    } catch (error) {
      showError(error.message);
    }
  }

  async function selectEffort(value) {
    if (!state.current) return;
    try {
      const next = await api(`/api/v1/sessions/${state.current.id}/thinking`, {
        method: "PATCH",
        body: JSON.stringify({ level: value }),
      });
      renderSnapshot(next);
      modelPopover.close();
    } catch (error) {
      showError(error.message);
    }
  }

  paintEffort();

  if (state.modelPanelView === "all") {
    const back = document.createElement("button");
    back.type = "button";
    back.className = "control-popover-more";
    back.innerHTML = `${icon("chevronLeft", "sm")}<span>${t("backToModels")}</span>`;
    back.addEventListener("click", () => {
      state.modelPanelView = "compact";
      renderModelPicker(state.current ?? { models: [] });
    });
    popover.append(back);
    return;
  }

  popover.append(note(t("modelSwitchHint")));
  if (models.length > COMPACT_MODEL_COUNT) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "control-popover-more";
    more.innerHTML = `${icon("layers", "sm")}<span>${t("moreModels")}</span>${icon("chevronRight", "sm")}`;
    more.addEventListener("click", () => {
      state.modelPanelView = "all";
      renderModelPicker(state.current ?? { models: [] });
    });
    popover.append(more);
  }
}

/** Effort labels, keyed by the kernel's thinking level ids. */
const EFFORT_LABELS = {
  off: "effortOff",
  minimal: "effortMinimal",
  low: "effortLow",
  medium: "effortMedium",
  high: "effortHigh",
  xhigh: "effortXhigh",
  max: "effortMax",
};

const modelPopover = setupPopover($("#modelTrigger"), $("#modelPopover"), () => {
  // Always open on the short view; "more models" is a deliberate step.
  state.modelPanelView = "compact";
  renderModelPicker(state.current ?? { models: [] });
});

/**
 * Session modes. Each is independent, so the picker is a set of toggles rather
 * than a radio group: goal + plan + ultraloop can all be on at once.
 *
 * `state.modes` is the UI's record of what the user asked for. The extensions
 * own the real state but expose no query API to an embedder, so the UI cannot
 * read it back — a session restored from disk starts with everything off.
 */
const MODES = [
  { id: "goal", icon: "target", labelKey: "modeGoal", descKey: "modeGoalDesc" },
  { id: "plan", icon: "listCheck", labelKey: "modePlan", descKey: "modePlanDesc" },
  { id: "ultraloop", icon: "orbit", labelKey: "modeUltraloop", descKey: "modeUltraloopDesc" },
];

function renderModePicker() {
  const active = MODES.filter((mode) => state.modes[mode.id]);
  $("#modeLabel").textContent = active.length ? active.map((mode) => t(mode.labelKey)).join(" + ") : t("modes");
  const popover = $("#modePopover");
  popover.replaceChildren();
  popover.append(groupLabel(t("modes")));
  for (const mode of MODES) {
    popover.append(
      controlOption({
        id: mode.id,
        icon: mode.icon,
        title: t(mode.labelKey),
        description: t(mode.descKey),
        selected: !!state.modes[mode.id],
        onSelect: (id) => toggleMode(id),
      }),
    );
  }
  popover.append(groupLabel(t("modeHint")));
  if (state.modes.goal) {
    const row = document.createElement("div");
    row.className = "control-popover-goal";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = t("goalPlaceholder");
    input.value = state.goalDraft ?? "";
    input.addEventListener("input", () => {
      state.goalDraft = input.value;
    });
    row.append(input);
    popover.append(row);
  }
}

async function toggleMode(id) {
  const next = !state.modes[id];
  state.modes[id] = next;
  if (id === "goal" && next) {
    // Goal needs text; keep the panel open so it can be typed before sending.
    renderModePicker();
    return;
  }
  modePopover.close();
  if (!state.current) return;
  try {
    // The server accepts the toggle and runs the slash command in the
    // background, so there is no snapshot to render from the response.
    await api(`/api/v1/sessions/${state.current.id}/mode`, {
      method: "PATCH",
      body: JSON.stringify({ mode: id, enabled: next, goal: state.goalDraft }),
    });
    if (id === "goal" && next) state.goalDraft = "";
  } catch (error) {
    state.modes[id] = !next;
    showError(error.message);
  }
  renderModePicker();
}

const modePopover = setupPopover($("#modeTrigger"), $("#modePopover"), renderModePicker);

/** Attachments staged for the next message, cleared once it is sent. */
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error(t("attachmentUnreadable")));
    reader.readAsDataURL(file);
  });
}

async function addAttachments(files) {
  for (const file of files) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      showError(t("attachmentTooLarge"));
      continue;
    }
    try {
      state.attachments.push({
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        data: await readFileAsBase64(file),
        kind: file.type.startsWith("image/") ? "image" : "text",
      });
    } catch (error) {
      showError(error.message || t("attachmentUnreadable"));
    }
  }
  renderAttachments();
}

function renderAttachments() {
  const list = $("#attachmentList");
  list.replaceChildren();
  list.hidden = !state.attachments.length;
  state.attachments.forEach((attachment, index) => {
    const chip = document.createElement("span");
    chip.className = "attachment-chip";
    const name = document.createElement("span");
    name.textContent = attachment.name;
    name.title = attachment.name;
    chip.append(name);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.title = t("removeAttachment");
    remove.setAttribute("aria-label", t("removeAttachment"));
    remove.innerHTML = icon("close-sm", "xs");
    remove.addEventListener("click", () => {
      state.attachments.splice(index, 1);
      renderAttachments();
    });
    chip.append(remove);
    list.append(chip);
  });
}

$("#attachButton").addEventListener("click", () => $("#attachInput").click());
$("#attachInput").addEventListener("change", async (event) => {
  const files = [...(event.target.files ?? [])];
  event.target.value = "";
  if (files.length) await addAttachments(files);
});

function populateModels(snapshot) {
  // Model and effort share one panel, so there is only one thing to paint.
  renderModelPicker(snapshot);
}

function renderSnapshot(snapshot) {
  state.current = snapshot;
  if (snapshot.policies) state.policiesCache = snapshot.policies;
  state.draftCwd = snapshot.cwd;
  state.draftPolicy = snapshot.permissionPreset || "ask";
  state.draftModel = snapshot.model ? `${snapshot.model.provider}\u0000${snapshot.model.id}` : "";
  state.statusById.set(snapshot.id, snapshot.status);
  state.unreadById.set(snapshot.id, false);
  mergeSessionSummary(snapshot);
  state.timelineItems = timelineFromEntries(snapshot.entries);
  $("#stopRun").hidden = snapshot.status !== "running";
  $("#sendButton").disabled = snapshot.status === "waiting";
  $("#prompt").disabled = snapshot.status === "waiting";
  renderPreferenceControls();
  populateModels(snapshot);
  renderTimeline();
  renderSessionLists();
}

function connectStream(id) {
  state.stream?.close();
  const stream = new EventSource(`/api/v1/sessions/${id}/events`);
  state.stream = stream;
  stream.addEventListener("snapshot", (event) => renderSnapshot(JSON.parse(event.data)));
  stream.addEventListener("agent", (event) => {
    const agentEvent = JSON.parse(event.data).event;
    if (agentEvent.type === "message_update") {
      const text = contentText(agentEvent.message?.content);
      const last = state.timelineItems.at(-1);
      if (last?.kind === "message" && last.itemId === "message-live") last.content = text;
      else state.timelineItems.push({ itemId: "message-live", kind: "message", role: "assistant", content: text });
      renderTimeline();
    }
    if (agentEvent.type === "tool_execution_start") {
      state.timelineItems.push({
        itemId: `tool-${agentEvent.toolCallId}`,
        kind: "tool",
        state: "pending",
        toolName: agentEvent.toolName,
        inputSummary: toolInputSummary(agentEvent.args),
        outputSummary: "",
      });
      renderTimeline();
    }
    if (agentEvent.type === "tool_execution_update") {
      const item = state.timelineItems.find((candidate) => candidate.itemId === `tool-${agentEvent.toolCallId}`);
      if (item) item.outputSummary = compact(contentText(agentEvent.partialResult?.content));
      renderTimeline();
    }
    if (agentEvent.type === "tool_execution_end") {
      const item = state.timelineItems.find((candidate) => candidate.itemId === `tool-${agentEvent.toolCallId}`);
      if (item) {
        item.state = agentEvent.isError ? "failed" : "completed";
        item.outputSummary = compact(contentText(agentEvent.result?.content) || JSON.stringify(agentEvent.result ?? {}));
      }
      renderTimeline();
    }
    if (
      agentEvent.type === "message_end" ||
      agentEvent.type === "entry_appended" ||
      agentEvent.type === "session_info_changed" ||
      agentEvent.type === "agent_settled"
    ) {
      void refreshCurrent();
      void refreshSessions();
    }
  });
  stream.addEventListener("status", (event) => {
    const payload = JSON.parse(event.data);
    state.statusById.set(id, payload.status);
    state.unreadById.set(id, payload.unread);
    if (state.current?.id === id) {
      state.current = { ...state.current, status: payload.status, unread: payload.unread };
      $("#stopRun").hidden = payload.status !== "running";
      $("#prompt").disabled = payload.status === "waiting";
      $("#sendButton").disabled = payload.status === "waiting";
    }
    renderSessionLists();
  });
  stream.addEventListener("approval_required", (event) => {
    const approval = JSON.parse(event.data).approval;
    state.timelineItems.push({ itemId: `approval-${approval.id}`, kind: "approval", approval });
    renderTimeline();
  });
  stream.addEventListener("web_error", (event) => showError(JSON.parse(event.data).message || "运行错误"));
  stream.onerror = () => window.setTimeout(() => void refreshCurrent(), 600);
}

async function refreshSessions() {
  const data = await api("/api/v1/sessions");
  state.sessions = data.sessions;
  renderSessionLists();
}

async function refreshCurrent() {
  if (!state.current) return;
  renderSnapshot(await api(`/api/v1/sessions/${state.current.id}`));
}

async function openSession(id) {
  try {
    const snapshot = await api(`/api/v1/sessions/${id}`);
    renderSnapshot(snapshot);
    connectStream(id);
  } catch (error) {
    showError(error.message);
  }
}

function startDraft(cwd = state.bootstrapCwd) {
  if (state.current) {
    state.draftPolicy = state.current.permissionPreset || state.draftPolicy;
    state.draftModel = state.current.model ? `${state.current.model.provider}\u0000${state.current.model.id}` : state.draftModel;
  }
  state.stream?.close();
  state.stream = null;
  state.current = null;
  state.timelineItems = [];
  state.draftCwd = cwd || state.bootstrapCwd;
  $("#stopRun").hidden = true;
  $("#prompt").disabled = false;
  $("#sendButton").disabled = false;
  renderPreferenceControls();
  renderTimeline();
  renderSessionLists();
  $("#prompt").focus();
}

async function createSessionIfNeeded() {
  if (state.current) return state.current;
  let snapshot = await api("/api/v1/sessions", {
    method: "POST",
    body: JSON.stringify({ cwd: state.draftCwd || state.bootstrapCwd }),
  });
  if (state.draftPolicy && snapshot.permissionPreset !== state.draftPolicy) {
    snapshot = await api(`/api/v1/sessions/${snapshot.id}/policy`, {
      method: "PATCH",
      body: JSON.stringify({ preset: state.draftPolicy }),
    });
  }
  if (state.draftModel) {
    const [provider, modelId] = state.draftModel.split("\u0000");
    if (provider && modelId && (snapshot.model?.provider !== provider || snapshot.model?.id !== modelId)) {
      snapshot = await api(`/api/v1/sessions/${snapshot.id}/model`, {
        method: "PATCH",
        body: JSON.stringify({ provider, modelId }),
      });
    }
  }
  renderSnapshot(snapshot);
  connectStream(snapshot.id);
  await refreshSessions();
  return snapshot;
}

function showError(message, danger = true) {
  const toast = $("#errorToast");
  toast.textContent = message;
  toast.dataset.tone = danger ? "danger" : "neutral";
  toast.hidden = false;
  window.clearTimeout(state.errorTimer);
  state.errorTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 4200);
}

function toggleUserMenu(force) {
  const popover = $("#userPopover");
  const open = force ?? popover.hidden;
  popover.hidden = !open;
  $("#userMenuButton").setAttribute("aria-expanded", String(open));
  if (!open) closePreferenceSubmenus();
}

function closePreferenceSubmenus() {
  $("#themeSubmenu").hidden = true;
  $("#languageSubmenu").hidden = true;
  $("#themeMenuItem").setAttribute("aria-expanded", "false");
  $("#languageMenuItem").setAttribute("aria-expanded", "false");
}

function togglePreferenceSubmenu(kind) {
  const target = kind === "theme" ? $("#themeSubmenu") : $("#languageSubmenu");
  const other = kind === "theme" ? $("#languageSubmenu") : $("#themeSubmenu");
  const trigger = kind === "theme" ? $("#themeMenuItem") : $("#languageMenuItem");
  const otherTrigger = kind === "theme" ? $("#languageMenuItem") : $("#themeMenuItem");
  const open = target.hidden;
  other.hidden = true;
  otherTrigger.setAttribute("aria-expanded", "false");
  target.hidden = !open;
  trigger.setAttribute("aria-expanded", String(open));
}

/**
 * Report the credential the Web UI is borrowing.
 *
 * StepCode Web deliberately has no login screen: signing in is a terminal
 * action that writes auth.json, and the host reads the same file the CLI does.
 * So this section explains the source and names the command, rather than
 * offering a field that could not do anything.
 */
function renderLoginStatus() {
  const summary = $("#loginSummary");
  const note = $("#loginNote");
  if (!summary || !note) return;
  const login = state.login;
  summary.textContent = login?.configured
    ? t("loginConfigured", {
        provider: login.provider ?? "step",
        profile: login.profile ? t("loginProfileSuffix", { profile: login.profile }) : "",
      })
    : t("loginNone");
  note.textContent = login?.configured
    ? login.source === "environment"
      ? t("loginFromEnvironment")
      : t("loginFromFile", { path: login.path ?? "" })
    : t("loginHint");
  $("#loginCommand").textContent = login?.loginCommand ?? "step login";
}

function openSettings() {
  $("#settingsModal").hidden = false;
  toggleUserMenu(false);
  renderPreferenceControls();
}

function closeSettings() {
  $("#settingsModal").hidden = true;
}

async function logout() {
  if (!window.confirm(t("confirmLogout"))) return;
  try {
    await api("/auth/logout", { method: "POST", body: "{}" });
    state.stream?.close();
    toggleUserMenu(false);
    $("#loggedOutOverlay").hidden = false;
  } catch (error) {
    showError(error.message);
  }
}

async function interruptCurrent() {
  if (!state.current || state.current.status !== "running") return;
  try {
    await api(`/api/v1/sessions/${state.current.id}/interrupt`, { method: "POST" });
  } catch (error) {
    showError(error.message);
  }
}

/** Composer growth limits, read once from CSS so the knobs stay in :root. */
function readCssPx(selector, name, fallback) {
  const value = Number.parseInt(getComputedStyle($(selector)).getPropertyValue(name), 10);
  return Number.isFinite(value) ? value : fallback;
}
const TEXTAREA_MIN_H = readCssPx("#prompt", "--textarea-min-h", 64);
const TEXTAREA_MAX_H = readCssPx("#prompt", "--textarea-max-h", 320);

function resizePrompt() {
  const prompt = $("#prompt");
  // Reset first so a shrinking value is measured against the minimum, not the
  // previously grown height.
  prompt.style.height = `${TEXTAREA_MIN_H}px`;
  prompt.style.height = `${Math.min(TEXTAREA_MAX_H, Math.max(TEXTAREA_MIN_H, prompt.scrollHeight))}px`;
}

const SIDEBAR_WIDTH_KEY = "stepcode.sidebarWidth";
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 480;
const SIDEBAR_DEFAULT = 260;
const SIDEBAR_KEYBOARD_STEP = 8;
const SIDEBAR_KEYBOARD_STEP_LARGE = 32;

function sidebarMaxWidth() {
  return Math.min(SIDEBAR_MAX, Math.round(window.innerWidth * 0.6));
}

function clampSidebarWidth(width) {
  return Math.min(sidebarMaxWidth(), Math.max(SIDEBAR_MIN, Math.round(width)));
}

/**
 * The width actually applied, *not* re-clamped. Callers compare this against a
 * freshly clamped value to decide whether anything changed, so clamping here
 * would hide a width that has grown past the current viewport limit.
 */
function currentSidebarWidth() {
  const raw = getComputedStyle($(".app")).getPropertyValue("--sidebar-width");
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : SIDEBAR_DEFAULT;
}

function applySidebarWidth(width, persist = true) {
  const resolved = clampSidebarWidth(width);
  $(".app").style.setProperty("--sidebar-width", `${resolved}px`);
  const resizer = $("#sidebarResizer");
  if (resizer) {
    resizer.setAttribute("aria-valuenow", String(resolved));
    resizer.setAttribute("aria-valuemax", String(sidebarMaxWidth()));
  }
  if (persist) localStorage.setItem(SIDEBAR_WIDTH_KEY, String(resolved));
  return resolved;
}

function initSidebarResizer() {
  const resizer = $("#sidebarResizer");
  const app = $(".app");
  if (!resizer || !app) return;
  // Guard against a second call double-binding every handler below.
  if (initSidebarResizer.done) return;
  initSidebarResizer.done = true;

  const stored = Number.parseInt(localStorage.getItem(SIDEBAR_WIDTH_KEY) ?? "", 10);
  if (Number.isFinite(stored)) applySidebarWidth(stored, false);

  let originX = 0;
  let originWidth = SIDEBAR_DEFAULT;

  resizer.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    resizer.setPointerCapture(event.pointerId);
    resizer.classList.add("dragging");
    app.classList.add("resizing");
    originX = event.clientX;
    originWidth = currentSidebarWidth();
    document.body.style.cursor = "col-resize";
  });

  resizer.addEventListener("pointermove", (event) => {
    if (!resizer.hasPointerCapture(event.pointerId)) return;
    applySidebarWidth(originWidth + (event.clientX - originX), false);
  });

  const finish = (event) => {
    if (!resizer.hasPointerCapture(event.pointerId)) return;
    resizer.releasePointerCapture(event.pointerId);
    resizer.classList.remove("dragging");
    app.classList.remove("resizing");
    document.body.style.cursor = "";
    applySidebarWidth(currentSidebarWidth());
  };
  resizer.addEventListener("pointerup", finish);
  resizer.addEventListener("pointercancel", finish);

  resizer.addEventListener("dblclick", () => applySidebarWidth(SIDEBAR_DEFAULT));

  // A width remembered on a wide window must not survive into a narrow one, and
  // the narrow-viewport media query cannot win against the inline variable.
  window.addEventListener("resize", () => {
    const current = currentSidebarWidth();
    const clamped = clampSidebarWidth(current);
    if (clamped !== current) applySidebarWidth(clamped, false);
  });

  resizer.addEventListener("keydown", (event) => {
    const width = currentSidebarWidth();
    const step = event.shiftKey ? SIDEBAR_KEYBOARD_STEP_LARGE : SIDEBAR_KEYBOARD_STEP;
    let next;
    if (event.key === "ArrowLeft") next = width - step;
    else if (event.key === "ArrowRight") next = width + step;
    else if (event.key === "Home") next = SIDEBAR_MIN;
    else if (event.key === "End") next = sidebarMaxWidth();
    else return;
    event.preventDefault();
    applySidebarWidth(next);
  });
}

$("#sidebarToggle").addEventListener("click", () => $(".app").classList.toggle("sidebar-hidden"));
$("#sidebarShow").addEventListener("click", () => $(".app").classList.toggle("sidebar-hidden"));
$("#authBannerReload").addEventListener("click", () => location.reload());
$("#feedbackClose").addEventListener("click", closeFeedback);
$("#feedbackModal").addEventListener("click", (event) => {
  if (event.target === $("#feedbackModal")) closeFeedback();
});
$("#feedbackSubmit").addEventListener("click", () => void submitFeedback());
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("#feedbackModal").hidden) closeFeedback();
});
$("#newSession").addEventListener("click", () => startDraft(state.current?.cwd || state.draftCwd || state.bootstrapCwd));
$("#searchPlaceholder").addEventListener("click", openSearch);
$("#searchClose").addEventListener("click", closeSearch);
$("#searchModal").addEventListener("click", (event) => {
  if (event.target === $("#searchModal")) closeSearch();
});
$("#globalSearchInput").addEventListener("input", (event) => {
  state.searchIndex = -1;
  renderSearchResults(event.target.value);
});
const searchIme = enterGuard($("#globalSearchInput"));
$("#globalSearchInput").addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveSearchSelection(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    moveSearchSelection(-1);
  } else if (event.key === "Enter" && !searchIme(event)) {
    event.preventDefault();
    openSelectedSearchResult();
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeSearch();
  }
});
$("#archiveToggle").addEventListener("click", toggleArchived);
$("#userMenuButton").addEventListener("click", () => toggleUserMenu());
$("#themeMenuItem").addEventListener("click", () => togglePreferenceSubmenu("theme"));
$("#languageMenuItem").addEventListener("click", () => togglePreferenceSubmenu("language"));
$("#settingsMenuItem").addEventListener("click", openSettings);
$("#logoutMenuItem").addEventListener("click", () => void logout());
$("#settingsClose").addEventListener("click", closeSettings);
$("#loginCommandCopy").addEventListener("click", () => void copyText($("#loginCommand").textContent, t("loginCopied")));
$("#settingsModal").addEventListener("click", (event) => {
  if (event.target === $("#settingsModal")) closeSettings();
});
$$("[data-theme-choice]").forEach((button) => {
  button.addEventListener("click", () => {
    applyTheme(button.dataset.themeChoice);
    closePreferenceSubmenus();
  });
});
$$("[data-language-choice]").forEach((button) => {
  button.addEventListener("click", () => {
    applyLocale(button.dataset.languageChoice);
    closePreferenceSubmenus();
  });
});
$("#settingsThemeSelect").addEventListener("change", (event) => applyTheme(event.target.value));
$("#settingsLanguageSelect").addEventListener("change", (event) => applyLocale(event.target.value));
$$("[data-view]").forEach((button) => button.addEventListener("click", () => switchConversationView(button.dataset.view)));
$("#tagFilterChip").addEventListener("click", () => applyTagFilter(null));
$("#workspaceButton").addEventListener("click", () => openWorkspacePopover());
$("#workspaceBrowseButton").addEventListener("click", () => {
  closeWorkspacePopover();
  void chooseWorkspaceFolder();
});
$("#workspaceBrowserClose").addEventListener("click", closeWorkspaceBrowser);
$("#workspaceBrowserCancel").addEventListener("click", closeWorkspaceBrowser);
$("#workspaceBrowserModal").addEventListener("click", (event) => {
  if (event.target === $("#workspaceBrowserModal")) closeWorkspaceBrowser();
});
$("#workspaceDirectorySearch").addEventListener("input", (event) => renderWorkspaceDirectoryList(event.target.value));
$("#workspacePathGo").addEventListener("click", () => void loadWorkspaceDirectory($("#workspacePathInput").value.trim()));
const workspacePathIme = enterGuard($("#workspacePathInput"));
$("#workspacePathInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !workspacePathIme(event)) {
    event.preventDefault();
    void loadWorkspaceDirectory(event.target.value.trim());
  }
});
// The server computes the parent, so Windows drive paths work as well as POSIX ones.
$("#workspaceParentButton").addEventListener("click", () => void loadWorkspaceDirectory(state.workspaceBrowserParent));
$("#workspaceBrowserConfirm").addEventListener("click", () => {
  if (!state.workspaceBrowserPath) return;
  closeWorkspaceBrowser();
  void addWorkspace(state.workspaceBrowserPath);
});
$("#addWorkspace").addEventListener("click", () => void chooseWorkspaceFolder());
$("#fileTreeBack").addEventListener("click", () => $("#fileTree").classList.remove("open"));
$("#fileTreeSearch").addEventListener("input", (event) => searchTree(event.target.value));
$("#fileTreeRefresh").addEventListener("click", () => void refreshTree());
$("#fileTreeBody").addEventListener("click", (event) => {
  const row = event.target.closest(".file-row");
  if (row) activateTreeRow(row);
});
$("#fileTreeBody").addEventListener("keydown", handleTreeKeydown);
$("#stopRun").addEventListener("click", interruptCurrent);
$("#policyMenu").addEventListener("policychange", async (event) => {
  state.draftPolicy = event.detail.preset;
  if (!state.current) return;
  try {
    renderSnapshot(
      await api(`/api/v1/sessions/${state.current.id}/policy`, {
        method: "PATCH",
        body: JSON.stringify({ preset: event.detail.preset }),
      }),
    );
  } catch (error) {
    showError(error.message);
  }
});
$("#composer").addEventListener("submit", async (event) => {
  event.preventDefault();
  const prompt = $("#prompt");
  const text = prompt.value.trim();
  if (!text) return;
  // Attachments are sent with the message and dropped afterwards, so a failed
  // send has to put both back.
  const attachments = state.attachments;
  prompt.value = "";
  state.attachments = [];
  renderAttachments();
  resizePrompt();
  try {
    const session = await createSessionIfNeeded();
    const endpoint = session.status === "running" ? "steer" : "messages";
    await api(`/api/v1/sessions/${session.id}/${endpoint}`, {
      method: "POST",
      body: JSON.stringify({ text, attachments }),
    });
  } catch (error) {
    prompt.value = text;
    state.attachments = attachments;
    renderAttachments();
    resizePrompt();
    showError(error.message);
  }
});
/**
 * Guard Enter against an IME composition.
 *
 * Confirming a Chinese/Japanese/Korean candidate is itself an Enter, so a bare
 * `key === "Enter"` check submits half-finished text. `isComposing` alone is not
 * enough: several browsers report it as false on the keydown that ends a
 * composition, and that keydown can arrive after compositionend — hence the
 * asynchronously cleared flag, which swallows that trailing Enter while leaving
 * the next real one alone.
 *
 * Every text field that acts on Enter needs this, which is why it is a helper
 * rather than four copies of the same three listeners.
 */
function enterGuard(element) {
  let composing = false;
  element.addEventListener("compositionstart", () => {
    composing = true;
  });
  element.addEventListener("compositionend", () => {
    setTimeout(() => {
      composing = false;
    }, 0);
  });
  return (event) => event.isComposing || composing;
}

const promptIme = enterGuard($("#prompt"));
$("#prompt").addEventListener("input", resizePrompt);
$("#prompt").addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey) return;
  if (promptIme(event)) return;
  event.preventDefault();
  $("#composer").requestSubmit();
});

document.addEventListener("click", (event) => {
  if (!event.target.closest("#sessionMenu,.session-menu-button")) closeSessionMenu();
  if (!event.target.closest("#tagPicker,.session-tag-button,.session-tag")) $("#tagPicker").hidden = true;
  if (!event.target.closest("#userPopover,#userMenuButton,#themeSubmenu,#languageSubmenu")) toggleUserMenu(false);
  if (!event.target.closest("#workspacePopover,#workspaceButton")) closeWorkspacePopover();
});
document.addEventListener("keydown", (event) => {
  // With Alt held, macOS reports the composed character in `key`, so the
  // Alt chords match on the physical key instead.
  if ((event.metaKey || event.ctrlKey) && event.altKey && event.code === "KeyO") {
    event.preventDefault();
    void chooseWorkspaceFolder();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.altKey && event.code === "KeyP") {
    event.preventDefault();
    const cwd = state.current?.cwd || state.draftCwd || state.bootstrapCwd;
    if (cwd) void openTree({ cwd });
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
    event.preventDefault();
    if (event.shiftKey) {
      if (state.preview.tabs.length) setPreviewOpen(!state.preview.open);
    } else $(".app").classList.toggle("sidebar-hidden");
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    openSearch();
  }
  if (event.key === "Escape") {
    if (!$("#searchModal").hidden) closeSearch();
    else if (!$("#workspaceBrowserModal").hidden) closeWorkspaceBrowser();
    else if (!$("#settingsModal").hidden) closeSettings();
    else if (!$("#workspacePopover").hidden) closeWorkspacePopover();
    else if (!$("#tagPicker").hidden) $("#tagPicker").hidden = true;
    else if (!$("#sessionMenu").hidden) closeSessionMenu();
    else if (!$("#themeSubmenu").hidden || !$("#languageSubmenu").hidden) closePreferenceSubmenus();
    else if (!$("#userPopover").hidden) toggleUserMenu(false);
    else if ($("#fileTree").classList.contains("open")) $("#fileTree").classList.remove("open");
    else void interruptCurrent();
  }
});

if (location.search.includes("sb=0")) $(".app").classList.add("sidebar-hidden");
systemTheme.addEventListener("change", () => {
  if (state.theme === "system") applyTheme("system", false);
});
applyTheme(state.theme, false);
applyLocale(state.locale, false);
// Before the async bootstrap: restoring the width here avoids a visible jump
// from the 260px default to the remembered one.
initSidebarResizer();
initPreviewPanel();
// Both start hidden: an empty session has no tasks and no reported usage, and
// renderTimeline only refreshes them once there is a timeline to read.
updateTaskBanner();
updateUsageTrigger();

// ── Task banner ────────────────────────────────────────────────────────────
// Top-right of the main pane: one element with two states (collapsed pill /
// expanded panel). Both read the session timeline directly, so the banner
// reflects the tools the session actually ran.

function bannerCountsFromTimeline() {
  const items = state.timelineItems ?? [];
  let taskName = null;
  let taskDone = 0;
  let taskTotal = 0;
  let taskPending = 0;
  let subagents = 0;
  let subagentsPending = 0;
  for (const item of items) {
    if (item.kind !== "tool") continue;
    const name = String(item.toolName ?? "");
    const pending = item.state === "pending";
    if (name === "task_create" || name === "task_update" || name === "task_get" || name === "task_list") {
      if (name === "task_create" || name === "task_update") {
        taskTotal += 1;
        if (pending) taskPending += 1;
        else taskDone += 1;
        if (!taskName && item.inputSummary) taskName = compact(item.inputSummary, 42);
      }
    }
    if (name === "subagent" || name === "agent_send") {
      subagents += 1;
      if (pending) subagentsPending += 1;
    }
  }
  // Nothing to report: the banner stays hidden rather than inventing a task.
  if (!taskName && taskTotal === 0 && subagents === 0) return null;
  return {
    title: taskName ?? t("currentTask"),
    steps: [taskDone, taskTotal],
    agents: subagentsPending || subagents,
    running: taskPending > 0 || subagentsPending > 0,
  };
}

function taskPanelRowsFromTimeline() {
  const items = state.timelineItems ?? [];
  const tasks = [];
  const agents = [];
  for (const item of items) {
    if (item.kind !== "tool") continue;
    const name = String(item.toolName ?? "");
    if (name === "task_create" || name === "task_update") {
      tasks.push({
        name: compact(item.inputSummary || t("task"), 46),
        state: item.state === "pending" ? "wip" : "done",
      });
    }
    if (name === "subagent" || name === "agent_send") {
      agents.push({
        name: compact(item.inputSummary || t("subagent"), 46),
        state: item.state === "pending" ? "wip" : "done",
      });
    }
  }
  return { tasks, agents };
}

function panelStateOf(state) {
  if (state === "done") return `<span class="row-state done"><svg class="icon icon--sm" aria-hidden="true"><use href="#i-check"/></svg></span>`;
  if (state === "wip") return `<span class="row-state wip"></span>`;
  return `<span class="row-state"></span>`;
}

function renderTaskPanel() {
  const banner = $("#taskBanner");
  if (!banner || !banner.classList.contains("expanded")) return;
  const { tasks, agents } = taskPanelRowsFromTimeline();
  const done = tasks.filter((row) => row.state === "done").length;
  const body = $("#taskPanelBody");
  const parts = [];
  if (tasks.length) {
    parts.push(`<div class="panel-section">${t("tasks")}</div>`);
    for (const task of tasks) {
      parts.push(`<div class="panel-row">${panelStateOf(task.state)}<span class="row-name">${escapeHtml(task.name)}</span><span class="row-meta">${task.state === "done" ? t("done") : task.state === "wip" ? t("running") : t("notStarted")}</span></div>`);
    }
  }
  if (agents.length) {
    parts.push(`<div class="panel-section">${t("subagents")}</div>`);
    for (const agent of agents) {
      parts.push(`<div class="panel-row">${panelStateOf(agent.state)}<span class="row-name">${escapeHtml(agent.name)}</span><span class="row-meta">${agent.state === "wip" ? t("running") : t("returned")}</span></div>`);
    }
  }
  body.innerHTML = parts.join("") || `<div class="panel-row"><span class="row-name">${t("noTasks")}</span></div>`;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const track = document.createElement("div");
  track.className = "panel-progress-track";
  track.innerHTML = `<div class="panel-progress-fill" style="width:${pct}%"></div>`;
  body.append(track);
}

function toggleTaskPanel(force) {
  const banner = $("#taskBanner");
  if (!banner) return;
  const open = force ?? !banner.classList.contains("expanded");
  banner.classList.toggle("expanded", open);
  banner.setAttribute("aria-expanded", String(open));
  if (open) renderTaskPanel();
}

function updateTaskBanner() {
  const banner = $("#taskBanner");
  if (!banner) return;
  const data = bannerCountsFromTimeline();
  // No task or subagent activity in this session yet: stay out of the way.
  if (!data) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  banner.classList.toggle("running", Boolean(data.running));
  $("#bannerTitle").textContent = data.title;
  const steps = $("#bannerSteps");
  if (data.steps && data.steps[1] > 0) {
    steps.hidden = false;
    steps.innerHTML = `${t("steps")} <b>${data.steps[0]}</b>/${data.steps[1]}`;
  } else {
    steps.hidden = true;
  }
  const agents = $("#bannerAgents");
  if (data.agents > 0) {
    agents.hidden = false;
    agents.innerHTML = `${t("subagents")} <b>${data.agents}</b>`;
  } else {
    agents.hidden = true;
  }
  renderTaskPanel();
}

$("#bannerHead")?.addEventListener("click", () => toggleTaskPanel());
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && $("#taskBanner")?.classList.contains("expanded")) toggleTaskPanel(false);
});

// ── Token usage ────────────────────────────────────────────────────────────
// Sums the usage the provider reported on each assistant turn. A session with
// no reported usage has nothing to show, so the trigger hides itself rather
// than displaying a placeholder figure.

function sessionUsage() {
  let input = 0;
  let output = 0;
  let turns = 0;
  for (const item of state.timelineItems ?? []) {
    if (item.kind !== "message" || item.role !== "assistant" || !item.usage) continue;
    input += item.usage.input ?? 0;
    output += item.usage.output ?? 0;
    turns += 1;
  }
  return { input, output, total: input + output, turns };
}

function renderUsagePopover() {
  const data = sessionUsage();
  const totalPct = data.total ? Math.round((data.input / data.total) * 100) : 0;
  $("#usagePopover").innerHTML = `
    <div class="usage-head">${t("usageTitle")}</div>
    <div class="usage-total"><b>${formatTokens(data.total)}</b><span>${t("usageCumulative")}</span></div>
    <div class="usage-bars">
      <div class="usage-bar-row"><span>${t("usageInput")}</span><span class="bar"><i style="width:${totalPct}%;background:#2f7fbf"></i></span><span class="val">${formatTokens(data.input)}</span></div>
      <div class="usage-bar-row"><span>${t("usageOutput")}</span><span class="bar"><i style="width:${100 - totalPct}%;background:#a8734a"></i></span><span class="val">${formatTokens(data.output)}</span></div>
    </div>
    <div class="usage-recent">
      <div class="panel-section">${t("usageTurns")}</div>
      <div class="row"><span class="n">${t("usageAssistantTurns")}</span><span class="v">${data.turns}</span></div>
    </div>`;
}

function updateUsageTrigger() {
  const trigger = $("#usageTrigger");
  if (!trigger) return;
  const data = sessionUsage();
  // No reported usage yet: keep the control out of the composer.
  trigger.hidden = data.total === 0;
}

function toggleUsagePopover(force) {
  const popover = $("#usagePopover");
  const trigger = $("#usageTrigger");
  if (!popover || !trigger) return;
  const open = force ?? popover.hidden;
  if (open) renderUsagePopover();
  popover.hidden = !open;
  trigger.setAttribute("aria-expanded", String(open));
}

$("#usageTrigger")?.addEventListener("click", () => toggleUsagePopover());
document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest("#usageMenu")) return;
  if (!$("#usagePopover")?.hidden) toggleUsagePopover(false);
}, true);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("#usagePopover")?.hidden) toggleUsagePopover(false);
});

(async () => {
  try {
    await exchange();
    const bootstrap = await api("/api/v1/bootstrap");
    state.bootstrapCwd = bootstrap.cwd;
    state.directoryPicker = bootstrap.directoryPicker === "native" ? "native" : "browse";
    state.login = bootstrap.login ?? null;
    renderLoginStatus();
    state.draftCwd = bootstrap.cwd;
    await refreshWorkspaces();
    await refreshSessions();
    const first =
      state.sessions.find(
        (session) => !session.archived && session.cwdAvailable !== false && session.cwd === bootstrap.cwd,
      ) ?? state.sessions.find((session) => !session.archived && session.cwdAvailable !== false);
    if (first) await openSession(first.id);
    else startDraft(bootstrap.cwd);
    if (location.search.includes("tree=1")) {
      const project = state.sessions.find((session) => !session.archived && session.cwd && session.cwdAvailable !== false);
      if (project) await openTree({ cwd: project.cwd });
    }
  } catch (error) {
    showError(error.message);
  }
})();
