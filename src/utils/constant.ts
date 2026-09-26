/**
 * SprintDesk Constants
 * ===================
 * v0.0.1 - Initial version
 */

// [vNext]: refactor constants

// [COMMIT]: Global Emoji Constants
export const COMMON_EMOJI = {
    GOAL: '🎯',
    HOT: '🔥',
    PROJECT: "📂",
    FILE: "📄",
    CALENDAR: "📅",
    LAST_UPDATE: "🗓",
    TOTAL_TASKS: "🛠",
    PROGRESS: "📊",
    SUMMARY: "📝",
    TYPE: "🏷️",
    ASSIGNEE: "👤",
    FOLDER: "📁",
    OPEN_FILE: "📂",
    CHECKMARK: "✔️",
    OVERVIEW: "🗂️",
    /* Global Content Emojis */
    DESCRIPTION: "📜",
    ACCEPTANCE_CRITERIA: "✅",
    CHECKLIST: "📝",
    NOTES: "🧠",
    
    /* RELATED COLLECTIONS EMOJIS */
    SPRINT: "🏃",
    SPRINT_LIST: "📆",
    SPRINT_SECTION: "⏱️",
    RELATED_SPRINTS: "🔗",
    BACKLOG: "📒",
    BACKLOG_LIST: "📋",
    BACKLOGS_SECTION: "📋",
    RELATED_BACKLOGS: "🔗",
    EPIC: "🚩",
    EPIC_LIST: "🧱",
    EPICS_SECTION: "🧱",
    RELATED_EPICS: "🔗",
    TASK: "📌",
    TASK_LIST: "📋",
    TASKS_SECTION: "🛠️",
    RELATED_TASKS: "🔗",
    PRIORITY: "⚡",
    
}

export const STATUS_EMOJI = {
    WAITING: "⏳",
    STARTEd: "🔄",
    DONE: "✅",
    BLOCKED: "⛔",
    CANCELLED: "❌"
}
export const PRIORITY_EMOJI = {
    HIGH: "🔴",
    MEDIUM: "🟡",
    LOW: "🟢"
}


/**
 * Project Structure
 * ================
 * Base directory and subdirectory configuration
 */
export const PROJECT_CONSTANTS = {
    SPRINTDESK_DIR: ".SprintDesk",
    DATA_DIR: "data",
    BACKLOGS_DIR: "Backlogs",
    EPICS_DIR: "Epics",
    SPRINTS_DIR: "Sprints",
    TASKS_DIR: "Tasks",
    MD_FILE_EXTENSION: ".md",

    // File Naming Patterns
    FILE_PREFIX: {
        BACKLOG: "[Backlog]_",
        BACKLOGPATTERN: (index: number) => `[Backlog-${index}]_`,
        EPIC: "[Epic]_",
        EPICPATTERN: (index: number) => `[${index}]_`,
        SPRINT: "[Sprint]_",
        SPRINTPATTERN: (index: number) => `[Sprint-${index}]_`,
        EPIC_LINK: "../Epics/",
        BACKLOG_LINK: "../Backlogs/",
        SPRINT_LINK: "../Sprints/",
        TASK: "[Task]_",
        TASKPATTERN: (index: number) => `[${index}]_`,
        TASK_LINK: "../Tasks/",
    },
    ID_PREFIX: {
        EPIC: "epic_",
        BACKLOG: "backlog_",
        SPRINT: "sprint_",
        TASK: "task_"
    }
};

/**
 * Task Management
 * ==============
 */
