import { t } from "./i18n";
export type ReleaseRecord = {
  version: string;
  name: string;
  body: string;
  publishedAt: string;
};
export type ReleaseHistory = {
  currentVersion: string;
  targetVersion: string;
  releases: ReleaseRecord[];
};
export function releaseVersion(value: string) {
  return value.replace(/^v/, "").split("+")[0];
}
export function releaseRange(current: string, target: string) {
  return `${releaseVersion(current)}→${releaseVersion(target)}`;
}
export function checkedHistory(
  value: unknown,
  current: string,
  target: string,
): ReleaseHistory {
  const data = value as ReleaseHistory | undefined;
  if (
    !data ||
    data.currentVersion !== releaseVersion(current) ||
    data.targetVersion !== releaseVersion(target) ||
    !Array.isArray(data.releases) ||
    data.releases.length === 0 ||
    data.releases.length > 2000 ||
    data.releases[0]?.version !== releaseVersion(target) ||
    data.releases.some(
      (item) =>
        !item ||
        [item.version, item.name, item.body, item.publishedAt].some(
          (field) => typeof field !== "string",
        ),
    ) ||
    new Set(data.releases.map((item) => item.version)).size !==
      data.releases.length
  )
    throw new Error(t("版本历史返回不完整或格式无效，请重试"));
  return data;
}
