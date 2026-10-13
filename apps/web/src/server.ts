import "./bootstrap.ts";

import { createReadStream, existsSync } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { StepPermissionPresetId } from "@step-harness/coding-agent";
import {
	getStepAuthPath,
	getStepLoginStatus,
	resolveStepAgentDir,
	resolveStepCodeVersion,
	resolveStepConfigRoot,
} from "@step-harness/coding-agent";
import { WebAuth } from "./auth.ts";
import { formatStartupBanner } from "./banner.ts";
import { type DirectoryPickerMode, pickNativeDirectory, resolveDirectoryPickerMode } from "./directory-picker.ts";
import {
	containedWorkspacePath,
	listDirectory,
	MAX_IMAGE_BYTES,
	readWorkspaceFile,
	searchWorkspaceFiles,
} from "./files.ts";
import { buildLoginReport, type LoginReport } from "./login.ts";
import {
	classifyAttachment,
	defaultWorkspace,
	MAX_ATTACHMENT_BYTES,
	type WebAttachment,
	WebSessionStore,
} from "./runtime.ts";
import { WORKSPACES_FILE, WorkspaceRegistry } from "./workspaces.ts";

const moduleRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));
const publicRoot = existsSync(join(moduleRoot, "public"))
	? join(moduleRoot, "public")
	: join(moduleRoot, "..", "public");
const port = Number.parseInt(process.env.STEPCODE_WEB_PORT ?? "3077", 10);
const SECRET_FILE = "web-auth-secret";
const authSecretPath = process.env.STEPCODE_WEB_AUTH_SECRET?.trim() || join(resolveStepConfigRoot(), SECRET_FILE);
const bindHost = "127.0.0.1";
/** Sampled once: the picker a page sees must not change under it. */
const directoryPicker: DirectoryPickerMode = resolveDirectoryPickerMode({
	bindHost,
	platform: process.platform,
	env: process.env,
});
/** One system dialog at a time; a second would stack invisibly behind the first. */
let pickerOpen = false;
const auth = new WebAuth([`http://127.0.0.1:${port}`, `http://localhost:${port}`], authSecretPath);

/**
 * Validate the `attachments` array on a message. Returns an Error so the caller
 * can answer 400 with the reason, or the parsed list (empty when absent).
 *
 * Every field is checked rather than trusted: these bytes are base64-decoded
 * straight into the prompt or an image payload.
 */
function readAttachments(raw: unknown): WebAttachment[] | Error | undefined {
	if (raw === undefined || raw === null) return [];
	if (!Array.isArray(raw)) return new Error("attachments must be an array");
	const attachments: WebAttachment[] = [];
	for (const entry of raw) {
		if (!entry || typeof entry !== "object") return new Error("each attachment must be an object");
		const { name, mimeType, data } = entry as Record<string, unknown>;
		if (typeof name !== "string" || !name.trim()) return new Error("attachment name is required");
		if (typeof mimeType !== "string" || !mimeType.trim()) return new Error("attachment mimeType is required");
		if (typeof data !== "string" || !data) return new Error("attachment data is required");
		// Base64 of the decoded size, without materialising the buffer.
		const decodedBytes = Math.floor((data.length * 3) / 4);
		if (decodedBytes > MAX_ATTACHMENT_BYTES) {
			return new Error(`attachment ${name} exceeds the ${MAX_ATTACHMENT_BYTES} byte limit`);
		}
		attachments.push({ name, mimeType, data, kind: classifyAttachment(mimeType) });
	}
	return attachments;
}

function authorized(request: IncomingMessage): boolean {
	const cookie = request.headers.cookie
		?.split(";")
		.map((part) => part.trim())
		.find((part) => part.startsWith("stepcode_web="))
		?.slice("stepcode_web=".length);
	return auth.authorize(cookie, request.headers.origin);
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
	let content = "";
	for await (const chunk of request) content += String(chunk);
	if (!content) return {};
	const value: unknown = JSON.parse(content);
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Request body must be an object");
	return value as Record<string, unknown>;
}

