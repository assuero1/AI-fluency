export type TeableRecord<TFields extends Record<string, unknown> = Record<string, unknown>> = {
  id: string;
  fields: TFields;
  createdTime?: string;
};

export class TeableConfigError extends Error {
  status = 503;
}

export class TeableRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public detail?: unknown
  ) {
    super(message);
  }
}
