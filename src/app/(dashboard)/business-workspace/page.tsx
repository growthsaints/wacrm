"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Bell,
  Bot,
  CalendarClock,
  CheckSquare,
  ClipboardList,
  Clock,
  Loader2,
  MessageSquare,
  StickyNote,
  Target,
  Trophy,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WorkspaceOverview } from "@/lib/business-workspace/queries";

function StatTile({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{label}</p>
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <p className="mt-1 text-xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

export default function BusinessWorkspaceOverviewPage() {
  const [data, setData] = useState<WorkspaceOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [notEnabled, setNotEnabled] = useState(false);

  useEffect(() => {
    fetch("/api/business-workspace/overview")
      .then(async (res) => {
        if (res.status === 403) {
          setNotEnabled(true);
          return;
        }
        const json = await res.json();
        setData(json.overview ?? null);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (notEnabled || !data) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        Overview isn&apos;t enabled for your account.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile label="Today's Customers" value={data.todaysCustomers.toLocaleString()} icon={Users} />
        <StatTile label="Open Conversations" value={data.openConversations.toLocaleString()} icon={MessageSquare} />
        <StatTile label="Open Leads" value={data.openLeads.toLocaleString()} icon={Target} />
        <StatTile label="Assigned Deals" value={data.assignedDeals.toLocaleString()} icon={ClipboardList} />
        <StatTile label="Unread Notifications" value={data.unreadNotifications.toLocaleString()} icon={Bell} />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile label="Pending Follow-ups" value={data.pendingFollowups.toLocaleString()} icon={CalendarClock} />
        <StatTile label="Upcoming Meetings" value={data.upcomingMeetings.toLocaleString()} icon={CalendarClock} />
        <StatTile label="Today's Tasks" value={data.todaysTasks.toLocaleString()} icon={CheckSquare} />
        <StatTile
          label="Team Wins (7d)"
          value={`${data.teamPerformance.conversationsClosed.toLocaleString()} closed · ${data.teamPerformance.dealsWon.toLocaleString()} won`}
          icon={Trophy}
        />
        <StatTile label="AI Suggestions (7d)" value={data.aiSuggestionsThisWeek.toLocaleString()} icon={Bot} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4 text-primary" /> Response Time
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold text-foreground">
            {data.avgResponseTimeMinutes === null ? "—" : `${data.avgResponseTimeMinutes} min`}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Average gap between a customer message and your team&apos;s next
            reply, over the last 7 days.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Activity Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            {data.activityTimeline.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recent activity.</p>
            ) : (
              <ul className="space-y-3">
                {data.activityTimeline.map((event) => (
                  <li key={event.id} className="flex items-start justify-between gap-3 text-sm">
                    {event.href ? (
                      <Link href={event.href} className="text-foreground hover:text-primary">
                        {event.text}
                      </Link>
                    ) : (
                      <span className="text-foreground">{event.text}</span>
                    )}
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {new Date(event.at).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <StickyNote className="h-4 w-4 text-primary" /> Recent Notes
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.recentNotes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No notes yet.</p>
            ) : (
              <ul className="space-y-3">
                {data.recentNotes.map((note) => (
                  <li key={note.id} className="text-sm">
                    <p className="text-foreground">{note.noteText}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {note.contactName ?? "Unknown contact"} ·{" "}
                      {new Date(note.createdAt).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Coming Soon</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {data.notTrackedYet.map((label) => (
              <Badge key={label} variant="outline" className="text-muted-foreground">
                {label}
              </Badge>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            No survey mechanism exists yet to measure customer satisfaction.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
