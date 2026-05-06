// src/lib/email-templates/test-list.ts
//
// Find-or-create a stable Locaweb list to use for "test send" previews.
// Originally each test created a brand-new throwaway list — the panel
// piled up to hundreds of `_test_<short>` lists over time. This helper
// keeps a single named list per recipient instead, reusing it on every
// subsequent test.
//
// Naming: `Vortex · Teste · <email>`. Easy to recognize in the Locaweb
// panel and tied 1:1 to the user receiving previews.

import {
  addContactsToList,
  createList,
  listLists,
  type LocawebCreds,
} from "@/lib/locaweb/email-marketing";

function buildName(email: string): string {
  return `Vortex · Teste · ${email.trim().toLowerCase()}`;
}

/**
 * Returns the id of the workspace's test list for the given email,
 * creating it on first use. Idempotent: calling twice with the same
 * email returns the same id and doesn't duplicate the contact.
 */
export async function ensureTestList(args: {
  creds: LocawebCreds;
  email: string;
}): Promise<{ list_id: string | number; list_name: string; created: boolean }> {
  const email = args.email.trim().toLowerCase();
  if (!email) throw new Error("Email vazio.");
  const target = buildName(email);

  // listLists returns the workspace's lists. We do a case-insensitive
  // match — Locaweb stores the name as-typed but the panel tends to
  // lowercase on display in some places.
  let existing: { id: string | number; name: string } | undefined;
  try {
    const lists = await listLists(args.creds);
    existing = lists.find(
      (l) => typeof l.name === "string" && l.name.trim().toLowerCase() === target.toLowerCase()
    );
  } catch {
    // If listing fails we fall through and try to create — Locaweb
    // sometimes 5xx's the list endpoint transiently and we'd rather
    // create a duplicate than refuse to send a test.
  }

  let listId: string | number;
  let created = false;
  if (existing) {
    listId = existing.id;
  } else {
    const list = await createList(args.creds, target);
    const id =
      list.id ??
      (typeof list._location === "string"
        ? list._location.split("/").filter(Boolean).pop() ?? null
        : null);
    if (id == null) throw new Error("Locaweb não retornou id da lista de teste.");
    listId = id;
    created = true;
  }

  // Add contact unconditionally — Locaweb's contacts endpoint is
  // idempotent (duplicate emails don't error), so we don't need to
  // check membership first.
  await addContactsToList(args.creds, listId, [{ email }]);

  return { list_id: listId, list_name: target, created };
}
