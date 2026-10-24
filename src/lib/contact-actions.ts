import { toast } from "sonner";
import { t } from "./i18n";
import { call } from "./api";
import type { Address, Contact } from "./types";

const pending = new Set<string>();

export async function saveContactAddress(address: Address) {
  const key = address.email.toLowerCase();
  if (pending.has(key)) return;
  pending.add(key);
  try {
    const contacts = await call<Contact[]>("list_contacts");
    if (contacts.some((contact) => contact.email.toLowerCase() === key)) {
      toast.info(t("This email address already exists in your contacts"));
      return;
    }
    await call("save_contact", {
      contact: {
        id: crypto.randomUUID(),
        name: address.name,
        email: address.email,
      },
    });
    toast.success(t("Contact saved"));
  } catch (error) {
    if (/已存在|already exists/i.test(String(error))) {
      toast.info(t("This email address already exists in your contacts"));
      return;
    }
    toast.error(
      t("Could not save contact: {value0}", { value0: String(error) }),
    );
  } finally {
    pending.delete(key);
  }
}
