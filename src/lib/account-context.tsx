"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
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
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [accountId, setAccountId] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAccounts() {
      try {
        const res = await fetch("/api/accounts");
        const data = await res.json();
        if (data.accounts && data.accounts.length > 0) {
          setAccounts(data.accounts);
          setAccountId(data.accounts[0].id);
        }
      } catch {
        // Will show empty state
      } finally {
        setLoading(false);
      }
    }
    fetchAccounts();
  }, []);

  return (
    <AccountContext.Provider value={{ accountId, setAccountId, accounts, loading }}>
      {children}
    </AccountContext.Provider>
  );
}
