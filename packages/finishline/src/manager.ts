import type { LogEntry, State, Task } from "./state.js";

const DAY = 86_400_000;
const STALL_DAYS = 3;
const IDLE_DAYS = 3;

export interface Warning {
  kind: "idle" | "stalled" | "juggling" | "blocked" | "scope" | "late" | "ship";
  text: string;
}

export interface MilestoneView {
  id: string;
  title: string;
  done: number;
  total: number;
  tasks: Pick<Task, "id" | "title" | "status" | "note" | "scopeCreep">[];
}

/** Everything the dashboard and the text summary need, computed from state. */
export interface StatusView {
  title: string;
  why: string;
  doneWhen: string[];
  outOfScope: string[];
  targetDate?: string;
  projectedDate?: string;
  percent: number;
  done: number;
  total: number;
  phase: "building" | "shipping" | "shipped";
  next: { taskId?: string; text: string; why: string };
  managerNote: string;
  warnings: Warning[];
  milestones: MilestoneView[];
  later: { id: string; title: string }[];
  activity: { date: string; done: number }[];
  streak: number;
  doneThisWeek: number;
  shipCheck?: State["shipCheck"];
  recent: LogEntry[];
  dashboardPath?: string;
}

const active = (t: Task) => t.status !== "later" && t.status !== "dropped";

export function buildStatus(state: State, now = new Date()): StatusView {
  const tasks = state.tasks.filter(active);
  const done = tasks.filter((t) => t.status === "done").length;
  const total = tasks.length;
  const percent = total ? Math.round((done / total) * 100) : 0;

  const milestones: MilestoneView[] = state.milestones.map((m) => {
    const mt = tasks.filter((t) => t.milestoneId === m.id);
    return {
      id: m.id,
      title: m.title,
      done: mt.filter((t) => t.status === "done").length,
      total: mt.length,
      tasks: mt.map(({ id, title, status, note, scopeCreep }) => ({ id, title, status, note, scopeCreep })),
    };
  });

  const ship = state.shipCheck;
  const shipFailing = ship ? ship.items.filter((i) => !i.pass) : [];
  const allDone = total > 0 && done === total;
  const phase = !allDone ? "building" : ship && shipFailing.length === 0 ? "shipped" : "shipping";

  const warnings = buildWarnings(state, tasks, now);
  const { projectedDate, late } = projection(state, done, total, now);
  if (late) warnings.push({ kind: "late", text: late });
  if (phase === "shipping" && ship && shipFailing.length) {
    warnings.push({ kind: "ship", text: `${shipFailing.length} ship-readiness check(s) failing.` });
  }

  const activity = dailyActivity(state, now, 14);
  const streak = (() => {
    let n = 0;
    for (let i = activity.length - 1; i >= 0 && activity[i].done > 0; i--) n++;
    return n;
  })();

  return {
    title: state.goal.title,
    why: state.goal.why,
    doneWhen: state.goal.doneWhen,
    outOfScope: state.goal.outOfScope,
    targetDate: state.goal.targetDate,
    projectedDate,
    percent,
    done,
    total,
    phase,
    next: nextAction(state, tasks, phase, now),
    managerNote: managerNote(state, percent, phase, warnings, streak, now),
    warnings,
    milestones,
    later: state.tasks.filter((t) => t.status === "later").map(({ id, title }) => ({ id, title })),
    activity,
    streak,
    doneThisWeek: activity.slice(-7).reduce((a, d) => a + d.done, 0),
    shipCheck: ship,
    recent: state.log.slice(-6).reverse(),
  };
}

function nextAction(state: State, tasks: Task[], phase: StatusView["phase"], now: Date): StatusView["next"] {
  const doing = tasks.filter((t) => t.status === "doing").sort(byStarted);
  if (doing.length) {
    const t = doing[0];
    const days = daysSince(t.startedAt, now);
    if (days >= STALL_DAYS) {
      return {
        taskId: t.id,
        text: `Split "${t.title}" into 2-3 smaller tasks, then finish the first one`,
        why: `It has been in progress for ${days} days. Big tasks are where projects stall.`,
      };
    }
    return { taskId: t.id, text: `Finish "${t.title}"`, why: "Finish what's in progress before starting anything new." };
  }

  for (const m of state.milestones) {
    const t = tasks.find((x) => x.milestoneId === m.id && x.status === "todo");
    if (t) return { taskId: t.id, text: `Start "${t.title}"`, why: `Next step in milestone "${m.title}".` };
  }

  const blocked = tasks.find((t) => t.status === "blocked");
  if (blocked) {
    return {
      taskId: blocked.id,
      text: `Unblock "${blocked.title}"`,
      why: blocked.note ? `Blocked: ${blocked.note}` : "Everything else is done. This is the only thing left.",
    };
  }

  if (phase === "shipping") {
    const failing = state.shipCheck?.items.find((i) => !i.pass);
    if (!state.shipCheck) {
      return { text: "Run ship_check", why: "All planned tasks are done. Check what's missing before release." };
    }
    if (failing) return { text: failing.fix ?? `Fix: ${failing.label}`, why: failing.detail };
  }
  if (phase === "shipped") return { text: "Ship it 🚀", why: "Every task is done and every ship check passes." };
  return { text: "Plan the first milestone", why: "There are no tasks yet." };
}

