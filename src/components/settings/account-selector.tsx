"use client";

import React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAccount } from "@/lib/account-context";

export function AccountSelector() {
  const { accountId, setAccountId, accounts, loading } = useAccount();

  if (loading) {
    return (
      <div className="h-9 w-48 animate-pulse rounded-md bg-muted" />
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="text-xs text-muted-foreground px-3 py-2 border border-border rounded-md">
        Nenhuma conta conectada
      </div>
    );
  }

  return (
    <Select value={accountId} onValueChange={setAccountId}>
      <SelectTrigger className="w-48">
        <SelectValue placeholder="Selecione a conta" />
      </SelectTrigger>
      <SelectContent>
        {accounts.map((account) => (
          <SelectItem key={account.id} value={account.id}>
            {account.name || account.account_id}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
