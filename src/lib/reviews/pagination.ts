type SupabasePageResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

const DEFAULT_PAGE_SIZE = 1000;

export async function fetchAllSupabasePages<T>(
  loadPage: (from: number, to: number) => Promise<SupabasePageResult<T>>,
  pageSize = DEFAULT_PAGE_SIZE
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await loadPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);

    const page = data || [];
    rows.push(...page);

    if (page.length < pageSize) break;
  }

  return rows;
}
