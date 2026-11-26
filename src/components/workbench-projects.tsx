import { useState } from "react";
import { Folder, Plus, Trash2 } from "lucide-react";
import { t } from "@/lib/i18n";
import type { WorkItem, WorkProject } from "@/lib/workbench";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "./ui/empty";
import { Field, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";

export function WorkbenchProjects({
  open,
  onOpenChange,
  projects,
  items,
  busy,
  save,
  remove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: WorkProject[];
  items: WorkItem[];
  busy: boolean;
  save: (project: WorkProject) => Promise<boolean>;
  remove: (project: WorkProject) => void;
}) {
  const [name, setName] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <DialogContent className="wb-project-dialog">
        <DialogHeader>
          <DialogTitle>{t("Manage work projects")}</DialogTitle>
          <DialogDescription>
            {t("Renaming a project updates its work records.")}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (await save({ id: crypto.randomUUID(), revision: 0, name }))
              setName("");
          }}
        >
          <Field>
            <FieldLabel htmlFor="new-work-project">
              {t("New work project")}
            </FieldLabel>
            <div className="flex gap-2">
              <Input
                id="new-work-project"
                maxLength={80}
                value={name}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
              <Button type="submit" disabled={busy || !name.trim()}>
                <Plus />
                {t("Add")}
              </Button>
            </div>
          </Field>
        </form>
        <ScrollArea fade="vertical" className="wb-project-list">
          {projects.map((project) => (
            <div className="wb-project-row" key={project.id}>
              <div className="min-w-0 flex-1">
                <Input
                  aria-label={t("Project name {value0}", {
                    value0: project.name,
                  })}
                  maxLength={80}
                  value={names[project.id] ?? project.name}
                  disabled={busy}
                  onChange={(event) =>
                    setNames((previous) => ({
                      ...previous,
                      [project.id]: event.target.value,
                    }))
                  }
                />
                <span className="text-xs text-muted-foreground tabular-nums">
                  {t("{value0} work records", {
                    value0: items.filter(
                      (item) => item.project === project.name,
                    ).length,
                  })}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={
                  busy ||
                  !names[project.id]?.trim() ||
                  names[project.id] === project.name
                }
                onClick={async () => {
                  if (await save({ ...project, name: names[project.id] }))
                    setNames((previous) => {
                      const next = { ...previous };
                      delete next[project.id];
                      return next;
                    });
                }}
              >
                {t("Save")}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="hover:bg-destructive/10 hover:text-destructive focus-visible:text-destructive"
                disabled={busy}
                aria-label={t("Delete project {value0}", {
                  value0: project.name,
                })}
                onClick={() => remove(project)}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          {!projects.length && (
            <Empty className="py-6">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Folder />
                </EmptyMedia>
                <EmptyDescription>
                  {t("No work projects yet.")}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
