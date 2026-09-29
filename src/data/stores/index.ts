import { getDataService } from '../DataService';
import { getHost } from '../../host';
import { RunStore } from './RunStore';
import { EventStore } from './EventStore';
import { AuditStore } from './AuditStore';
import { EmployeeStore } from './EmployeeStore';
import { EmployeeTeamStore } from './EmployeeTeamStore';
import { ReviewerStore } from './ReviewerStore';
import {
  ProjectMcpManifest,
  defaultProjectMcpManifest,
  getProjectMcpPath,
  loadProjectMcp,
  saveProjectMcp
} from './projectMcp';

export interface Stores {
  runs: RunStore;
  events: EventStore;
  audit: AuditStore;
  employees: EmployeeStore;
  teams: EmployeeTeamStore;
  reviewers: ReviewerStore;
}

export interface ProjectMcpFacade {
  path: string;
  load: () => ProjectMcpManifest | null;
  save: (manifest: ProjectMcpManifest) => void;
  defaultManifest: () => ProjectMcpManifest;
}

let activeStores: Stores | null = null;
let activeStoresRoot: string | undefined;

function resolveRoot(workspaceRoot?: string): string {
  if (workspaceRoot) return workspaceRoot;
  const dataRoot = getDataService().getWorkspaceRoot();
  return (dataRoot || getHost().getWorkspaceRoot() || '') as string;
}

export function getStores(workspaceRoot?: string): Stores {
  const root = resolveRoot(workspaceRoot);
  if (!activeStores || root !== activeStoresRoot) {
    activeStores = {
      runs: new RunStore(root),
      events: new EventStore(root),
      audit: new AuditStore(root),
      employees: new EmployeeStore(root),
      teams: new EmployeeTeamStore(root),
      reviewers: new ReviewerStore(root)
    };
    activeStoresRoot = root;
  }
  return activeStores;
}

export function getProjectMcpFile(workspaceRoot?: string): ProjectMcpFacade {
  const root = resolveRoot(workspaceRoot);
  return {
    path: getProjectMcpPath(root),
    load: () => loadProjectMcp(root),
    save: manifest => saveProjectMcp(manifest, root),
    defaultManifest: () => defaultProjectMcpManifest(root)
  };
}

export { ProjectMcpManifest } from './projectMcp';
export {
  ReviewerRecord,
  ReviewerStore,
  REVIEWER_DISPLAY_NAME_MAX_LENGTH,
  REVIEWER_ID_MAX_LENGTH,
  normalizeReviewerDisplayName,
  normalizeReviewerId
} from './ReviewerStore';
