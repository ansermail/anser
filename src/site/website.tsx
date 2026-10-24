import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Archive,
  Check,
  CheckCheck,
  Copy,
  Download,
  FileArchive,
  FileInput,
  Github,
  Globe,
  HardDrive,
  Inbox,
  Languages,
  Mail,
  Play,
  Search,
  ShieldCheck,
  Sparkles,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import zh from "@/locales/site.zh-CN.json";
import en from "@/locales/site.en.json";
import pkg from "../../package.json";
import inboxImage from "../../preview/site/inbox-dark.png";
import archiveImage from "../../preview/site/archive.png";
import rulesImage from "../../preview/site/rules.png";
import composeImage from "../../preview/site/compose.png";
import filmPoster from "../../preview/site/film-poster.jpg";
import filmURL from "../../preview/site/anser-film.mp4";
const base = import.meta.env.BASE_URL;
const media: Record<string, string> = {
  "inbox-dark.png": inboxImage,
  "archive.png": archiveImage,
  "rules.png": rulesImage,
  "compose.png": composeImage,
  "film-poster.jpg": filmPoster,
  "anser-film.mp4": filmURL,
};
const asset = (file: string) => media[file];
const repository = "https://github.com/ansermail/anser";
const install =
  "brew tap --custom-remote ansermail/tap https://github.com/ansermail/anser\nbrew install --cask ansermail/tap/anser";

