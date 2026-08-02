import { getMembersForUser } from "./memberService.js";
import { getReceiptsForUser } from "./receiptService.js";
import { getSettingsForUser } from "./settingsService.js";

export async function getReportsForUser(userId: number) {
  const members = await getMembersForUser(userId);
  const receipts = await getReceiptsForUser(userId);
  const settings = await getSettingsForUser(userId);

  return {
    members,
    receipts,
    settings,
  };
}