export const TASK_CONSTANTS = {
    // Status
    STATUS: {
        WAITING: "waiting",
        STARTED: "started",
        DONE: "done",
        COMPLETED: "completed",
        BLOCKED: "blocked",
        CANCELED: "canceled"
    },

    // Types
    TYPE: {
        FEATURE: "feature",
        BUG: "bug",
        IMPROVEMENT: "improvement",
        DOCUMENTATION: "documentation",
        TEST: "test",
    },
    PRIORITY: {
        HIGH: "high",
        MEDIUM: "medium",
        LOW: "low"
    },
    // File & Template
    FILE_PREFIX: "[Task]_",
    /** Sprints Content Table */
    SPRINT_SECTION: `## ${COMMON_EMOJI.SPRINT_SECTION} Sprints`,
    SPRINT_TABLE_HEADER: "| # | Sprint | Status | Priority | File |\n|:--|:------|:------:|:--------:|:-----|",
    SPRINT_TABLE_ROW: (sprints: SprintDesk.ISprintMetadata[]) => sprints.map((sprint) => {
        return `| ${sprint._id} | [${sprint.title}](${sprint.path}) | ${sprint.status} | - | \`${sprint._id}\` |`;
    }).join('\n'),
    /** Backlogs Content Table */
    BACKLOG_SECTION: `## ${COMMON_EMOJI.BACKLOGS_SECTION} Backlogs`,
    BACKLOG_TABLE_HEADER: "| # | Backlog | Status | Priority | File |\n|:--|:-------|:------:|:--------:|:-----|",
    BACKLOG_TABLE_ROW: (backlogs: SprintDesk.IBacklogMetadata[]) => backlogs.map((backlog) => {
        return `| ${backlog._id} | [${backlog.title}](${backlog.path}) | - | - | \`${backlog._id}\` |`;
    }).join('\n'),
    /** Epics Content Table */
    EPIC_SECTION: `## ${COMMON_EMOJI.EPICS_SECTION} Epic`,
    EPIC_TABLE_HEADER: "| # | Epic | Status | Priority | File |\n|:--|:----|:------:|:--------:|:-----|",
    EPIC_TABLE_ROW: (epic: SprintDesk.EpicMetadata) => `| ${epic._id} | [${epic.title}](${epic.path}) | ${epic.status} | ${epic.priority} | \`${epic._id}\` |`,
    /** Tasks Content Table */
    TASKS_SECTION: `## ${COMMON_EMOJI.TASKS_SECTION} Tasks`,
    TASKS_TABLE_HEADER: "| # | Task | Status | Priority | File |\n|:--|:-----|:------:|:--------:|:-----|",
    TASKS_TABLE_ROW: (tasks: SprintDesk.ITaskMetadata[]) => tasks.map((task) => {
        return `| ${task._id} | [${task.title}](${task.path}) | ${task.status} | ${task.priority} | \`${task._id}\` |`;
    }).join('\n'),
    TEMPLATE: (title: string) => `# 🧩 Task: ${title}\n\n## 📋 Description\n`,
    CONTENT: {
        OVERVIEW: `## ${COMMON_EMOJI.OVERVIEW} Overview\n`,
        OVERVIEW_TABLE_HEADER: `| Field | Value |\n|:--|:--|\n`,
        OVERVIEW_TABEL_ROW: (field: string, value: string) => `| ${field} | ${value} |\n`,

        // [NOTE]: to be deleted
        DESCRIPTION: `## ${COMMON_EMOJI.DESCRIPTION} Description\n`,
        ACCEPTANCE_CRITERIA: `## ${COMMON_EMOJI.ACCEPTANCE_CRITERIA} Acceptance Criteria\n`,
        CHECKLIST: `## ${COMMON_EMOJI.CHECKLIST} Checklist\n`,
        NOTES: `## ${COMMON_EMOJI.NOTES} Notes\n`,
        RELATED_TASKS: `## ${COMMON_EMOJI.RELATED_TASKS} Related Tasks\n`,
        EPIC: `## ${COMMON_EMOJI.EPIC} Epic\n`,
        SPRINTS: `## ${COMMON_EMOJI.SPRINT} Sprints\n`,
        BACKLOGS: `## ${COMMON_EMOJI.BACKLOG} Backlogs\n`,
    },

    // Markers
    LINK_MARKER: "📌"
};

/**
 * Epic Management
 * ================
 */
