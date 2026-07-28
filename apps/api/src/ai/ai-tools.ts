/**
 * The read-only menu the assistant may call.
 *
 * Split from the service so the CONTRACT (what the model is offered, and in
 * what words) is readable in one place — the descriptions are prompt, not
 * documentation: they are the only thing telling the model when each tool is
 * the right one, and a vague description is indistinguishable from a missing
 * tool.
 *
 * Every tool is a read. There is deliberately no way to write anything from
 * here: the assistant is a window, not a control panel.
 */
export interface AiToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

const NO_ARGS = { type: 'object', properties: {}, additionalProperties: false };

export const AI_TOOLS: AiToolDef[] = [
  {
    name: 'get_overdue_tasks',
    description:
      'Tasks past their deadline and not finished, within the asker\'s access. Use for "what is overdue", "what is late", "what has slipped".',
    parameters: NO_ARGS,
  },
  {
    name: 'get_my_tasks',
    description:
      'The asker\'s OWN assigned tasks with status and deadline. Use for "my tasks", "what am I working on", "what is on my plate".',
    parameters: NO_ARGS,
  },
  {
    name: 'get_team_capacity',
    description:
      'Workload per person the asker can see: open task count and estimated hours, lowest load first. Use for "who is free", "who has capacity", "who is busy", "who should I give this to".',
    parameters: NO_ARGS,
  },
  {
    name: 'get_my_attendance_today',
    description:
      "The asker's OWN attendance for today: checked in or out, hours worked, overtime, idle, and whether they were marked late.",
    parameters: NO_ARGS,
  },
  {
    name: 'get_team_attendance_today',
    description:
      'Attendance for OTHER PEOPLE today — who is present, who was late, who is absent, and who is currently checked in. Use for "who came late today", "who is absent", "who is online", "team attendance". Requires permission; returns an error if the asker may not see other people\'s attendance.',
    parameters: NO_ARGS,
  },
  {
    name: 'get_my_leave',
    description:
      "The asker's OWN leave balances by type and their recent leave requests with status. Use for \"my leave balance\", \"how many days do I have\", \"my leave requests\".",
    parameters: NO_ARGS,
  },
  {
    name: 'get_pending_approvals',
    description:
      'Things waiting for the ASKER to approve: leave requests and attendance correction requests. Use for "what needs my approval", "anything waiting on me".',
    parameters: NO_ARGS,
  },
  {
    name: 'get_projects',
    description:
      'Projects the asker can see, with task counts and completion percentage. Use for "my projects", "how is <project> going", "project status", "what are we working on".',
    parameters: NO_ARGS,
  },
  {
    name: 'find_people',
    description:
      'Staff directory the asker may see: name, role, team, and whether active. Use for "who is in the team", "what is X\'s role", "how many employees". Never returns client contacts unless the asker administers clients.',
    parameters: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Optional name fragment to filter by.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_finance_summary',
    description:
      'Invoice totals: outstanding amount, overdue count, and recently paid. Finance and admin only; returns an error otherwise. Use for "how much is outstanding", "unpaid invoices", "who owes us".',
    parameters: NO_ARGS,
  },
];

/**
 * The assistant's standing instructions.
 *
 * Written to prevent the two failure modes seen in practice: answering a
 * question about someone else with the asker's own figures, and filling a gap
 * in the data with a confident guess.
 */
export const AI_SYSTEM_PROMPT = [
  'You are the assistant inside Rademics ERP, an internal company system.',
  '',
  'HOW TO ANSWER',
  '- Call the tools to get facts. Never answer from memory or assumption.',
  '- If a tool returns an error saying the asker lacks permission, say plainly that they cannot see that and suggest who can (their team lead, HR, or an admin). Do not substitute different data.',
  '- A tool result carrying permissionOk:true is NOT a permission problem, whatever else it says. Never tell someone to request access they already have — relay the actual reason instead.',
  '- Never present one person\'s data as another\'s. If asked about a colleague and you only have the asker\'s own record, say so explicitly.',
  '- If the tools return nothing relevant, say you do not have that information. Do not guess, and do not pad the answer with unrelated facts.',
  '- Numbers, names and dates must come from tool results verbatim.',
  '- ANSWER the question. Do not reply by asking what they would like to know — if a question is broad, give the useful summary and then offer to go deeper.',
  '- Skip machine-looking identifiers. If a record has no readable name, leave it out rather than printing an internal ID at someone.',
  '',
  'STYLE',
  '- Short and direct: two or three sentences, or a compact list for several items.',
  '- Plain language for a colleague, not a report. Amounts in rupees.',
  '- Do not mention tools, functions, JSON, or that you are an AI.',
  '',
  'SCOPE',
  '- Only Rademics ERP: projects, tasks, people, attendance, leave, clients and finance.',
  '- Anything else (weather, general knowledge, coding, personal advice) — decline in one line and say what you can help with instead.',
  '- You are read-only. If asked to create, change, assign, approve or delete anything, say you cannot and point them at the page where they can do it themselves.',
].join('\n');
