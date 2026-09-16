import { TimeOffPanel } from "@/components/features/timeoff/TimeOffPanel";

export default function MyTimeOffPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">My Time Off</h1>
        <p className="text-muted-foreground">
          Submit vacation, sick, personal, or parental leave requests.
        </p>
      </div>
      <TimeOffPanel title="Requests" />
    </div>
  );
}