export const EPIC_CONSTANTS = {
    STATUS: {
        PLANNED: "⏳ Planned",
        IN_PROGRESS: "🔄 In Progress",
        COMPLETED: "✅ Completed",
        BLOCKED: "⛔ Blocked"
    },
    FILE_PREFIX: "[Epic]_",
    TEMPLATE: (name: string) => `# 🌟 Epic: ${name}\n\n## 🧱 Tasks\n`,
    DEFAULT_COLOR: "#0b2cc2",  // deep blue

    /** Sprints Content Table */
    SPRINT_SECTION: `## ${COMMON_EMOJI.SPRINT_SECTION} Sprints`,
    SPRINT_TABLE_HEADER: "| # | Sprint | Status | Priority | File |\n|:--|:------|:------:|:--------:|:-----|",
    SPRINT_TABLE_ROW: (sprints: SprintDesk.ISprintMetadata[]) => sprints.map((sprint) => {
        return `| ${sprint._id} | [${sprint.title}](${sprint.path}) | ${sprint.status} | - | \`${sprint._id}\` |`;
    }).join('\n'),
    /** Backlogs Content Table */
    BACKLOG_SECTION: `## ${COMMON_EMOJI.BACKLOGS_SECTION} Backlogs`,
    BACKLOG_TABLE_HEADER: "| # | Backlog | Status | Priority | File |\n|:--|:-------|:------:|:--------:|:-----|",
    BACKLOG_TABLE_ROW: (backlogs: SprintDesk.IBacklogMetadata[]) => backlogs.map((backlog) => {
        return `| ${backlog._id} | [${backlog.title}](${backlog.path}) | - | - | \`${backlog._id}\` |`;
    }).join('\n'),
    /** Epics Content Table */
    EPIC_SECTION: `## ${COMMON_EMOJI.EPICS_SECTION} Epics`,
    EPIC_TABLE_HEADER: "| # | Epic | Status | Priority | File |\n|:--|:----|:------:|:--------:|:-----|",
    EPIC_TABLE_ROW: (epics: SprintDesk.IEpicMetadata[]) => epics.map((epic) => {
        return `| ${epic._id} | [${epic.title}](${epic.path}) | ${epic.status} | ${epic.priority} | \`${epic._id}\` |`;
    }).join('\n'),
    /** Tasks Content Table */
    TASKS_SECTION: `## ${COMMON_EMOJI.TASKS_SECTION} Tasks`,
    TASKS_TABLE_HEADER: "| # | Task | Status | Priority | File |\n|:--|:-----|:------:|:--------:|:-----|",
    TASKS_TABLE_ROW: (tasks: SprintDesk.ITaskMetadata[]) => tasks.map((task) => {
        return `| ${task._id} | [${task.title}](${task.path}) | ${task.status} | ${task.priority} | \`${task._id}\` |`;
    }).join('\n'),
    CONTENT: {
        OVERVIEW: `## ${COMMON_EMOJI.OVERVIEW} Overview\n`,
        OVERVIEW_TABLE_HEADER: `| Field | Value |\n|:--|:--|\n`,
        OVERVIEW_TABEL_ROW: (field: string, value: string) => `| ${field} | ${value} |\n`,

        // [NOTE]: to be deleted
        DESCRIPTION: `## ${COMMON_EMOJI.DESCRIPTION} Description\n`,
        ACCEPTANCE_CRITERIA: `## ${COMMON_EMOJI.ACCEPTANCE_CRITERIA} Acceptance Criteria\n`,
        CHECKLIST: `## ${COMMON_EMOJI.CHECKLIST} Checklist\n`,
        NOTES: `## ${COMMON_EMOJI.NOTES} Notes\n`,
        RELATED_TASKS: `## ${COMMON_EMOJI.RELATED_TASKS} Related Tasks\n`,
        EPIC: `## ${COMMON_EMOJI.EPIC} Epic\n`,
        SPRINTS: `## ${COMMON_EMOJI.SPRINT} Sprints\n`,
        BACKLOGS: `## ${COMMON_EMOJI.BACKLOG} Backlogs\n`,
    },
};

/**
 * Backlog Management
 * ================
 */
