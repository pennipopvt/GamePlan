# GamePlan milestone-only JSON import

Use **… More → Import milestone** from the project you want to add work to. This action **adds** a new milestone; it does not replace existing projects, milestones, tasks, logs, or tags. Check the selected project before importing. Importing the same file twice creates two milestones.

## Compact format (recommended)

```json
{
  "format": "gameplan-milestone",
  "version": 1,
  "milestone": {
    "name": "A Living World",
    "description": "Expand fishing, progression and NPC content.",
    "target_date": "2026-11-15",
    "status": "To do"
  },
  "tags": [
    { "name": "Programming", "color": "#729fd6" },
    { "name": "Art", "color": "#db8bac" },
    { "name": "Design", "color": "#ac91d6" },
    { "name": "Writing", "color": "#98aab6" }
  ],
  "features": [
    {
      "name": "Fishing Combat",
      "description": "Make parrying central to fishing.",
      "tasks": [
        {
          "title": "Implement the close-parry reel window",
          "description": "Reuse the existing fishing state machine.",
          "assignee": "Ethan",
          "estimated_minutes": 45,
          "priority": "Normal",
          "status": "To do",
          "tags": ["Programming", "Design"]
        }
      ]
    },
    {
      "name": "NPC 2 — From Template",
      "description": "Fill later using the NPC route template.",
      "tasks": []
    }
  ]
}
```

- No generated IDs are needed for **nested** tasks or features. The importer creates IDs when it adds them to the current project.
- `estimated_minutes` (or `estimate_minutes`) is preferred. Older `estimated_hours` and `estimate` values also work. The editable task form uses hours **and** minutes.
- `assignee` is the team member's display name. Existing members are reused; an unknown name creates a member in the selected project. Omit it to leave the task unassigned.
- `tags` and `tag_names` accept multiple tag names. Tags matching the current project's names are reused without changing their colors. Unknown names are created with the matching color from the top-level `tags` definitions, or gray if none was supplied.
- Feature `description`, task `description`, `priority`, `status`, optional task `due_date` (`YYYY-MM-DD`), and milestone `target_date` are preserved.
- A **flat** `tasks` array is also supported; each task needs `feature` (matching a feature name) or `feature_id`. Legacy full-board exports with `projects`/`milestones`/`features`/`tasks`/`logs`/`tags` still work as sources: select the milestone when prompted.
- If importing time entries, provide explicit task IDs and reference them using `logs[].task_id`. No logs are required for a new milestone.
- Invalid feature references, missing tag-ID definitions, negative estimates, and duplicate IDs stop the import before it saves the board.
- **Remaining hours is not an import field.** For each unfinished task, GamePlan calculates `max(0, estimated - logged)`; tasks marked Done have zero remaining. Reopening a task recalculates it from its estimate and logs.

**Safety:** **Import milestone** adds work to the currently selected project. **Import project** creates one new project without replacing any existing project; full-workspace replacement is intentionally unavailable.

Task-level `resources` and `deliverables` arrays also import with each task and sync through existing task JSON. Resource links require HTTP(S); deliverable links can start blank as placeholders. Files themselves are not stored in GamePlan.
