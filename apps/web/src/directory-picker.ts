import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

/**
 * How "Add workspace" chooses a folder.
 *
 * - `native`: the Host opens the operating system's folder chooser and returns
 *   the absolute path. A browser cannot do this itself: its directory pickers
 *   hand the page file contents, never a path.
 * - `browse`: the in-page folder browser, which works everywhere.
 */
export type DirectoryPickerMode = "native" | "browse";

export interface PickDirectoryOptions {
	/** Dialog title. */
	readonly title: string;
	/** Folder the dialog starts in; ignored unless it is an existing directory. */
	readonly startIn?: string;
	readonly signal: AbortSignal;
}

/** Result of one helper run, shaped like `execFile`'s callback. */
export interface PickerCommandResult {
	readonly code: number | string | null;
	readonly stdout: string;
	readonly stderr: string;
}

export type PickerCommandRunner = (
	command: string,
	args: readonly string[],
	options: { readonly signal: AbortSignal; readonly env?: NodeJS.ProcessEnv },
) => Promise<PickerCommandResult>;

/** Exit code the Windows helper uses for "the user cancelled". */
const WINDOWS_CANCEL_EXIT = 3;

/**
 * Run a helper without a shell. Arguments are passed as argv, never
 * interpolated into a command line, so a folder name cannot inject anything.
 */
export const runPickerCommand: PickerCommandRunner = (command, args, options) =>
	new Promise((resolve) => {
		execFile(
			command,
			[...args],
			{ signal: options.signal, env: options.env, windowsHide: true, encoding: "utf8", maxBuffer: 1024 * 1024 },
			(error, stdout, stderr) => {
				// A numeric code is the exit status; a string is a spawn error such
				// as ENOENT; null means the helper was killed by a signal.
				const raw = (error as { code?: unknown } | null)?.code;
				const code = !error ? 0 : typeof raw === "number" || typeof raw === "string" ? raw : null;
				resolve({ code, stdout, stderr });
			},
		);
	});

function onPath(command: string, env: NodeJS.ProcessEnv): boolean {
	return (env.PATH ?? "").split(delimiter).some((directory) => directory && existsSync(join(directory, command)));
}

const present = (value: string | undefined): boolean => value !== undefined && value.trim() !== "";

/**
 * Decide once at startup which picker this Host offers.
 *
 * The native chooser opens on the machine running the Host, so it is only
 * offered when that is the machine in front of the user: a loopback bind, no
 * SSH session, and a desktop. Linux additionally needs a display and zenity or
 * kdialog. Anything ambiguous falls back to `browse`.
 * `STEPCODE_WEB_DIRECTORY_PICKER=native|browse` overrides the detection.
 */
export function resolveDirectoryPickerMode(facts: {
	readonly bindHost: string;
	readonly platform: NodeJS.Platform;
	readonly env: NodeJS.ProcessEnv;
}): DirectoryPickerMode {
	const forced = facts.env.STEPCODE_WEB_DIRECTORY_PICKER?.trim();
	if (forced === "native" || forced === "browse") return forced;
	if (facts.bindHost !== "127.0.0.1") return "browse";
	if (present(facts.env.SSH_CONNECTION) || present(facts.env.SSH_TTY)) return "browse";
	if (facts.platform === "darwin" || facts.platform === "win32") return "native";
	if (facts.platform !== "linux") return "browse";
	if (!present(facts.env.DISPLAY) && !present(facts.env.WAYLAND_DISPLAY)) return "browse";
	return onPath("zenity", facts.env) || onPath("kdialog", facts.env) ? "native" : "browse";
}

function existingDirectory(path: string | undefined): string | undefined {
	if (!path || !isAbsolute(path)) return undefined;
	try {
		return statSync(path).isDirectory() ? path : undefined;
	} catch {
		return undefined;
	}
}