export const BACKLOG_CONSTANTS = {
    STATUS: {
        ACTIVE: "active",
        ARCHIVED: "archived"
    },
    FILE_PREFIX: "[Backlog]_",
    TEMPLATE: (name: string) => `# Backlog: ${name}\n\n## 📋 Tasks\n`,
    DEFAULT_COLOR: "#2563eb",  // blue-600


    /** Sprints Content Table */
    SPRINT_SECTION: `## ${COMMON_EMOJI.SPRINT_SECTION} Sprints`,
    SPRINT_TABLE_HEADER: "| # | Sprint | Status | Priority | File |\n|:--|:------|:------:|:--------:|:-----|",
    SPRINT_TABLE_ROW: (sprints: SprintDesk.ISprintMetadata[]) => sprints.map((sprint) => {
        return `| ${sprint._id} | [${sprint.title}](${sprint.path}) | ${sprint.status} | - | \`${sprint._id}\` |`;
    }).join('\n'),
    /** Backlogs Content Table */
    BACKLOG_SECTION: `## ${COMMON_EMOJI.BACKLOGS_SECTION} Backlogs`,
    BACKLOG_TABLE_HEADER: "| # | Backlog | Status | Priority | File |\n|:--|:-------|:------:|:--------:|:-----|",
    BACKLOG_TABLE_ROW: (backlogs: SprintDesk.IBacklogMetadata[]) => backlogs.map((backlog) => {
        return `| ${backlog._id} | [${backlog.title}](${backlog.path}) | - | - | \`${backlog._id}\` |`;
    }).join('\n'),
    /** Epics Content Table */
    EPIC_SECTION: `## ${COMMON_EMOJI.EPICS_SECTION} Epics`,
    EPIC_TABLE_HEADER: "| # | Epic | Status | Priority | File |\n|:--|:----|:------:|:--------:|:-----|",
    EPIC_TABLE_ROW: (epics: SprintDesk.IEpicMetadata[]) => epics.map((epic) => {
        return `| ${epic._id} | [${epic.title}](${epic.path}) | ${epic.status} | ${epic.priority} | \`${epic._id}\` |`;
    }).join('\n'),
    /** Tasks Content Table */
    TASKS_SECTION: `## ${COMMON_EMOJI.TASKS_SECTION} Tasks`,
    TASKS_TABLE_HEADER: "| # | Task | Status | Priority | File |\n|:--|:-----|:------:|:--------:|:-----|",
    TASKS_TABLE_ROW: (tasks: SprintDesk.ITaskMetadata[]) => tasks.map((task) => {
        return `| ${task._id} | [${task.title}](${task.path}) | ${task.status} | ${task.priority} | \`${task._id}\` |`;
    }).join('\n'),
    CONTENT: {
        OVERVIEW: `## ${COMMON_EMOJI.OVERVIEW} Overview\n`,
        OVERVIEW_TABLE_HEADER: `| Field | Value |\n|:--|:--|\n`,
        OVERVIEW_TABEL_ROW: (field: string, value: string) => `| ${field} | ${value} |\n`,

        // [NOTE]: to be deleted
        DESCRIPTION: `## ${COMMON_EMOJI.DESCRIPTION} Description\n`,
        ACCEPTANCE_CRITERIA: `## ${COMMON_EMOJI.ACCEPTANCE_CRITERIA} Acceptance Criteria\n`,
        CHECKLIST: `## ${COMMON_EMOJI.CHECKLIST} Checklist\n`,
        NOTES: `## ${COMMON_EMOJI.NOTES} Notes\n`,
        RELATED_TASKS: `## ${COMMON_EMOJI.RELATED_TASKS} Related Tasks\n`,
        EPIC: `## ${COMMON_EMOJI.EPIC} Epic\n`,
        SPRINTS: `## ${COMMON_EMOJI.SPRINT} Sprints\n`,
        BACKLOGS: `## ${COMMON_EMOJI.BACKLOG} Backlogs\n`,
    },
};

/**
 * Sprint Management
 * ===============
 */
