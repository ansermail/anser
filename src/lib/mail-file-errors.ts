import { t } from "./i18n";
export function mailFileError(code: unknown, opening = false): string {
  switch (code instanceof Error ? code.message : String(code)) {
    case "archiveCleared":
      return t(
        "Import canceled because local archives were cleared. Completed files follow the confirmed cleanup scope.",
      );
    case "invalidFile":
      return t(
        "Choose a regular mail file. Links and directories are not supported.",
      );
    case "unreadable":
      return t("The source file could not be read.");
    case "tooLarge":
      return t("The message exceeds the 64 MiB limit.");
    case "fileChanged":
      return t("The source file changed. Select it again.");
    case "invalidMessage":
      return t("The file does not contain a recognizable email.");
    case "unsupportedMessage":
      return t(
        "This message contains unsupported content. Its original file was not changed.",
      );
    case "unsupportedMboxVariant":
      return t(
        "This MBOX variant uses Content-Length. Export MBOXrd or EML and try again.",
      );
    case "budgetExceeded":
      return t("The message exceeds the MIME processing limits.");
    case "batchLimit":
      return t(
        "Select mail files totaling up to 1 GiB, with at most 1,000 messages per batch.",
      );
    case "invalidFolder":
      return t("Enter a local folder name of 1–120 characters.");
    case "accountRemoved":
      return t("The target account was removed. Completed imports are kept.");
    case "archiveUnavailable":
      return t(
        "The archive location is unavailable. Reconnect it before importing.",
      );
    case "noSpace":
      return t("There is not enough free space at the archive location.");
    case "archiveWriteFailed":
      return t(
        "The original could not be saved. Check the archive and select unfinished files again.",
      );
    case "databaseFailed":
      return t(
        "The import could not be committed. Completed imports are kept.",
      );
    case "importBusy":
      return t(
        "Another import is running. Wait for it or cancel it in Background tasks.",
      );
    case "staleImport":
      return t("The import changed. Refresh its status.");
    case "interrupted":
      return t(
        "Import interrupted. Select unfinished files again; duplicates will be skipped.",
      );
    case "inTrash":
      return t("Already in local trash. It was not restored.");
    default:
      return opening
        ? t("Could not open this mail file.")
        : t("Import could not continue. Refresh and try again.");
  }
}
