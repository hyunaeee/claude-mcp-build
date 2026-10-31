import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export type TaskStatus = "todo" | "doing" | "done" | "blocked" | "later" | "dropped";

export interface Task {
  id: string;
  title: string;
  milestoneId: string;
  status: TaskStatus;
  createdAt: string;
  startedAt?: string;
  doneAt?: string;
  note?: string;
  /** Added after the plan was set, without the user confirming it belongs in scope. */
  scopeCreep?: boolean;
}

export interface Milestone {
  id: string;
  title: string;
}

export interface ShipItem {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
  fix?: string;
}

export interface LogEntry {
  at: string;
  kind: "start" | "done" | "blocked" | "added" | "scope" | "session" | "ship" | "plan";
  text: string;
}

export interface State {
  version: 1;
  goal: {
    title: string;
    why: string;
    doneWhen: string[];
    outOfScope: string[];
    targetDate?: string;
    createdAt: string;
  };
  milestones: Milestone[];
  tasks: Task[];
  log: LogEntry[];
  shipCheck?: { at: string; score: number; items: ShipItem[] };
  nextId: number;
}

export function projectDir(dir?: string): string {
  return resolve(dir ?? process.env.FINISHLINE_DIR ?? process.cwd());
}

export const stateDir = (dir: string) => join(dir, ".finishline");
const statePath = (dir: string) => join(stateDir(dir), "state.json");

export async function loadState(dir: string): Promise<State | undefined> {
  try {
    return JSON.parse(await readFile(statePath(dir), "utf8")) as State;
  } catch (e: any) {
    if (e.code === "ENOENT") return undefined;
    throw new Error(`Could not read ${statePath(dir)}: ${e.message}`);
  }
}

export async function requireState(dir: string): Promise<State> {
  const s = await loadState(dir);
  if (!s) {
    throw new Error(
      `No finishline project in ${dir}. Interview the user about their goal and call start_project first.`,
    );
  }
  return s;
}

export async function saveState(dir: string, state: State): Promise<void> {
  await mkdir(stateDir(dir), { recursive: true });
  // Write-then-rename so a crash never leaves a half-written plan behind.
  const tmp = statePath(dir) + ".tmp";
  await writeFile(tmp, JSON.stringify(state, null, 2) + "\n");
  await rename(tmp, statePath(dir));
}

export function newId(state: State, prefix: string): string {
  return `${prefix}${state.nextId++}`;
}

export function log(state: State, kind: LogEntry["kind"], text: string): void {
  state.log.push({ at: new Date().toISOString(), kind, text });
  if (state.log.length > 500) state.log.splice(0, state.log.length - 500);
}