export const SPRINT_CONSTANTS = {
    STATUS: {
        UPCOMING: "upcoming",
        IN_PROGRESS: "in-progress",
        COMPLETED: "completed"
    },
    FILE_PREFIX: "[Sprint]_",
    TEMPLATE: (name: string) => `# ⏱️ Sprint: ${name}\n\n## 📋 Tasks\n`,
    SEPARATOR: {
        DATE: "-",
        DURATION: "_",
        YEAR_PREFIX: "20"
    },


    /** Sprints Content Table */
    SPRINT_SECTION: `## ${COMMON_EMOJI.SPRINT_SECTION} Sprints`,
    SPRINT_TABLE_HEADER: "| # | Sprint | Status | Priority | File |\n|:--|:------|:------:|:--------:|:-----|",
    SPRINT_TABLE_ROW: (sprints: SprintDesk.ISprintMetadata[]) => sprints.map((sprint) => {
        return `| ${sprint._id} | [${sprint.title}](${sprint.path}) | ${sprint.status} | - | \`${sprint._id}\` |`;
    }).join('\n'),
    /** Backlogs Content Table */
    BACKLOG_SECTION: `## ${COMMON_EMOJI.BACKLOGS_SECTION} Backlogs`,
    BACKLOG_TABLE_HEADER: "| # | Backlog | Status | Priority | File |\n|:--|:-------|:------:|:--------:|:-----|",
    BACKLOG_TABLE_ROW: (backlogs: SprintDesk.IBacklogMetadata[]) => backlogs.map((backlog) => {
        return `| ${backlog._id} | [${backlog.title}](${backlog.path}) | - | - | \`${backlog._id}\` |`;
    }).join('\n'),
    /** Epics Content Table */
    EPIC_SECTION: `## ${COMMON_EMOJI.EPICS_SECTION} Epics`,
    EPIC_TABLE_HEADER: "| # | Epic | Status | Priority | File |\n|:--|:----|:------:|:--------:|:-----|",
    EPIC_TABLE_ROW: (epics: SprintDesk.IEpicMetadata[]) => epics.map((epic) => {
        return `| ${epic._id} | [${epic.title}](${epic.path}) | ${epic.status} | ${epic.priority} | \`${epic._id}\` |`;
    }).join('\n'),
    /** Tasks Content Table */
    TASKS_SECTION: `## ${COMMON_EMOJI.TASKS_SECTION} Tasks`,
    TASKS_TABLE_HEADER: "| # | Task | Status | Priority | File |\n|:--|:-----|:------:|:--------:|:-----|",
    TASKS_TABLE_ROW: (tasks: SprintDesk.ITaskMetadata[]) => tasks.map((task) => {
        return `| ${task._id} | [${task.title}](${task.path}) | ${task.status} | ${task.priority} | \`${task._id}\` |`;
    }).join('\n'),
    CONTENT: {
        HEADER:(start: string, end: string) => `# ${COMMON_EMOJI.SPRINT} Sprint : ${start} ➜ ${end}`,
        OVERVIEW: `## ${COMMON_EMOJI.OVERVIEW} Overview\n`,
        OVERVIEW_TABLE_HEADER: `| 🗓 Dates | 28 Oct 2025 → 04 Nov 2025 |\n|:--|:--|\n`,
        OVERVIEW_TABEL_ROW: (field: string, value: string) => `| ${field} | ${value} |\n`,
        // [NOTE]: to be deleted because section are new approach defined
        DESCRIPTION: `## ${COMMON_EMOJI.DESCRIPTION} Description\n`,
        ACCEPTANCE_CRITERIA: `## ${COMMON_EMOJI.ACCEPTANCE_CRITERIA} Acceptance Criteria\n`,
        CHECKLIST: `## ${COMMON_EMOJI.CHECKLIST} Checklist\n`,
        NOTES: `## ${COMMON_EMOJI.NOTES} Notes\n`,
        RELATED_TASKS: `## ${COMMON_EMOJI.RELATED_TASKS} Related Tasks\n`,
        EPIC: `## ${COMMON_EMOJI.EPIC} Epic\n`,
        SPRINTS: `## ${COMMON_EMOJI.SPRINT} Sprints\n`,
        BACKLOGS: `## ${COMMON_EMOJI.BACKLOG} Backlogs\n`,
    },
};

/**
 * UI Colors and Themes
 * ==================
 */
