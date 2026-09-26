// Auto-generated global types namespace for SprintDesk
// This file makes types available under the global `SprintDesk` namespace
// so you can refer to them as `SprintDesk.TaskMetadata`, etc., without imports.

declare global {
    namespace SprintDesk {
        type TaskType = 'feature' | 'bug' | 'improvement' | 'documentation' | 'test';
        type TaskStatus = 'waiting' | 'started' | 'done' | 'blocked' | 'canceled';
        type Priority = 'high' | 'medium' | 'low';
        type EpicStatus = 'planned' | 'started' | 'completed' | 'blocked';
        type ITaskBacklog = { _id: string; title: string; path: string; };
        type ITaskSprint = { _id: string; title: string; path: string; };
        interface TaskMetadata {
            _id?: number;
            title: string;
            type?: TaskType;
            category?: string;
            component?: string;
            duration?: string;
            priority?: Priority;
            status?: TaskStatus;
            assignee?: string;
            objective?: string;
            path?: string;
            relativePath?: string;

            // audit fields
            createdAt?: string;
            updatedAt?: string;

            epic?: {
                _id?: number;
                title: string;
                path?: string;
            };
            backlogs?: ITaskBacklog[];
            sprints?: ITaskSprint[];
        }

        interface EpicMetadata {
            _id?: number;
            title: string;
            category?: string;
            description?: string;
            priority?: Priority;
            status?: EpicStatus;
            owner?: string;
            startDate?: Date;
            endDate?: Date;
            totalTasks?: number;
            color?: string;
            completedTasks?: number;
            waitingTasks?: number;
            startedTasks?: number;
            doneTasks?: number;
            progress?: string;
            path?: string
            createdAt?: string;
            updatedAt?: string;

            // components fields
            tasks?: any[];
            backlogs?: any[];
            sprints?: any[];
            related_epics?: any[];
        }

        interface TaskRow {
            task: string;
            epic: string;
            file: string;
        }

        interface ProjectItem {
            name: string;
            lastCommit: string;
            lastUpdate: string;
        }

        interface ProjectStructure {
            name: string;
            path: string;
            lastCommit: string;
            lastUpdate: string;
            backlogs: ProjectItem[];
            epics: ProjectItem[];
            sprints: ProjectItem[];
            tasks: ProjectItem[];
        }

        interface IAppProps { }

        interface ISprintMetadata {
            _id: string;
            title: string;
            type?: TaskType;
            category?: string;
            component?: string;
            duration?: string;
            priority?: Priority;
            status?: TaskStatus;
            assignee?: string;
            created_at?: string;
            updated_at?: string;
            objective?: string;
            path?: string;
        }
        interface IBacklogMetadata {
            _id: string;
            title: string;
            type?: TaskType;
            category?: string;
            component?: string;
            duration?: string;
            priority?: Priority;
            status?: TaskStatus;
            assignee?: string;
            created_at?: string;
            updated_at?: string;
            objective?: string;
            path?: string;
        }
        interface IEpicMetadata {
            _id: string;
            title: string;
            type?: TaskType;
            category?: string;
            component?: string;
            duration?: string;
            priority?: Priority;
            status?: TaskStatus;
            assignee?: string;
            created_at?: string;
            updated_at?: string;
            objective?: string;
            path?: string;
        }
        interface ITaskMetadata {
            _id: string;
            title: string;
            type?: TaskType;
            category?: string;
            component?: string;
            duration?: string;
            priority?: Priority;
            status?: TaskStatus;
            assignee?: string;
            created_at?: string;
            updated_at?: string;
            objective?: string;
            path?: string;
            relativePath?: string;
        }
    }
}

export { };
