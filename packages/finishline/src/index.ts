#!/usr/bin/env node
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { sessionStartHook } from "./hook.js";
import { buildStatus, formatStatus } from "./manager.js";
import { shipCheck } from "./shipcheck.js";
import { loadState, log, newId, projectDir, requireState, saveState, stateDir, type State, type Task } from "./state.js";
import { dashboardHtml } from "./view.js";

const DASHBOARD_URI = "ui://finishline/dashboard.html";
const SHIP_MILESTONE = "Ship it";

const server = new McpServer(
  { name: "finishline", version: "0.1.0" },
  {
    instructions:
      "finishline is the user's project manager. Its job is to get the project FINISHED, not just started.\n" +
      "- At the start of every session, and whenever the user asks what to do next or how things are going, call `status` and lead with its Next action.\n" +
      "- If there is no project yet and the user is starting something, interview them briefly (what, why, what 'done' looks like, what is out of scope, deadline) and call `start_project`.\n" +
      "- Keep the plan in sync as you work: call `update_plan` when you start or finish a task.\n" +
      "- When the user raises a new idea mid-project, park it with `update_plan` (add without in_scope_confirmed) instead of doing it, unless they insist it is required to ship.\n" +
      "- When the planned work is done, run `ship_check` and close the gaps.",
  },
);

const dirArg = z.string().optional().describe("Project root. Defaults to the server's working directory.");

server.registerResource(
  "dashboard",
  DASHBOARD_URI,
  { title: "Finishline dashboard", mimeType: "text/html;profile=mcp-app" },
  async () => ({ contents: [{ uri: DASHBOARD_URI, mimeType: "text/html;profile=mcp-app", text: dashboardHtml() }] }),
);

server.registerTool(
  "start_project",
  {
    title: "Start a project",
    description:
      "Create the project plan. Before calling, interview the user in a few quick questions: what they're building, why, " +
      "what concrete outcome means DONE, what is explicitly out of scope, and any deadline. Then propose 2-5 small milestones " +
      "where the first one delivers a rough end-to-end version. Each task should fit in a single work session. " +
      `A final "${SHIP_MILESTONE}" milestone with release tasks is added automatically.`,
    inputSchema: {
      project_dir: dirArg,
      title: z.string().describe("Project name"),
      why: z.string().describe("One sentence: why this matters to the user"),
      done_when: z.array(z.string()).min(1).max(6).describe("Concrete, checkable outcomes that mean the project is finished"),
      out_of_scope: z.array(z.string()).default([]).describe("Things deliberately NOT part of this version"),
      target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD"),
      milestones: z
        .array(z.object({ title: z.string(), tasks: z.array(z.string()).min(1) }))
        .min(1)
        .max(8),
      replace: z.boolean().default(false).describe("Overwrite an existing plan. Only with the user's explicit OK."),
    },
    _meta: { ui: { resourceUri: DASHBOARD_URI }, "ui/resourceUri": DASHBOARD_URI },
  },
  async (a) => {
    const dir = projectDir(a.project_dir);
    if ((await loadState(dir)) && !a.replace) {
      throw new Error("A plan already exists here. Call status instead, or pass replace: true if the user wants to start over.");
    }
    const now = new Date().toISOString();
    const state: State = {
      version: 1,
      goal: { title: a.title, why: a.why, doneWhen: a.done_when, outOfScope: a.out_of_scope, targetDate: a.target_date, createdAt: now },
      milestones: [],
      tasks: [],
      log: [],
      nextId: 1,
    };
    const milestones = [
      ...a.milestones.filter((m) => m.title.toLowerCase() !== SHIP_MILESTONE.toLowerCase()),
      { title: SHIP_MILESTONE, tasks: ["Run ship_check and close the gaps", "Release it (publish, deploy or hand over)", "Tell people: share the link"] },
    ];
    for (const m of milestones) {
      const mid = newId(state, "m");
      state.milestones.push({ id: mid, title: m.title });
      for (const title of m.tasks) state.tasks.push(task(state, title, mid, now));
    }
    log(state, "plan", `Project started: ${a.title}`);
    await saveState(dir, state);
    return statusResult(dir, state, "Project created. Show the user the plan and the first next action.");
  },
);