export const UI_CONSTANTS = {
    // Sprint Colors
    COLORS: {
        SPRINT: {
            UPCOMING: "#1f2937",    // slate-800
            CLOSED: "#065f46",      // emerald-900
            IN_PROGRESS: "#1e3a8a"  // blue-900
        },
        STATUS: {
            DEFAULT: "#94a3b8",     // gray
            DONE: "#86efac",        // green
            PROGRESS: "#facc15",    // yellow
            BLOCKED: "#f87171"      // red
        }
    },

    // Status Text
    STATUS: {
        NOT_STARTED: "Not_Started",
        UPCOMING: "Upcoming",
        CLOSED: "Closed",
        IN_PROGRESS: "In Progress"
    },

    // Section Headers
    SECTIONS: {
        TASKS: "Tasks",
        TASKS_MARKER: "## Tasks",
        AUTO_COMMENT: "<!-- Tasks will be added here automatically -->"
    },

    // Icons and Emojis
    EMOJI: {
        COMMON: {
            BACKLOG: "📌",
            EPIC: "🚩",
            SPRINT: "⏱️",
            TASK: "✅",

            PROJECT: "📂",
            FILE: "📄",
            CALENDAR: "📅",
            LAST_UPDATE: "🗓",
            TOTAL_TASKS: "🛠",
            PROGRESS: "📊",
            SUMMARY: "📝",
            TASK_LIST: "📋",
            TASKS_SECTION: "🧱",
            PRIORITY: "⚡",
            TYPE: "🏷️",
            ASSIGNEE: "👤",
            FOLDER: "📁",
            OPEN_FILE: "📂",
            CHECKMARK: "✔️",
        },
        STATUS: {
            WAITING: "⏳",
            IN_PROGRESS: "🔄",
            DONE: "✅",
            BLOCKED: "⛔",
            CANCELLED: "❌"
        },
        PRIORITY: {
            HIGH: "🔴",
            MEDIUM: "🟡",
            LOW: "🟢"
        }
    },

    // Quick Pick Options
    QUICK_PICK: {
        TASK_TYPE: "Select task type",
        PRIORITY: "Select priority",
        EPIC_PRIORITY: "Select epic priority",
        TASK_TITLE: "e.g., Implement Login Feature",
        CATEGORY: "e.g., frontend, backend, testing",
        COMPONENT: "e.g., authentication, database, ui",
        DURATION: "e.g., 2d, 4h, 1w",
        ASSIGNEE: "e.g., John Doe",
        EPIC_NAME: "e.g., Epic File Name",
        EPIC_TITLE: "e.g., User Authentication",
        EPIC_OWNER: "e.g., Team Lead"
    }
};

/**
 * Sample/Demo Data
 * ==============
 */
export const SAMPLE_CONSTANTS = {
    BACKLOG_1: "Sample Backlog 1",
    BACKLOG_2: "Sample Backlog 2",
    EPIC_1: "Sample Epic 1",
    SPRINT_1: "Sprint 1",
    TASK_1: "Task 1"
};

/**
 * Git Integration
 * =============
 */
export const GIT_CONSTANTS = {
    DEFAULT_COMMIT: "Initial",
    LAST_UPDATE: {
        TODAY: "today",
        YESTERDAY: "yesterday"
    },
    INIT_COMMIT: "Initial commit"
};

/**
 * WebView Configuration
 * ===================
 */
export const WEBVIEW_CONSTANTS = {
    APP_TITLE: "Sprint Desk v0.2.4",
    EXTENSION_NAME: "sprintdesk",
    PANEL: {
        TASKS: {
            ID: "sprintdesk-tasks",
            TITLE: "SprintDesk Tasks"
        },
        PROJECT_STRUCTURE: {
            ID: "sprintdesk.projectStructure",
            TITLE: "Project Structure"
        }
    },
    VIEWS: {
        PROJECTS_TITLE: "Project Structure",
        TASK_TABLE_TITLE: "Task Table"
    },
    COMMANDS: {
        SET_TASKS: "SET_TASKS",
        SET_BACKLOGS: "SET_BACKLOGS",
        SET_EPICS: "SET_EPICS",
        SET_PROJECTS: "SET_PROJECTS",
        REQUEST_PROJECTS: "REQUEST_PROJECTS",
        REQUEST_OPEN_FILE: "REQUEST_OPEN_FILE",
        SAVE_SPRINT_TABLE: "SAVE_SPRINT_TABLE"
    },
    BUNDLING: {
        MAIN_JS: "main.js",
        LOCAL_SERVER: "http://localhost:9001",
        DIST_DIR: "dist/webview",
        MANIFEST_FILE: "manifest.json"
    }
};