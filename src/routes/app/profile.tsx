import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/app/profile")({
  head: () => ({
    meta: [
      { title: "Profile — SkillTrack Labs" },
      { name: "description", content: "Your SkillTrack Labs account details and workspace assignment." },
      { property: "og:title", content: "Profile — SkillTrack Labs" },
      { property: "og:description", content: "Review your learner profile and access details." },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { user } = useAuth();
  return (
    <>
      <PageHeader title="Profile" description="Account details for this training engagement." />
      <Card className="max-w-xl">
        <CardHeader><CardTitle className="text-base">Account</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Full name</Label>
            <Input id="name" defaultValue={user?.name} readOnly />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" defaultValue={user?.email} readOnly />
          </div>
          <div className="space-y-2">
            <Label>Workspace</Label>
            <p className="text-sm">{user?.workspaceName}</p>
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <div><Badge variant="secondary" className="capitalize">{user?.role}</Badge></div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
