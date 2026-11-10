# GamePlan — import exactly one project

Use **… More → Import project** to create one NEW project. Importing never replaces your workspace, its other projects, tasks, or time logs.

## JSON format

```json
{
  "format": "gameplan-project",
  "version": 1,
  "project": {"name": "Summer 2027 Internships", "description": "Application tracker"},
  "tags": [{"name": "Applications", "color": "#df71b5"}],
  "milestones": [
    {
      "name": "Urgent applications",
      "target_date": "2026-11-21",
      "features": [{"name": "Insomniac Game Design", "tasks": [
        {"title": "Prepare portfolio case study", "estimated_minutes": 90, "tags": ["Applications"]}
      ]}]
    }
  ]
}
```

Each milestone can include nested features, each feature can include tasks. Task fields include `title`, `description`, `estimated_minutes`, `priority`, `status`, `assignee`, and `tags`. The importer assigns new IDs and validates all milestones before asking for confirmation.

Single-milestone JSON files also work with Import project, creating a new project with that milestone. Full GamePlan backups can be used as input; choose **one** project from the backup to copy. Neither operation replaces existing projects. Import milestone remains an additive operation inside the currently selected project.

The app makes a pre-import recovery snapshot. Importing while signed in creates a new cloud project and then saves its content. If cloud sync is paused because you recently restored a backup, keep it paused until you have verified your data.

**There is intentionally no Import full board or Replace all projects operation.** Export backup remains available for safekeeping.
Task JSON entries may optionally include `"due_date": "2026-11-21"` (ISO calendar date). Due dates are shown in both Board and All Tasks. Existing tasks without a due date are unchanged.

## Task reference links and deliverables

Each nested task can include optional arrays:

```json
{
  "title": "Submit the application",
  "due_date": "2026-11-18",
  "resources": [
    {"title": "Official job posting", "url": "https://job-boards.greenhouse.io/example"}
  ],
  "deliverables": [
    {"title": "Role-tailored resume PDF", "url": ""},
    {"title": "Submitted application confirmation", "url": "https://drive.google.com/example"}
  ]
}
```

These sample URLs demonstrate the format; replace them with real URLs. A resource must have an HTTP(S) URL; deliverables may be placeholders with a blank URL until the document exists. Actual file bytes are **not** uploaded or stored in GamePlan; paste a link to the file in a service you control instead. Projects remain safe and additive on import, so importing an updated file creates another project rather than overwriting or deleting the old one.