function buildWarnings(state: State, tasks: Task[], now: Date): Warning[] {
  const w: Warning[] = [];
  const last = state.log.at(-1)?.at;
  const idle = daysSince(last, now);
  if (idle >= IDLE_DAYS) {
    w.push({ kind: "idle", text: `No activity for ${idle} days. Recap where things stand before diving back in.` });
  }
  for (const t of tasks.filter((t) => t.status === "doing")) {
    const d = daysSince(t.startedAt, now);
    if (d >= STALL_DAYS) w.push({ kind: "stalled", text: `"${t.title}" has been in progress for ${d} days.` });
  }
  const doing = tasks.filter((t) => t.status === "doing").length;
  if (doing > 2) w.push({ kind: "juggling", text: `${doing} tasks in progress at once. Finish one before starting more.` });
  const blocked = tasks.filter((t) => t.status === "blocked");
  if (blocked.length) w.push({ kind: "blocked", text: `${blocked.length} blocked: ${blocked.map((t) => t.title).join(", ")}` });

  const later = state.tasks.filter((t) => t.status === "later" && t.scopeCreep).length;
  const planned = state.tasks.filter((t) => !t.scopeCreep).length;
  if (later >= 3 && later / Math.max(planned, 1) >= 0.2) {
    w.push({
      kind: "scope",
      text: `${later} ideas parked outside the plan (${Math.round((later / planned) * 100)}% of its size). Keep them parked until this ships.`,
    });
  }
  return w;
}

/** Projects a finish date from the pace of the last 14 days. */
function projection(state: State, done: number, total: number, now: Date) {
  const remaining = total - done;
  if (remaining <= 0) return {};
  const since = new Date(Math.max(now.getTime() - 14 * DAY, Date.parse(state.goal.createdAt)));
  const recentDone = state.tasks.filter((t) => t.doneAt && Date.parse(t.doneAt) >= since.getTime()).length;
  const days = Math.max(1, (now.getTime() - since.getTime()) / DAY);
  if (recentDone === 0) return {};
  const projected = new Date(now.getTime() + (remaining / (recentDone / days)) * DAY);
  const projectedDate = projected.toISOString().slice(0, 10);
  const target = state.goal.targetDate;
  const late =
    target && projectedDate > target
      ? `At the current pace you'll finish around ${projectedDate}, after the ${target} target. Cut scope or move the date.`
      : undefined;
  return { projectedDate, late };
}

function dailyActivity(state: State, now: Date, days: number) {
  const out: { date: string; done: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now.getTime() - i * DAY).toISOString().slice(0, 10);
    out.push({ date, done: state.tasks.filter((t) => t.doneAt?.startsWith(date)).length });
  }
  return out;
}

function managerNote(
  state: State,
  percent: number,
  phase: StatusView["phase"],
  warnings: Warning[],
  streak: number,
  now: Date,
): string {
  if (phase === "shipped") return "Done means done. Ship it, announce it, then celebrate.";
  if (warnings.some((w) => w.kind === "idle")) {
    return "Welcome back. Give the user a 3-line recap of where things stand, then do the next action together.";
  }
  if (phase === "shipping") return "All features are done. This last stretch is where most projects die: close it out.";
  if (warnings.some((w) => w.kind === "stalled" || w.kind === "juggling")) {
    return "Momentum is leaking. Shrink the current task until it can be finished today.";
  }
  if (percent >= 80) return "Final stretch. Say no to new ideas: park them with update_plan and keep going.";
  if (streak >= 3) return `${streak}-day streak. Keep it alive with one small finished task today.`;
  if (percent === 0) return "Start with the smallest task that proves the idea works end to end.";
  return `Day ${daysSince(state.goal.createdAt, now) + 1}, ${percent}% done. One task at a time.`;
}

const byStarted = (a: Task, b: Task) => (a.startedAt ?? "").localeCompare(b.startedAt ?? "");

function daysSince(iso: string | undefined, now: Date): number {
  return iso ? Math.floor((now.getTime() - Date.parse(iso)) / DAY) : 0;
}

export function formatStatus(v: StatusView): string {
  const bar = "█".repeat(Math.round(v.percent / 10)) + "░".repeat(10 - Math.round(v.percent / 10));
  const lines = [
    `# ${v.title}`,
    `${bar} ${v.percent}% (${v.done}/${v.total} tasks) · phase: ${v.phase}` +
      (v.targetDate ? ` · target ${v.targetDate}` : "") +
      (v.projectedDate ? ` · projected ${v.projectedDate}` : ""),
    "",
    `**Next:** ${v.next.text}${v.next.taskId ? ` [${v.next.taskId}]` : ""}. ${v.next.why}`,
    `**Manager's note:** ${v.managerNote}`,
  ];
  if (v.warnings.length) lines.push("", "Warnings:", ...v.warnings.map((w) => `- ⚠ ${w.text}`));
  lines.push("", "Milestones:");
  for (const m of v.milestones) {
    lines.push(`- ${m.done === m.total && m.total ? "✅" : "⬜"} ${m.title} (${m.done}/${m.total})`);
    for (const t of m.tasks.filter((t) => t.status !== "done")) {
      lines.push(`  - [${t.id}] ${t.title} (${t.status}${t.note ? `: ${t.note}` : ""})`);
    }
  }
  if (v.later.length) lines.push("", `Parked for later: ${v.later.map((t) => t.title).join(", ")}`);
  if (v.shipCheck) {
    const failing = v.shipCheck.items.filter((i) => !i.pass);
    lines.push("", `Ship readiness: ${v.shipCheck.score}%${failing.length ? ` (missing: ${failing.map((i) => i.label).join(", ")})` : ""}`);
  }
  lines.push("", `Done when: ${v.doneWhen.join("; ")}`);
  if (v.dashboardPath) lines.push(`Dashboard: ${v.dashboardPath}`);
  return lines.join("\n");
}
