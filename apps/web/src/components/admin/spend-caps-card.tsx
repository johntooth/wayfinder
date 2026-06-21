"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/trpc/client";

type Period = "daily" | "weekly" | "monthly";

const money = (value: number): string => `$${value.toFixed(2)}`;

interface CapForm {
  userId: string;
  period: Period;
  limitUsd: string;
  warnThresholdPct: string;
  enabled: boolean;
}

const emptyForm: CapForm = {
  userId: "",
  period: "monthly",
  limitUsd: "",
  warnThresholdPct: "80",
  enabled: true,
};

// Per-user spend-cap CRUD. Rendered on both the Cost governance dashboard and
// the Usage admin screen; the shared tRPC query keys keep their caches in sync.
export function SpendCapsCard() {
  const utils = trpc.useUtils();
  const budgetsQuery = trpc.governance.budgets.list.useQuery();
  const usersQuery = trpc.user.list.useQuery({});

  const invalidate = () => {
    void utils.governance.dashboard.invalidate();
    void utils.governance.budgets.list.invalidate();
  };

  const createMutation = trpc.governance.budgets.create.useMutation({ onSuccess: invalidate });
  const updateMutation = trpc.governance.budgets.update.useMutation({ onSuccess: invalidate });
  const deleteMutation = trpc.governance.budgets.delete.useMutation({ onSuccess: invalidate });

  const [form, setForm] = useState<CapForm>({ ...emptyForm });

  const userNameById = new Map(
    (usersQuery.data ?? []).map((user) => [user.id, user.name ?? user.email]),
  );

  const onCreate = async (): Promise<void> => {
    const limitUsd = Number(form.limitUsd);
    const warnThresholdPct = Number(form.warnThresholdPct);
    if (!form.userId || !(limitUsd > 0)) return;
    await createMutation.mutateAsync({
      userId: form.userId,
      period: form.period,
      limitUsd,
      warnThresholdPct: Number.isFinite(warnThresholdPct) ? warnThresholdPct : undefined,
      enabled: form.enabled,
    });
    setForm({ ...emptyForm });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Spend caps</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-6 sm:items-end">
          <div className="sm:col-span-2">
            <Label htmlFor="cap-user">User</Label>
            <select
              id="cap-user"
              className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
              value={form.userId}
              onChange={(e) => setForm({ ...form, userId: e.target.value })}
            >
              <option value="">Select a user…</option>
              {usersQuery.data?.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name ?? user.email}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="cap-period">Period</Label>
            <select
              id="cap-period"
              className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
              value={form.period}
              onChange={(e) => setForm({ ...form, period: e.target.value as Period })}
            >
              <option value="daily">daily</option>
              <option value="weekly">weekly</option>
              <option value="monthly">monthly</option>
            </select>
          </div>
          <div>
            <Label htmlFor="cap-limit">Limit (USD)</Label>
            <Input
              id="cap-limit"
              type="number"
              min="0"
              value={form.limitUsd}
              onChange={(e) => setForm({ ...form, limitUsd: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="cap-warn">Warn %</Label>
            <Input
              id="cap-warn"
              type="number"
              min="1"
              max="100"
              value={form.warnThresholdPct}
              onChange={(e) => setForm({ ...form, warnThresholdPct: e.target.value })}
            />
          </div>
          <Button onClick={() => void onCreate()} disabled={createMutation.isPending}>
            Add cap
          </Button>
        </div>

        {(budgetsQuery.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">No caps configured.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Limit</TableHead>
                <TableHead className="text-right">Warn %</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {budgetsQuery.data?.map((budget) => (
                <TableRow key={budget.id}>
                  <TableCell>{userNameById.get(budget.userId) ?? budget.userId}</TableCell>
                  <TableCell>{budget.period}</TableCell>
                  <TableCell className="text-right">{money(budget.limitUsd)}</TableCell>
                  <TableCell className="text-right">{budget.warnThresholdPct}%</TableCell>
                  <TableCell>{budget.enabled ? <Badge>on</Badge> : "off"}</TableCell>
                  <TableCell className="space-x-2 text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        updateMutation.mutate({ id: budget.id, enabled: !budget.enabled })
                      }
                    >
                      {budget.enabled ? "Disable" : "Enable"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => deleteMutation.mutate({ id: budget.id })}
                    >
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
