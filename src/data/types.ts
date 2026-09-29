export interface Task {
  id: string;
  number: number;
  code: string;
  name: string;
  title: string;
  type: 'feature' | 'bug' | 'chore' | 'doc' | 'test';
  status: TaskStatus;
  priority: 'high' | 'medium' | 'low';
  epic: string | null;
  backlog: string;
  sprint: string | null;
  startDate?: string;
  endDate?: string;
  assignee?: string;
  createdAt: string;
  updatedAt: string;
  path?: string;

  // v0.4 workforce / agent additions (all optional, additive, non-breaking)
  source?: string;
  workStatus?: TaskWorkStatus;
  agent?: string;
  workflow?: string;
  parentTaskId?: string;
  childTaskIds?: string[];
  runId?: string;
  attempts?: number;
  humanVerification?: HumanVerification;
  review?: TaskReview;
}

export type TaskStatus = 'waiting' | 'in-progress' | 'under-review' | 'done' | 'blocked' | 'cancelled';

export type ReviewResult = 'met' | 'needs work';
export type ReviewSummary = 'pending' | 'accepted' | 'further work required';

export interface TaskReviewCriterion {
  criterion: string;
  result?: ReviewResult;
  reviewerId?: string;
  verifiedAt?: string;
}

export interface TaskReview {
  summary: ReviewSummary;
  reviewerId?: string;
  reviewedAt?: string;
  criteria: TaskReviewCriterion[];
}

export interface HumanVerification {
  reviewerId: string;
  reviewerName: string;
  approvedAt: string;
  notes?: string;
}

export type TaskWorkStatus =
  | 'waiting'
  | 'assigned'
  | 'claimed'
  | 'in-progress'
  | 'review'
  | 'done'
  | 'blocked'
  | 'cancelled';

export interface Run {
  id: string;
  taskId: string;
  agentId?: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  attempts: number;
  startedAt?: string;
  finishedAt?: string;
  result?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EventRecord {
  id: string;
  type: string;
  source: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  targetType: string;
  targetId?: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

export interface Employee {
  id: string;
  name: string;
  role: 'agent' | 'human';
  description?: string;
  capabilities?: string[];
  status?: 'idle' | 'busy' | 'offline';
  gitAuthor?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeTeam {
  id: string;
  name: string;
  description?: string;
  memberIds: string[];
  leadId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Epic {
  id: string;
  number: number;
  code: string;
  name: string;
  title: string;
  category: string;
  description: string;
  status: 'planned' | 'in-progress' | 'completed' | 'blocked';
  priority: 'high' | 'medium' | 'low';
  tasks: string[];
  createdAt: string;
  updatedAt: string;
  path?: string;
}

export interface Backlog {
  id: string;
  title: string;
  name: string;
  description: string;
  tasks: string[];
  color: string;
  path?: string;
}

export interface Sprint {
  id: string;
  number: number;
  title: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'planned' | 'in-progress' | 'completed';
  tasks: string[];
  createdAt: string;
  updatedAt: string;
  path?: string;
  color?: string;
}

export interface IdsConfig {
  task: { prefix: string; startNumber: number; padding: number };
  epic: { prefix: string; startNumber: number; padding: number };
  sprint: { prefix: string; startNumber: number; padding: number };
  backlog: { prefix: string };
}

export interface DefaultsConfig {
  backlog: string | null;
  epic: string | null;
  sprint: string | null;
  status: string;
  priority: string;
  type: string;
}

export interface UIConfig {
  showCompleted: boolean;
  defaultView: 'tree' | 'table';
  showIds: boolean;
  dateFormat: 'iso' | 'short' | 'relative';
}

export interface DirectoriesConfig {
  data: string;
  tasks: string;
  backlogs: string;
  epics: string;
  sprints: string;
  templates: string;
}

export interface Config {
  projectPrefix: string;
  ids: IdsConfig;
  defaults: DefaultsConfig;
  ui: UIConfig;
  directories: DirectoriesConfig;
}

export const DEFAULT_CONFIG: Config = {
  projectPrefix: 'SPD',
  ids: {
    task: { prefix: 'task_', startNumber: 100, padding: 3 },
    epic: { prefix: 'epic_', startNumber: 1, padding: 2 },
    sprint: { prefix: 'sprint_', startNumber: 1, padding: 1 },
    backlog: { prefix: '' }
  },
  defaults: {
    backlog: 'features',
    epic: null,
    sprint: null,
    status: 'waiting',
    priority: 'medium',
    type: 'feature'
  },
  ui: {
    showCompleted: false,
    defaultView: 'tree',
    showIds: true,
    dateFormat: 'iso'
  },
  directories: {
    data: 'data',
    tasks: 'Tasks',
    backlogs: 'Backlogs',
    epics: 'Epics',
    sprints: 'Sprints',
    templates: 'templates'
  }
};

export interface TasksData {
  tasks: Task[];
}

export interface EpicsData {
  epics: Epic[];
}

export interface BacklogsData {
  backlogs: Backlog[];
}

export interface SprintsData {
  sprints: Sprint[];
}

export interface AgentConfig {
  tool: 'opencode' | 'ollama' | 'claude-code' | 'custom';
  command?: string;
  model?: string;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  role?: 'lead' | 'developer' | 'reviewer' | 'observer' | 'agent';
  agentConfig?: AgentConfig;
  gitAuthor?: string;
  createdAt: string;
  updatedAt: string;
}

export interface HistoryEntry {
  id: string;
  itemId: string;
  itemType: 'task' | 'epic' | 'backlog' | 'sprint';
  action: 'create' | 'update' | 'delete' | 'move' | 'assign';
  field?: string;
  oldValue?: string;
  newValue?: string;
  author: string;
  authorEmail?: string;
  commitHash?: string;
  timestamp: string;
}

export interface TeamData {
  members: TeamMember[];
}

export interface HistoryData {
  entries: HistoryEntry[];
}

export interface RunsData {
  runs: Run[];
}

export interface EventsData {
  events: EventRecord[];
}

export interface AuditData {
  entries: AuditEntry[];
}

export interface EmployeesData {
  employees: Employee[];
}

export interface EmployeeTeamsData {
  teams: EmployeeTeam[];
}