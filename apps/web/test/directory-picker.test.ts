import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	encodePowerShell,
	type PickerCommandResult,
	type PickerCommandRunner,
	pickNativeDirectory,
	resolveDirectoryPickerMode,
	runPickerCommand,
} from "../src/directory-picker.ts";

interface Call {
	command: string;
	args: readonly string[];
	env?: NodeJS.ProcessEnv;
}

/** A runner that answers each command from a table and records every call. */
function fakeRunner(answers: Record<string, PickerCommandResult>): { run: PickerCommandRunner; calls: Call[] } {
	const calls: Call[] = [];
	return {
		calls,
		run: async (command, args, options) => {
			calls.push({ command, args, env: options.env });
			return answers[command] ?? { code: "ENOENT", stdout: "", stderr: "" };
		},
	};
}

const ok = (stdout: string): PickerCommandResult => ({ code: 0, stdout, stderr: "" });
const signal = new AbortController().signal;

test("the native picker is offered only when the dialog would appear in front of the user", () => {
	const local = { bindHost: "127.0.0.1", env: {} };
	assert.equal(resolveDirectoryPickerMode({ ...local, platform: "darwin" }), "native");
	assert.equal(resolveDirectoryPickerMode({ ...local, platform: "win32" }), "native");
	assert.equal(resolveDirectoryPickerMode({ ...local, platform: "freebsd" }), "browse");
	// Reached over the network or SSH: the dialog would open on an unattended machine.
	assert.equal(resolveDirectoryPickerMode({ bindHost: "0.0.0.0", platform: "darwin", env: {} }), "browse");
	assert.equal(resolveDirectoryPickerMode({ ...local, platform: "win32", env: { SSH_CONNECTION: "1 2 3 4" } }), "browse");
	assert.equal(resolveDirectoryPickerMode({ ...local, platform: "darwin", env: { SSH_TTY: "/dev/ttys001" } }), "browse");
	// An empty export counts as unset.
	assert.equal(resolveDirectoryPickerMode({ ...local, platform: "darwin", env: { SSH_TTY: "" } }), "native");
	assert.equal(
		resolveDirectoryPickerMode({ ...local, platform: "linux", env: { STEPCODE_WEB_DIRECTORY_PICKER: "native" } }),
		"native",
	);
	assert.equal(
		resolveDirectoryPickerMode({ ...local, platform: "darwin", env: { STEPCODE_WEB_DIRECTORY_PICKER: "browse" } }),
		"browse",
	);
});

test("linux needs a display and zenity or kdialog on PATH", async () => {
	const bin = await mkdtemp(join(tmpdir(), "stepcode-picker-bin-"));
	try {
		const base = { bindHost: "127.0.0.1", platform: "linux" as const };
		assert.equal(resolveDirectoryPickerMode({ ...base, env: { DISPLAY: ":0", PATH: bin } }), "browse");
		await writeFile(join(bin, "kdialog"), "");
		assert.equal(resolveDirectoryPickerMode({ ...base, env: { DISPLAY: ":0", PATH: bin } }), "native");
		assert.equal(resolveDirectoryPickerMode({ ...base, env: { WAYLAND_DISPLAY: "wayland-0", PATH: bin } }), "native");
		assert.equal(resolveDirectoryPickerMode({ ...base, env: { PATH: bin } }), "browse");
	} finally {
		await rm(bin, { recursive: true, force: true });
	}
});

test("macOS passes the title and start folder as arguments, not as script source", async () => {
	const start = tmpdir();
	const { run, calls } = fakeRunner({ osascript: ok("/Users/me/project/\n") });
	const title = 'Pick "this" folder';
	const path = await pickNativeDirectory({ title, startIn: start, signal }, { platform: "darwin", run });
	assert.equal(path, "/Users/me/project/");
	const args = calls[0]?.args ?? [];
	assert.deepEqual(args.slice(-2), [title, start]);
	assert.equal(
		args.filter((arg) => arg !== "-e").some((arg) => arg.includes(title)),
		true,
		"title is an argv entry",
	);
	assert.equal(
		args.filter((_arg, index) => args[index - 1] === "-e").some((line) => line.includes(title)),
		false,
		"title never appears inside an -e script line",
	);
});