function json(response: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
	const payload = JSON.stringify(value);
	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		...headers,
	});
	response.end(payload);
}

function error(response: ServerResponse, status: number, message: string): void {
	json(response, status, { error: message });
}

async function serveStatic(_request: IncomingMessage, response: ServerResponse, pathname: string): Promise<void> {
	const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
	const target = resolve(publicRoot, normalize(relativePath));
	if (relative(publicRoot, target).startsWith("..")) return error(response, 404, "Not found");
	try {
		const info = await stat(target);
		if (!info.isFile()) return error(response, 404, "Not found");
		const contentType =
			extname(target) === ".css"
				? "text/css; charset=utf-8"
				: extname(target) === ".js"
					? "text/javascript; charset=utf-8"
					: "text/html; charset=utf-8";
		response.writeHead(200, { "content-type": contentType, "cache-control": "no-cache" });
		createReadStream(target).pipe(response);
	} catch {
		error(response, 404, "Not found");
	}
}

async function directoryList(inputPath: string): Promise<unknown> {
	const target = await realpath(resolve(inputPath || defaultWorkspace()));
	const info = await stat(target);
	if (!info.isDirectory()) throw new Error("Path is not a directory");
	const entries = await readdir(target, { withFileTypes: true });
	return {
		path: target,
		parent: dirname(target),
		directories: entries
			.filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
			.sort((left, right) => left.name.localeCompare(right.name))
			.slice(0, 300)
			.map((entry) => ({ name: entry.name, path: join(target, entry.name) })),
	};
}

const store = new WebSessionStore();
const workspaces = new WorkspaceRegistry(join(resolveStepAgentDir(), WORKSPACES_FILE));

/**
 * Resolve the `cwd` of a workspace-scoped request, or undefined when the folder
 * is not one this host already works in.
 *
 * File browsing is keyed by folder rather than by session so that a workspace
 * with no conversation yet can still be browsed. That makes the folder a
 * caller-supplied path, so it is checked against what the host already knows:
 * the launch folder, registered workspaces, and the cwd of existing sessions.
 */
async function knownWorkspace(input: string | null): Promise<string | undefined> {
	if (!input) return undefined;
	let cwd: string;
	try {
		cwd = await realpath(input);
	} catch {
		return undefined;
	}
	if (await workspaces.has(cwd)) return cwd;
	const candidates = [defaultWorkspace(), ...(await store.list()).map((session) => session.cwd)];
	for (const candidate of new Set(candidates)) {
		if (!candidate) continue;
		try {
			if ((await realpath(candidate)) === cwd) return cwd;
		} catch {
			// A session whose folder is gone cannot match a folder that exists.
		}
	}
	return undefined;
}

/** Stream an image from a workspace; the preview loads it through an <img>. */
/**
 * Open the system folder chooser and answer with the chosen path, or null on
 * cancel. The dialog closes if the page goes away before the user answers.
 */
/**
 * Where the model credential comes from, for the settings dialog.
 *
 * Reuses the product's own inspection so the answer matches a terminal
 * `step login status`; only the source and profile are forwarded, never the
 * credential. The inspection can hit the network to validate a token, which is
 * why the answer is cached rather than recomputed per request, and why the
 * cache expires on its own.
 */
const LOGIN_REPORT_TTL_MS = 30_000;
let loginCache: { at: number; value: LoginReport } | undefined;

async function loginReport(): Promise<LoginReport> {
	const now = Date.now();
	if (!loginCache || now - loginCache.at > LOGIN_REPORT_TTL_MS) {
		const authPath = getStepAuthPath();
		loginCache = { at: now, value: buildLoginReport({ status: await getStepLoginStatus({ authPath }), authPath }) };
	}
	return loginCache.value;
}

