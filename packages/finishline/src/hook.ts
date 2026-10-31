import { buildStatus, formatStatus } from "./manager.js";
import { loadState, projectDir } from "./state.js";

const MAX_CONTEXT = 9_000;

async function readStdin(): Promise<any> {
  if (process.stdin.isTTY) return {};
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Claude Code SessionStart hook: injects the project's status into the new session so Claude
 * opens with the next action without the user having to ask.
 */
export async function sessionStartHook(): Promise<void> {
  const input = await readStdin();
  const dir = projectDir(input.cwd ?? process.env.CLAUDE_PROJECT_DIR);
  const state = await loadState(dir).catch(() => undefined);

  let context: string;
  if (state) {
    const v = buildStatus(state);
    let status = formatStatus(v);
    if (status.length > MAX_CONTEXT) status = status.slice(0, MAX_CONTEXT) + "\n…(truncated, call status for the full view)";
    context =
      "finishline project plan for this repository (.finishline/state.json). The user installed finishline so that each " +
      "session picks up where the last one left off and the project gets finished.\n" +
      `The recommended starting point for this session is: ${v.next.text}.\n\n${status}`;
  } else if (!input.source || input.source === "startup") {
    context =
      "finishline is installed, but this repository has no project plan yet (.finishline/state.json not found). " +
      "If the user is starting or continuing a project here, start_project can set up a plan.";
  } else {
    return;
  }

  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context } }),
  );
}