server.registerTool(
  "status",
  {
    title: "Project status",
    description:
      "Show where the project stands: progress, the single next action, warnings (stalled tasks, scope creep, deadline risk) " +
      "and ship readiness, as a visual dashboard. Call this at the START of every session and whenever the user asks " +
      "what's next, where they are, or seems unsure what to do.",
    inputSchema: { project_dir: dirArg },
    _meta: { ui: { resourceUri: DASHBOARD_URI }, "ui/resourceUri": DASHBOARD_URI },
  },
  async ({ project_dir }) => {
    const dir = projectDir(project_dir);
    return statusResult(dir, await requireState(dir));
  },
);

const actions = ["start", "done", "block", "unblock", "reopen", "later", "drop"] as const;

server.registerTool(
  "update_plan",
  {
    title: "Update the plan",
    description:
      "Record progress and changes: start/finish/block tasks, add tasks, and log a session note. " +
      "Call it when you begin a task, right after finishing one, and at the end of a work session. " +
      "New ideas raised mid-project are parked for later by default; set in_scope_confirmed only when the user says the task is required to meet the done criteria.",
    inputSchema: {
      project_dir: dirArg,
      changes: z
        .array(z.object({ id: z.string().describe('Task id, e.g. "t4"'), action: z.enum(actions), note: z.string().optional() }))
        .default([]),
      add: z
        .array(
          z.object({
            title: z.string(),
            milestone: z.string().optional().describe("Milestone id or title. A new title creates a milestone before Ship it."),
            in_scope_confirmed: z.boolean().default(false),
          }),
        )
        .default([]),
      session_note: z.string().optional().describe("What happened this session, for the next session's recap"),
    },
  },
  async ({ project_dir, changes, add, session_note }) => {
    const dir = projectDir(project_dir);
    const state = await requireState(dir);
    const now = new Date().toISOString();
    const out: string[] = [];
    const before = completedMilestones(state);

    for (const c of changes) {
      const t = state.tasks.find((x) => x.id === c.id);
      if (!t) {
        out.push(`! Unknown task ${c.id}`);
        continue;
      }
      applyAction(t, c.action, now);
      if (c.note) t.note = c.note;
      const verb = { start: "Started", done: "Done", block: "Blocked", unblock: "Unblocked", reopen: "Reopened", later: "Parked", drop: "Dropped" }[c.action];
      log(state, c.action === "done" ? "done" : c.action === "block" ? "blocked" : c.action === "start" ? "start" : "scope", `${verb}: ${t.title}${c.note ? ` (${c.note})` : ""}`);
      out.push(`${verb} [${t.id}] ${t.title}`);
    }

    for (const a of add) {
      const mid = resolveMilestone(state, a.milestone);
      const t = task(state, a.title, mid, now);
      if (!a.in_scope_confirmed) {
        t.status = "later";
        t.scopeCreep = true;
        log(state, "scope", `Parked idea: ${a.title}`);
        out.push(`Parked [${t.id}] ${a.title}: not part of the current plan. Revisit after shipping.`);
      } else {
        log(state, "added", `Added: ${a.title}`);
        out.push(`Added [${t.id}] ${a.title}`);
      }
      state.tasks.push(t);
    }

    if (session_note) log(state, "session", session_note);
    await saveState(dir, state);

    const finished = completedMilestones(state).filter((m) => !before.includes(m));
    for (const m of finished) out.push(`🎉 Milestone complete: ${m}. Celebrate this with the user.`);

    const v = buildStatus(state);
    await writeDashboard(dir, v);
    out.push(`Progress: ${v.percent}% (${v.done}/${v.total}). Next: ${v.next.text}. ${v.next.why}`);
    return { content: [{ type: "text", text: out.join("\n") }] };
  },
);

