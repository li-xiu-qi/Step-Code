import { ProcessTerminal, type TUI, TuiMainScreen } from "@step-harness/pi-tui";
import { AuthStorage, readStoredCredential } from "../core/auth-storage.ts";
import {
	defaultStepCliClientInfo,
	loginStepOAuth,
	STEP_PROVIDER_ID,
	STEP_STATIC_REFRESH_TOKEN,
} from "../features/step-provider/index.ts";
import { detectTerminalBackgroundFromEnv, initTheme, resolveThemeSetting, theme } from "../theme/theme.ts";
import { openBrowser } from "../utils/open-browser.ts";
import { resolveStepAgentDir } from "./environment.ts";
import { type StepApiKeyValidation, validateStepApiKey } from "./login-status.ts";
import {
	INITIAL_STEP_LOGIN_STEP,
	isStepLoginSettled,
	reduceStepLogin,
	resolveStepLoginProfiles,
	type StepLoginEvent,
	type StepLoginProfile,
	type StepLoginProfileId,
	type StepLoginStep,
} from "./onboarding.ts";
import { StepOnboardingView } from "./onboarding-view.ts";
import { resolveStepCodeVersion } from "./version.ts";

export interface StepLoginHost {
	addChild(child: unknown): void;
	setFocus(child: unknown): void;
	requestRender(): void;
	start(): void | Promise<void>;
	stop(): void | Promise<void>;
	/** Clear a standalone login screen before another TUI takes over. */
	clearScreen?(): void;
}

export interface StepLoginOutcome {
	readonly kind: "completed" | "exit";
	readonly profile?: StepLoginProfile;
	readonly credentialsPath?: string;
}

export interface RunStepLoginOptions {
	readonly authPath?: string;
	readonly createHost?: () => StepLoginHost;
	readonly now?: () => Date;
	readonly env?: Record<string, string | undefined>;
	readonly themeName?: string;
	/**
	 * Never try to launch a browser; only print the URL. Useful over SSH and in
	 * containers, where a launcher may "succeed" without a window ever appearing.
	 */
	readonly noBrowser?: boolean;
}

export async function writeStepLoginCredential(input: {
	authPath: string;
	profile: StepLoginProfileId;
	apiKey: string;
	uid?: string;
	obtainedAt?: string;
}): Promise<void> {
	const storage = AuthStorage.create(input.authPath);
	await storage.modify(STEP_PROVIDER_ID, async () => ({
		type: "oauth",
		access: input.apiKey.trim(),
		refresh: STEP_STATIC_REFRESH_TOKEN,
		expires: Number.MAX_SAFE_INTEGER,
		profile: input.profile,
		obtainedAt: input.obtainedAt ?? new Date().toISOString(),
		...(input.uid?.trim() ? { uid: input.uid.trim() } : {}),
	}));
}

export function readStepLoginProfile(authPath: string): StepLoginProfileId | undefined {
	const credential = readStoredCredential(STEP_PROVIDER_ID, authPath) as { profile?: unknown } | undefined;
	const profile = typeof credential?.profile === "string" ? credential.profile.trim() : "";
	if (profile === "step") return "step_plan";
	return resolveStepLoginProfiles().some((candidate) => candidate.id === profile)
		? (profile as StepLoginProfileId)
		: undefined;
}

export function readStepLoginCredential(
	authPath: string,
):
	| { readonly type: "oauth"; readonly access: string; readonly profile?: unknown; readonly uid?: unknown }
	| { readonly type: "api_key"; readonly key?: string }
	| undefined {
	const credential = readStoredCredential(STEP_PROVIDER_ID, authPath);
	if (!credential) return undefined;
	if (credential.type === "oauth" && typeof credential.access === "string" && credential.access.trim().length > 0)
		return credential;
	if (credential.type === "api_key" && typeof credential.key === "string" && credential.key.trim().length > 0)
		return credential;
	return undefined;
}

