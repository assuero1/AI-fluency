export const WORDS_PAGE_SIZE = 20;

export type PaginatedSlice<T> = {
  pageItems: T[];
  page: number;
  totalPages: number;
  totalItems: number;
};

export function paginateSlice<T>(items: T[], requestedPage: number, pageSize: number = WORDS_PAGE_SIZE): PaginatedSlice<T> {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const normalized = Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1;
  const page = Math.min(Math.max(1, normalized), totalPages);
  return {
    pageItems: items.slice((page - 1) * pageSize, page * pageSize),
    page,
    totalPages,
    totalItems
  };
}