/** The chosen path from a helper's stdout, or null when it printed nothing. */
function outputPath(stdout: string): string | null {
	// A byte-order mark can lead a redirected Windows console stream.
	const path = stdout.replace(/^\uFEFF/u, "").replace(/[\r\n]+$/u, "");
	return path ? path : null;
}

function failure(command: string, result: PickerCommandResult): Error {
	if (result.code === "ENOENT") return new Error(`${command} is not available on this machine`);
	const detail = result.stderr.trim().split(/\r?\n/u).at(-1) ?? "";
	return new Error(`Folder picker failed (${command} exit ${String(result.code)})${detail ? `: ${detail}` : ""}`);
}

/**
 * The Windows helper: PowerShell compiles a small C# wrapper around the Vista
 * `IFileOpenDialog` in folder mode, the same dialog Explorer uses. The older
 * `FolderBrowserDialog` would show a tree-only picker on Windows PowerShell
 * 5.1, which ships with every supported Windows.
 *
 * The title and start folder arrive through environment variables rather than
 * the script text, so no escaping is involved. The path is written as UTF-8 so
 * non-ASCII folder names survive the pipe.
 */
const WINDOWS_PICKER_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class StepCodeFolderPicker {
  [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]
  private class FileOpenDialog {}

  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IShellItem {
    void BindToHandler(IntPtr pbc, [MarshalAs(UnmanagedType.LPStruct)] Guid bhid, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, out IntPtr ppv);
    void GetParent(out IShellItem ppsi);
    void GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
    void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
    void Compare(IShellItem psi, uint hint, out int piOrder);
  }

  // Declared up to GetResult, the last method used; COM only needs the vtable prefix.
  [ComImport, Guid("D57C7288-D4AD-4768-BE02-9D969532D960"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IFileOpenDialog {
    [PreserveSig] int Show(IntPtr parent);
    void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
    void SetFileTypeIndex(uint iFileType);
    void GetFileTypeIndex(out uint piFileType);
    void Advise(IntPtr pfde, out uint pdwCookie);
    void Unadvise(uint dwCookie);
    void SetOptions(uint fos);
    void GetOptions(out uint pfos);
    void SetDefaultFolder(IShellItem psi);
    void SetFolder(IShellItem psi);
    void GetFolder(out IShellItem ppsi);
    void GetCurrentSelection(out IShellItem ppsi);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
    void GetResult(out IShellItem ppsi);
  }

  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  private static extern void SHCreateItemFromParsingName(string pszPath, IntPtr pbc, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, out IShellItem ppv);

  private const uint FOS_NOCHANGEDIR = 0x8;
  private const uint FOS_PICKFOLDERS = 0x20;
  private const uint FOS_FORCEFILESYSTEM = 0x40;
  private const uint FOS_PATHMUSTEXIST = 0x800;
  private const uint SIGDN_FILESYSPATH = 0x80058000;
  private const int ERROR_CANCELLED = unchecked((int)0x800704C7);

  public static string Pick(string title, string startIn) {
    IFileOpenDialog dialog = (IFileOpenDialog)new FileOpenDialog();
    try {
      uint options;
      dialog.GetOptions(out options);
      dialog.SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST | FOS_NOCHANGEDIR);
      if (!String.IsNullOrEmpty(title)) dialog.SetTitle(title);
      if (!String.IsNullOrEmpty(startIn)) {
        try {
          IShellItem folder;
          SHCreateItemFromParsingName(startIn, IntPtr.Zero, typeof(IShellItem).GUID, out folder);
          dialog.SetFolder(folder);
        } catch (Exception) {
          // An unreadable start folder is not worth failing the picker over.
        }
      }
      int hr = dialog.Show(IntPtr.Zero);
      if (hr == ERROR_CANCELLED) return null;
      Marshal.ThrowExceptionForHR(hr);
      IShellItem item;
      dialog.GetResult(out item);
      string path;
      item.GetDisplayName(SIGDN_FILESYSPATH, out path);
      return path;
    } finally {
      Marshal.ReleaseComObject(dialog);
    }
  }
}
'@
$picked = [StepCodeFolderPicker]::Pick($env:STEPCODE_PICKER_TITLE, $env:STEPCODE_PICKER_START)
if ($null -eq $picked) { exit ${WINDOWS_CANCEL_EXIT} }
[Console]::Out.Write($picked)
`;

/** PowerShell's -EncodedCommand takes base64 of UTF-16LE. */
export function encodePowerShell(script: string): string {
	return Buffer.from(script, "utf16le").toString("base64");
}

/**
 * Open the operating system's folder chooser on this machine.
 * @returns the chosen absolute path, or null when the user cancelled.
 */
export async function pickNativeDirectory(
	options: PickDirectoryOptions,
	internals: {
		readonly platform?: NodeJS.Platform;
		readonly run?: PickerCommandRunner;
		readonly env?: NodeJS.ProcessEnv;
	} = {},
): Promise<string | null> {
	const platform = internals.platform ?? process.platform;
	const run = internals.run ?? runPickerCommand;
	const env = internals.env ?? process.env;
	const startIn = existingDirectory(options.startIn);
	const { signal } = options;
	const aborted = () => {
		if (signal.aborted) throw new Error("Folder picker was cancelled");
	};

	if (platform === "darwin") {
		// `on run argv` receives the title and start folder as arguments, so
		// neither is ever parsed as AppleScript source.
		const script = [
			"on run argv",
			"if (count of argv) > 1 then",
			"set chosen to choose folder with prompt (item 1 of argv) default location (POSIX file (item 2 of argv))",
			"else",
			"set chosen to choose folder with prompt (item 1 of argv)",
			"end if",
			"return POSIX path of chosen",
			"end run",
		];
		const args = [...script.flatMap((line) => ["-e", line]), options.title, ...(startIn ? [startIn] : [])];
		const result = await run("osascript", args, { signal, env });
		aborted();
		if (result.code === 0) return outputPath(result.stdout);
		// -128 is AppleScript's "User canceled".
		if (result.code === 1 && /-128|User cancel/iu.test(result.stderr)) return null;
		throw failure("osascript", result);
	}

	if (platform === "win32") {
		const result = await run(
			"powershell.exe",
			[
				"-NoProfile",
				"-NonInteractive",
				"-STA",
				"-ExecutionPolicy",
				"Bypass",
				"-EncodedCommand",
				encodePowerShell(WINDOWS_PICKER_SCRIPT),
			],
			{ signal, env: { ...env, STEPCODE_PICKER_TITLE: options.title, STEPCODE_PICKER_START: startIn ?? "" } },
		);
		aborted();
		if (result.code === 0) return outputPath(result.stdout);
		if (result.code === WINDOWS_CANCEL_EXIT) return null;
		throw failure("powershell.exe", result);
	}

	if (platform === "linux") {
		// zenity and kdialog both exit 1 on cancel.
		const zenity = await run(
			"zenity",
			[
				"--file-selection",
				"--directory",
				`--title=${options.title}`,
				...(startIn ? [`--filename=${startIn}/`] : []),
			],
			{ signal, env },
		);
		aborted();
		if (zenity.code === 0) return outputPath(zenity.stdout);
		if (zenity.code === 1) return null;
		if (zenity.code !== "ENOENT") throw failure("zenity", zenity);
		const kdialog = await run("kdialog", ["--getexistingdirectory", startIn ?? ".", "--title", options.title], {
			signal,
			env,
		});
		aborted();
		if (kdialog.code === 0) return outputPath(kdialog.stdout);
		if (kdialog.code === 1) return null;
		if (kdialog.code === "ENOENT") throw new Error("No folder picker found; install zenity or kdialog");
		throw failure("kdialog", kdialog);
	}

	throw new Error(`The system folder picker is not supported on ${platform}`);
}