/** True only when the Step entrypoint is about to open an empty interactive session. */
export function isStepInteractiveLoginStartup(input: {
	readonly stdinIsTTY?: boolean;
	readonly stdoutIsTTY?: boolean;
	readonly args: {
		readonly help?: boolean;
		readonly version?: boolean;
		readonly export?: string;
		readonly listModels?: string | true;
		readonly sdkStdio?: boolean;
		readonly messages: readonly string[];
		readonly fileArgs: readonly string[];
		readonly print?: boolean;
		readonly mode?: string;
	};
}): boolean {
	return (
		input.stdinIsTTY === true &&
		input.stdoutIsTTY === true &&
		input.args.help !== true &&
		input.args.version !== true &&
		input.args.export === undefined &&
		input.args.listModels === undefined &&
		input.args.sdkStdio !== true &&
		input.args.messages.length === 0 &&
		input.args.fileArgs.length === 0 &&
		input.args.print !== true &&
		input.args.mode !== "json" &&
		input.args.mode !== "rpc"
	);
}

export function needsStepLoginBeforeInteractive(input: {
	readonly authPath: string;
	readonly interactive: boolean;
	readonly env?: Record<string, string | undefined>;
}): boolean {
	if (!input.interactive) return false;
	if (input.env?.STEP_API_KEY?.trim()) return false;
	return readStepLoginCredential(input.authPath) === undefined;
}

/**
 * Update the provider endpoint hints used by the Step extension on reload.
 *
 * Both the model endpoint and the developer-center login page follow the stored
 * profile, so a mainland and an overseas plan never cross regions.
 */
export function syncStepLoginProfileEndpoint(
	authPath: string,
	env: Record<string, string | undefined> = process.env,
): void {
	const profileId = readStepLoginProfile(authPath);
	const profile = profileId
		? resolveStepLoginProfiles(env).find((candidate) => candidate.id === profileId)
		: undefined;
	if (!profile) {
		delete env.STEP_LOGIN_PROFILE_API_URL;
		delete env.STEP_LOGIN_PROFILE_AUTH_URL;
		return;
	}
	env.STEP_LOGIN_PROFILE_API_URL = profile.baseUrl;
	env.STEP_LOGIN_PROFILE_AUTH_URL = profile.authBaseUrl;
}

/** The cloud sign-in shared by `step login` and hosts without a terminal. */
async function requestStepBrowserCredential(
	profile: StepLoginProfile,
	options: {
		readonly signal: AbortSignal;
		readonly env?: Record<string, string | undefined>;
		readonly onAuthUrl: (url: string) => void;
	},
): Promise<{ readonly access: string; readonly uid?: unknown }> {
	return loginStepOAuth(
		{
			signal: options.signal,
			onAuth: ({ url }) => options.onAuthUrl(url),
			onDeviceCode: () => {},
			// Cloud login never prompts for a callback URL or opens a local port.
			onPrompt: async () => "",
			onSelect: async () => undefined,
		},
		{
			apiBaseUrl: profile.baseUrl,
			authBaseUrl: profile.authBaseUrl,
			env: options.env ?? process.env,
			loginProfile: profile.id,
			client: defaultStepCliClientInfo(resolveStepCodeVersion(options.env).value),
		},
	);
}

function requireStepLoginProfile(
	id: StepLoginProfileId,
	source: StepLoginProfile["credentialSource"],
	env?: Record<string, string | undefined>,
): StepLoginProfile {
	const profile = resolveStepLoginProfiles(env).find((candidate) => candidate.id === id);
	if (!profile || profile.credentialSource !== source) throw new Error(`Unknown Step login profile: ${id}`);
	return profile;
}

export interface StepHeadlessLoginOptions {
	readonly authPath: string;
	readonly env?: Record<string, string | undefined>;
	readonly now?: () => Date;
}