server.registerTool(
  "ship_check",
  {
    title: "Ship readiness check",
    description:
      "Audit the project for the unglamorous last 20% that stops projects from shipping: README, license, tests, CI, " +
      "secret hygiene, leftover TODOs, vulnerable or deprecated dependencies, and package metadata. " +
      `Failing checks are added as tasks to the "${SHIP_MILESTONE}" milestone. Run it when the planned features are done, or any time to see the gap.`,
    inputSchema: {
      project_dir: dirArg,
      add_tasks: z.boolean().default(true).describe("Add failing checks as tasks"),
      check_dependencies: z.boolean().default(true).describe("Query registries and OSV for dependency health"),
    },
  },
  async ({ project_dir, add_tasks, check_dependencies }) => {
    const dir = projectDir(project_dir);
    const state = await requireState(dir);
    const items = await shipCheck(dir, { deps: check_dependencies });
    const passed = items.filter((i) => i.pass).length;
    const score = Math.round((passed / items.length) * 100);
    const now = new Date().toISOString();
    state.shipCheck = { at: now, score, items };

    const added: string[] = [];
    if (add_tasks) {
      const mid = resolveMilestone(state, SHIP_MILESTONE);
      // Insert fixes before the generic release tasks, keeping check order.
      let at = state.tasks.findIndex((x) => x.milestoneId === mid);
      if (at < 0) at = state.tasks.length;
      for (const i of items.filter((i) => !i.pass && i.fix)) {
        if (state.tasks.some((t) => t.title === i.fix && t.status !== "dropped")) continue;
        const t = task(state, i.fix!, mid, now);
        state.tasks.splice(at++, 0, t);
        added.push(`[${t.id}] ${t.title}`);
      }
    }
    const runTask = state.tasks.find((t) => t.title.startsWith("Run ship_check") && t.status !== "done");
    if (runTask) applyAction(runTask, "done", now);
    log(state, "ship", `Ship check: ${score}%`);
    await saveState(dir, state);
    await writeDashboard(dir, buildStatus(state));

    const lines = [
      `Ship readiness: ${score}% (${passed}/${items.length})`,
      ...items.map((i) => `${i.pass ? "✓" : "✕"} ${i.label}: ${i.detail}`),
    ];
    if (added.length) lines.push("", `Added to "${SHIP_MILESTONE}":`, ...added.map((a) => `- ${a}`));
    return { content: [{ type: "text", text: lines.join("\n") }] };
  },
);

function task(state: State, title: string, milestoneId: string, now: string): Task {
  return { id: newId(state, "t"), title, milestoneId, status: "todo", createdAt: now };
}

function applyAction(t: Task, action: (typeof actions)[number], now: string) {
  switch (action) {
    case "start":
      t.status = "doing";
      t.startedAt = now;
      break;
    case "done":
      t.status = "done";
      t.doneAt = now;
      t.startedAt ??= now;
      break;
    case "block":
      t.status = "blocked";
      break;
    case "unblock":
      t.status = t.startedAt ? "doing" : "todo";
      break;
    case "reopen":
      t.status = "todo";
      t.doneAt = undefined;
      t.scopeCreep = false;
      break;
    case "later":
      t.status = "later";
      break;
    case "drop":
      t.status = "dropped";
      break;
  }
}

function resolveMilestone(state: State, ref: string | undefined): string {
  const ship = state.milestones.find((m) => m.title === SHIP_MILESTONE);
  if (!ref) {
    // Default to the first milestone that still has open work.
    const open = state.milestones.find((m) => state.tasks.some((t) => t.milestoneId === m.id && (t.status === "todo" || t.status === "doing")));
    return (open ?? ship ?? state.milestones[0]).id;
  }
  const found = state.milestones.find((m) => m.id === ref || m.title.toLowerCase() === ref.toLowerCase());
  if (found) return found.id;
  const m = { id: newId(state, "m"), title: ref };
  const shipIdx = ship ? state.milestones.indexOf(ship) : state.milestones.length;
  state.milestones.splice(shipIdx, 0, m);
  return m.id;
}

function completedMilestones(state: State): string[] {
  return state.milestones
    .filter((m) => {
      const ts = state.tasks.filter((t) => t.milestoneId === m.id && t.status !== "later" && t.status !== "dropped");
      return ts.length > 0 && ts.every((t) => t.status === "done");
    })
    .map((m) => m.title);
}

async function writeDashboard(dir: string, v: ReturnType<typeof buildStatus>): Promise<string> {
  const path = join(stateDir(dir), "dashboard.html");
  await mkdir(stateDir(dir), { recursive: true });
  await writeFile(path, dashboardHtml(v));
  return path;
}

async function statusResult(dir: string, state: State, lead?: string) {
  const v = buildStatus(state);
  v.dashboardPath = await writeDashboard(dir, v);
  const text = (lead ? lead + "\n\n" : "") + formatStatus(v);
  return { content: [{ type: "text" as const, text }], structuredContent: v as unknown as Record<string, unknown> };
}

if (process.argv.includes("--session-start")) {
  await sessionStartHook();
} else {
  await server.connect(new StdioServerTransport());
}
