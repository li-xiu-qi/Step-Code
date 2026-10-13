// Match apps/cli/src/main.ts: opt into the StepCode config/storage namespace
// before the coding-agent module graph is evaluated.
process.env.STEPCODE_ENTRYPOINT = "1";
