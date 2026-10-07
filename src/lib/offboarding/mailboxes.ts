// The mailboxes the Email monitor watches. Client-safe (no server imports):
// the admin page uses it too.
//
//   retiredemployees@  mail for offboarded staff. Spam-filtered.
//   orders@            every email alerts.
// Each tags whoever an admin picked for it on /admin/email-monitor.

export const RETIRED_MAILBOX = "retiredemployees@bigbuildingsdirect.com";
export const ORDERS_MAILBOX = "orders@bigbuildingsdirect.com";

export const MAILBOXES = [
  { address: RETIRED_MAILBOX, label: "Retired employees", filtered: true },
  { address: ORDERS_MAILBOX, label: "Orders", filtered: false },
] as const;

export type MailboxInfo = (typeof MAILBOXES)[number];

export const mailboxInfo = (address: string): MailboxInfo | undefined =>
  MAILBOXES.find((m) => m.address === address);

export const shortMailbox = (address: string) => address.split("@")[0] + "@";