test("macOS treats AppleScript error -128 as cancel and anything else as a failure", async () => {
	const cancelled = fakeRunner({ osascript: { code: 1, stdout: "", stderr: "execution error: User canceled. (-128)" } });
	assert.equal(await pickNativeDirectory({ title: "t", signal }, { platform: "darwin", run: cancelled.run }), null);
	// A start folder that does not exist is dropped rather than failing the dialog.
	assert.equal(cancelled.calls[0]?.args.at(-1), "t");

	const broken = fakeRunner({ osascript: { code: 1, stdout: "", stderr: "execution error: Not authorized (-1743)" } });
	await assert.rejects(
		pickNativeDirectory({ title: "t", signal }, { platform: "darwin", run: broken.run }),
		/Not authorized/,
	);
});

test("Windows runs the IFileOpenDialog helper with inputs in the environment", async () => {
	const { run, calls } = fakeRunner({ "powershell.exe": ok("C:\\Users\\me\\项目\r\n") });
	const path = await pickNativeDirectory(
		{ title: "选择工作区文件夹", startIn: tmpdir(), signal },
		{ platform: "win32", run, env: { PATH: "x" } },
	);
	assert.equal(path, "C:\\Users\\me\\项目");
	const call = calls[0];
	assert.equal(call?.command, "powershell.exe");
	assert.ok(call?.args.includes("-STA"), "COM dialogs need a single-threaded apartment");
	assert.ok(call?.args.includes("-NoProfile"));
	assert.equal(call?.env?.STEPCODE_PICKER_TITLE, "选择工作区文件夹");
	assert.equal(call?.env?.STEPCODE_PICKER_START, tmpdir());
	assert.equal(call?.env?.PATH, "x");
	const script = Buffer.from(String(call?.args.at(-1)), "base64").toString("utf16le");
	assert.match(script, /IFileOpenDialog/);
	assert.match(script, /FOS_PICKFOLDERS/);
	assert.doesNotMatch(script, /选择工作区文件夹/, "the title is not baked into the script");
	assert.equal(encodePowerShell("ab"), Buffer.from("ab", "utf16le").toString("base64"));

	const cancelled = fakeRunner({ "powershell.exe": { code: 3, stdout: "", stderr: "" } });
	assert.equal(await pickNativeDirectory({ title: "t", signal }, { platform: "win32", run: cancelled.run }), null);
	const missing = fakeRunner({});
	await assert.rejects(
		pickNativeDirectory({ title: "t", signal }, { platform: "win32", run: missing.run }),
		/powershell\.exe is not available/,
	);
});

test("linux uses zenity, falls back to kdialog, and treats exit 1 as cancel", async () => {
	const zenity = fakeRunner({ zenity: ok("/home/me/project\n") });
	assert.equal(await pickNativeDirectory({ title: "t", signal }, { platform: "linux", run: zenity.run }), "/home/me/project");
	assert.ok(zenity.calls[0]?.args.includes("--directory"));

	const kdialog = fakeRunner({ kdialog: ok("/home/me/other\n") });
	assert.equal(await pickNativeDirectory({ title: "t", signal }, { platform: "linux", run: kdialog.run }), "/home/me/other");
	assert.deepEqual(
		kdialog.calls.map((call) => call.command),
		["zenity", "kdialog"],
	);

	const cancelled = fakeRunner({ zenity: { code: 1, stdout: "", stderr: "" } });
	assert.equal(await pickNativeDirectory({ title: "t", signal }, { platform: "linux", run: cancelled.run }), null);
	await assert.rejects(
		pickNativeDirectory({ title: "t", signal }, { platform: "linux", run: fakeRunner({}).run }),
		/install zenity or kdialog/,
	);
});

test("an aborted pick does not report the helper's exit as a choice", async () => {
	const controller = new AbortController();
	const run: PickerCommandRunner = async () => {
		controller.abort();
		return { code: null, stdout: "", stderr: "" };
	};
	await assert.rejects(
		pickNativeDirectory({ title: "t", signal: controller.signal }, { platform: "linux", run }),
		/cancelled/,
	);
});

test("the real runner kills the helper when the signal aborts", { skip: process.platform === "win32" }, async () => {
	const controller = new AbortController();
	const started = Date.now();
	const pending = runPickerCommand("sleep", ["30"], { signal: controller.signal });
	setTimeout(() => controller.abort(), 50);
	const result = await pending;
	assert.notEqual(result.code, 0);
	assert.ok(Date.now() - started < 5000, "the helper did not outlive the abort");
});
