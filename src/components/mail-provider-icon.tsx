import { Mail } from "lucide-react";
import exmail from "@/assets/mail-providers/exmail.png";
import gmail from "@/assets/mail-providers/gmail.svg";
import microsoft365 from "@/assets/mail-providers/microsoft365.svg";
import netease from "@/assets/mail-providers/netease.png";
import outlook from "@/assets/mail-providers/outlook.svg";
import qq from "@/assets/mail-providers/qq.png";

const providerIcons = new Map([
  ["exmail", exmail],
  ["gmail", gmail],
  ["microsoft365", microsoft365],
  ["netease", netease],
  ["neteaseWork", netease],
  ["outlook", outlook],
  ["qq", qq],
]);

export function MailProviderIcon({ provider }: { provider: string }) {
  const icon = providerIcons.get(provider);
  return (
    <span className="mail-provider-icon" aria-hidden="true">
      {icon ? <img src={icon} alt="" /> : <Mail />}
    </span>
  );
}