/**
 * Sign in with a platform API key without a terminal (StepCode Desktop).
 *
 * The key is checked against the profile's endpoint first and written only when
 * the provider accepts it, in the same shape `step login` writes, so the CLI
 * and the desktop app read one credential.
 */
export async function loginStepWithApiKey(
	input: StepHeadlessLoginOptions & {
		readonly profile: StepLoginProfileId;
		readonly apiKey: string;
		readonly fetch?: typeof fetch;
		readonly signal?: AbortSignal;
	},
): Promise<StepApiKeyValidation> {
	const profile = requireStepLoginProfile(input.profile, "apiKey", input.env);
	const apiKey = input.apiKey.trim();
	if (!apiKey) throw new Error("API key cannot be empty");
	const result = await validateStepApiKey({
		apiKey,
		baseUrl: profile.baseUrl,
		fetch: input.fetch,
		signal: input.signal,
	});
	if (result.validity !== "valid") return result;
	await writeStepLoginCredential({
		authPath: input.authPath,
		profile: profile.id,
		apiKey,
		obtainedAt: (input.now ?? (() => new Date()))().toISOString(),
	});
	syncStepLoginProfileEndpoint(input.authPath, input.env ?? process.env);
	return result;
}

/**
 * Run the Step Plan browser sign-in without a terminal (StepCode Desktop).
 *
 * `onAuthUrl` receives the same authorize URL `step login` opens; the caller
 * decides how to show it. Resolves once the browser approval arrives and the
 * credential is saved; rejects on timeout, failure, or abort.
 */
export async function loginStepInBrowser(
	input: StepHeadlessLoginOptions & {
		readonly profile: StepLoginProfileId;
		readonly signal: AbortSignal;
		readonly onAuthUrl: (url: string) => void;
	},
): Promise<void> {
	const profile = requireStepLoginProfile(input.profile, "browser", input.env);
	const credential = await requestStepBrowserCredential(profile, input);
	input.signal.throwIfAborted();
	const uid = typeof credential.uid === "string" ? credential.uid : undefined;
	await writeStepLoginCredential({
		authPath: input.authPath,
		profile: profile.id,
		apiKey: credential.access,
		...(uid ? { uid } : {}),
		obtainedAt: (input.now ?? (() => new Date()))().toISOString(),
	});
	syncStepLoginProfileEndpoint(input.authPath, input.env ?? process.env);
}