export function Website() {
  const [language, setLanguage] = useState<"zh-CN" | "en">(() => {
    try {
      return localStorage.getItem("anser-site-language") === "en"
        ? "en"
        : "zh-CN";
    } catch {
      return "zh-CN";
    }
  });
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const copy = language === "en" ? en : zh;
  useEffect(() => {
    document.documentElement.lang = language;
    document.title =
      language === "en"
        ? "Anser — Important mail. Yours to keep."
        : "雁信 Anser — 重要的邮件，留在自己手里";
  }, [language]);
  const switchLanguage = () => {
    const next = language === "en" ? "zh-CN" : "en";
    setLanguage(next);
    try {
      localStorage.setItem("anser-site-language", next);
    } catch {
      /* Private browsing keeps the choice in memory. */
    }
  };
  const copyInstall = async () => {
    try {
      await navigator.clipboard.writeText(install);
      setCopied(true);
      setCopyError(false);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopyError(true);
    }
  };
  const views = [
    {
      id: "inbox",
      name: copy.tabInbox,
      caption: copy.capInbox,
      alt: copy.inboxAlt,
      icon: Inbox,
      image: "inbox-dark.png",
    },
    {
      id: "archive",
      name: copy.tabArchive,
      caption: copy.capArchive,
      alt: copy.archiveAlt,
      icon: Archive,
      image: "archive.png",
    },
    {
      id: "rules",
      name: copy.tabRules,
      caption: copy.capRules,
      alt: copy.rulesAlt,
      icon: Wand2,
      image: "rules.png",
    },
    {
      id: "compose",
      name: copy.tabCompose,
      caption: copy.capCompose,
      alt: copy.composeAlt,
      icon: Mail,
      image: "compose.png",
    },
  ];
  return (
    <div className="anser-site dark">
      <a className="site-skip" href="#main">
        {language === "en" ? "Skip to content" : "跳到正文"}
      </a>
      <header className="site-header site-container">
        <a className="site-brand" href={base} aria-label={copy.home}>
          <img
            src={`${base}app-icon.png`}
            alt={copy.appAlt}
            width={46}
            height={46}
          />
          <span>
            {copy.name}
            <span className="site-wordmark">
              Anser<span className="brand-dot">.</span>
            </span>
          </span>
        </a>
        <nav
          aria-label={language === "en" ? "Primary navigation" : "主导航"}
          className="site-nav"
        >
          <a href="#features">{copy.navFeatures}</a>
          <a href="#film">{copy.navFilm}</a>
          <a
            href={`${repository}/blob/main/docs/USAGE.md`}
            target="_blank"
            rel="noreferrer"
          >
            {copy.guide}
            <ArrowUpRight size={12} />
          </a>
        </nav>
        <div className="site-header-actions">
          <Button
            variant="ghost"
            size="sm"
            onClick={switchLanguage}
            aria-label={copy.language}
          >
            <Globe size={14} />
            <span>{copy.language}</span>
          </Button>
          <Button asChild size="sm" className="site-nav-download">
            <a href="#download">
              {copy.navDownload}
              <ArrowDown size={14} />
            </a>
          </Button>
        </div>
      </header>
      <main id="main">
        <section className="site-hero">
          <div className="site-signal" aria-hidden="true">
            <svg viewBox="0 0 1440 740" preserveAspectRatio="xMidYMid slice">
              <defs>
                <linearGradient id="field" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#263d31" stopOpacity="0" />
                  <stop offset="46%" stopColor="#92ac9b" stopOpacity=".48" />
                  <stop offset="66%" stopColor="#cddec2" stopOpacity=".85" />
                  <stop offset="100%" stopColor="#324b3c" stopOpacity="0" />
                </linearGradient>
              </defs>
              {Array.from({ length: 42 }, (_, i) => (
                <path
                  key={i}
                  d={`M ${-280 + i * 10} 680 C ${260 + i * 7} ${-110 + i * 7}, ${680 + i * 5} ${920 - i * 9}, ${1620 + i * 8} ${-90 + i * 4}`}
                  fill="none"
                  stroke="url(#field)"
                  strokeWidth={i % 5 === 0 ? 1.4 : 0.65}
                />
              ))}
            </svg>
          </div>
          <div className="site-hero-content site-container">
            <a href={`${repository}/releases/latest`} className="site-release">
              <span className="release-light" />v{pkg.version}{" "}
              <span className="release-separator">/</span> {copy.alpha}
              <ArrowUpRight size={12} />
            </a>
            <p className="site-eyebrow">{copy.eyebrow}</p>
            <h1>
              {copy.hero1}
              <br />
              <em>{copy.hero2}</em>
            </h1>
            <p className="site-hero-description">
              {copy.intro}
              <br />
              {copy.intro2}
            </p>
            <div className="site-hero-actions">
              <Button asChild size="lg" className="site-primary">
                <a href="#download">
                  <Download size={18} />
                  {copy.download}
                </a>
              </Button>
              <Button
                asChild
                variant="outline"
                size="lg"
                className="site-secondary"
              >
                <a href={`${base}demo/`}>
                  {copy.demo}
                  <ArrowRight size={18} />
                </a>
              </Button>
            </div>
            <p className="site-platform">{copy.platform}</p>
          </div>
        </section>
        <section
          className="site-container site-showcase"
          aria-label={copy.productLabel}
        >
          <Tabs defaultValue="inbox" className="site-product-tabs">
            <div className="site-product-toolbar">
              <span className="site-product-caption">
                <span className="status-dot" />
                ANSER / DESKTOP
              </span>
              <TabsList variant="line" aria-label={copy.productLabel}>
                {views.map((v) => (
                  <TabsTrigger key={v.id} value={v.id}>
                    <v.icon size={15} />
                    {v.name}
                  </TabsTrigger>
                ))}
              </TabsList>
              <a className="site-preview-link" href={`${base}demo/`}>
                {copy.navDemo}
                <ArrowUpRight size={14} />
              </a>
            </div>
            {views.map((v) => (
              <TabsContent key={v.id} value={v.id}>
                <div className="site-screen">
                  <img
                    src={asset(v.image)}
                    alt={v.alt}
                    width={2880}
                    height={1800}
                    fetchPriority={v.id === "inbox" ? "high" : "auto"}
                  />
                </div>
                <div className="site-screen-caption">
                  <p>{v.caption}</p>
                  <span>{copy.sample}</span>
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </section>
        <section id="features" className="site-container site-archive-section">
          <div className="site-section-intro">
            <p className="site-eyebrow">{copy.archiveEyebrow}</p>
            <h2>
              {copy.archiveTitle1}
              <br />
              <span>{copy.archiveTitle2}</span>
            </h2>
            <p>{copy.archiveBody}</p>
          </div>
          <div className="site-archive-visual" aria-hidden="true">
            <div className="site-archive-orbit" />
            <div className="site-file file-back">
              <FileArchive />
              <span>original.eml</span>
              <small>MIME · ORIGINAL</small>
            </div>
            <div className="site-file file-front">
              <Mail />
              <span>conversation.eml</span>
              <small>
                <CheckCheck size={12} /> LOCAL COPY
              </small>
            </div>
            <div className="site-disk">
              <HardDrive size={20} />
              <span>Saved on your Mac</span>
              <ShieldCheck size={18} />
            </div>
          </div>
          <div className="site-archive-points">
            {[
              {
                title: copy.original,
                body: copy.originalBody,
                icon: FileArchive,
              },
              { title: copy.offline, body: copy.offlineBody, icon: HardDrive },
              { title: copy.backup, body: copy.backupBody, icon: ShieldCheck },
            ].map((v) => (
              <article key={v.title}>
                <v.icon size={21} />
                <h3>{v.title}</h3>
                <p>{v.body}</p>
              </article>
            ))}
          </div>
          <p className="site-footnote">{copy.archiveNote}</p>
        </section>
        <section className="site-container site-rules-section">
          <div className="site-rule-stream">
            <span className="site-small-label">
              MAIL → RULES → A PLACE OF ITS OWN
            </span>
            {[copy.rule1, copy.rule2, copy.rule3].map((title, i) => (
              <div key={title} className="site-rule-row">
                <span className="site-rule-icon">
                  <Mail size={17} />
                </span>
                <div>
                  <strong>{title}</strong>
                  <small>
                    {
                      [
                        copy.ruleCondition1,
                        copy.ruleCondition2,
                        copy.ruleCondition3,
                      ][i]
                    }
                  </small>
                </div>
                <ArrowRight size={16} />
                <span className="site-rule-folder">
                  <Archive size={17} />
                </span>
              </div>
            ))}
          </div>
          <div>
            <p className="site-eyebrow">LESS SORTING. MORE DOING.</p>
            <h2>{copy.rulesTitle}</h2>
            <p className="site-section-body">{copy.rulesBody}</p>
            <a href={`${base}demo/`} className="site-text-link">
              {copy.demo}
              <ArrowUpRight size={16} />
            </a>
          </div>
        </section>
        <section className="site-container site-import-section">
          <div>
            <p className="site-eyebrow">YOUR HISTORY COMES WITH YOU</p>
            <h2>{copy.importTitle}</h2>
            <p className="site-section-body">{copy.importBody}</p>
            <p className="site-footnote">{copy.importFoot}</p>
          </div>
          <div className="site-formats" aria-label="EML, EMLX, MSG, MBOX">
            {["EML", "EMLX", "MSG", "MBOX"].map((f, i) => (
              <div className={`site-format format-${i}`} key={f}>
                <FileInput size={28} />
                <strong>.{f.toLowerCase()}</strong>
                <span>{["EMAIL", "APPLE MAIL", "OUTLOOK", "MAILBOX"][i]}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="site-container site-details-section">
          <div className="site-section-heading">
            <p className="site-eyebrow">THOUGHTFUL BY DESIGN</p>
            <h2>{copy.moreTitle}</h2>
          </div>
          <div className="site-details-grid">
            {[
              { icon: Inbox, title: copy.more1, body: copy.more1Body },
              { icon: Search, title: copy.more2, body: copy.more2Body },
              { icon: Languages, title: copy.more3, body: copy.more3Body },
              { icon: Sparkles, title: copy.more4, body: copy.more4Body },
            ].map((v) => (
              <article key={v.title}>
                <v.icon size={22} />
                <h3>{v.title}</h3>
                <p>{v.body}</p>
              </article>
            ))}
          </div>
        </section>
        <section className="site-container site-film-section" id="film">
          <div>
            <p className="site-eyebrow">THE ANSER FILM</p>
            <h2>{copy.filmTitle}</h2>
            <p className="site-section-body">{copy.filmBody}</p>
          </div>
          <Dialog>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                className="site-film-poster"
                aria-label={copy.watch}
              >
                <img
                  src={asset("film-poster.jpg")}
                  alt=""
                  width={1920}
                  height={1080}
                  loading="lazy"
                />
                <span className="site-film-play">
                  <Play size={25} fill="currentColor" />
                  {copy.watch}
                </span>
              </Button>
            </DialogTrigger>
            <DialogContent className="site-film-dialog sm:max-w-5xl">
              <DialogHeader>
                <DialogTitle>{copy.videoTitle}</DialogTitle>
                <DialogDescription>{copy.sample}</DialogDescription>
              </DialogHeader>
              <video
                controls
                autoPlay
                playsInline
                preload="metadata"
                poster={asset("film-poster.jpg")}
              >
                <source src={asset("anser-film.mp4")} type="video/mp4" />
                {copy.videoFallback}
              </video>
              <a
                href={asset("anser-film.mp4")}
                download
                className="site-text-link"
              >
                {copy.getVideo}
                <Download size={15} />
              </a>
            </DialogContent>
          </Dialog>
        </section>
        <section className="site-container site-download-section" id="download">
          <img
            className="site-download-icon"
            src={`${base}app-icon.png`}
            alt={copy.appAlt}
            width={100}
            height={100}
          />
          <h2>{copy.getTitle}</h2>
          <p>{copy.getBody}</p>
          <div className="site-download-options">
            {[
              { arch: "aarch64", name: copy.arm, sub: copy.armSub },
              { arch: "x86_64", name: copy.intel, sub: copy.intelSub },
            ].map((v) => (
              <a
                key={v.arch}
                href={`${repository}/releases/download/v${pkg.version}/Anser_${pkg.version}_${v.arch}.dmg`}
                className="site-download-option"
              >
                <span>
                  <strong>{v.name}</strong>
                  <small>{v.sub}</small>
                </span>
                <span>
                  {copy.getDmg}
                  <Download size={18} />
                </span>
              </a>
            ))}
          </div>
          <div className="site-install">
            <div>
              <span>{copy.brew}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void copyInstall()}
                aria-label={copy.copy}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? copy.copied : copy.copy}
              </Button>
            </div>
            <pre>
              <code>{install}</code>
            </pre>
            <span role="status">{copyError ? copy.copyFailed : ""}</span>
          </div>
          <p className="site-install-note">{copy.installNote}</p>
        </section>
      </main>
      <footer className="site-container site-footer">
        <div className="site-footer-top">
          <a href={base} className="site-brand">
            <img
              src={`${base}app-icon.png`}
              width={42}
              height={42}
              alt={copy.appAlt}
            />
            <span>
              {copy.name}
              <small>{copy.tagline}</small>
            </span>
          </a>
          <div>
            <a href={repository} target="_blank" rel="noreferrer">
              <Github size={15} />
              {copy.source}
            </a>
            <a
              href={`${repository}/blob/main/docs/USAGE.md`}
              target="_blank"
              rel="noreferrer"
            >
              {copy.guide}
            </a>
            <a href={`${repository}/issues`} target="_blank" rel="noreferrer">
              {copy.feedback}
            </a>
            <a
              href={`${repository}/blob/main/LICENSE`}
              target="_blank"
              rel="noreferrer"
            >
              {copy.license}
            </a>
          </div>
        </div>
        <p>{copy.footerPrivacy}</p>
        <div className="site-footer-bottom">
          <span>© {new Date().getFullYear()} Anser</span>
          <span>{copy.licenseNote}</span>
        </div>
      </footer>
    </div>
  );
}
