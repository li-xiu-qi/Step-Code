/** Local deterministic provider; exercises the real agent and clarify_user without paid APIs. */
export const clarificationQuestions = [
  {
    id: "app",
    question: "假设要在这个项目里改进一个页面，你想以哪个应用为例?",
    options: [
      { label: "国内开发者控制台 main（推荐）", value: "main" },
      { label: "海外开发者控制台 main-oversea", value: "main-oversea" },
      { label: "两个应用的共享组件", value: "shared" },
    ],
  },
  {
    id: "scope",
    question: "你希望先完成哪个部分？",
    options: [
      { label: "页面交互（推荐）", value: "interaction" },
      { label: "页面样式", value: "style" },
      { label: "两者一起", value: "both" },
    ],
  },
  {
    id: "decision",
    question: "假设进入实际开发，你希望 Codex 在什么情况下先问你?",
    options: [
      { label: "常规细节自行决定，影响用户体验的关键选择先问我（推荐）", value: "key" },
      { label: "先给出完整方案，等我选择后再动手", value: "plan" },
      { label: "目标明确后直接完成，遇到阻塞再问我", value: "finish" },
    ],
  },
];

export async function clarificationCompletion(request, response) {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  const input = JSON.parse(raw);
  const last = input.messages.at(-1);
  const text = Array.isArray(last.content) ? last.content.map((part) => part.text ?? "").join("\n") : String(last.content);
  const cancelled = last.role === "tool" && text.includes("User clarification cancelled");
  let delta;
  if (last.role === "user" && text.includes("approval-fixture")) {
    const tool = input.tools.find((item) => item.function.name === "bash") ?? input.tools.find((item) => item.function.name === "run_command");
    const path = text.includes("denied") ? "approval-denied.txt" : text.includes("remembered") ? "approval-remembered.txt" : "approval-result.txt";
    const command = `printf '%s\\n' '${"approval command preview ".repeat(24)}' > ${path}\n# exact-end-of-command`;
    delta = { tool_calls: [{ index: 0, id: `approval-call-${input.messages.length}`, type: "function", function: {
      name: tool.function.name, arguments: JSON.stringify({ command }),
    } }] };
  } else if (last.role === "user") {
    const freeform = text.includes("freeform-only");
    delta = { tool_calls: [{ index: 0, id: "clarification-call", type: "function", function: {
      name: "clarify_user",
      arguments: JSON.stringify({ questions: freeform ? [{ id: "custom", question: "写下你的回答", allow_freeform: true }] : clarificationQuestions }),
    } }] };
  } else if (last.role === "tool" && text.includes("source:") && !cancelled) {
    const write = input.tools.find((tool) => tool.function.name === "write_file") ?? input.tools.find((tool) => tool.function.name === "write");
    delta = { tool_calls: [{ index: 0, id: "write-call", type: "function", function: {
      name: write.function.name, arguments: JSON.stringify({ path: "clarification-result.txt", content: text.replaceAll("\\n", "\n") }),
    } }] };
  } else delta = { content: cancelled ? "Clarification cancelled." : "Clarification received and saved." };
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", model: input.model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
  response.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", model: input.model, choices: [{ index: 0, delta: {}, finish_reason: delta.tool_calls ? "tool_calls" : "stop" }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } })}\n\n`);
  response.end("data: [DONE]\n\n");
}