async function pickWorkspaceFolder(request: IncomingMessage, response: ServerResponse): Promise<void> {
	if (directoryPicker !== "native") return error(response, 409, "The system folder picker is not available");
	if (pickerOpen) return error(response, 409, "A folder picker is already open");
	const input = await body(request);
	const title =
		typeof input.title === "string" && input.title.trim()
			? input.title.trim().slice(0, 120)
			: "Select Workspace Directory";
	const startIn = typeof input.startIn === "string" ? input.startIn : undefined;
	const controller = new AbortController();
	response.on("close", () => {
		if (!response.writableFinished) controller.abort();
	});
	pickerOpen = true;
	try {
		const path = await pickNativeDirectory({ title, startIn, signal: controller.signal });
		return json(response, 200, { path });
	} catch (caught) {
		if (controller.signal.aborted) return;
		return error(response, 500, caught instanceof Error ? caught.message : String(caught));
	} finally {
		pickerOpen = false;
	}
}

async function serveWorkspaceImage(response: ServerResponse, cwd: string, inputPath: string): Promise<void> {
	const file = await readWorkspaceFile(cwd, inputPath);
	if (file.kind !== "image") return error(response, 415, "Only images can be served raw");
	if (file.size > MAX_IMAGE_BYTES) return error(response, 413, "Image is too large to preview");
	response.writeHead(200, {
		"content-type": file.mimeType,
		"content-length": String(file.size),
		"cache-control": "no-store",
		"x-content-type-options": "nosniff",
	});
	createReadStream(await containedWorkspacePath(cwd, inputPath)).pipe(response);
}

