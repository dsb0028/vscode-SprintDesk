we want this naming pattern epic [{PROJECT code}-epicNumber}]_{Category}_{title} for tasks [{Project code}-{epicNumber}.{taskNumber}]_{title} 
example: 
epics:
[SPD-101]_SEO_Add-Meta-Tags-to-Product-Pages
[SPD-102]_SEO_Implement-Schema-org-JSON-LD
[SPD-103]_SEO_Fix-SSR-for-Store-Products
[SPD-104]_SEO_Add-Canonical-URLs
[SPD-105]_SEO_Add-Open-Graph-Tags
[SPD-106]_SEO_Add-Structured-Data for-Doctors
[SPD-107]_SEO_Fix-Missing-H1-Tags
[SPD-108]_SEO_Add-Sitemap-Generation
tasks :
[SPD-101.1]_Add-title=and-description-metadata
[SPD-101.2]_Add-canonical=URL-tags
[SPD-101.3]_Add-robots=meta-tags

epics:
  - id: b50e4ed7-0972-4c89-af27-548b6a41e6a9
    number: 101 // startNumber incremented
    code: SPD-101 // {prefix}-{number}
    category: SEO
    title: implementation of seo
    description: ''
    status: planned
    priority: medium
    name: '[SPD-101]_SEO_Add-Meta-Tags-to-Product-Pages' // [{{prefix}-{number}}]_{CAT}_{epic-title}
    tasks: []
    createdAt: '2026-04-20T23:00:23.462Z'
    updatedAt: '2026-04-20T23:00:23.462Z'
    path: >-
      c:\Users\khmamedRG\Documents\ittyni.com\ittyni_app\.SprintDesk\Epics\[Epic]_epicb50e4ed7-0972-4c89-af27-548b6a41e6a9.md


tasks:
  - id: aa9df97e-f568-4fa4-ac8e-4eeff03f4849
    number: 1 // startNumber incremented
    code: SPD_100.1 // {epic code}.{task number} if no epic let it empty
    name: '[SPD-100.1]_new-task' // [{epic code}.{task Number}]_{task-title} if no epic [{task prefex}.{task Number}]_{task-title}
    title: new task
    type: feature
    status: waiting
    priority: high
    epic: null
    backlog: features
    sprint: null
    createdAt: '2026-04-20T22:53:15.400Z'
    updatedAt: '2026-04-20T22:53:15.400Z'
    path: >-
      c:\Users\khmamedRG\Documents\ittyni.com\ittyni_app\.SprintDesk\Tasks\[SPD-100.1]_new-task.md

backlogs:
  - id: aa9df97e-f568-4fa4-ac8e-4eeff03f4849
    title: FEATURE // should be uppercase
    name: '[Backlog]_FEATURE' 
    tasks: null
    path: >-
      c:\Users\khmamedRG\Documents\ittyni.com\ittyni_app\.SprintDesk\backlogs\[Backlog]_FEATURE.md

sprints:
  - id: aa9df97e-f568-4fa4-ac8e-4eeff03f4849
    title: '{startDate} ➜ {endDate}'
    number: 1 // startNumber from setting incremented
    name: [${Sprint prefix from settings}-${number}]_{title}
    startDate: '24042026'
    endDate: '30042026'
    status: planned
    tasks: []
    createdAt: '2026-04-21T01:19:40.928Z'
    updatedAt: '2026-04-21T01:19:40.928Z'
    path: >-
      c:\Users\khmamedRG\Documents\ittyni.com\ittyni_app\.SprintDesk\Sprints\[${Sprint prefix from settings}-${number}]_{title}.md
