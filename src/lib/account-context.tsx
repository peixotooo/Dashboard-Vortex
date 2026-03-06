"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useWorkspace } from "@/lib/workspace-context";
import type { AdAccount } from "@/lib/types";

interface AccountContextType {
  accountId: string;
  setAccountId: (id: string) => void;
  accounts: AdAccount[];
  loading: boolean;
}

const AccountContext = createContext<AccountContextType>({
  accountId: "",
  setAccountId: () => {},
  accounts: [],
  loading: true,
});

export function useAccount() {
  return useContext(AccountContext);
}

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const { workspace } = useWorkspace();
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [accountId, setAccountId] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const headers: Record<string, string> = {};
      if (workspace?.id) {
        headers["x-workspace-id"] = workspace.id;
      }

      const res = await fetch("/api/accounts", { headers });
      const data = await res.json();
      if (data.accounts && data.accounts.length > 0) {
        setAccounts(data.accounts);

        // Default to "all" when multiple accounts, otherwise select first
        const currentValid = accountId === "all"
          ? data.accounts.length > 1
          : data.accounts.find((a: AdAccount) => a.id === accountId);

        if (!currentValid) {
          if (data.accounts.length > 1) {
            setAccountId("all");
          } else {
            const defaultAccount = data.accounts.find(
              (a: AdAccount & { is_default?: boolean }) => a.is_default
            );
            setAccountId(defaultAccount?.id || data.accounts[0].id);
          }
        }
      } else {
        setAccounts([]);
        setAccountId("");
      }
    } catch {
      // Will show empty state
    } finally {
      setLoading(false);
    }
  }, [workspace?.id, accountId]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  return (
    <AccountContext.Provider value={{ accountId, setAccountId, accounts, loading }}>
      {children}
    </AccountContext.Provider>
  );
}
