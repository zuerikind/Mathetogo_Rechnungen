export type Tutor24Result = {
  messaged: number;
  skipped: number;
  errors: string[];
  log: string[];
  newContacts: { name: string; tutor24Id: string; profileUrl: string }[];
};