const server = createServer(async (request, response) => {
	try {
		const method = request.method ?? "GET";
		const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
		if (url.pathname === "/auth/exchange" && method === "POST") {
			const input = await body(request);
			const cookie = auth.exchange(input.token, request.headers.origin);
			if (!cookie) return error(response, 401, "Launch token is invalid, already used, or origin is not allowed");
			return json(
				response,
				200,
				{ ok: true },
				{ "set-cookie": `stepcode_web=${cookie}; HttpOnly; SameSite=Strict; Path=/` },
			);
		}
		if (url.pathname === "/auth/logout" && method === "POST") {
			if (!auth.allowsOrigin(request.headers.origin)) return error(response, 403, "Origin is not allowed");
			return json(
				response,
				200,
				{ ok: true },
				{ "set-cookie": "stepcode_web=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" },
			);
		}
		if (url.pathname === "/healthz") return json(response, 200, { ok: true });
		if (!url.pathname.startsWith("/api/")) return serveStatic(request, response, url.pathname);
		if (!authorized(request)) return error(response, 401, "Authentication required");

		const parts = url.pathname.split("/").filter(Boolean);
		if (parts[0] !== "api" || parts[1] !== "v1") return error(response, 404, "Not found");
		if (parts[2] === "bootstrap" && method === "GET") {
			return json(response, 200, { cwd: defaultWorkspace(), directoryPicker, login: await loginReport() });
		}
		if (parts[2] === "login" && parts.length === 3 && method === "GET") {
			return json(response, 200, await loginReport());
		}
		if (parts[2] === "workspaces" && parts[3] === "pick" && parts.length === 4 && method === "POST") {
			return pickWorkspaceFolder(request, response);
		}
		if (parts[2] === "directories" && method === "GET") {
			return json(response, 200, await directoryList(url.searchParams.get("path") ?? defaultWorkspace()));
		}
		if (parts[2] === "workspaces" && parts.length === 3) {
			if (method === "GET") return json(response, 200, { workspaces: await workspaces.list() });
			if (method === "POST") {
				const input = await body(request);
				if (typeof input.path !== "string") return error(response, 400, "path is required");
				try {
					return json(response, 201, await workspaces.add(input.path));
				} catch (caught) {
					return error(response, 400, caught instanceof Error ? caught.message : String(caught));
				}
			}
			if (method === "DELETE") {
				const removed = await workspaces.remove(url.searchParams.get("path") ?? "");
				return removed ? json(response, 200, { ok: true }) : error(response, 404, "Workspace is not registered");
			}
		}
		if (parts[2] === "workspace" && parts.length === 4 && method === "GET") {
			const cwd = await knownWorkspace(url.searchParams.get("cwd"));
			if (!cwd) return error(response, 403, "Folder is not a known workspace");
			const path = url.searchParams.get("path") ?? "";
			try {
				if (parts[3] === "files") return json(response, 200, await listDirectory(cwd, path));
				if (parts[3] === "file") return json(response, 200, await readWorkspaceFile(cwd, path));
				if (parts[3] === "raw") return await serveWorkspaceImage(response, cwd, path);
				if (parts[3] === "search") {
					return json(response, 200, await searchWorkspaceFiles(cwd, url.searchParams.get("q") ?? ""));
				}
			} catch (caught) {
				// A bad path inside a valid workspace is the caller's mistake.
				return error(response, 400, caught instanceof Error ? caught.message : String(caught));
			}
		}
		if (parts[2] === "sessions" && parts.length === 3 && method === "GET") {
			const sessions = await store.list();
			return json(response, 200, { sessions });
		}
		if (parts[2] === "sessions" && parts.length === 3 && method === "POST") {
			const input = await body(request);
			const session = await store.create(typeof input.cwd === "string" ? input.cwd : defaultWorkspace());
			return json(response, 201, session.snapshot());
		}
		if (parts[2] === "sessions" && parts[3]) {
			if (parts.length === 4 && method === "DELETE") {
				await store.delete(parts[3]);
				return json(response, 200, { ok: true });
			}
			const session = await store.getOrOpen(parts[3]);
			if (parts.length === 4 && method === "GET") return json(response, 200, session.snapshot());
			if (parts[4] === "events" && method === "GET") {
				response.writeHead(200, {
					"content-type": "text/event-stream; charset=utf-8",
					"cache-control": "no-cache",
					connection: "keep-alive",
				});
				response.write(`event: snapshot\ndata: ${JSON.stringify(session.snapshot())}\n\n`);
				const unsubscribe = session.subscribe((event) => {
					const eventName = event.type === "error" ? "web_error" : event.type;
					response.write(`event: ${eventName}\ndata: ${JSON.stringify(event)}\n\n`);
				});
				response.on("close", unsubscribe);
				return;
			}
			if (parts[4] === "messages" && method === "POST") {
				const input = await body(request);
				if (typeof input.text !== "string" || !input.text.trim()) return error(response, 400, "text is required");
				const attachments = readAttachments(input.attachments);
				if (attachments instanceof Error) return error(response, 400, attachments.message);
				void session.send(input.text, attachments ?? []).catch((caught) => {
					session.publishError(caught instanceof Error ? caught.message : String(caught));
				});
				return json(response, 202, { ok: true });
			}
			if (parts[4] === "steer" && method === "POST") {
				const input = await body(request);
				if (typeof input.text !== "string" || !input.text.trim()) return error(response, 400, "text is required");
				void session.steer(input.text).catch((caught) => {
					session.publishError(caught instanceof Error ? caught.message : String(caught));
				});
				return json(response, 202, { ok: true });
			}
			if (parts[4] === "interrupt" && method === "POST") {
				await session.interrupt();
				return json(response, 200, { ok: true });
			}
			if (parts[4] === "approvals" && parts[5] === "decision" && method === "POST") {
				const input = await body(request);
				const verdict = input.verdict;
				if (verdict !== "approve" && verdict !== "approve_for_session" && verdict !== "deny")
					return error(response, 400, "Invalid verdict");
				if (typeof input.id !== "string" || !(await session.decideApproval(input.id, verdict)))
					return error(response, 404, "Approval not found");
				return json(response, 200, { ok: true });
			}
			if (parts[4] === "name" && method === "PATCH") {
				const input = await body(request);
				if (typeof input.name !== "string") return error(response, 400, "name is required");
				await session.rename(input.name);
				return json(response, 200, session.snapshot());
			}
			if (parts[4] === "archive" && method === "PATCH") {
				const input = await body(request);
				if (typeof input.archived !== "boolean") return error(response, 400, "archived is required");
				await store.archive(session.id, input.archived);
				return json(response, 200, session.snapshot());
			}
			if (parts[4] === "policy" && method === "PATCH") {
				const input = await body(request);
				if (typeof input.preset !== "string") return error(response, 400, "preset is required");
				try {
					await session.setPolicy(input.preset as StepPermissionPresetId);
				} catch (caught) {
					// Both "unknown preset" and "the Web host refuses this tier" are the
					// caller's problem, not a server fault.
					return error(response, 400, caught instanceof Error ? caught.message : String(caught));
				}
				return json(response, 200, session.snapshot());
			}
			if (parts[4] === "model" && method === "PATCH") {
				const input = await body(request);
				if (typeof input.provider !== "string" || typeof input.modelId !== "string")
					return error(response, 400, "provider and modelId are required");
				await session.setModel(input.provider, input.modelId);
				return json(response, 200, session.snapshot());
			}
			if (parts[4] === "feedback" && method === "POST") {
				const input = await body(request);
				if (input.sentiment !== "up" && input.sentiment !== "down") {
					return error(response, 400, "sentiment must be up or down");
				}
				if (typeof input.comment !== "string") return error(response, 400, "comment is required");
				const topic = typeof input.topic === "string" ? input.topic : undefined;
				const result = await session.submitFeedback({
					sentiment: input.sentiment,
					...(topic ? { topic } : {}),
					comment: input.comment,
				});
				// A rejected submission is the caller's problem to show, not a 500.
				return json(response, result.ok ? 200 : 400, result);
			}
			if (parts[4] === "fork" && method === "POST") {
				const input = await body(request);
				const entryId = typeof input.entryId === "string" ? input.entryId : undefined;
				try {
					const result = await session.fork(entryId);
					return json(response, 200, result);
				} catch (caught) {
					// A rejected fork is a bad request (wrong entry, nothing to fork
					// from), not a server fault.
					return error(response, 400, caught instanceof Error ? caught.message : String(caught));
				}
			}
			if (parts[4] === "mode" && method === "PATCH") {
				const input = await body(request);
				const mode = input.mode;
				if (mode !== "goal" && mode !== "plan" && mode !== "ultraloop") {
					return error(response, 400, "mode must be goal, plan or ultraloop");
				}
				if (typeof input.enabled !== "boolean") return error(response, 400, "enabled is required");
				if (input.enabled && mode === "goal" && typeof input.goal !== "string") {
					return error(response, 400, "goal text is required to enable goal mode");
				}
				// Fire-and-forget like /messages: a slash command is a full agent turn
				// and can take seconds, and holding the request lets a client timeout
				// strand the session mid-turn.
				void session
					.setMode(mode, input.enabled, typeof input.goal === "string" ? input.goal : undefined)
					.catch((caught) => session.publishError(caught instanceof Error ? caught.message : String(caught)));
				return json(response, 202, { ok: true });
			}
			if (parts[4] === "thinking" && method === "PATCH") {
				const input = await body(request);
				if (typeof input.level !== "string") return error(response, 400, "level is required");
				try {
					session.setThinkingLevel(input.level);
				} catch (caught) {
					return error(response, 400, caught instanceof Error ? caught.message : String(caught));
				}
				return json(response, 200, session.snapshot());
			}
			if (parts[4] === "files" && method === "GET") {
				const listing = await listDirectory(session.cwd, url.searchParams.get("path") ?? "");
				return json(response, 200, { files: listing.entries, truncated: listing.truncated });
			}
			if (parts[4] === "file" && method === "GET") {
				return json(response, 200, await readWorkspaceFile(session.cwd, url.searchParams.get("path") ?? ""));
			}
		}
		return error(response, 404, "Not found");
	} catch (caught) {
		const message = caught instanceof Error ? caught.message : String(caught);
		error(response, message.startsWith("Session not found:") ? 404 : 500, message);
	}
});

server.listen(port, bindHost, () => {
	console.log(formatStartupBanner({ port, token: auth.getLaunchToken(), version: resolveStepCodeVersion().value }));
});

// Installing signal handlers replaces Node's default exit, so shutdown must end
// the process itself: open SSE streams and keep-alive sockets would otherwise
// keep server.close() pending forever.
const shutdown = async (): Promise<void> => {
	server.close();
	server.closeAllConnections();
	try {
		await store.close();
	} finally {
		process.exit(0);
	}
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