export async function runStepLogin(options: RunStepLoginOptions = {}): Promise<StepLoginOutcome> {
	const authPath = options.authPath ?? "auth.json";
	const profiles = resolveStepLoginProfiles(options.env);
	const host = options.createHost?.() ?? createStandaloneStepHost();
	// `step login` runs before main() initializes the product theme. Reusing the
	// configured theme is safe in-session; only initialize when this is the first
	// renderer in the process.
	try {
		theme.fg("text", "");
	} catch {
		const terminalTheme = detectTerminalBackgroundFromEnv({ env: options.env }).theme;
		const themeName = resolveThemeSetting(options.themeName ?? "dark", terminalTheme) ?? "dark";
		initTheme(themeName, false);
	}

	let step: StepLoginStep = INITIAL_STEP_LOGIN_STEP;
	let browserAbort: AbortController | undefined;
	let savedProfile: StepLoginProfile | undefined;
	let savedPath: string | undefined;
	let settle: ((outcome: StepLoginOutcome) => void) | undefined;
	const finished = new Promise<StepLoginOutcome>((resolve) => {
		settle = resolve;
	});

	const view = new StepOnboardingView(profiles, {
		onChoose: (choice) => dispatch({ type: "choose", choice }),
		onSubmitApiKey: (apiKey) => dispatch({ type: "credential", apiKey }),
		onType: (text) => dispatch({ type: "type", text }),
		onBackspace: () => dispatch({ type: "backspace" }),
		onBack: () => dispatch({ type: "back" }),
		onQuit: () => dispatch({ type: "quit" }),
		requestRender: () => host.requestRender(),
	});

	function dispatch(event: StepLoginEvent): void {
		const previous = step;
		step = reduceStepLogin(previous, event);
		if (step === previous) return;
		view.setStep(step);
		host.requestRender();
		void runEffects(previous, step, event);
	}

	async function runEffects(previous: StepLoginStep, next: StepLoginStep, event: StepLoginEvent): Promise<void> {
		if (previous.kind === "continueInBrowser" && next.kind !== "continueInBrowser") {
			browserAbort?.abort();
			browserAbort = undefined;
		}
		if (next.kind === "continueInBrowser" && previous.kind !== next.kind) {
			await beginBrowserLogin(next.choice);
			return;
		}
		if (next.kind === "saving") {
			const apiKey = event.type === "credential" ? event.apiKey.trim() : "";
			await persist(next.choice, apiKey, event.type === "credential" ? event.uid : undefined);
			return;
		}
		if (isStepLoginSettled(next)) {
			settle?.(
				next.kind === "done"
					? { kind: "completed", profile: savedProfile, credentialsPath: savedPath }
					: { kind: "exit" },
			);
		}
	}

	async function beginBrowserLogin(choice: StepLoginProfileId): Promise<void> {
		const profile = profiles.find((candidate) => candidate.id === choice);
		if (!profile) return;
		const controller = new AbortController();
		browserAbort = controller;
		try {
			const credential = await requestStepBrowserCredential(profile, {
				signal: controller.signal,
				env: options.env,
				onAuthUrl: (url) => {
					// Show the URL before launching anything: if the launcher hangs or
					// the host has no browser, the user still has something to copy.
					dispatch({ type: "browserOpened", authUrl: url });
					if (!options.noBrowser) openBrowser(url);
				},
			});
			dispatch({
				type: "credential",
				apiKey: credential.access,
				uid: typeof credential.uid === "string" ? credential.uid : undefined,
			});
		} catch (error) {
			if (!controller.signal.aborted)
				dispatch({ type: "fail", message: error instanceof Error ? error.message : String(error) });
		}
	}

	async function persist(choice: StepLoginProfileId, apiKey: string, uid?: string): Promise<void> {
		try {
			const profile = profiles.find((candidate) => candidate.id === choice);
			if (!profile) throw new Error(`Unknown Step login profile: ${choice}`);
			await writeStepLoginCredential({
				authPath,
				profile: choice,
				apiKey,
				...(uid ? { uid } : {}),
				obtainedAt: (options.now ?? (() => new Date()))().toISOString(),
			});
			savedProfile = profile;
			savedPath = authPath;
			syncStepLoginProfileEndpoint(authPath, options.env ?? process.env);
			dispatch({ type: "saved" });
		} catch (error) {
			dispatch({
				type: "fail",
				message: `Could not save credentials: ${error instanceof Error ? error.message : String(error)}`,
			});
		}
	}

	host.addChild(view);
	host.setFocus(view);
	try {
		await host.start();
		return await finished;
	} finally {
		browserAbort?.abort();
		await host.stop();
		host.clearScreen?.();
	}
}

/**
 * A screen of its own for a startup flow that runs before the main UI exists.
 *
 * `preserveScreen` plus an explicit clear is what keeps these screens from
 * bleeding into whatever renders next: the login, the MCP import offer and the
 * theme picker each own the terminal for their turn and hand it back empty.
 */
export function createStandaloneStepHost(): StepLoginHost {
	const ui = new TuiMainScreen(new ProcessTerminal(), undefined, resolveStepAgentDir());
	return {
		addChild: (child) => ui.addChild(child as Parameters<TUI["addChild"]>[0]),
		setFocus: (child) => ui.setFocus(child as Parameters<TUI["setFocus"]>[0]),
		requestRender: () => ui.requestRender(),
		start: () => ui.start(),
		stop: () => ui.stop({ preserveScreen: true }),
		clearScreen: () => ui.terminal.clearScreen(),
	};
}
