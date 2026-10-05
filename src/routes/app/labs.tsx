import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/AppShell";
import { LabCard } from "@/components/learner/LabCard";
import { useAuth } from "@/lib/auth";
import { useLearnerView } from "@/lib/learner";

export const Route = createFileRoute("/app/labs")({
  head: () => ({
    meta: [
      { title: "My Labs — SkillTrack Labs" },
      { name: "description", content: "Labs published to your workspace and assigned to you." },
      { property: "og:title", content: "My Labs — SkillTrack Labs" },
      { property: "og:description", content: "Launch and continue your hands-on cloud labs." },
    ],
  }),
  component: MyLabs,
});

function MyLabs() {
  const { user } = useAuth();
  const { workspace, myLabs } = useLearnerView(user);

  return (
    <>
      <PageHeader title="My Labs" description={`Assigned to you in ${workspace?.name ?? "your workspace"}`} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {myLabs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-8 text-sm text-muted-foreground md:col-span-2 xl:col-span-3">
            No labs assigned to you yet.
          </p>
        ) : null}
        {myLabs.map((l) => <LabCard key={l.id} lab={l} />)}
      </div>
    </>
  );
}
