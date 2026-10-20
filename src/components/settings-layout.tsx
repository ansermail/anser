import { t } from "@/lib/i18n";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Archive, History, Info, Mail, SlidersHorizontal } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Badge } from "./ui/badge";

const sections = [
  {
    value: "accounts",
    get label() {
      return t("邮箱账号");
    },
    icon: Mail,
  },
  {
    value: "archive",
    get label() {
      return t("本地存档");
    },
    icon: Archive,
  },
  {
    value: "preferences",
    get label() {
      return t("应用偏好");
    },
    icon: SlidersHorizontal,
  },
  {
    value: "tasks",
    get label() {
      return t("后台任务");
    },
    icon: History,
  },
  {
    value: "about",
    get label() {
      return t("关于雁信");
    },
    icon: Info,
  },
] as const;

type Section = (typeof sections)[number]["value"];

export function SettingsLayout({
  value,
  onValueChange,
  accountCount,
  ...panels
}: {
  value: string;
  onValueChange: (value: string) => void;
  accountCount: number;
} & Record<Section, ReactNode>) {
  const container = useRef<HTMLDivElement>(null);
  const panelContainer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (panelContainer.current) panelContainer.current.scrollTop = 0;
  }, [value]);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setCompact(entry.contentRect.width < 900);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={container} className="settings-layout-container">
      <Tabs
        value={value}
        onValueChange={onValueChange}
        orientation={compact ? "horizontal" : "vertical"}
        className="settings-layout"
      >
        <TabsList aria-label={t("设置分类")} className="settings-navigation">
          {sections.map((section) => (
            <TabsTrigger key={section.value} value={section.value}>
              <section.icon />
              <span>{section.label}</span>
              {section.value === "accounts" && (
                <Badge variant="secondary" className="ml-auto">
                  {accountCount}
                </Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
        <div ref={panelContainer} className="settings-panels">
          {sections.map((section) => (
            <TabsContent
              key={section.value}
              value={section.value}
              forceMount
              hidden={value !== section.value}
              className="settings-section"
            >
              {panels[section.value]}
            </TabsContent>
          ))}
        </div>
      </Tabs>
    </div>
  );
}
